import { Alarm, CloudSettings, Device, DeviceClass, DeviceFirmware, DeviceFirmwareBinary } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import deviceLogModel from '@models/devicelog.model';
import deviceClassModel from '@/models/deviceclass.model';
import { deviceFirmwareBinaryModel, deviceFirmwareModel } from '@/models/devicefirmware.model';
import claimCodeModel from '@/models/claimcode.model';
import { v4 as uuidv4 } from 'uuid';
import { AddDeviceDto, RegisterDeviceDto, TestDeviceDto } from '@/dtos/device.dto';
import { mqttclient } from '../databases/mqttclient';
import { dataService } from './data.service';
import { HttpException } from '@/exceptions/HttpException';
import { ENABLE_SELF_REGISTRATION, SELF_REGISTRATION_PASSWORD, SMTP_SENDER } from '@/config';
import { alarmService } from '@services/alarm.service';
import { isNumeric } from 'influx/lib/src/grammar';
import { mailTransport } from '@services/auth.service';
import { execFile } from 'node:child_process';
import im from 'imagemagick';
import imageModel from '@models/images.model';
import pLimit from 'p-limit';
import { tmpdir } from 'node:os';
import { join } from 'path';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { Image } from '@fg2/shared-types';
import { deviceService } from '@services/device.service';
import { createServer } from 'node:net';
import { tunnelService } from '@services/tunnel.service';

const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

const READ_IMAGE_CHECK_INTERVAL_MS = 5_000;
const IMAGE_LOAD_INTERVAL_MS = 30_000;
const IMAGE_LOAD_MAX_BACKOFF_INTERVAL_MS = 120 * 60_000;
const COMPRESS_INTERVAL_MS = 60 * 60 * 1000;
const THIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

class ImageService {
  private ffmpegLimit = pLimit(10);
  private deviceIdToLastRtspState = new Map<string, { lastTry: number; failureCount: number }>();
  private lastThinningRun = 0;

  constructor() {
    setTimeout(() => {
      void this.readFromRtspStreams();
    }, 30_000);
    setTimeout(() => {
      void this.compressRtspStreams();
    }, 60_000);
  }

  public async getDeviceImage(
    device_id: string,
    format: string,
    timestamp?: number,
    duration?: string,
    imageId?: string,
  ): Promise<Image | undefined> {
    return imageModel
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
    return imageModel.findOne({ image_id });
  }

  public async createDeviceImage(device_id: string, source: Buffer, timestamp?: number): Promise<Image> {
    const jpegData = await this.convertToJpeg(source);

    return imageModel.create({
      image_id: uuidv4(),
      device_id,
      format: 'user/jpeg',
      timestamp: Number.isFinite(timestamp) ? (timestamp as number) : Date.now(),
      data: jpegData,
    });
  }

  public async deleteImage(image_id: string): Promise<boolean> {
    const result = await imageModel.deleteOne({ image_id });
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

  private async readFromRtspStreams(): Promise<void> {
    const devices = await deviceModel.find({
      'cloudSettings.rtspStream': { $exists: true, $ne: '' },
    });

    const promises: Promise<void>[] = [];
    for (const device of devices) {
      if (!this.deviceIdToLastRtspState.has((await device).device_id)) {
        this.deviceIdToLastRtspState.set(device.device_id, { lastTry: 0, failureCount: 0 });
      }

      if (device.cloudSettings?.maintenanceWebcamOff && device.maintenance_mode_until && device.maintenance_mode_until > Date.now()) {
        continue;
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
                  void imageModel.create({
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
                console.log(`Error reading RTSP stream ${device.cloudSettings.rtspStream} for device ${device.device_id}:`, e?.message);
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
      const devices = await deviceModel.find({ 'cloudSettings.rtspStream': { $exists: true, $ne: '' } });

      const shouldThin = Date.now() - this.lastThinningRun >= THIN_INTERVAL_MS;

      for (const device of devices) {
        const oldImages = await imageModel
          .find({
            device_id: device.device_id,
            format: 'jpeg',
            timestamp: { $lt: Date.now() - IMAGE_RETENTION_DAYS * MS_IN_A_DAY },
          })
          .select({ image_id: 1 });
        for (const oldImage of oldImages) {
          await imageModel.deleteOne({ image_id: oldImage.image_id });
        }

        await this.compressRtspStreamRange(device, MS_IN_A_DAY, TIMELAPSE_DAY_FRAMEINTERVAL_MS, '1d');
        await this.compressRtspStreamRange(device, 7 * MS_IN_A_DAY, 7 * TIMELAPSE_DAY_FRAMEINTERVAL_MS, '1w');
        await this.compressRtspStreamRange(device, 30 * MS_IN_A_DAY, 30 * TIMELAPSE_DAY_FRAMEINTERVAL_MS, '1m');

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
  ): Promise<void> {
    let endTimestamp = Math.ceil(Date.now() / timeStep) * timeStep;

    while (true) {
      const startTimestamp = endTimestamp - timeStep;
      const compressedImage = await imageModel
        .findOne({
          device_id: device.device_id,
          format: 'mp4',
          timestamp: startTimestamp,
          duration: targetDuration,
        })
        .select({ image_id: 1, timestampEnd: 1 });

      const getImages = (beforeTimestamp: number, limit: number) =>
        imageModel
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

      if (newestImage && (!compressedImage || compressedImage.timestampEnd < newestImage?.timestamp)) {
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
            await imageModel.deleteOne({ image_id: compressedImage.image_id });
          }

          await imageModel.create({
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
    const cursor = imageModel
      .find({ device_id: deviceId, format: 'jpeg', timestamp: { $gte: minTimestamp, $lt: maxTimestamp } })
      .sort({ timestamp: 1 })
      .select({ image_id: 1, timestamp: 1 })
      .cursor();

    let lastKeptTimestamp = -Infinity;
    let toDelete: string[] = [];
    const flush = async () => {
      if (toDelete.length === 0) return;
      await imageModel.deleteMany({ image_id: { $in: toDelete } });
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
        const imageData = await imageModel.findOne({
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
      console.log('Error compressing RTSP images for device ' + device.device_id + ':', e);
    } finally {
      for (const file of filesWritten) {
        try {
          await unlink(file);
        } catch (e) {
          console.log('Error deleting temp file ' + file + ':', e);
        }
      }
      try {
        await rmdir(tmpDir);
      } catch (e) {
        console.log('Error deleting temp dir ' + tmpDir + ':', e);
      }
    }

    return undefined;
  }

  private async readRtspStreamImage(cloudSettings: CloudSettings, deviceId: string): Promise<Buffer> {
    let streamUrl = cloudSettings.rtspStream;
    if (cloudSettings.tunnelRtspStream) {
      streamUrl = await tunnelService.createTunnelProxyServer(new URL(cloudSettings.rtspStream), deviceId);
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
              void deviceService.logMessage(deviceId, {
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
            console.log('Error compressing RTSP stream images:', stderr, error);
            reject(error);
          } else {
            readFile(`${filesDir}/result.mp4`)
              .then(data => resolve(data))
              .catch(err => {
                console.log(`Error reading result file ${filesDir}/result.mp4:`, err);
                reject(err);
              })
              .finally(() => unlink(`${filesDir}/result.mp4`).catch(() => Promise.resolve()));
          }
        },
      );
    });
  }
}

export const imageService = new ImageService();
