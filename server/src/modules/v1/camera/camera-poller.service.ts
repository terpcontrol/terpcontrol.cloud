import { Inject, Injectable, OnApplicationShutdown, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { logger } from '@utils/logger';
import { BackgroundWork, logIfItFails } from '@common/background-work';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { isOffline } from '@common/v1/value-age';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { CamerasService } from './cameras.service';
import { CaptureService, CorruptFrameError } from './capture.service';
import { MediaService } from './media.service';
import { LIGHT_STATE_READER, LightStateReader } from './light-state';

/**
 * Reads one still from every camera on a schedule, and stores it.
 *
 * How often a camera is tried is the camera's own setting, so two cameras in one
 * tent can be read at different rates; what a failed read costs the next one is
 * decided here. A pass does not wait for the reads it starts: ffmpeg is given 90
 * seconds to answer, and a pass that waited out one unreachable camera would
 * hold every other camera's next still behind it for that long.
 */

const PASS_INTERVAL_MS = 5_000;
const MAX_BACKOFF_MS = 120 * 60_000;

/** One camera is started per tick of this, so a hundred cameras do not all open a stream at once. */
const BETWEEN_CAMERAS_MS = 1_000;

interface PollState {
  lastTry: number;
  failureCount: number;
}

@Injectable()
export class CameraPollerService implements OnModuleInit, OnApplicationShutdown {
  private readonly state = new Map<string, PollState>();
  /** The cameras being read right now - queued for ffmpeg counts as being read. */
  private readonly beingRead = new Set<string>();
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    private readonly cameras: CamerasService,
    private readonly capture: CaptureService,
    private readonly media: MediaService,
    private readonly entries: EntryWriterService,
    @Optional() @Inject(LIGHT_STATE_READER) private readonly light: LightStateReader | null,
  ) {}

  public onModuleInit(): void {
    this.work.schedule('The camera poller', () => this.pass(), 30_000);
  }

  public onApplicationShutdown(): void {
    logger.info('Stopping the camera poller');
    this.work.stop();
  }

  /** The settings may be the ones that were failing, so the camera is tried again at once. */
  public settingsChanged(cameraId: string): void {
    const state = this.state.get(cameraId);
    if (state) {
      state.lastTry = 0;
      state.failureCount = 0;
    }
  }

  public forget(cameraId: string): void {
    this.state.delete(cameraId);
    this.beingRead.delete(cameraId);
    this.capture.forget(cameraId);
  }

  private async pass(): Promise<void> {
    try {
      const cameras = await this.cameras.capturable();
      const controllers = await this.controllersOf(cameras);

      for (const camera of cameras) {
        // A pass can outlive the server: it sleeps between cameras, and those
        // sleeps are not the scheduler's to cancel. Stopping here is what keeps
        // it from reading cameras and writing to a connection that is closing.
        if (this.work.isStopped) break;

        const controller = camera.deviceId ? (controllers.get(camera.deviceId) ?? null) : null;
        this.capture.trackControllerOnlinePeriod(camera.id, controller !== null && !isOffline(controller.state.lastSeenAt));

        if (this.beingRead.has(camera.id) || !this.isDue(camera) || (await this.isResting(camera, controller))) {
          continue;
        }

        this.beingRead.add(camera.id);
        logIfItFails(`Reading camera ${camera.id}`, this.read(camera));

        await new Promise(resolve => setTimeout(resolve, BETWEEN_CAMERAS_MS));
      }
    } catch (error) {
      // A pass that fails must not take the poller with it: without this the
      // reschedule below is skipped and no camera is read again.
      logger.error(`The camera poller failed a pass: ${error}`);
    } finally {
      // Each pass schedules the next one, so a stopped server has to refuse it
      // rather than only cancel the timer that happens to be pending.
      this.work.schedule('The camera poller', () => this.pass(), PASS_INTERVAL_MS);
    }
  }

  /** One read, start to finish: the picture stored, or the failure paid for. */
  private async read(camera: CameraDocument): Promise<void> {
    const state = this.stateOf(camera.id);

    try {
      const withSecret = await this.cameras.withSecret(camera.id);
      if (!withSecret) return;

      const still = await this.capture.readStill(withSecret);
      // The camera answered, so the backoff is reset: how far apart to try is
      // about reaching the camera, and one that is working must not be backed
      // off to the two-hour cap because of something on this side.
      state.failureCount = 0;

      const capturedAt = new Date();
      await this.media.storeBytes({ kind: 'still', mime: 'image/jpeg', cameraId: camera.id, capturedAt }, still);
      await this.cameras.noteCapture(camera.id, capturedAt, null);
    } catch (e) {
      const reason = (e as Error)?.message ?? String(e);
      // A corrupt frame means the camera was reachable and streaming, so unlike
      // a failure to connect it does not count towards the backoff.
      state.failureCount = e instanceof CorruptFrameError ? 0 : state.failureCount + 1;

      logger.error(`Reading camera ${camera.id} failed: ${reason}`);
      await this.cameras.noteCapture(camera.id, null, reason).catch(() => undefined);
      if (camera.logErrors) await this.writeTheFailureDown(camera, reason);
    } finally {
      state.lastTry = Date.now();
      this.beingRead.delete(camera.id);
    }
  }

  /** A camera that is told to say so puts its failures in the diary, where the person looking for them is. */
  private async writeTheFailureDown(camera: CameraDocument, reason: string): Promise<void> {
    await this.entries
      .write({
        source: 'device',
        authorId: null,
        values: { kind: 'system' },
        severity: 'warning',
        cameraId: camera.id,
        deviceId: camera.deviceId,
        spaceId: camera.spaceId,
        message: { key: 'message-rtsp-stream-error', params: [reason] },
      })
      .catch(e => logger.error(`Could not write down the camera failure of ${camera.id}: ${e}`));
  }

  private stateOf(cameraId: string): PollState {
    const known = this.state.get(cameraId);
    if (known) return known;

    const fresh = { lastTry: 0, failureCount: 0 };
    this.state.set(cameraId, fresh);
    return fresh;
  }

  /** Each failed try doubles the wait before the next one, up to two hours. */
  private isDue(camera: CameraDocument): boolean {
    const state = this.stateOf(camera.id);
    const interval = Math.max(camera.stillIntervalSeconds, 1) * 1000;

    return state.lastTry <= Date.now() - Math.min(interval * Math.pow(2, state.failureCount), MAX_BACKOFF_MS);
  }

  /**
   * Whether the camera is deliberately not being read: a tent that is being
   * worked in or switched off, and a tent whose light is out.
   *
   * `nightOff` needs somebody to say what the light is doing, and nothing says
   * so until the device part provides a reader - a camera then keeps taking
   * pictures, which is what it did before the switch existed.
   */
  private async isResting(camera: CameraDocument, controller: StoredDevice | null): Promise<boolean> {
    if (camera.maintenanceOff && controller) {
      const inMaintenance = !!controller.state.maintenanceUntil && controller.state.maintenanceUntil.getTime() > Date.now();
      const switchedOff = (controller.configuration as { workmode?: unknown } | null)?.workmode === 'off';
      if (inMaintenance || switchedOff) return true;
    }

    if (camera.nightOff && controller && this.light) {
      return (await this.light.isLightOn(controller.id).catch(() => null)) === false;
    }

    return false;
  }

  /** The controllers of this pass's cameras, in one query rather than one per camera. */
  private async controllersOf(cameras: CameraDocument[]): Promise<Map<string, StoredDevice>> {
    const ids = [...new Set(cameras.map(camera => camera.deviceId).filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();

    const rows = await this.devices.find({ id: { $in: ids } }, { id: 1, configuration: 1, state: 1 }).lean<StoredDevice[]>();
    return new Map(rows.map(device => [device.id, device]));
  }
}
