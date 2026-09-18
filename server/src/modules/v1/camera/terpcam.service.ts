import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';

/**
 * The one thing both Terp Cam paths end in: a raw H.264 keyframe turned into a
 * JPEG.
 *
 * The shipped webcam is a VStarcam OEM that, once on the home wifi, only speaks a
 * proprietary P2P transport (no LAN RTSP/HTTP; the protocol notes are kept
 * internally). Neither the controller nor the camera hands over a picture: the
 * controller has no decoder and little RAM, and the camera's own `snapshot.cgi`
 * is pinned far below what its video stream carries. So both paths take a
 * keyframe off that stream and it is decoded here.
 *
 * The keyframe is a standard H.264 Annex-B GOP head (SPS + PPS + IDR); the
 * VStarcam 55aa15a8 frame headers are stripped before it gets here.
 */

const FFMPEG_TIMEOUT_MS = 15_000;

@Injectable()
export class TerpCamService {
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
}
