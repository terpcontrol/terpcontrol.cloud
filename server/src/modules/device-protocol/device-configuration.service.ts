import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeviceConfiguration } from '@fg2/shared-types/v1';
import { HttpException } from '@common/http-exception';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { MODEL_V1 } from '@database/models';
import { ScheduleClock, StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
// The plan hands over what its step stored; the port it asks through is the plan's.
import { DeviceConfigurationWriter } from '../v1/plan/device-configuration.port';
import { DevicePublisherService } from './device-publisher.service';
import { driftBetween, keepsTime, SCHEDULE_FOLLOWER, ScheduleFollower, sameClockTimes, scheduleClockOf, withClockTimesMoved } from './schedule-clock';

/**
 * The configuration document, which is the device's own.
 *
 * The cloud stores a copy and hands it back; the device decides what it means
 * and which keys exist, and the server never validates or interprets one. A key
 * the device does not know is ignored, and disappears the next time the device
 * uploads its settings - which is why nothing here adds anything to what it is
 * given.
 *
 * The device sends no acknowledgement and no echo, so a save is what was stored
 * and sent, never what the device is now running: it reports that itself, when a
 * setting is changed on the device.
 *
 * The one thing the server does read is the times of day, because they are
 * kept on the owner's wall clock (see `schedule-clock.ts`): every write
 * remembers the clock it was made on, and a write that leaves the times alone
 * while that clock has moved puts them where the wall clock says first.
 */
@Injectable()
export class DeviceConfigurationService implements DeviceConfigurationWriter {
  constructor(
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly publisher: DevicePublisherService,
    private readonly entries: EntryWriterService,
    @Optional() @Inject(SCHEDULE_FOLLOWER) private readonly followers: ScheduleFollower | null = null,
  ) {}

  /**
   * The whole document, as a client writes it, and a line in the diary naming
   * what moved and who moved it. A target changed by hand is as much a thing
   * that happened in the tent as a plan step is, and without the line the
   * timeline could not say who moved it or when. A save that changed nothing
   * writes nothing.
   */
  public async replace(deviceId: string, configuration: DeviceConfiguration, by: string | null = null): Promise<boolean> {
    let before: DeviceConfiguration | null = null;
    const changed = await this.store(deviceId, current => {
      before = current;
      return configuration;
    });

    const moved = changedFigures(before, configuration);
    if (changed && moved.length > 0) {
      const device = await this.devices.findOne({ id: deviceId }, { spaceId: 1 }).lean<Pick<StoredDevice, 'spaceId'> | null>();
      await this.entries.write({
        source: 'device',
        authorId: by,
        values: { kind: 'system' },
        spaceId: device?.spaceId ?? null,
        deviceId,
        severity: 'info',
        message: { key: 'message-device-configuration-updated', params: [moved.join('\n')] },
      });
    }

    return changed;
  }

  /**
   * A plan step's or a preset's settings, merged into what the device runs.
   *
   * The merge goes into each section rather than stopping at the top-level key:
   * a step that carries `day: { humidity }` changes the day's humidity and
   * leaves the day's temperature where it was. Replacing the whole section left
   * every figure the step did not name out of the document, and the firmware
   * reads a missing key as its compile-time default - so a figure the plan
   * screen shows as empty, "not written", reached the tent as a factory value.
   * A key whose value is not a section on both sides - a lamp's plain `day`
   * seconds, a list - is replaced as it always was.
   */
  public applyConfiguration(deviceId: string, settings: DeviceConfiguration): Promise<boolean> {
    // Nothing to merge, or nothing to merge into, is no write: the firmware reads
    // every key a document leaves out as its compile-time default, so sending
    // either would reset tuning the cloud has no copy of.
    return this.store(deviceId, current =>
      !current || Object.keys(current).length === 0 || Object.keys(settings).length === 0 ? null : mergeSections(current, settings),
    );
  }

  /**
   * The document again, its times of day moved to where the owner's wall clock
   * now puts them - after summer time began or ended, or the owner named
   * another zone. What the schedule loop calls when it finds a clock has moved.
   */
  public keepOnClock(deviceId: string, at: Date = new Date()): Promise<boolean> {
    return this.store(deviceId, current => current, at);
  }

  private async store(
    deviceId: string,
    next: (current: DeviceConfiguration | null) => DeviceConfiguration | null,
    at: Date = new Date(),
  ): Promise<boolean> {
    // Asked before anything is written: a caller that cannot be served should
    // find nothing changed, rather than a stored configuration it was told had
    // failed and a device that goes on running the old one.
    if (!this.publisher.canPublish) {
      throw new HttpException(503, 'Not connected to the message broker');
    }

    const device = await this.devices
      .findOne({ id: deviceId }, { configuration: 1, ownerId: 1, scheduleClock: 1 })
      .lean<Pick<StoredDevice, 'configuration' | 'ownerId' | 'scheduleClock'> | null>();
    if (!device) {
      throw new HttpException(404, 'Device not found');
    }

    const before = device.configuration ?? null;
    const wanted = next(before);
    if (wanted === null) return false;

    // Times a write sets are meant on the clock it is made on. Times it leaves
    // as they were are meant on the clock they were kept on, which may have
    // moved since - a plan step re-sent in the minute after the clocks went
    // back, a temperature saved from a page drawn before - so they are moved
    // along rather than taken as new.
    const clock = await this.ownersClock(device.ownerId, at);
    const drift = driftBetween(device.scheduleClock ?? null, clock);
    const configuration = drift !== 0 && sameClockTimes(before, wanted) ? withClockTimesMoved(wanted, drift) : wanted;

    await this.devices.updateOne({ id: deviceId }, { $set: { configuration, scheduleClock: keepsTime(configuration) ? clock : null } });

    // Not required after the write: the device asks for its configuration when
    // it connects and is answered from what is stored, so a send that fails
    // between the check above and here costs a delay, not the setting.
    this.publisher.configuration(deviceId, configuration);

    if (drift !== 0) await this.followers?.onScheduleMoved(deviceId, drift);

    return JSON.stringify(before) !== JSON.stringify(configuration);
  }

  private async ownersClock(ownerId: string | null, at: Date): Promise<ScheduleClock | null> {
    if (!ownerId) return null;

    const owner = await this.users.findOne({ id: ownerId }, { preferences: 1 }).lean<Pick<StoredUser, 'preferences'> | null>();
    return scheduleClockOf(owner?.preferences, at);
  }
}

const isSection = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A diary line is read, not scrolled: past this many figures the rest are counted rather than listed. */
const MOST_FIGURES = 12;

/**
 * "day.temperature: 24 → 25", one line per figure that moved, in the dotted
 * names the firmware's own diff has always written into these lines.
 */
export const changedFigures = (before: unknown, after: unknown): string[] => {
  const lines = figuresMoved(before, after, '');
  return lines.length > MOST_FIGURES ? [...lines.slice(0, MOST_FIGURES), `… ${lines.length - MOST_FIGURES} more`] : lines;
};

const figuresMoved = (before: unknown, after: unknown, path: string): string[] => {
  if (isSection(before) && isSection(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap(key => figuresMoved(before[key], after[key], path ? `${path}.${key}` : key));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];

  return [`${path || 'configuration'}: ${figureOf(before)} → ${figureOf(after)}`];
};

const figureOf = (value: unknown): string =>
  value === undefined || value === null ? '–' : typeof value === 'string' ? value : JSON.stringify(value);

const mergeSections = (current: DeviceConfiguration, settings: DeviceConfiguration): DeviceConfiguration =>
  Object.fromEntries(
    Object.entries({ ...current, ...settings }).map(([key, value]) => {
      const before = current[key];
      return [key, isSection(before) && isSection(value) ? { ...before, ...value } : value];
    }),
  );
