import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { execFile } from 'node:child_process';
import { Document, Model } from 'mongoose';
import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';
import { CloudSettings, Device } from '@fg2/shared-types';
import { logger } from '@utils/logger';
import { BackgroundWork, logIfItFails } from '../../common/background-work';
import { withoutCredentials } from '../../common/log-path';
import { ImageStore } from '../../database/image-store';
import { MODEL } from '../../database/models.module';
import { TerpCamDirectService } from '../camera/terpcam-direct.service';
import { TerpCamP2PService, terpCamLabel } from '../camera/terpcam-p2p.service';
import { DeviceLogService } from '../device/device-log.service';
import { ONLINE_TIMEOUT } from '../device/device.queries';
import { TunnelService } from '../tunnel/tunnel.service';

const READ_IMAGE_CHECK_INTERVAL_MS = 5_000;
const IMAGE_LOAD_INTERVAL_MS = 30_000;
const IMAGE_LOAD_MAX_BACKOFF_INTERVAL_MS = 120 * 60_000;

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

// How long a Terp Cam's direct path has to have delivered nothing before a
// still is asked of the controller instead. A failure or two means nothing: a
// keyframe is missed, the camera reboots, the uplink has a slow minute - all of
// which a later poll clears by itself, and a few lost stills are invisible in a
// timelapse while downgraded ones are not.
const TERPCAM_FALLBACK_AFTER_MS = 10 * 60_000;

/**
 * Which camera a read is of, for telling whether two reads would fetch the same
 * picture. A Terp Cam's camera is decided by the device rather than by the
 * setting, so every Terp Cam read of a device is the same one.
 */
function readKey(settings: Pick<CloudSettings, 'rtspStream' | 'rtspStreamTransport' | 'tunnelRtspStream'>): string {
  if (terpCamLabel(settings.rtspStream)) return 'terpcam';
  return JSON.stringify([settings.rtspStream, settings.rtspStreamTransport ?? 'tcp', !!settings.tunnelRtspStream]);
}

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
  /** Online on the last pass; offline -> online starts a new period and resets `since`. */
  online: boolean;
  /** When the direct path last delivered a still, or this online period began if it has not yet. */
  since: number;
};

/**
 * Reads one still from every configured camera on a schedule, and stores it.
 * How often a camera is tried, which of a Terp Cam's two paths the picture
 * comes from, and what a failed read costs the next one all live here.
 */
@Injectable()
export class WebcamPollerService implements OnModuleInit, OnApplicationShutdown {
  private ffmpegLimit = pLimit(10);
  private deviceIdToLastRtspState = new Map<string, { lastTry: number; failureCount: number }>();
  /**
   * The devices whose camera is being read right now - queued for ffmpeg counts
   * as being read. A pass no longer waits for the reads it started, so the
   * interval between tries is no longer what keeps one camera from being read
   * twice at once: a read that outlives it would otherwise be joined by the next
   * pass, and then by every pass after that, each holding an ffmpeg run open on
   * the same camera.
   *
   * The read itself is kept so the test-image button can wait for it instead of
   * starting a second one: a Terp Cam's controller bridges one relay at a time
   * and turns a second request down, which the cloud takes for a controller
   * that cannot relay at all. `settings` says which camera the read is of.
   */
  private readonly readsInFlight = new Map<string, { settings: string; image: Promise<Buffer> }>();
  private deviceIdToTerpCamDirectState = new Map<string, TerpCamDirectState>();
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL.device) private readonly devices: Model<Device & Document>,
    private readonly store: ImageStore,
    private readonly logs: DeviceLogService,
    private readonly tunnel: TunnelService,
    private readonly terpCamP2P: TerpCamP2PService,
    private readonly terpCamDirect: TerpCamDirectService,
  ) {}

  /**
   * The poller used to start as this file was imported, which is before the
   * server can serve a request - and before the database connection is
   * necessarily up.
   */
  public onModuleInit(): void {
    this.work.schedule('The webcam poller', () => this.readFromRtspStreams(), 30_000);
  }

  public onApplicationShutdown(): void {
    logger.info('Stopping the webcam poller');
    this.work.stop();
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

  /**
   * One pass over every device with a camera, starting a read for each whose
   * turn it is. It does not wait for those reads. ffmpeg is given 90 seconds to
   * answer, and a pass that waited out one unreachable camera held every other
   * device's next still behind it for that long - a camera nobody can reach
   * costing every other customer their timelapse frames. What the failure is
   * worth is already spent on the device it belongs to: each try that fails
   * doubles the wait before the next one, up to two hours.
   */
  private async readFromRtspStreams(): Promise<void> {
    try {
      const devices = await this.devices.find({
        'cloudSettings.rtspStream': { $exists: true, $ne: '' },
      });

      for (const device of devices) {
        // A pass can outlive the server: it sleeps between devices, and those
        // sleeps are not the scheduler's to cancel. Stopping here is what keeps
        // it from reading cameras and writing to a connection that is closing.
        if (this.work.isStopped) break;

        if (!this.deviceIdToLastRtspState.has((await device).device_id)) {
          this.deviceIdToLastRtspState.set(device.device_id, { lastTry: 0, failureCount: 0 });
        }
        this.trackTerpCamOnlinePeriod(device);

        if (this.readsInFlight.has(device.device_id)) {
          continue;
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
          const read = this.ffmpegLimit(() => this.readRtspStreamImage(device.cloudSettings, device.device_id));
          this.readsInFlight.set(device.device_id, { settings: readKey(device.cloudSettings), image: read });
          logIfItFails(
            `Reading the camera of device ${device.device_id}`,
            read
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
                this.readsInFlight.delete(device.device_id);
              }),
          );
        }

        await new Promise(r => setTimeout(r, FFMPEG_THROTTLE_MS));
      }
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
    // A read of the same camera already under way is waited for rather than
    // joined by a second one, and its picture is the answer.
    const running = this.readsInFlight.get(device_id);
    if (running?.settings === readKey(settings)) {
      try {
        return await running.image;
      } catch (e) {
        // A poll keeps a Terp Cam's full-resolution path rather than downgrade a
        // stored still; the button wants any picture, so the controller takes
        // one. Anything else would only fail the same way again.
        if (!terpCamLabel(settings.rtspStream)) throw e;
        return this.terpCamP2P.captureViaController(device_id);
      }
    }

    // The button asks for a picture to look at right now, so a Terp Cam whose
    // direct path is unwell answers with the controller's smaller one rather
    // than with an error. Nothing here is stored. While it runs, a poll leaves
    // the camera to it, and a second click waits for it.
    const image = this.ffmpegLimit(() => this.readRtspStreamImage({ ...settings, logRtspStreamErrors: false }, device_id, true));
    if (!running) {
      this.readsInFlight.set(device_id, { settings: readKey(settings), image });
      const forget = () => {
        if (this.readsInFlight.get(device_id)?.image === image) this.readsInFlight.delete(device_id);
      };
      image.then(forget, forget);
    }
    return image;
  }

  /** The settings may be the ones that were failing, so the camera is tried again at once. */
  public reportDeviceConfigured(device_id: string): void {
    const state = this.deviceIdToLastRtspState.get(device_id);
    if (state) {
      state.lastTry = 0;
      state.failureCount = 0;
    }
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
      this.deviceIdToTerpCamDirectState.set(device.device_id, { online, since: Date.now() });
      return;
    }
    if (online && !state.online) {
      state.since = Date.now();
    }
    state.online = online;
  }

  /**
   * One Terp Cam still: full resolution from the camera itself, and only where
   * that has produced nothing for TERPCAM_FALLBACK_AFTER_MS, the controller's
   * smaller `snapshot.cgi` picture. Which camera is decided by the device, not
   * by the setting.
   *
   * The fallback is never the answer to a single failure. It is taken once the
   * direct path has delivered nothing for ten minutes - since its last still, or
   * since the device came online - and any direct still closes it again. That
   * includes the direct service leaving a camera alone for a while (one that
   * refused it, a controller that did not open the relay): those are failures
   * of the direct path like any other. `alwaysAllowController` lifts the wait
   * for the test-image button, where a picture now beats the better picture the
   * next poll would store.
   */
  private async captureTerpCamStill(deviceId: string, alwaysAllowController: boolean): Promise<Buffer> {
    // Where the server has no way to the camera of its own - no relay
    // configured, or a device that has reported no camera it can be reached by -
    // the controller is the only path, and waiting would only cost stills.
    if (!(await this.terpCamDirect.canReachCamera(deviceId))) {
      return this.terpCamP2P.captureViaController(deviceId);
    }

    const state = this.deviceIdToTerpCamDirectState.get(deviceId);
    try {
      const still = await this.terpCamDirect.captureStill(deviceId);
      if (state) state.since = Date.now();
      return still;
    } catch (e) {
      const exhausted = !state || Date.now() - state.since >= TERPCAM_FALLBACK_AFTER_MS;
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
          this.logs.logMessage(deviceId, {
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
}
