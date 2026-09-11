import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'path';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { Document, Model } from 'mongoose';
import im from 'imagemagick';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { Image } from '@fg2/shared-types';
import { logger } from '@utils/logger';
import { ImageStore } from '../../database/image-store';
import { MODEL } from '../../database/models.module';

const escapeXml = (value: string): string =>
  value.replace(/[<>&'"]/g, character => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' }[character]};`);

/**
 * The stored pictures: finding one, adding one a user uploaded, and handing the
 * bytes of one out however the caller needs them. What fills the store is the
 * webcam poller and the timelapse builder beside it.
 */
@Injectable()
export class ImageService {
  constructor(
    @InjectModel(MODEL.image) private readonly images: Model<Image & Document>,
    private readonly store: ImageStore,
  ) {}

  public async getDeviceImage(
    device_id: string,
    format: string,
    timestamp?: number,
    duration?: string,
    imageId?: string,
  ): Promise<Image | undefined> {
    return this.images
      .findOne({
        device_id,
        format: { $eq: format as 'jpeg' | 'mp4' },
        duration: (duration as '1d' | '1w' | '1m') || undefined,
        ...(!imageId || timestamp ? { timestamp: { $lte: timestamp ? timestamp : Date.now() } } : {}),
        ...(imageId ? { image_id: imageId } : {}),
      })
      .sort({ timestamp: -1 });
  }

  public async getImageById(image_id: string): Promise<Image | undefined> {
    return this.images.findOne({ image_id });
  }

  public async createDeviceImage(device_id: string, source: Buffer, timestamp?: number): Promise<Image> {
    const jpegData = await this.convertToJpeg(source);

    return this.store.createImage(
      {
        image_id: uuidv4(),
        device_id,
        format: 'user/jpeg',
        timestamp: Number.isFinite(timestamp) ? (timestamp as number) : Date.now(),
      },
      jpegData,
    );
  }

  /** The bytes of a picture, wherever they are kept. */
  public async readImageData(image: Image): Promise<Buffer> {
    return image.data ?? this.store.download(image.image_id);
  }

  /**
   * The bytes of a picture as a stream, optionally one byte range of it
   * (inclusive `end`, as an HTTP Range header counts). A timelapse runs to tens
   * of megabytes, so serving one never holds the whole file in memory.
   */
  public readImageStream(image: Image, range?: { start: number; end: number }): Readable {
    if (image.data) {
      return Readable.from(range ? image.data.subarray(range.start, range.end + 1) : image.data);
    }

    return this.store.read(image.image_id, range);
  }

  /** How large the picture is, for Content-Length and for resolving a Range. */
  public imageSize(image: Image): number | undefined {
    return image.data ? image.data.length : image.size;
  }

  // Draws a caption box over a still, in the style of the webapp's device offline
  // overlay. A failure here must not cost the caller the picture itself.
  public async addOfflineOverlay(image: Buffer, caption: string): Promise<Buffer> {
    try {
      const { width, height } = await sharp(image).metadata();
      if (!width || !height) {
        return image;
      }

      // SVG text cannot be measured up front, so the caption is laid out from the
      // average glyph width of the font: big enough to read, small enough to fit.
      const averageGlyphWidth = 0.62;
      const fontSize = Math.max(10, Math.min(Math.round(width / 30), Math.floor((width * 0.6) / (caption.length * averageGlyphWidth))));
      const padding = Math.round(fontSize * 0.7);
      const boxWidth = Math.min(width - padding, Math.round(caption.length * fontSize * averageGlyphWidth) + padding * 2);
      const boxHeight = fontSize + padding * 2;

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="rgb(24,26,32)" fill-opacity="0.52"/>
        <rect x="${(width - boxWidth) / 2}" y="${(height - boxHeight) / 2}" width="${boxWidth}" height="${boxHeight}"
              rx="${Math.round(fontSize * 0.4)}" fill="rgb(13,14,18)" fill-opacity="0.72"
              stroke="rgb(255,255,255)" stroke-opacity="0.16"/>
        <text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="central"
              font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="bold" fill="#f3f5f8">${escapeXml(caption)}</text>
      </svg>`;

      return await sharp(image)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .jpeg()
        .toBuffer();
    } catch (error) {
      logger.error(`Failed drawing the offline overlay: ${error}`);
      return image;
    }
  }

  public async deleteImage(image_id: string): Promise<boolean> {
    const result = await this.images.deleteOne({ image_id });
    return (result?.deletedCount ?? 0) > 0;
  }

  private async convertToJpeg(source: Buffer): Promise<Buffer> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'image-upload-'));
    const srcPath = join(tmpDir, `source-${uuidv4()}`);
    const dstPath = join(tmpDir, `image-${uuidv4()}.jpeg`);

    try {
      await writeFile(srcPath, source);
      await new Promise<void>((resolve, reject) => {
        im.convert([srcPath, '-auto-orient', `jpeg:${dstPath}`], err => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
      return await readFile(dstPath);
    } finally {
      await unlink(srcPath).catch(() => Promise.resolve());
      await unlink(dstPath).catch(() => Promise.resolve());
      await rmdir(tmpDir).catch(() => Promise.resolve());
    }
  }
}
