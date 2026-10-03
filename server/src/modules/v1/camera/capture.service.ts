import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import pLimit from 'p-limit';
import { withoutCredentials } from '@common/log-path';
import { TunnelService } from '@modules/tunnel/tunnel.service';
import { CameraWithSecret } from './cameras.service';
import { TerpCamDirectService } from './terpcam-direct.service';

/**
 * One still, from whichever camera is asked and by whichever path reaches it.
 * The schedule is the poller's; what a single read costs and which path it takes
 * is here.
 *
 * A Terp Cam is read off its video stream by this server, over a relay the
 * device it is paired at opens to the cloud. Every other camera is an address
 * ffmpeg opens, through the tunnel of a device in the tent where the stream only
 * exists on the tent's own network.
 */

const FFMPEG_TIMEOUT_MS = 90_000;

// When the connection to a camera drops mid-frame (e.g. through a firmware tunnel),
// ffmpeg still emits the partially decoded frame and exits successfully, only noting
// the corruption on stderr at warning level. Frames whose stderr matches one of these
// decoder/demuxer corruption indicators are discarded instead of saved.
const FFMPEG_CORRUPT_FRAME_PATTERN =
  /EOI missing|No JPEG data found|error while decoding|concealing \d+|Packet corrupt|corrupt decoded frame|incomplete frame|RTP: missed|truncat/i;

/**
 * A corrupt frame means the camera was reachable and streaming, so unlike
 * connection failures it does not count towards the retry backoff.
 */
export class CorruptFrameError extends Error {}

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

@Injectable()
export class CaptureService {
  /** ffmpeg is expensive and a camera that hangs holds a run for 90 s; ten at a time is what the box takes. */
  private readonly ffmpegLimit = pLimit(10);

  constructor(
    private readonly tunnel: TunnelService,
    private readonly terpCamDirect: TerpCamDirectService,
  ) {}

  /**
   * One still. A Terp Cam is read in full resolution or not at all: there is no
   * smaller picture to fall back on, and a poll left without one is better than
   * a downgraded one in the timelapse.
   */
  public readStill(camera: CameraWithSecret): Promise<Buffer> {
    if (camera.kind === 'rtsp') return this.ffmpegLimit(() => this.readFromStream(camera));
    if (!this.terpCamDirect.canReach(camera)) {
      return Promise.reject(new Error('this camera answers to no device that could bridge it to this server'));
    }
    return this.terpCamDirect.captureStill(camera);
  }

  private async readFromStream(camera: CameraWithSecret): Promise<Buffer> {
    if (!camera.url) {
      throw new Error('this camera has no stream address');
    }

    // A camera that is only visible from the tent is read through the MQTT
    // tunnel of a device standing there, which answers on a local port.
    const streamUrl = camera.tunnel && camera.deviceId ? await this.tunnel.createTunnelProxyServer(new URL(camera.url), camera.deviceId) : camera.url;

    let attempt = await this.runFfmpegStill(streamUrl, camera, FFMPEG_FAST_PROBE_ARGS);
    if (attempt.failure && FFMPEG_MISSING_CODEC_PARAMS_PATTERN.test(attempt.stderr)) {
      attempt = await this.runFfmpegStill(streamUrl, camera, FFMPEG_FULL_PROBE_ARGS);
    }

    if (attempt.failure) {
      // What ffmpeg wrote says why, where its exit message only says that it
      // failed - and the caller puts this reason in front of a person. Redacted
      // because ffmpeg quotes the whole command line back, URL credentials and
      // all, and this text reaches a log and a diary entry.
      const reason = attempt.failure instanceof CorruptFrameError ? attempt.failure.message : attempt.stderr.trim() || attempt.failure.message;
      attempt.failure.message = withoutCredentials(reason);
      throw attempt.failure;
    }

    return attempt.stdout;
  }

  private runFfmpegStill(
    streamUrl: string,
    camera: Pick<CameraWithSecret, 'url' | 'transport'>,
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
          ...(camera.url?.startsWith('rtsp://') ? ['-rtsp_transport', camera.transport ?? 'tcp'] : []),
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
}
