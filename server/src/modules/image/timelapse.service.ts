import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'path';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { Document, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Device, Image } from '@fg2/shared-types';
import { logger } from '@utils/logger';
import { BackgroundWork } from '../../common/background-work';
import { ImageStore } from '../../database/image-store';
import { MODEL } from '../../database/models.module';

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

const COMPRESS_INTERVAL_MS = 60 * 60 * 1000;
const THIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

// The weekly/monthly timelapses cover far more source frames than the daily one, so
// recompressing them every time a single new frame arrives wastes CPU for little
// visible benefit. Only rebuild them once enough new frames have accumulated since
// the last rebuild (tracked via the existing timelapse's timestampEnd).
const DAILY_COMPRESS_REFRESH_MS = 60 * 60 * 1000;
const WEEKLY_COMPRESS_REFRESH_MS = 4 * 60 * 60 * 1000;
const MONTHLY_COMPRESS_REFRESH_MS = 12 * 60 * 60 * 1000;

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

/**
 * Rolls the stored stills up into the day, week and month timelapses a client
 * plays back, and thins the stills themselves out as they age - a year of
 * full-resolution frames every thirty seconds is not worth keeping once the
 * videos made from them exist.
 */
@Injectable()
export class TimelapseService implements OnModuleInit, OnApplicationShutdown {
  private lastThinningRun = 0;
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL.image) private readonly images: Model<Image & Document>,
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    private readonly store: ImageStore,
  ) {}

  /**
   * The builder used to start as this file was imported, which is before the
   * server can serve a request - and before the database connection is
   * necessarily up.
   */
  public onModuleInit(): void {
    this.work.schedule('The timelapse builder', () => this.compressRtspStreams(), 60_000);
  }

  public onApplicationShutdown(): void {
    logger.info('Stopping the timelapse builder');
    this.work.stop();
  }

  private async compressRtspStreams(): Promise<void> {
    try {
      const devices = await this.devices.find({ 'cloudSettings.rtspStream': { $exists: true, $ne: '' } });

      const shouldThin = Date.now() - this.lastThinningRun >= THIN_INTERVAL_MS;

      for (const device of devices) {
        // As in the poller: a pass walks every device and runs ffmpeg as it
        // goes, so it has to notice the server stopping around it.
        if (this.work.isStopped) break;

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
      this.work.schedule('The timelapse builder', () => this.compressRtspStreams(), COMPRESS_INTERVAL_MS);
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
          // `size` says where the bytes are without dragging them along: a
          // picture written before the move to the image store has none.
          .select({ image_id: 1, timestamp: 1, size: 1 })
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

        await this.compressRtspStreamImages(device, images, async videoPath => {
          if (compressedImage) {
            await this.images.deleteOne({ image_id: compressedImage.image_id });
          }

          await this.store.createImageFromFile(
            {
              image_id: uuidv4(),
              device_id: device.device_id,
              timestamp: startTimestamp,
              timestampEnd: images[images.length - 1]?.timestamp,
              format: 'mp4',
              duration: targetDuration,
            },
            videoPath,
          );
        });

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

  /**
   * Encode the frames into a timelapse and hand the finished file to `store`.
   * Frames and video stay on disk from beginning to end - a day of
   * full-resolution stills is tens of megabytes as a video and far more as
   * frames, and neither the store nor ffmpeg needs any of it in memory.
   * Answers whether a video was produced and stored.
   */
  private async compressRtspStreamImages(
    device: Device,
    images: Pick<Image, 'image_id' | 'timestamp' | 'size'>[],
    store: (videoPath: string) => Promise<void>,
  ): Promise<boolean> {
    const filesWritten = [];
    const tmpDir = await mkdtemp(join(tmpdir(), device.device_id));
    const videoPath = `${tmpDir}/result.mp4`;

    try {
      let sequenceNumber = 1;
      for (const image of images) {
        const filename = `${tmpDir}/${sequenceNumber}.jpeg`;
        try {
          await this.copyImageToFile(image, filename);
        } catch (e) {
          logger.error(`Skipping frame ${image.image_id} of device ${device.device_id}: ${e}`);
          continue;
        }
        sequenceNumber++;
        filesWritten.push(filename);
      }

      if (filesWritten.length >= TIMELAPSE_FRAME_RATE / 2) {
        await this.convertRtspStreamImagesToVideo(tmpDir);
        await store(videoPath);
        return true;
      }
    } catch (e) {
      logger.error(`Error compressing RTSP images for device ${device.device_id}: ${e}`);
    } finally {
      for (const file of [...filesWritten, videoPath]) {
        try {
          await unlink(file);
        } catch {
          // ffmpeg never ran, or the frame was already gone: nothing to report.
        }
      }
      try {
        await rmdir(tmpDir);
      } catch (e) {
        logger.error(`Error deleting temp dir ${tmpDir}: ${e}`);
      }
    }

    return false;
  }

  /** One stored frame on disk, from wherever its bytes are kept. */
  private async copyImageToFile(image: Pick<Image, 'image_id' | 'size'>, path: string): Promise<void> {
    if (image.size === undefined) {
      // No size means the picture predates the image store and carries its bytes
      // in the document. Only then is it worth a second query to fetch them.
      const legacy = await this.images.findOne({ image_id: image.image_id }).select({ data: 1 });
      if (legacy?.data) {
        await writeFile(path, legacy.data);
        return;
      }
    }

    await this.store.copyToFile(image.image_id, path);
  }

  /** Encodes the frames in `filesDir` into `result.mp4` beside them. */
  private convertRtspStreamImagesToVideo(filesDir: string): Promise<void> {
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
            logger.error(`Error compressing RTSP stream images: ${error} ${stderr}`);
            reject(error);
          } else {
            resolve();
          }
        },
      );
    });
  }
}
