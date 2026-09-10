import { forwardRef, Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'path';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { Document, Model } from 'mongoose';
import im from 'imagemagick';
import pLimit from 'p-limit';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { CloudSettings, Device, Image } from '@fg2/shared-types';
import { logger } from '@utils/logger';
import { BackgroundWork, logIfItFails } from '../../common/background-work';
import { withoutCredentials } from '../../common/log-path';
import { ImageStore } from '../../database/image-store';
import { MODEL } from '../../database/models.module';
import { TerpCamDirectService } from '../camera/terpcam-direct.service';
import { TerpCamP2PService, terpCamLabel } from '../camera/terpcam-p2p.service';
import { DeviceService, ONLINE_TIMEOUT } from '../device/device.service';
import { TunnelService } from '../tunnel/tunnel.service';

const escapeXml = (value: string): string =>
  value.replace(/[<>&'"]/g, character => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' }[character]};`);

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

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

// A single still needs no stream analysis as long as ffmpeg can read the frame
// size straight from the camera's parameter sets, so the probe budget is kept
// minimal: raising it makes ffmpeg analyse until it can also estimate the frame
// rate, which measurably doubles the time a still takes. Some cameras do not
// have those parameter sets ready on every connect, and ffmpeg then gives up
// within this budget with "Could not find codec parameters". That is rare and
// clears by itself, so rather than slow down every poll, spend the larger
// budget only on the run that reported it — without the retry a single such
// connect would push the camera into the poll backoff.
const FFMPEG_FAST_PROBE_ARGS = ['-probesize', '32', '-analyzeduration', '0'];
const FFMPEG_FULL_PROBE_ARGS = ['-probesize', '5000000', '-analyzeduration', '5000000'];
const FFMPEG_MISSING_CODEC_PARAMS_PATTERN = /Could not find codec parameters/i;
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

// How many direct captures in a row have to fail before a Terp Cam still is
// asked of the controller instead. One failure means nothing: a held session
// goes stale, the camera reboots, a keyframe is missed - all of which the next
// poll clears by itself, and a single lost still is invisible in a timelapse
// while a downgraded one is not.
const TERPCAM_DIRECT_FAILURES_BEFORE_FALLBACK = 2;

/**
 * What is known about a Terp Cam's direct path for the device's current online
 * period, i.e. since it last came online. The controller renders through
 * `snapshot.cgi` and tops out at 1280x720 where the direct path takes the full
 * 2304x1296 off the video stream, so its picture is a fallback rather than an
 * equal: for a camera the server does reach, a poll is better left without an
 * image than filled with a downgraded one, which would also stand out in the
 * timelapse it ends up in.
 */
type TerpCamDirectState = {
  /** Online on the last pass; offline -> online starts a new period and clears the rest. */
  online: boolean;
  /** A direct still arrived in this online period, so the fallback stays unused. */
  succeeded: boolean;
  /** Direct failures in a row, counted within this online period only. */
  failures: number;
};

@Injectable()
export class ImageService implements OnModuleInit, OnApplicationShutdown {
  private ffmpegLimit = pLimit(10);
  private deviceIdToLastRtspState = new Map<string, { lastTry: number; failureCount: number }>();
  private deviceIdToTerpCamDirectState = new Map<string, TerpCamDirectState>();
  private lastThinningRun = 0;
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL.image) private readonly images: Model<Image & Document>,
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    @Inject(forwardRef(() => DeviceService)) private readonly deviceService: DeviceService,
    private readonly tunnel: TunnelService,
    private readonly store: ImageStore,
    private readonly terpCamP2P: TerpCamP2PService,
    private readonly terpCamDirect: TerpCamDirectService,
  ) {}

  /**
   * The pollers that read the cameras and roll up the timelapses. They used to
   * start as this file was imported, which is before the server can serve a
   * request - and before the database connection is necessarily up.
   */
  public onModuleInit(): void {
    this.work.schedule('The webcam poller', () => this.readFromRtspStreams(), 30_000);
    this.work.schedule('The timelapse builder', () => this.compressRtspStreams(), 60_000);
  }

  public onApplicationShutdown(): void {
    logger.info('Stopping the webcam poller and the timelapse builder');
    this.work.stop();
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
    try {
      const devices = await this.devices.find({
        'cloudSettings.rtspStream': { $exists: true, $ne: '' },
      });

      const promises: Promise<void>[] = [];
      for (const device of devices) {
        // A pass can outlive the server: it sleeps between devices, and those
        // sleeps are not the scheduler's to cancel. Stopping here is what keeps
        // it from reading cameras and writing to a connection that is closing.
        if (this.work.isStopped) break;

        if (!this.deviceIdToLastRtspState.has((await device).device_id)) {
          this.deviceIdToLastRtspState.set(device.device_id, { lastTry: 0, failureCount: 0 });
        }
        this.trackTerpCamOnlinePeriod(device);

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
                .then(async image => {
                  // The camera answered, so the backoff is reset: how far apart
                  // to try is about reaching the camera, and a camera that is
                  // working must not be backed off to the two-hour cap because
                  // of something on this side.
                  state.failureCount = 0;

                  try {
                    await this.store.createImage(
                      {
                        image_id: uuidv4(),
                        device_id: device.device_id,
                        format: 'jpeg',
                        timestamp: Date.now(),
                      },
                      image,
                    );
                  } catch (e) {
                    // Caught here rather than below, so it is neither an
                    // unhandled rejection nor reported as the camera failing.
                    logger.error(`Could not store the still read from device ${device.device_id}: ${e?.message ?? e}`);
                  }
                })
                .catch(e => {
                  // Both halves are redacted: the URL is stored with the
                  // camera's credentials in it, and an ffmpeg failure quotes
                  // the whole command line - including that URL - back.
                  logger.error(
                    withoutCredentials(
                      `Error reading RTSP stream ${device.cloudSettings.rtspStream} for device ${device.device_id}: ${e?.message ?? e}`,
                    ),
                  );
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
    } catch (error) {
      // A pass that fails must not take the poller with it: without this the
      // reschedule below is skipped and no camera is read again.
      logger.error(`The webcam poller failed a pass: ${error}`);
    } finally {
      // Each pass schedules the next one, so a stopped server has to refuse it
      // rather than only cancel the timer that happens to be pending.
      this.work.schedule('The webcam poller', () => this.readFromRtspStreams(), READ_IMAGE_CHECK_INTERVAL_MS);
    }
  }

  public async testRtspStream(
    device_id: string,
    settings: Pick<CloudSettings, 'rtspStream' | 'rtspStreamTransport' | 'tunnelRtspStream'>,
  ): Promise<Buffer> {
    // The button asks for a picture to look at right now, so a Terp Cam whose
    // direct path is unwell answers with the controller's smaller one rather
    // than with an error. Nothing here is stored.
    return this.ffmpegLimit(() => this.readRtspStreamImage({ ...settings, logRtspStreamErrors: false }, device_id, true));
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

  /**
   * Note whether the device is online, and forget what an earlier online period
   * knew about its camera. A device that has just come back may have taken the
   * camera with it (both hang off the same wifi), so the direct path is worth
   * proving again before its picture is given up on.
   */
  private trackTerpCamOnlinePeriod(device: Device): void {
    const online = (device.lastseen ?? 0) >= Date.now() - ONLINE_TIMEOUT;
    const state = this.deviceIdToTerpCamDirectState.get(device.device_id);
    if (!state) {
      this.deviceIdToTerpCamDirectState.set(device.device_id, { online, succeeded: false, failures: 0 });
      return;
    }
    if (online && !state.online) {
      state.succeeded = false;
      state.failures = 0;
    }
    state.online = online;
  }

  /**
   * One Terp Cam still: full resolution from the camera itself, and only where
   * that has produced nothing at all this online period, the controller's
   * smaller `snapshot.cgi` picture. Which camera is decided by the device, not
   * by the setting.
   *
   * The fallback is never the answer to a single failure. It is taken once the
   * direct path has failed TERPCAM_DIRECT_FAILURES_BEFORE_FALLBACK times running
   * AND has delivered nothing since the device came online - a camera that was
   * being reached until now is having a bad minute, not a bad day, and the poll
   * that proves it comes soon enough. `alwaysAllowController` lifts that for
   * the test-image button, where a picture now beats the better picture the
   * next poll would store.
   */
  private async captureTerpCamStill(deviceId: string, alwaysAllowController: boolean): Promise<Buffer> {
    // Where the server reaches no camera of its own - no rendezvous configured,
    // or a device that has reported none - the controller is the only path and
    // waiting out failed direct attempts would cost every still a poll or two.
    if (!(await this.terpCamDirect.canReachCamera(deviceId))) {
      return this.terpCamP2P.captureViaController(deviceId);
    }

    const state = this.deviceIdToTerpCamDirectState.get(deviceId);
    try {
      const still = await this.terpCamDirect.captureStill(deviceId);
      if (state) {
        state.succeeded = true;
        state.failures = 0;
      }
      return still;
    } catch (e) {
      if (state) state.failures++;
      const exhausted = !state || (!state.succeeded && state.failures >= TERPCAM_DIRECT_FAILURES_BEFORE_FALLBACK);
      if (!alwaysAllowController && !exhausted) {
        throw new Error(`direct capture failed (${(e as Error).message}); keeping the full-resolution path`);
      }
      logger.info(`Direct capture for ${deviceId} failed (${(e as Error).message}); asking the controller`);
    }

    return this.terpCamP2P.captureViaController(deviceId);
  }

  private async readRtspStreamImage(cloudSettings: CloudSettings, deviceId: string, alwaysAllowController = false): Promise<Buffer> {
    // Terp Cams have no RTSP; they speak P2P. They are configured as
    // `terpcam://<id>` so the poll schedule, backoff, maintenance gating, the
    // test-image button, storage, timelapses and thinning are reused unchanged.
    if (terpCamLabel(cloudSettings.rtspStream)) {
      return this.captureTerpCamStill(deviceId, alwaysAllowController);
    }

    let streamUrl = cloudSettings.rtspStream;
    if (cloudSettings.tunnelRtspStream) {
      streamUrl = await this.tunnel.createTunnelProxyServer(new URL(cloudSettings.rtspStream), deviceId);
    }

    let attempt = await this.runFfmpegStill(streamUrl, cloudSettings, FFMPEG_FAST_PROBE_ARGS);
    if (attempt.failure && FFMPEG_MISSING_CODEC_PARAMS_PATTERN.test(attempt.stderr)) {
      attempt = await this.runFfmpegStill(streamUrl, cloudSettings, FFMPEG_FULL_PROBE_ARGS);
    }

    if (attempt.failure) {
      if (cloudSettings.logRtspStreamErrors) {
        logIfItFails(
          `Recording the webcam error for device ${deviceId}`,
          this.deviceService.logMessage(deviceId, {
            title: 'message-rtsp-stream-error',
            // ffmpeg quotes the stream URL back, and a diary entry is
            // readable by anyone the owner shares the diary with.
            message: withoutCredentials(`message-rtsp-stream-error:${attempt.stderr}`),
            severity: 1,
            categories: ['webcam', 'error'],
          }),
        );
      }
      throw attempt.failure;
    }

    return attempt.stdout;
  }

  private runFfmpegStill(
    streamUrl: string,
    cloudSettings: CloudSettings,
    probeArgs: string[],
  ): Promise<{ stdout: Buffer; stderr: string; failure?: Error }> {
    return new Promise(resolve => {
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
          // We only need a single still frame, so decode nothing but keyframes and
          // hand them on without buffering.
          '-fflags',
          'nobuffer',
          '-flags',
          'low_delay',
          ...probeArgs,
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
          const failure =
            error ??
            (corruptionIndicator
              ? new CorruptFrameError(`discarding corrupt frame ("${corruptionIndicator}")`)
              : !stdout || stdout.length === 0
              ? new Error('ffmpeg produced no output')
              : undefined);
          resolve({ stdout: stdout ?? Buffer.alloc(0), stderr: String(stderr), failure });
        },
      );
    });
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
