import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import pLimit from 'p-limit';
import { logger } from '@utils/logger';
import { withoutCredentials } from '@common/log-path';
import { TunnelService } from '@modules/tunnel/tunnel.service';
import { CameraWithSecret } from './cameras.service';
import { TerpCamDirectService } from './terpcam-direct.service';
import { TerpCamP2PService } from './terpcam-p2p.service';

/**
 * One still, from whichever camera is asked and by whichever path reaches it.
 * The schedule is the poller's; what a single read costs and which path it takes
 * is here.
 *
 * A Terp Cam is read off its video stream, by this server where a rendezvous is
 * configured and by its controller otherwise. Every other camera is an address
 * ffmpeg opens, through the controller's tunnel where the stream only exists on
 * the tent's own network.
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

/**
 * How many direct captures in a row have to fail before a Terp Cam still is
 * asked of the controller instead. One failure means nothing: a held session
 * goes stale, the camera reboots, a keyframe is missed - all of which the next
 * poll clears by itself, and a single lost still is invisible in a timelapse
 * while a downgraded one is not.
 */
const DIRECT_FAILURES_BEFORE_FALLBACK = 2;

/**
 * What is known about a Terp Cam's direct path for its controller's current
 * online period, i.e. since the controller last came online. The controller
 * renders through `snapshot.cgi` and tops out at 1280x720 where the direct path
 * takes the full 2304x1296 off the video stream, so its picture is a fallback
 * rather than an equal: for a camera the server does reach, a poll is better
 * left without an image than filled with a downgraded one, which would also
 * stand out in the timelapse it ends up in.
 */
type DirectState = {
  /** Online on the last pass; offline -> online starts a new period and clears the rest. */
  online: boolean;
  /** A direct still arrived in this online period, so the fallback stays unused. */
  succeeded: boolean;
  /** Direct failures in a row, counted within this online period only. */
  failures: number;
};

@Injectable()
export class CaptureService {
  /** ffmpeg is expensive and a camera that hangs holds a run for 90 s; ten at a time is what the box takes. */
  private readonly ffmpegLimit = pLimit(10);
  private readonly directState = new Map<string, DirectState>();

  constructor(
    private readonly tunnel: TunnelService,
    private readonly terpCamP2P: TerpCamP2PService,
    private readonly terpCamDirect: TerpCamDirectService,
  ) {}

  /**
   * Note whether the camera's controller is online, and forget what an earlier
   * online period knew about the direct path. A controller that has just come
   * back may have taken the camera with it (both hang off the same wifi), so the
   * direct path is worth proving again before its picture is given up on.
   */
  public trackControllerOnlinePeriod(cameraId: string, online: boolean): void {
    const state = this.directState.get(cameraId);
    if (!state) {
      this.directState.set(cameraId, { online, succeeded: false, failures: 0 });
      return;
    }
    if (online && !state.online) {
      state.succeeded = false;
      state.failures = 0;
    }
    state.online = online;
  }

  /** A camera that is gone leaves nothing behind to decide a later camera's path by. */
  public forget(cameraId: string): void {
    this.directState.delete(cameraId);
  }

  /**
   * One still. `alwaysAllowController` is the test-image button, where a picture
   * now beats the better picture the next poll would store.
   */
  public readStill(camera: CameraWithSecret, alwaysAllowController = false): Promise<Buffer> {
    return this.ffmpegLimit(() => (camera.kind === 'rtsp' ? this.readFromStream(camera) : this.readFromTerpCam(camera, alwaysAllowController)));
  }

  /**
   * A Terp Cam: full resolution from the camera itself, and only where that has
   * produced nothing at all this online period, the controller's smaller
   * `snapshot.cgi` picture.
   *
   * The fallback is never the answer to a single failure. It is taken once the
   * direct path has failed DIRECT_FAILURES_BEFORE_FALLBACK times running AND has
   * delivered nothing since the controller came online - a camera that was being
   * reached until now is having a bad minute, not a bad day, and the poll that
   * proves it comes soon enough.
   */
  private async readFromTerpCam(camera: CameraWithSecret, alwaysAllowController: boolean): Promise<Buffer> {
    // Where the server reaches no camera of its own - no rendezvous configured,
    // or one that has reported no P2P id - the controller is the only path and
    // waiting out failed direct attempts would cost every still a poll or two.
    if (!this.terpCamDirect.canReach(camera)) {
      return this.viaController(camera);
    }

    const state = this.directState.get(camera.id);
    try {
      const still = await this.terpCamDirect.captureStill(camera);
      if (state) {
        state.succeeded = true;
        state.failures = 0;
      }
      return still;
    } catch (e) {
      if (state) state.failures++;
      const exhausted = !state || (!state.succeeded && state.failures >= DIRECT_FAILURES_BEFORE_FALLBACK);
      if (!alwaysAllowController && !exhausted) {
        throw new Error(`direct capture failed (${(e as Error).message}); keeping the full-resolution path`);
      }
      logger.info(`Direct capture for camera ${camera.id} failed (${(e as Error).message}); asking the controller`);
    }

    return this.viaController(camera);
  }

  /** A standalone camera has no controller to fall back on: the direct path is the only one it has. */
  private viaController(camera: CameraWithSecret): Promise<Buffer> {
    if (!camera.deviceId) {
      return Promise.reject(new Error('this camera answers to no controller, so the server has to reach it itself'));
    }
    return this.terpCamP2P.captureViaController(camera.deviceId);
  }

  private async readFromStream(camera: CameraWithSecret): Promise<Buffer> {
    if (!camera.url) {
      throw new Error('this camera has no stream address');
    }

    // A camera that is only visible from the tent is read through the
    // controller's MQTT tunnel, which answers on a local port.
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
