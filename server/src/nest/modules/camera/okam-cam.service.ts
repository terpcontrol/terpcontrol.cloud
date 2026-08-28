import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { execFile } from 'node:child_process';
import { Document, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Image } from '@fg2/shared-types';
import { MODEL } from '../../database/models.module';

/**
 * O-KAM / VStarcam camera stills.
 *
 * The shipped webcam is a VStarcam OEM that, once on the home wifi, only speaks a
 * proprietary P2P transport (no LAN RTSP/HTTP — see
 * docs/okam-webcam-reverse-engineering.md). The controller, which sits on the
 * camera's LAN, runs the lightweight reverse-engineered P2P client, grabs one
 * H.264 keyframe every 1-2 min and uploads the raw elementary stream to the
 * server. This service turns that keyframe into a JPEG and stores it through the
 * same pipeline the RTSP poller uses (format 'jpeg' -> timelapses, thinning,
 * sharing and the /image/:device_id route all come for free).
 *
 * The keyframe is a standard H.264 Annex-B GOP head (SPS + PPS + IDR); the
 * VStarcam 55aa15a8 frame headers are stripped controller-side.
 */

const FFMPEG_TIMEOUT_MS = 15_000;

@Injectable()
export class OkamCamService {
  constructor(@InjectModel(MODEL.image) private readonly images: Model<Image & Document>) {}

  /** Decode a single H.264 keyframe (Annex-B elementary stream) to a JPEG buffer. */
  public decodeKeyframeToJpeg(h264: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        'ffmpeg',
        ['-loglevel', 'warning', '-threads', '1', '-y', '-f', 'h264', '-i', 'pipe:0', '-frames:v', '1', '-q:v', '2', '-f', 'mjpeg', 'pipe:1'],
        { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' },
        (error, stdout, stderr) => {
          if (error || !stdout || (stdout as unknown as Buffer).length === 0) {
            reject(new Error(`ffmpeg h264 decode failed: ${error?.message ?? ''} ${String(stderr)}`));
            return;
          }
          resolve(stdout as unknown as Buffer);
        },
      );
      // feed the elementary stream on stdin
      child.stdin?.on('error', () => undefined); // ignore EPIPE if ffmpeg exits early
      child.stdin?.end(h264);
    });
  }

  /** Decode a controller-supplied keyframe and store it as a device still. */
  public async ingestKeyframe(deviceId: string, h264: Buffer, timestamp?: number): Promise<Image> {
    const jpeg = await this.decodeKeyframeToJpeg(h264);
    return this.ingestJpeg(deviceId, jpeg, timestamp);
  }

  /** Store a ready JPEG (e.g. from snapshot.cgi) as a device still. */
  public async ingestJpeg(deviceId: string, jpeg: Buffer, timestamp?: number): Promise<Image> {
    return this.images.create({
      image_id: uuidv4(),
      device_id: deviceId,
      format: 'jpeg',
      timestamp: Number.isFinite(timestamp) ? (timestamp as number) : Date.now(),
      data: jpeg,
    });
  }
}
