import { forwardRef, Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'path';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { Document, Model } from 'mongoose';
import im from 'imagemagick';
import pLimit from 'p-limit';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { CloudSettings, Device, Image } from '@fg2/shared-types';
import { HttpException } from '@common/http-exception';
import { logger } from '@utils/logger';
import { MODEL } from '../../database/models.module';
import { OkamP2PService, OKAM_STREAM_PREFIX } from '../camera/okam-p2p.service';
import { DeviceService } from '../device/device.service';
import { TunnelService } from '../tunnel/tunnel.service';
const escapeXml = (value: string): string =>
  value.replace(/[<>&'"]/g, character => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' }[character]};`);

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

// Under MongoDB's 16 MB document limit, with room for the rest of the document.
const MAX_STORED_IMAGE_BYTES = 15 * 1024 * 1024;

const READ_IMAGE_CHECK_INTERVAL_MS = 5_000;
const IMAGE_LOAD_INTERVAL_MS = 30_000;
const IMAGE_LOAD_MAX_BACKOFF_INTERVAL_MS = 120 * 60_000;
const COMPRESS_INTERVAL_MS = 60 * 60 * 1000;
const THIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

// The weekly/monthly timelapses cover far more source frames than the daily one, so
// recompressing them every time a single new frame arrives wastes CPU for little
// visible benefit. Only rebuild them once enough new frames have accumulated since
// the last rebuild (tracked via the existing timelapse's timestampEnd).
const DAILY_COMPRESS_REFRESH_MS = 60 * 60 * 1000;
const WEEKLY_COMPRESS_REFRESH_MS = 4 * 60 * 60 * 1000;
const MONTHLY_COMPRESS_REFRESH_MS = 12 * 60 * 60 * 1000;

const FFMPEG_THROTTLE_MS = 1_000;
const FFMPEG_TIMEOUT_MS = 90_000;

// When the connection to a camera drops mid-frame (e.g. through a firmware tunnel),
// ffmpeg still emits the partially decoded frame and exits successfully, only noting
// the corruption on stderr at warning level. Frames whose stderr matches one of these
// decoder/demuxer corruption indicators are discarded instead of saved.
const FFMPEG_CORRUPT_FRAME_PATTERN =
  /EOI missing|No JPEG data found|error while decoding|concealing \d+|Packet corrupt|corrupt decoded frame|incomplete frame|RTP: missed|truncat/i;

// A corrupt frame means the camera was reachable and streaming, so unlike
// connection failures it does not count towards the retry backoff.
class CorruptFrameError extends Error {}
const IMAGE_RETENTION_DAYS = 3 * 365;

// Gradually thin out raw camera images as they age: once an image is older than
// `afterMs`, no more than one is kept per `minIntervalMs`. Ordered oldest-boundary
// last so each tier only thins images younger than the next, coarser tier.
const IMAGE_THINNING_TIERS = [
  { afterMs: MS_IN_A_DAY, minIntervalMs: 60 * 1000 },
  { afterMs: 7 * MS_IN_A_DAY, minIntervalMs: 5 * 60 * 1000 },
  { afterMs: 30 * MS_IN_A_DAY, minIntervalMs: 15 * 60 * 1000 },
  { afterMs: 90 * MS_IN_A_DAY, minIntervalMs: 60 * 60 * 1000 },
];

const TIMELAPSE_DAY_FRAMEINTERVAL_MS = 2 * 60 * 1000;
const TIMELAPSE_FRAME_RATE = 25;

@Injectable()
export class ImageService implements OnModuleInit, OnApplicationShutdown {
  private ffmpegLimit = pLimit(10);
  private deviceIdToLastRtspState = new Map<string, { lastTry: number; failureCount: number }>();
  private lastThinningRun = 0;
  private readonly startupTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    @InjectModel(MODEL.image) private readonly images: Model<Image & Document>,
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    @Inject(forwardRef(() => DeviceService)) private readonly deviceService: DeviceService,
    private readonly tunnel: TunnelService,
    private readonly okam: OkamP2PService,
  ) {}

  /**
   * The pollers that read the cameras and roll up the timelapses. They used to
   * start as this file was imported, which is before the server can serve a
   * request - and before the database connection is necessarily up.
   */
  public onModuleInit(): void {
    this.startupTimers.push(setTimeout(() => void this.readFromRtspStreams(), 30_000));
    this.startupTimers.push(setTimeout(() => void this.compressRtspStreams(), 60_000));
  }

  public onApplicationShutdown(): void {
    for (const timer of this.startupTimers) clearTimeout(timer);
  }

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

    // A picture is stored inside its document, and MongoDB stops at 16 MB. The
    // check is on the converted image because that is what gets written - a
    // large source often shrinks to a fraction of it.
    if (jpegData.length > MAX_STORED_IMAGE_BYTES) {
      throw new HttpException(413, 'Image is too large');
    }

    return this.images.create({
      image_id: uuidv4(),
      device_id,
      format: 'user/jpeg',
      timestamp: Number.isFinite(timestamp) ? (timestamp as number) : Date.now(),
      data: jpegData,
    });
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
      logger.info('Failed drawing the offline overlay:', error);
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

  private getDeviceWorkmode(configuration?: string): string | undefined {
    if (!configuration) {
      return undefined;
    }
    try {
      return JSON.parse(configuration)?.workmode;
    } catch {
      return undefined;
    }
  }

  private async readFromRtspStreams(): Promise<void> {
    const devices = await this.devices.find({
      'cloudSettings.rtspStream': { $exists: true, $ne: '' },
    });

    const promises: Promise<void>[] = [];
    for (const device of devices) {
      if (!this.deviceIdToLastRtspState.has((await device).device_id)) {
        this.deviceIdToLastRtspState.set(device.device_id, { lastTry: 0, failureCount: 0 });
      }

      if (device.cloudSettings?.maintenanceWebcamOff) {
        const isInMaintenanceMode = !!device.maintenance_mode_until && device.maintenance_mode_until > Date.now();
        const isWorkmodeOff = this.getDeviceWorkmode(device.configuration) === 'off';
        if (isInMaintenanceMode || isWorkmodeOff) {
          continue;
        }
      }

      const state = this.deviceIdToLastRtspState.get(device.device_id);
      if (
        (state?.lastTry ?? 0) <=
        Date.now() - Math.min(IMAGE_LOAD_INTERVAL_MS * Math.pow(2, state?.failureCount ?? 0), IMAGE_LOAD_MAX_BACKOFF_INTERVAL_MS)
      ) {
        promises.push(
          this.ffmpegLimit(() =>
            this.readRtspStreamImage(device.cloudSettings, device.device_id)
              .then(
                async image =>
                  void this.images.create({
                    image_id: uuidv4(),
                    device_id: device.device_id,
                    format: 'jpeg',
                    timestamp: Date.now(),
                    data: image,
                  }),
              )
              .then(() => {
                state.failureCount = 0;
              })
              .catch(e => {
                logger.info(`Error reading RTSP stream ${device.cloudSettings.rtspStream} for device ${device.device_id}:`, e?.message);
                state.failureCount = e instanceof CorruptFrameError ? 0 : (state.failureCount ?? 0) + 1;
                return Promise.resolve();
              })
              .finally(() => {
                state.lastTry = Date.now();
              }),
          ),
        );
      }

      await new Promise(r => setTimeout(r, FFMPEG_THROTTLE_MS));
    }

    await Promise.all(promises);

    setTimeout(() => {
      void this.readFromRtspStreams();
    }, READ_IMAGE_CHECK_INTERVAL_MS);
  }

  public async testRtspStream(
    device_id: string,
    settings: Pick<CloudSettings, 'rtspStream' | 'rtspStreamTransport' | 'tunnelRtspStream'>,
  ): Promise<Buffer> {
    return this.ffmpegLimit(() => this.readRtspStreamImage({ ...settings, logRtspStreamErrors: false }, device_id));
  }

  public reportDeviceConfigured(device_id: string): void {
    const state = this.deviceIdToLastRtspState.get(device_id);
    if (state) {
      state.lastTry = 0;
      state.failureCount = 0;
    }
  }

  private async compressRtspStreams(): Promise<void> {
    try {
      const devices = await this.devices.find({ 'cloudSettings.rtspStream': { $exists: true, $ne: '' } });

      const shouldThin = Date.now() - this.lastThinningRun >= THIN_INTERVAL_MS;

      for (const device of devices) {
        const oldImages = await this.images
          .find({
            device_id: device.device_id,
            format: 'jpeg',
            timestamp: { $lt: Date.now() - IMAGE_RETENTION_DAYS * MS_IN_A_DAY },
          })
          .select({ image_id: 1 });
        for (const oldImage of oldImages) {
          await this.images.deleteOne({ image_id: oldImage.image_id });
        }

        await this.compressRtspStreamRange(device, MS_IN_A_DAY, TIMELAPSE_DAY_FRAMEINTERVAL_MS, '1d', DAILY_COMPRESS_REFRESH_MS);
        await this.compressRtspStreamRange(device, 7 * MS_IN_A_DAY, 7 * TIMELAPSE_DAY_FRAMEINTERVAL_MS, '1w', WEEKLY_COMPRESS_REFRESH_MS);
        await this.compressRtspStreamRange(device, 30 * MS_IN_A_DAY, 30 * TIMELAPSE_DAY_FRAMEINTERVAL_MS, '1m', MONTHLY_COMPRESS_REFRESH_MS);

        if (shouldThin) {
          await this.thinRtspStreamImages(device);
        }
      }

      if (shouldThin) {
        this.lastThinningRun = Date.now();
      }
    } finally {
      setTimeout(() => {
        void this.compressRtspStreams();
      }, COMPRESS_INTERVAL_MS);
    }
  }

  private async compressRtspStreamRange(
    device: Device,
    timeStep: number,
    minFrameIntervalMs: number,
    targetDuration: '1d' | '1w' | '1m',
    refreshIntervalMs: number,
  ): Promise<void> {
    const currentPeriodEndTimestamp = Math.ceil(Date.now() / timeStep) * timeStep;
    let endTimestamp = currentPeriodEndTimestamp;

    while (true) {
      const startTimestamp = endTimestamp - timeStep;
      const compressedImage = await this.images
        .findOne({
          device_id: device.device_id,
          format: 'mp4',
          timestamp: startTimestamp,
          duration: targetDuration,
        })
        .select({ image_id: 1, timestampEnd: 1 });

      const getImages = (beforeTimestamp: number, limit: number) =>
        this.images
          .find({
            device_id: device.device_id,
            format: 'jpeg',
            timestamp: {
              $lt: beforeTimestamp,
              $gte: startTimestamp,
            },
          })
          .sort({ timestamp: -1 })
          .select({ image_id: 1, timestamp: 1 })
          .limit(limit);

      const newestImage = (await getImages(endTimestamp, 1))?.[0];

      // Only the still-open (current) period gets new frames appended repeatedly, so only
      // throttle it; a closed/past period is rebuilt once as soon as it's complete either way.
      const isCurrentPeriod = endTimestamp === currentPeriodEndTimestamp;
      const staleEnoughToRefresh =
        !compressedImage ||
        (isCurrentPeriod
          ? newestImage?.timestamp - compressedImage.timestampEnd >= refreshIntervalMs
          : compressedImage.timestampEnd < (newestImage?.timestamp ?? -Infinity));

      if (newestImage && staleEnoughToRefresh) {
        const images = newestImage ? [newestImage] : [];

        let imagesAdded = true;
        while (imagesAdded) {
          imagesAdded = false;
          const moreImages = await getImages(images.length > 0 ? images[0].timestamp : endTimestamp, 500);

          for (const image of moreImages) {
            if (images.length > 0 && images[0].timestamp - image.timestamp < minFrameIntervalMs) {
              continue;
            }

            imagesAdded = true;
            images.unshift(image);
          }
        }

        const video = await this.compressRtspStreamImages(device, images);

        if (video) {
          if (compressedImage) {
            await this.images.deleteOne({ image_id: compressedImage.image_id });
          }

          await this.images.create({
            image_id: uuidv4(),
            device_id: device.device_id,
            timestamp: startTimestamp,
            timestampEnd: images[images.length - 1]?.timestamp,
            data: video,
            format: 'mp4',
            duration: targetDuration,
          });
        }

        endTimestamp -= timeStep;
      } else {
        return;
      }
    }
  }

  private async thinRtspStreamImages(device: Device): Promise<void> {
    const now = Date.now();
    for (let i = 0; i < IMAGE_THINNING_TIERS.length; i++) {
      const tier = IMAGE_THINNING_TIERS[i];
      const coarserTier = IMAGE_THINNING_TIERS[i + 1];
      const maxTimestamp = now - tier.afterMs;
      const minTimestamp = coarserTier ? now - coarserTier.afterMs : 0;
      await this.thinImageRange(device.device_id, minTimestamp, maxTimestamp, tier.minIntervalMs);
    }
  }

  private async thinImageRange(deviceId: string, minTimestamp: number, maxTimestamp: number, minIntervalMs: number): Promise<void> {
    const cursor = this.images
      .find({ device_id: deviceId, format: 'jpeg', timestamp: { $gte: minTimestamp, $lt: maxTimestamp } })
      .sort({ timestamp: 1 })
      .select({ image_id: 1, timestamp: 1 })
      .cursor();

    let lastKeptTimestamp = -Infinity;
    let toDelete: string[] = [];
    const flush = async () => {
      if (toDelete.length === 0) return;
      await this.images.deleteMany({ image_id: { $in: toDelete } });
      toDelete = [];
    };

    for (let image = await cursor.next(); image != null; image = await cursor.next()) {
      if (image.timestamp - lastKeptTimestamp < minIntervalMs) {
        toDelete.push(image.image_id);
        if (toDelete.length >= 500) {
          await flush();
        }
      } else {
        lastKeptTimestamp = image.timestamp;
      }
    }
    await flush();
  }

  private async compressRtspStreamImages(device: Device, images: Omit<Image, 'data'>[]): Promise<Buffer | undefined> {
    const filesWritten = [];
    const tmpDir = await mkdtemp(join(tmpdir(), device.device_id));

    try {
      let sequenceNumber = 1;
      for (const image of images) {
        const imageData = await this.images.findOne({
          image_id: image.image_id,
          format: 'jpeg',
        });
        if (imageData) {
          // pad sequence number with leading zeros
          const filename = `${tmpDir}/${sequenceNumber++}.jpeg`;
          filesWritten.push(filename);
          await writeFile(filename, imageData.data);
        }
      }

      if (filesWritten.length >= TIMELAPSE_FRAME_RATE / 2) {
        return await this.convertRtspStreamImagesToVideo(tmpDir);
      }
    } catch (e) {
      logger.info('Error compressing RTSP images for device ' + device.device_id + ':', e);
    } finally {
      for (const file of filesWritten) {
        try {
          await unlink(file);
        } catch (e) {
          logger.info('Error deleting temp file ' + file + ':', e);
        }
      }
      try {
        await rmdir(tmpDir);
      } catch (e) {
        logger.info('Error deleting temp dir ' + tmpDir + ':', e);
      }
    }

    return undefined;
  }

  private async readRtspStreamImage(cloudSettings: CloudSettings, deviceId: string): Promise<Buffer> {
    // O-KAM / VStarcam cameras have no LAN RTSP: they are reached over the
    // reverse-engineered P2P protocol through the controller's UDP tunnel. They
    // are configured as `okam://<device-id>` in rtspStream so that everything
    // else here — the poll schedule, backoff, maintenance gating, the test-image
    // button, storage, timelapses and thinning — is reused unchanged.
    if (cloudSettings.rtspStream?.startsWith(OKAM_STREAM_PREFIX)) {
      return this.okam.captureViaController(deviceId);
    }

    let streamUrl = cloudSettings.rtspStream;
    if (cloudSettings.tunnelRtspStream) {
      streamUrl = await this.tunnel.createTunnelProxyServer(new URL(cloudSettings.rtspStream), deviceId);
    }

    return new Promise((resolve, reject) => {
      execFile(
        'ffmpeg',
        [
          // Decoder messages about corrupt/truncated frames (e.g. "EOI missing,
          // emulating") are logged at warning level, so "error" would hide them.
          '-loglevel',
          'warning',
          '-threads',
          '1',
          '-y',
          ...(cloudSettings.rtspStream.startsWith('rtsp://') ? ['-rtsp_transport', cloudSettings.rtspStreamTransport ?? 'tcp'] : []),
          // Skip ffmpeg's default stream analysis and non-keyframe decoding: we only need a
          // single still frame, so grabbing the next keyframe immediately is far cheaper.
          '-fflags',
          'nobuffer',
          '-flags',
          'low_delay',
          '-probesize',
          '32',
          '-analyzeduration',
          '0',
          '-skip_frame',
          'nokey',
          '-i',
          streamUrl,
          '-q:v',
          '20',
          '-vframes',
          '1',
          '-f',
          'mjpeg',
          '-',
        ],
        {
          timeout: FFMPEG_TIMEOUT_MS,
          maxBuffer: 5 * 1024 * 1024,
          encoding: 'buffer',
        },
        (error, stdout, stderr) => {
          const corruptionIndicator = !error && FFMPEG_CORRUPT_FRAME_PATTERN.exec(String(stderr))?.[0];
          if (error || !stdout || stdout.length === 0 || corruptionIndicator) {
            if (cloudSettings.logRtspStreamErrors) {
              void this.deviceService.logMessage(deviceId, {
                title: 'message-rtsp-stream-error',
                message: `message-rtsp-stream-error:${stderr}`,
                severity: 1,
                categories: ['webcam', 'error'],
              });
            }
            reject(
              error ??
                (corruptionIndicator
                  ? new CorruptFrameError(`discarding corrupt frame ("${corruptionIndicator}")`)
                  : new Error('ffmpeg produced no output')),
            );
          } else {
            resolve(stdout);
          }
        },
      );
    });
  }

  private convertRtspStreamImagesToVideo(filesDir: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      execFile(
        'ffmpeg',
        [
          '-loglevel',
          'error',
          '-threads',
          '1',
          '-y',
          '-framerate',
          String(TIMELAPSE_FRAME_RATE),
          '-f',
          'image2',
          '-i',
          `${filesDir}/%d.jpeg`,
          '-f',
          'mp4',
          '-vcodec',
          'libx265',
          '-crf',
          '30',
          `${filesDir}/result.mp4`,
        ],
        {
          timeout: 15 * 60000,
          maxBuffer: 50 * 1024 * 1024,
          encoding: 'buffer',
        },
        (error, stdout, stderr) => {
          if (error) {
            logger.info('Error compressing RTSP stream images:', stderr, error);
            reject(error);
          } else {
            readFile(`${filesDir}/result.mp4`)
              .then(data => resolve(data))
              .catch(err => {
                logger.info(`Error reading result file ${filesDir}/result.mp4:`, err);
                reject(err);
              })
              .finally(() => unlink(`${filesDir}/result.mp4`).catch(() => Promise.resolve()));
          }
        },
      );
    });
  }
}
