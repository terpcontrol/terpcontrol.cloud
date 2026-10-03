import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeviceConfiguration, GrowthStage } from '@fg2/shared-types/v1';
import { co2FanKey, co2FanOf, co2InjectFor, type Co2Fan, type FieldSetting } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { HttpException } from '@common/http-exception';
import { unprocessable } from '@common/v1/problem';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { MODEL_V1 } from '@database/models';
import { ScheduleClock, StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { logger } from '@utils/logger';
// The plan hands over what its step stored; the port it asks through is the plan's.
import { DeviceConfigurationWriter } from '../v1/plan/device-configuration.port';
import { recordTargets } from '../v1/phase/target-record';
import { HIDDEN_FIGURES, heldTo } from './class-rules';
import { fieldChangesOf, withFigures } from './configuration-fields';
import { DevicePublisherService } from './device-publisher.service';
import { driftBetween, keepsTime, SCHEDULE_FOLLOWER, ScheduleFollower, sameClockTimes, scheduleClockOf, withClockTimesMoved } from './schedule-clock';
import { targetsOf } from '../v1/phase/phase-targets';
import { keptForDrying, keptForGermination, recordedReturn } from './drying-return';
import { withIdleFiguresKept } from './idle-figures';
import { decideWorkmode, standardOf, WriteIntent } from './work-modes';

/** What a write stored: the document before it and after it. */
interface Written {
  before: DeviceConfiguration | null;
  after: DeviceConfiguration;
  changed: boolean;
}

/**
 * The configuration document, which is the device's own.
 *
 * The cloud stores a copy and hands it back; the device decides what it means
 * and which keys exist. A key the device does not know is ignored, and
 * disappears the next time the device uploads its settings - which is why
 * nothing here adds a key of its own to what it is given.
 *
 * Three things are read and decided here all the same, on every write, because
 * every write is a whole document the firmware loads: the work mode, which says
 * whether and how the hardware regulates and is the server's to decide
 * (`work-modes.ts`); the figures a type's document is held to whoever wrote it
 * (`class-rules.ts`); and the settings a person changes one at a time, which are
 * checked against what the type offers (`configuration-fields.ts`).
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
    @InjectModel(MODEL_V1.targetChange) private readonly targetRecord: Model<StoredTargetChange>,
    private readonly publisher: DevicePublisherService,
    private readonly entries: EntryWriterService,
    @Optional() @Inject(SCHEDULE_FOLLOWER) private readonly followers: ScheduleFollower | null = null,
  ) {}

  /**
   * The whole document, as a client writes it with the targets, and a line in
   * the diary naming what moved and who moved it. A target changed by hand is as
   * much a thing that happened in the tent as a plan step is, and without the
   * line the timeline could not say who moved it or when. A save that changed
   * nothing writes nothing. A device whose control was switched off is switched
   * on again by it: somebody who sets targets wants them held. `drying` is
   * whether they are a drying room's (see `WriteIntent`).
   *
   * What is stored is answered, because it is not always what was sent: the
   * work mode is the server's, the figures a mode leaves alone are kept
   * (`idle-figures.ts`), and the type's rules hold the rest (`class-rules.ts`).
   */
  public async replace(
    deviceId: string,
    configuration: DeviceConfiguration,
    by: string | null = null,
    drying?: boolean,
  ): Promise<DeviceConfiguration | null> {
    const written = await this.store(deviceId, { kind: 'targets', drying }, () => configuration);
    if (written) await this.writeDown(deviceId, written, by);

    return written?.after ?? null;
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
   *
   * `stage` is the stage the climate is for, which decides the work mode: a
   * drying stage dries, and anything else puts a device that was off or drying
   * back on its own mode.
   */
  public async applyConfiguration(deviceId: string, settings: DeviceConfiguration, stage: GrowthStage | null = null): Promise<boolean> {
    // Nothing to merge, or nothing to merge into, is no write: the firmware reads
    // every key a document leaves out as its compile-time default, so sending
    // either would reset tuning the cloud has no copy of. A stage with no
    // figures still decides the work mode, so it writes what the device runs.
    const written = await this.store(deviceId, { kind: 'climate', stage, requested: settings.workmode }, current =>
      !current || Object.keys(current).length === 0 || (Object.keys(settings).length === 0 && stage === null)
        ? null
        : mergeSections(current, settings),
    );

    return written?.changed ?? false;
  }

  /**
   * Settings beyond the targets, by the names the device's type gives them
   * (`CONFIGURATION_FIELDS`), merged into the document it runs with every other
   * key kept, and written down in the diary like the targets are.
   *
   * A device that has never sent its document is refused rather than written
   * to: what would reach it is the change alone, and the firmware reads every key
   * a document leaves out as its default.
   */
  public async configure(deviceId: string, set: Record<string, FieldSetting>, by: string | null = null): Promise<boolean> {
    const device = await this.devices
      .findOne({ id: deviceId }, { type: 1, configuration: 1 })
      .lean<Pick<StoredDevice, 'type' | 'configuration'> | null>();
    if (!device) throw new HttpException(404, 'Device not found');
    if (!device.configuration || Object.keys(device.configuration).length === 0) {
      throw unprocessable('device_sent_no_settings', 'This device has not sent its settings, so there is nothing to change them in.', [
        {
          field: 'set',
          code: 'no_settings_yet',
          detail: 'The device sends its settings once one is changed on the device itself while it is online.',
        },
      ]);
    }

    const changes = fieldChangesOf(device.type, set);
    const written = await this.store(deviceId, changes.intent, current => (current ? withFigures(current, changes.figures) : null));
    if (written) await this.writeDown(deviceId, written, by);

    return written?.changed ?? false;
  }

  /**
   * The AIR fan a stand-alone smart socket slows down while it doses CO2 in
   * windows, or none. The socket names the fan in its own document, and the
   * write follows it to the fan (`followCo2Fan`) - which is also what keeps the
   * fan in step whenever the socket's windows change later. A socket that has
   * never sent its document is refused as `configure` refuses it.
   */
  public async coupleCo2Fan(plugId: string, coupling: Co2Fan | null): Promise<void> {
    const plug = await this.devices
      .findOne({ id: plugId }, { type: 1, configuration: 1 })
      .lean<Pick<StoredDevice, 'type' | 'configuration'> | null>();
    if (!plug) throw new HttpException(404, 'Device not found');
    if (plug.type !== 'plug') throw unprocessable('not_a_plug', 'Only a stand-alone smart socket slows a fan while it doses CO2.');
    if (!plug.configuration || Object.keys(plug.configuration).length === 0) {
      throw unprocessable('device_sent_no_settings', 'This device has not sent its settings, so there is nothing to change them in.');
    }
    if (coupling) {
      const fan = await this.devices.findOne({ id: coupling.fanId }, { type: 1 }).lean<Pick<StoredDevice, 'type'> | null>();
      if (fan?.type !== 'fan') throw unprocessable('not_a_fan', 'Only an AIR fan can be slowed while a socket doses CO2.');
    }

    await this.store(plugId, { kind: 'fields' }, current => (current ? { ...current, fan: co2FanKey(coupling) } : null));
  }

  /**
   * The document again, its times of day moved to where the owner's wall clock
   * now puts them - after summer time began or ended, or the owner named
   * another zone. What the schedule loop calls when it finds a clock has moved.
   */
  public async keepOnClock(deviceId: string, at: Date = new Date()): Promise<boolean> {
    return (await this.store(deviceId, { kind: 'clock' }, current => current, at))?.changed ?? false;
  }

  /**
   * The diary line of a write somebody made, naming the figures that moved;
   * nothing for a write that moved none.
   *
   * The two times of the light schedule are named together whenever either
   * moved: 24 hours and none are each written as a pair - a day that never
   * ends, a light that goes off as it comes on - and one of them alone reads as
   * a time of day that means nothing. Where the device holds the night's
   * figures round the clock - drying, germination - the mode it is in goes with
   * the line, so the screens can say the drying room's humidity moved rather
   * than the night's.
   */
  private async writeDown(deviceId: string, written: Written, by: string | null): Promise<void> {
    const moved = withScheduleWhole(changedFigures(written.before, written.after, HIDDEN_FIGURES), written.after);
    if (!written.changed || moved.length === 0) return;
    const mode = written.after.workmode;

    const device = await this.devices.findOne({ id: deviceId }, { spaceId: 1 }).lean<Pick<StoredDevice, 'spaceId'> | null>();
    await this.entries.write({
      source: 'device',
      authorId: by,
      values: { kind: 'system' },
      spaceId: device?.spaceId ?? null,
      deviceId,
      severity: 'info',
      message: { key: 'message-device-configuration-updated', params: [moved.join('\n'), ...(mode === 'dry' || mode === 'breed' ? [mode] : [])] },
    });
  }

  private async store(
    deviceId: string,
    intent: WriteIntent,
    next: (current: DeviceConfiguration | null) => DeviceConfiguration | null,
    at: Date = new Date(),
  ): Promise<Written | null> {
    // Asked before anything is written: a caller that cannot be served should
    // find nothing changed, rather than a stored configuration it was told had
    // failed and a device that goes on running the old one.
    if (!this.publisher.canPublish) {
      throw new HttpException(503, 'Not connected to the message broker');
    }

    const device = await this.devices
      .findOne(
        { id: deviceId },
        { type: 1, configuration: 1, ownerId: 1, scheduleClock: 1, baseWorkmode: 1, standardWorkmode: 1, beforeDrying: 1, beforeGermination: 1 },
      )
      .lean<Pick<
        StoredDevice,
        'type' | 'configuration' | 'ownerId' | 'scheduleClock' | 'baseWorkmode' | 'standardWorkmode' | 'beforeDrying' | 'beforeGermination'
      > | null>();
    if (!device) {
      throw new HttpException(404, 'Device not found');
    }

    const before = device.configuration ?? null;
    const asked = next(before);
    if (asked === null) return null;

    const mode = decideWorkmode(device.type, before?.workmode, device.baseWorkmode, intent, device.standardWorkmode);
    const standard = standardOf(mode?.base);
    // A spell that begins keeps what it writes over; one ended by itself - its
    // own button, or control switched off - brings that back, since nothing else
    // that ends it brings a climate with it. A preset, a phase or a step does.
    const dried = before?.workmode === 'dry';
    const dries = mode?.workmode === 'dry';
    // Germination holds the night's temperature round the clock, so what is set
    // for it lands there. The night it wrote over is kept when it begins, and
    // put back when the device goes back to a day and a night by itself - a
    // preset, a phase or a step brings a night of its own.
    const germinated = device.beforeGermination ?? null;
    const germinates = mode?.workmode === 'breed' && before?.workmode !== 'breed' && germinated === null;
    const backFromGermination = germinated !== null && ['small', 'full', 'temp'].includes(mode?.workmode ?? '');
    const returned =
      dried && !dries && intent.kind === 'fields'
        ? withFigures(asked, Object.entries(await this.keptFor(deviceId, device.beforeDrying, before)))
        : asked;
    const wanted = backFromGermination && intent.kind === 'fields' ? withFigures(returned, Object.entries(germinated)) : returned;
    const kept = intent.kind === 'targets' && mode ? withIdleFiguresKept(before, wanted, mode.workmode) : wanted;
    const held = heldTo(device.type, mode ? { ...kept, workmode: mode.workmode } : kept);

    // Times a write sets are meant on the clock it is made on. Times it leaves
    // as they were are meant on the clock they were kept on, which may have
    // moved since - a plan step re-sent in the minute after the clocks went
    // back, a temperature saved from a page drawn before - so they are moved
    // along rather than taken as new.
    const clock = await this.ownersClock(device.ownerId, at);
    const drift = driftBetween(device.scheduleClock ?? null, clock);
    const configuration = drift !== 0 && sameClockTimes(before, held) ? withClockTimesMoved(held, drift) : held;

    await this.devices.updateOne(
      { id: deviceId },
      {
        $set: {
          configuration,
          scheduleClock: keepsTime(configuration) ? clock : null,
          ...(mode ? { baseWorkmode: mode.base } : {}),
          ...(standard ? { standardWorkmode: standard } : {}),
          ...(dries && !dried ? { beforeDrying: keptForDrying(before) } : !dries && dried ? { beforeDrying: null } : {}),
          ...(germinates ? { beforeGermination: keptForGermination(before) } : backFromGermination ? { beforeGermination: null } : {}),
        },
      },
    );
    await recordTargets(this.targetRecord, { id: deviceId, type: device.type }, before, configuration, at);

    // Not required after the write: the device asks for its configuration when
    // it connects and is answered from what is stored, so a send that fails
    // between the check above and here costs a delay, not the setting.
    this.publisher.configuration(deviceId, configuration);

    if (drift !== 0) await this.followers?.onScheduleMoved(deviceId, drift);
    if (device.type === 'plug') await this.followCo2Fan(deviceId, before, configuration);

    return { before, after: configuration, changed: JSON.stringify(before) !== JSON.stringify(configuration) };
  }

  /**
   * What a drying spell ended by itself brings back: what it kept when it
   * began, or - for a spell begun before anything was kept - the targets the
   * record holds from before it, the newest row that is not the drying room's.
   */
  private async keptFor(deviceId: string, kept: Record<string, number> | null, current: DeviceConfiguration | null): Promise<Record<string, number>> {
    if (kept && Object.keys(kept).length > 0) return kept;

    const now = JSON.stringify(targetsOf(current as Record<string, unknown> | null));
    const rows = await this.targetRecord.find({ deviceId }).sort({ at: -1, _id: -1 }).limit(50).lean<StoredTargetChange[]>();
    return recordedReturn(rows.find(row => row.targets !== null && JSON.stringify(row.targets) !== now)?.targets ?? null, current);
  }

  /**
   * A fan slowed for a socket's CO2 knows nothing of the socket: it is handed
   * the socket's dosing windows and runs slower in them. So whenever the
   * socket's document is written the fan's section is written from it again - a
   * fan the socket no longer names is told it is slowed for nothing, and while
   * the socket does not dose in windows its fan is told the same. Neither may
   * fail the socket's own write: the socket is where the person is.
   */
  private async followCo2Fan(plugId: string, before: DeviceConfiguration | null, after: DeviceConfiguration): Promise<void> {
    const was = co2FanOf(before);
    const now = co2FanOf(after);
    const inject = (fanId: string, section: Record<string, unknown>) =>
      this.store(fanId, { kind: 'fields' }, current =>
        current && JSON.stringify(current.co2inject ?? {}) !== JSON.stringify(section) ? { ...current, co2inject: section } : null,
      ).catch(error => logger.error(`Could not tell fan ${fanId} about the CO2 of socket ${plugId}: ${error}`));

    if (was && was.fanId !== now?.fanId) await inject(was.fanId, {});
    if (now) await inject(now.fanId, co2InjectFor(plugId, after, now.speed));
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
export const changedFigures = (before: unknown, after: unknown, hidden: ReadonlySet<string> = new Set()): string[] => {
  const lines = figuresMoved(before, after, '', hidden);
  return lines.length > MOST_FIGURES ? [...lines.slice(0, MOST_FIGURES), `… ${lines.length - MOST_FIGURES} more`] : lines;
};

const figuresMoved = (before: unknown, after: unknown, path: string, hidden: ReadonlySet<string>): string[] => {
  if (isSection(before) && isSection(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap(key => figuresMoved(before[key], after[key], path ? `${path}.${key}` : key, hidden));
  }
  if (hidden.has(path) || JSON.stringify(before) === JSON.stringify(after)) return [];

  return [`${path || 'configuration'}: ${figureOf(before)} → ${figureOf(after)}`];
};

/** Both times of the light schedule where one of them moved, the one that stayed written as itself on both sides. */
const withScheduleWhole = (lines: string[], after: DeviceConfiguration): string[] => {
  const named = (key: string) => lines.some(line => line.startsWith(`daynight.${key}: `));
  if (named('day') === named('night')) return lines;

  const missing = named('day') ? 'night' : 'day';
  const section = after.daynight;
  const value = isSection(section) ? section[missing] : undefined;
  if (typeof value !== 'number') return lines;
  return [...lines, `daynight.${missing}: ${value} → ${value}`].sort((one, other) => (one < other ? -1 : one > other ? 1 : 0));
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
