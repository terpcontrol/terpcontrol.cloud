import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { createHash } from 'node:crypto';
import { FirmwareChannel } from '@fg2/shared-types/v1';
import { BackgroundWork, logIfItFails } from '@common/background-work';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { onlineSince } from '@common/v1/value-age';
import { MODEL_V1 } from '@database/models';
import { StoredDeviceClass } from '@database/schemas/v1/device-classes.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredFirmware } from '@database/schemas/v1/firmwares.schema';
import { logger } from '@utils/logger';
import { DevicePresenceSink } from '@modules/device-protocol/device-sinks';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';

/**
 * Handing the fleet its firmware: which devices are told to update next, when a
 * device that has been told but has not moved is told again, and what the diary
 * says once one has come back.
 *
 * A device is told by being pinned: `firmware.targetId` is the build it should
 * be running and `state.firmwareId` is what it reports it is running, so the two
 * being different is the whole of "this device owes an update". That the device
 * heard is never assumed - the instruction is repeated with a growing delay
 * until the two agree.
 */

/** After this, a device that was told to update and has not reported back has failed. */
export const UPGRADE_TIMEOUT_MS = 10 * 60 * 1000;

const INSTRUCTION_INITIAL_DELAY_MS = 30 * 1000;
const INSTRUCTION_MAX_DELAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 1000;

/** The channels a class hands a build out on. `manual` is the absence of one and is never swept. */
const CHANNELS: readonly Exclude<FirmwareChannel, 'manual'>[] = ['stable', 'beta', 'alpha'];

@Injectable()
export class FirmwareRolloutService implements OnModuleInit, OnApplicationShutdown, DevicePresenceSink {
  private readonly instructionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly instructionBackoff = new Map<string, { firmwareId: string; nextDelayMs: number }>();
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.deviceClass) private readonly classes: Model<StoredDeviceClass>,
    @InjectModel(MODEL_V1.firmware) private readonly firmwares: Model<StoredFirmware>,
    private readonly publisher: DevicePublisherService,
    private readonly entries: EntryWriterService,
  ) {}

  public onModuleInit(): void {
    this.work.repeat('The firmware rollout', () => this.sweep(), SWEEP_INTERVAL_MS);
  }

  public onApplicationShutdown(): void {
    this.work.stop();
    for (const timer of this.instructionTimers.values()) clearTimeout(timer);
    this.instructionTimers.clear();
  }

  /**
   * A device is there. If it owes an update it is told about it shortly - not at
   * once: a device that has just connected is still settling, and the delay
   * grows with every instruction it does not act on.
   */
  public async onDeviceSeen(deviceId: string): Promise<void> {
    const device = await this.devices.findOne({ id: deviceId }, { id: 1, firmware: 1, state: 1 }).lean<StoredDevice | null>();
    const owed = device ? owedUpdate(device) : null;

    if (!owed) {
      this.forget(deviceId);
      return;
    }

    // One timer per device, and none at all once the server is stopping.
    if (this.instructionTimers.has(deviceId) || this.work.isStopped) return;

    const backoff = this.instructionBackoff.get(deviceId);
    const delay = backoff?.firmwareId === owed ? backoff.nextDelayMs : INSTRUCTION_INITIAL_DELAY_MS;
    this.instructionBackoff.set(deviceId, { firmwareId: owed, nextDelayMs: delay });

    this.instructionTimers.set(
      deviceId,
      setTimeout(() => logIfItFails(`The update instruction for device ${deviceId}`, this.instruct(deviceId)), delay),
    );
  }

  /**
   * What a device came back running. It is called before the fact is stored, so
   * this is the one moment at which the build it was told to install and the
   * build it now reports can be compared - which is what says an update
   * finished rather than a device having been flashed by hand.
   */
  public async onFirmwareReported(deviceId: string, firmwareId: string): Promise<void> {
    const device = await this.devices.findOne({ id: deviceId }).lean<StoredDevice | null>();
    if (!device || device.firmware.targetId !== firmwareId) return;

    const endedAt = new Date();
    await this.devices.updateOne({ id: deviceId }, { $set: { 'state.updateEndedAt': endedAt } });
    this.forget(deviceId);

    const took = device.state.updateStartedAt ? `${(endedAt.getTime() - device.state.updateStartedAt.getTime()) / 1000}s` : 'unknown';
    logger.info(`Device ${deviceId} finished its firmware update in ${took}`);

    const [before, after] = await Promise.all([this.label(device.state.firmwareId), this.label(firmwareId)]);
    await this.entries.writeDeviceLine({
      deviceId,
      spaceId: device.spaceId,
      line: `message-firmware-update-complete-with-ids:${before} -> ${after}`,
    });
  }

  /**
   * One pass over the fleet: every class, every channel that points somewhere,
   * as many devices started as the class allows to be updating at once.
   */
  private async sweep(): Promise<void> {
    for (const deviceClass of await this.classes.find().lean<StoredDeviceClass[]>()) {
      // A pass awaits its way through every class, so it can outlive the server
      // unless it looks.
      if (this.work.isStopped) break;
      if (deviceClass.rollout.paused) continue;

      for (const channel of CHANNELS) {
        const firmwareId = deviceClass.firmwareIds[channel];
        // A channel with no build on it has nothing to roll out, and a pass made
        // for one would record the devices it picked as updating to nothing.
        if (firmwareId) await this.sweepChannel(deviceClass, channel, firmwareId);
      }
    }
  }

  private async sweepChannel(deviceClass: StoredDeviceClass, channel: FirmwareChannel, firmwareId: string): Promise<void> {
    const now = new Date();
    const deadline = new Date(now.getTime() - UPGRADE_TIMEOUT_MS);
    const onChannel: FilterQuery<StoredDevice> = { classId: deviceClass.id, 'firmware.channel': channel };
    const partway: FilterQuery<StoredDevice> = { ...onChannel, 'firmware.targetId': firmwareId, 'state.firmwareId': { $ne: firmwareId } };

    const updating = await this.devices.countDocuments({ ...partway, 'state.updateStartedAt': { $gte: deadline } });
    const failed = await this.devices.countDocuments({ ...partway, 'state.updateStartedAt': { $lt: deadline } });

    const room = deviceClass.concurrentUpdates - updating;
    if (room <= 0 || failed >= deviceClass.maxFailures) return;

    // Only devices that are there: one that is not listening would burn a slot
    // until the timeout and let nothing else through.
    const candidates = await this.devices
      .find({
        ...onChannel,
        'firmware.targetId': { $ne: firmwareId },
        'state.lastSeenAt': { $gte: onlineSince(now) },
      })
      .lean<StoredDevice[]>();

    for (const device of candidates.filter(device => inRolloutStage(device.id, deviceClass.rollout.percent)).slice(0, room)) {
      logger.info(`Updating device ${device.id} to firmware ${firmwareId}`);
      await this.devices.updateOne(
        { id: device.id },
        { $set: { 'firmware.targetId': firmwareId, 'state.updateStartedAt': now, 'state.updateEndedAt': null } },
      );
      this.forget(device.id);
    }
  }

  /** Tells one device which build to install, and doubles the wait before saying it again. */
  private async instruct(deviceId: string): Promise<void> {
    try {
      const device = await this.devices.findOne({ id: deviceId }, { id: 1, firmware: 1, state: 1 }).lean<StoredDevice | null>();
      const owed = device ? owedUpdate(device) : null;
      if (!owed) {
        this.instructionBackoff.delete(deviceId);
        return;
      }

      logger.info(`Telling device ${deviceId} to install firmware ${owed}, over ${device?.state.firmwareId || 'nothing recorded'}`);
      this.publisher.firmware(deviceId, owed);

      const previous = this.instructionBackoff.get(deviceId);
      const delay = previous?.firmwareId === owed ? previous.nextDelayMs : INSTRUCTION_INITIAL_DELAY_MS;
      this.instructionBackoff.set(deviceId, { firmwareId: owed, nextDelayMs: Math.min(delay * 2, INSTRUCTION_MAX_DELAY_MS) });
    } finally {
      this.instructionTimers.delete(deviceId);
    }
  }

  /** Nothing is owed any more, so the next instruction starts from the shortest delay again. */
  private forget(deviceId: string): void {
    const timer = this.instructionTimers.get(deviceId);
    if (timer) {
      clearTimeout(timer);
      this.instructionTimers.delete(deviceId);
    }
    this.instructionBackoff.delete(deviceId);
  }

  /** What the diary calls a build: its version, or its id where the build is no longer recorded. */
  private async label(firmwareId: string | null): Promise<string> {
    if (!firmwareId) return 'unknown';

    const firmware = await this.firmwares.findOne({ id: firmwareId }, { version: 1 }).lean<Pick<StoredFirmware, 'version'> | null>();
    return firmware?.version || firmwareId;
  }
}

/** The build this device has been told to install and is not running, or null when it owes nothing. */
const owedUpdate = (device: Pick<StoredDevice, 'firmware' | 'state'>): string | null =>
  device.firmware.targetId && device.firmware.targetId !== device.state.firmwareId ? device.firmware.targetId : null;

/**
 * Whether a staged rollout has reached this device yet. The share is taken from
 * the id rather than at random, so a device that is inside the first ten per
 * cent stays inside it - a share re-drawn every ten seconds would hand the build
 * to the whole class within the minute.
 */
const inRolloutStage = (deviceId: string, percent: number): boolean =>
  percent >= 100 || (percent > 0 && createHash('sha1').update(deviceId).digest().readUInt32BE(0) % 100 < percent);
