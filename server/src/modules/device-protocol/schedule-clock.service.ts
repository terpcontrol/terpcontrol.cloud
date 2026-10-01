import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BackgroundWork } from '@common/background-work';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { logger } from '@utils/logger';
import { DeviceConfigurationService } from './device-configuration.service';
import { driftBetween, sameClock, scheduleClockOf } from './schedule-clock';

/**
 * The loop that keeps every schedule on its owner's wall clock.
 *
 * Once a minute it works out each owner's clock and compares it with the one
 * their devices' times were kept on. A clock that moved - summer time began or
 * ended, the owner named another zone - has those times moved and the document
 * sent again; a clock that merely appeared, because the owner picked a zone or
 * the device set its own times, is written down and moves nothing. A minute is
 * as close to the hour the clocks change as a lamp needs to be, and a pass that
 * finds nothing to do is two reads of a few small fields.
 */

const TICK_MS = 60 * 1000;

/** A document that keeps a time of day in any of the places a firmware keeps one. */
const KEEPS_TIME = [
  { 'configuration.daynight.day': { $type: 'number' } },
  { 'configuration.day': { $type: 'number' } },
  { 'configuration.co2inject.day': { $type: 'number' } },
];

@Injectable()
export class ScheduleClockService implements OnModuleInit, OnApplicationShutdown {
  private readonly work = new BackgroundWork();

  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly configuration: DeviceConfigurationService,
  ) {}

  public onModuleInit(): void {
    this.work.repeat('The schedule clocks', () => this.run(), TICK_MS);
  }

  public onApplicationShutdown(): void {
    this.work.stop();
  }

  public async run(now: Date = new Date()): Promise<void> {
    const devices = await this.devices
      .find({ ownerId: { $ne: null }, $or: KEEPS_TIME }, { id: 1, ownerId: 1, scheduleClock: 1 })
      .lean<Pick<StoredDevice, 'id' | 'ownerId' | 'scheduleClock'>[]>();
    if (devices.length === 0) return;

    const ownerIds = [...new Set(devices.map(device => device.ownerId))];
    const owners = await this.users.find({ id: { $in: ownerIds } }, { id: 1, preferences: 1 }).lean<Pick<StoredUser, 'id' | 'preferences'>[]>();
    const clocks = new Map(owners.map(owner => [owner.id, scheduleClockOf(owner.preferences, now)]));

    for (const device of devices) {
      if (this.work.isStopped) break;

      const kept = device.scheduleClock ?? null;
      const clock = clocks.get(device.ownerId ?? '') ?? null;
      if (sameClock(kept, clock)) continue;

      // One device must not end the pass: the broker may be away for a moment,
      // and the next pass finds the same clock still to be kept.
      try {
        if (driftBetween(kept, clock) === 0) await this.devices.updateOne({ id: device.id }, { $set: { scheduleClock: clock } });
        else if (await this.configuration.keepOnClock(device.id, now)) logger.info(`Moved the schedule of device ${device.id} onto ${clock?.zone}`);
      } catch (error) {
        logger.error(`Could not keep the schedule of device ${device.id} on its owner's clock: ${error}`);
      }
    }
  }
}
