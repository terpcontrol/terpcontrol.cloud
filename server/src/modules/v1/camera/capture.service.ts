import { Injectable } from '@nestjs/common';
import { CAPTURE_BUDGET_SECONDS } from '@fg2/shared-types/v1-schemas';
import { withoutCredentials } from '@common/log-path';
import { TunnelService } from '@modules/tunnel/tunnel.service';
import { CameraWithSecret } from './cameras.service';
import { runFfmpeg, streamSlot } from './ffmpeg';
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
 *
 * Either way a read has `CAPTURE_BUDGET_SECONDS` from the moment it is asked
 * for, its wait for a turn at ffmpeg included, and every step inside it is
 * given what is left of that where it is less than the step's own limit. The
 * poller and the test button run the same read, so a picture somebody is
 * waiting for is never held up for longer than the schedule allows a camera.
 */

/** How long one ffmpeg run may take on a stream before it is ended. */
const FFMPEG_TIMEOUT_MS = 90_000;

/** A run is not started with less of the budget left than this: it could not connect and decode a keyframe. */
const MIN_RUN_MS = 10_000;

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

/**
 * What ffmpeg is run with for one still off `streamUrl`: only keyframes are
 * decoded, and the first is handed on at once. `nobuffer` keeps a live stream
 * from being buffered while ffmpeg looks at it, by dropping what it reads while
 * it does - over HTTP that is a snapshot URL's one and only JPEG, and ffmpeg 8
 * then encodes nothing. So an HTTP(S) address is read without it.
 */
export const stillArgs = (streamUrl: string, camera: Pick<CameraWithSecret, 'url' | 'transport'>, probeArgs: string[]): string[] => [
  ...(camera.url?.startsWith('rtsp://') ? ['-rtsp_transport', camera.transport ?? 'tcp'] : []),
  ...(/^https?:/i.test(camera.url ?? '') ? [] : ['-fflags', 'nobuffer']),
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
];

@Injectable()
export class CaptureService {
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
    const deadline = Date.now() + CAPTURE_BUDGET_SECONDS * 1000;
    if (camera.kind === 'rtsp') return streamSlot(() => this.readFromStream(camera, deadline));
    if (!this.terpCamDirect.canReach(camera)) {
      return Promise.reject(new Error('this camera answers to no device that could bridge it to this server'));
    }
    return this.terpCamDirect.captureStill(camera, deadline);
  }

  private async readFromStream(camera: CameraWithSecret, deadline: number): Promise<Buffer> {
    if (!camera.url) {
      throw new Error('this camera has no stream address');
    }
    const left = () => deadline - Date.now();
    if (left() < MIN_RUN_MS) {
      throw new Error(`timed out waiting for a turn at ffmpeg: no picture within the ${CAPTURE_BUDGET_SECONDS / 60} minutes a read has`);
    }

    // A camera that is only visible from the tent is read through the MQTT
    // tunnel of a device standing there, which answers on a local port.
    const streamUrl = camera.tunnel && camera.deviceId ? await this.tunnel.createTunnelProxyServer(new URL(camera.url), camera.deviceId) : camera.url;

    let attempt = await this.runFfmpegStill(streamUrl, camera, FFMPEG_FAST_PROBE_ARGS, Math.min(FFMPEG_TIMEOUT_MS, left()));
    if (attempt.failure && FFMPEG_MISSING_CODEC_PARAMS_PATTERN.test(attempt.stderr) && left() >= MIN_RUN_MS) {
      attempt = await this.runFfmpegStill(streamUrl, camera, FFMPEG_FULL_PROBE_ARGS, Math.min(FFMPEG_TIMEOUT_MS, left()));
    }

    if (attempt.failure) {
      // What ffmpeg wrote says why, where its exit message only says that it
      // failed - and the caller puts this reason in front of a person. Redacted
      // because ffmpeg quotes the whole command line back, URL credentials and
      // all, and this text reaches a log and a diary entry. A run that was ended
      // for taking too long says so: what it wrote until then is not why.
      const reason =
        attempt.failure instanceof CorruptFrameError || attempt.timedOut ? attempt.failure.message : attempt.stderr.trim() || attempt.failure.message;
      attempt.failure.message = withoutCredentials(reason);
      throw attempt.failure;
    }

    return attempt.stdout;
  }

  private async runFfmpegStill(
    streamUrl: string,
    camera: Pick<CameraWithSecret, 'url' | 'transport'>,
    probeArgs: string[],
    timeoutMs: number,
  ): Promise<{ stdout: Buffer; stderr: string; failure?: Error; timedOut?: boolean }> {
    const { error, stdout, stderr } = await runFfmpeg(
      stillArgs(streamUrl, camera, probeArgs),
      // Decoder messages about corrupt/truncated frames (e.g. "EOI missing,
      // emulating") are logged at warning level, so "error" would hide them.
      { loglevel: 'warning', timeoutMs, maxBuffer: 5 * 1024 * 1024 },
    );

    // Ended by the timeout above rather than finished. execFile also kills a
    // run whose output overflows, which is a failure of another kind.
    const timedOut = !!error?.killed && error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    const corruptionIndicator = !error && FFMPEG_CORRUPT_FRAME_PATTERN.exec(stderr)?.[0];
    const failure = timedOut
      ? new Error(`timed out after ${Math.round(timeoutMs / 1000)} s without a picture`)
      : (error ??
        (corruptionIndicator
          ? new CorruptFrameError(`discarding corrupt frame ("${corruptionIndicator}")`)
          : stdout.length === 0
            ? new Error('ffmpeg produced no output')
            : undefined));
    return { stdout, stderr, failure, timedOut };
  }
}
