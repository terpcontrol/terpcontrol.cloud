import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DeviceConfiguration, GrowthStage } from '@fg2/shared-types/v1';
import { GERMINATION_HUMIDITY, germinationChoicesOf, type GerminationChoiceValues } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import {
  co2FanKey,
  co2FanOf,
  co2InjectFor,
  isSection,
  nestedAt,
  type Co2Fan,
  type FieldSetting,
} from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { SCHEDULED_MODES } from '@fg2/shared-types/v1-schemas/day-night.js';
import { badRequest, unprocessable } from '@common/v1/problem';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { MODEL_V1 } from '@database/models';
import { ScheduleClock, StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { logger } from '@utils/logger';
// The plan hands over what its step stored; the port it asks through is the plan's.
import { DeviceConfigurationWriter } from '../v1/plan/device-configuration.port';
import { recordTargets } from '../v1/phase/target-record';
import { HIDDEN_FIGURES, HUMIDIFIER_REST_BAND, heldTo } from './class-rules';
import { fieldChangesOf, withFigures } from './configuration-fields';
import { DevicePublisherService } from './device-publisher.service';
import { DEVICE_GERMINATION_SINK, type DeviceGerminationSink } from './device-sinks';
import { figureRefusals, withFiguresHeld } from './document-figures';
import { GERMINATION_FORGOTTEN, leavesGermination } from './germination-memory';
import { driftBetween, keepsTime, SCHEDULE_FOLLOWER, ScheduleFollower, sameClockTimes, scheduleClockOf, withClockTimesMoved } from './schedule-clock';
import { targetsOf } from '../v1/phase/phase-targets';
import { GERMINATION_FIGURES, keptForDrying, keptForGermination, recordedReturn } from './drying-return';
import { withIdleFiguresKept } from './idle-figures';
import { ChoicesSaid, decideWorkmode, standardOf, WriteIntent } from './work-modes';

/** What a write stored: the document before it and after it, and what germination is to do about the humidity before and after. */
interface Written {
  before: DeviceConfiguration | null;
  after: DeviceConfiguration;
  changed: boolean;
  /** Set where the write changed a choice of germination's (`GerminationChoices`): what held before it, and what holds now. */
  choices?: { before: GerminationChoiceValues; after: GerminationChoiceValues };
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
    // The alarms are asked for when they are needed rather than handed over here:
    // they reach back to this service through the grow and its climate (an
    // alert names the grow standing where it happened, and a grow writes its
    // climate here), and a cycle of providers is one Nest never finishes building.
    @Optional() @Inject(ModuleRef) private readonly modules: Pick<ModuleRef, 'get'> | null = null,
  ) {}

  /**
   * The whole document, as a client writes it with the targets, and a line in
   * the diary naming what moved and who moved it. A target changed by hand is as
   * much a thing that happened in the tent as a plan step is, and without the
   * line the timeline could not say who moved it or when. A save that changed
   * nothing writes nothing. A device whose control was switched off is switched
   * on again by it: somebody who sets targets wants them held. `drying` is
   * whether they are a drying room's, `germination` whether they are for
   * germinating in the dark, and `choices` what germination does about the
   * humidity (see `WriteIntent`).
   *
   * What is stored is answered, because it is not always what was sent: the
   * work mode is the server's, the figures a mode leaves alone are kept
   * (`idle-figures.ts`), and the type's rules hold the rest (`class-rules.ts`).
   *
   * A figure the device's firmware would misread - anything but a number where
   * it reads a number - or one outside the firmware's range is refused before
   * anything is written, every one of them named (`document-figures.ts`).
   */
  public async replace(
    deviceId: string,
    configuration: DeviceConfiguration,
    by: string | null = null,
    drying?: boolean,
    germination?: boolean,
    choices?: ChoicesSaid,
  ): Promise<DeviceConfiguration | null> {
    const device = await this.typeAndDocument(deviceId);
    const refused = figureRefusals(device.type, configuration, { stored: device.configuration ?? null });
    if (refused.length > 0) throw badRequest('validation_failed', 'The settings do not fit what the device reads.', refused);

    const written = await this.store(deviceId, { kind: 'targets', drying, germination, choices }, () => configuration);
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
   * drying stage dries, germination germinates in the dark, and anything else
   * puts a device that was off, drying or germinating back on its own mode.
   * `choices` is what germination does about the humidity, where the climate
   * says so.
   */
  public async applyConfiguration(
    deviceId: string,
    settings: DeviceConfiguration,
    stage: GrowthStage | null = null,
    choices?: ChoicesSaid,
  ): Promise<boolean> {
    // Nothing to merge, or nothing to merge into, is no write: the firmware reads
    // every key a document leaves out as its compile-time default, so sending
    // either would reset tuning the cloud has no copy of. A stage with no
    // figures still decides the work mode, so it writes what the device runs -
    // and so does a climate of nothing for a device that germinates: only
    // germination is dark, so any other climate brings it back into the light
    // (a plan step that names nothing after a germination step).
    const intent: WriteIntent = { kind: 'climate', stage, requested: settings.workmode, stated: nightStated(settings), choices };
    const written = await this.store(deviceId, intent, current =>
      !current || Object.keys(current).length === 0 || (Object.keys(settings).length === 0 && stage === null && current.workmode !== 'breed')
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
    const device = await this.typeAndDocument(deviceId);
    if (sentNoSettings(device.configuration)) {
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
    const plug = await this.typeAndDocument(plugId);
    if (plug.type !== 'plug') throw unprocessable('not_a_plug', 'Only a stand-alone smart socket slows a fan while it doses CO2.');
    if (sentNoSettings(plug.configuration)) {
      throw unprocessable('device_sent_no_settings', 'This device has not sent its settings, so there is nothing to change them in.');
    }
    if (coupling) {
      const fan = await this.devices.findOne({ id: coupling.fanId }, { type: 1 }).lean<Pick<StoredDevice, 'type'> | null>();
      if (fan?.type !== 'fan') throw unprocessable('not_a_fan', 'Only an AIR fan can be slowed while a socket doses CO2.');
    }

    await this.store(plugId, { kind: 'fields' }, current => (current ? { ...current, fan: co2FanKey(coupling) } : null));
  }

  private async typeAndDocument(deviceId: string): Promise<Pick<StoredDevice, 'type' | 'configuration'>> {
    const device = await this.devices
      .findOne({ id: deviceId }, { type: 1, configuration: 1 })
      .lean<Pick<StoredDevice, 'type' | 'configuration'> | null>();
    if (!device) throw new HttpException('Device not found', 404);

    return device;
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
   * a time of day that means nothing.
   *
   * Beside the lines go the work mode where it decides what a figure is, so
   * the screens can say the drying room's humidity moved rather than the
   * night's - drying and germination hold the night's figures round the clock,
   * and a smart socket's day is for its switch points or, dosing CO2, for
   * whether it doses at all; empty for any other - and the device's type,
   * because one place holds different things on different hardware: a smart
   * socket's `daynight` times are where its day starts, a controller's are its
   * lamp's. A line written before either carries the figures alone, or the
   * figures and the mode.
   */
  private async writeDown(deviceId: string, written: Written, by: string | null): Promise<void> {
    const moved = [...withScheduleWhole(changedFigures(written.before, written.after), written.after), ...choicesMoved(written.choices)];
    if (moved.length === 0) return;

    const device = await this.devices.findOne({ id: deviceId }, { spaceId: 1, type: 1 }).lean<Pick<StoredDevice, 'spaceId' | 'type'> | null>();
    const mode = typeof written.after.workmode === 'string' ? written.after.workmode : '';
    const decisive = mode === 'dry' || mode === 'breed' || device?.type === 'plug';
    await this.entries.write({
      source: 'device',
      authorId: by,
      values: { kind: 'system' },
      spaceId: device?.spaceId ?? null,
      deviceId,
      severity: 'info',
      message: {
        key: 'message-device-configuration-updated',
        params: [moved.join('\n'), decisive ? mode : '', device?.type ?? ''],
      },
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
      throw new HttpException('Not connected to the message broker', 503);
    }

    const device = await this.devices
      .findOne(
        { id: deviceId },
        {
          type: 1,
          configuration: 1,
          ownerId: 1,
          scheduleClock: 1,
          baseWorkmode: 1,
          standardWorkmode: 1,
          beforeDrying: 1,
          beforeGermination: 1,
          germinationChoices: 1,
          restedHumidityBand: 1,
        },
      )
      .lean<Pick<
        StoredDevice,
        | 'type'
        | 'configuration'
        | 'ownerId'
        | 'scheduleClock'
        | 'baseWorkmode'
        | 'standardWorkmode'
        | 'beforeDrying'
        | 'beforeGermination'
        | 'germinationChoices'
        | 'restedHumidityBand'
      > | null>();
    if (!device) {
      throw new HttpException('Device not found', 404);
    }

    const before = device.configuration ?? null;
    const asked = next(before);
    if (asked === null) return null;

    // The standard mode last run, which a return from another mode comes back to:
    // the one kept for it, or - where none was kept yet - the one it runs or rests on.
    const lastStandard = standardOf(device.standardWorkmode) ?? standardOf(standingNow(before)) ?? standardOf(device.baseWorkmode);
    const mode = decideWorkmode(device.type, before?.workmode, device.baseWorkmode, intent, lastStandard);
    const standard = standardOf(mode?.base) ?? lastStandard;
    // A spell that begins keeps what it writes over; one ended by itself - its
    // own button, or control switched off - brings that back, since nothing else
    // that ends it brings a climate with it. A preset, a phase or a step does.
    const dried = before?.workmode === 'dry';
    const dries = mode?.workmode === 'dry';
    // Germination holds the night's temperature round the clock, and a
    // humidifier that holds goes by the night's humidity, so what is set for
    // either lands there. The night it wrote over is kept when it begins, and
    // each figure is put back when the device goes back to a day and a night
    // without one of its own: by itself, or by a stage entered without its
    // climate. A preset, a phase or a step brings whichever it names.
    const germinated = device.beforeGermination ?? null;
    const germinates = mode?.workmode === 'breed' && before?.workmode !== 'breed' && germinated === null;
    const backFromGermination = germinated !== null && SCHEDULED_MODES.includes(mode?.workmode ?? '');
    // A drying spell begun out of germination for good - the drying chip, a
    // drying stage - ends it too. What the spell puts aside to give back is the
    // night from before germination, not germination's 75 %, which the
    // standard mode would otherwise dehumidify to after the drying and which
    // "after the drying" announced; the memory is let go with it, so a later
    // germination keeps the night again. A spell begun from the device panel
    // while germinating goes back to germination (its base stays `breed`), and
    // keeps the memory for then.
    const driesFromGermination = germinated !== null && dries && !dried && mode?.base !== 'breed';
    const keptBeforeDrying = driesFromGermination && before ? withFigures(before, Object.entries(germinated)) : before;
    const bringsOwn = (path: string): boolean => intent.kind === 'targets' || (intent.kind === 'climate' && (intent.stated ?? []).includes(path));
    const returned =
      dried && !dries && intent.kind === 'fields'
        ? withFigures(asked, Object.entries(await this.keptFor(deviceId, device.beforeDrying, before)))
        : asked;
    // Germination brings its own humidity (owner's decision G3), however it is
    // begun: the operating mode and a plan step that names none get it here, as
    // a preset, a phase and the targets page bring it themselves. The figure
    // before it was a dehumidifier's - where to start drying a leafy plant's
    // air - and a humidifier holding it in the dark would leave the seeds dry.
    const wanted = backFromGermination
      ? withFigures(
          returned,
          Object.entries(germinated).filter(([path]) => !bringsOwn(path)),
        )
      : germinates && !bringsOwn(GERMINATION_HUMIDITY_PATH)
        ? withFigures(returned, [[GERMINATION_HUMIDITY_PATH, GERMINATION_HUMIDITY]])
        : returned;
    // What germination does about the humidity: what this write says, over what
    // the device keeps, over what holds where nobody said. The device keeps it
    // for the one germination: a write that ends germination lets it go, so the
    // next one starts from the defaults rather than from a choice made for
    // seeds months ago that no screen showed on the way in.
    const said = 'choices' in intent ? (intent.choices ?? null) : null;
    const kept = germinationChoicesOf(device.germinationChoices ?? null);
    const choices = germinationChoicesOf({ ...(device.germinationChoices ?? {}), ...(said ?? {}) });
    const ended = leavesGermination(before?.workmode, mode?.workmode);
    const idle = intent.kind === 'targets' && mode ? withIdleFiguresKept(before, wanted, mode.workmode) : wanted;
    const moded = mode ? { ...idle, workmode: mode.workmode } : idle;
    const band = humidifierBand(moded, !choices.humidifierHolds, device.restedHumidityBand ?? null);
    const held = heldTo(device.type, band.configuration);

    // Times a write sets are meant on the clock it is made on. Times it leaves
    // as they were are meant on the clock they were kept on, which may have
    // moved since - a plan step re-sent in the minute after the clocks went
    // back, a temperature saved from a page drawn before - so they are moved
    // along rather than taken as new.
    const clock = await this.ownersClock(device.ownerId, at);
    const drift = driftBetween(device.scheduleClock ?? null, clock);
    const timed = drift !== 0 && sameClockTimes(before, held) ? withClockTimesMoved(held, drift) : held;
    // Nothing the firmware would misread goes to the device, whatever wrote it: a
    // client is refused before this, but a plan step stored before steps were
    // checked, or a document stored before any of this, is put right here.
    const { configuration, dropped } = withFiguresHeld(device.type, timed, before);
    if (dropped.length > 0) logger.warn(`Device ${deviceId}: not sent as stored, as its firmware would misread them: ${dropped.join(', ')}`);

    await this.devices.updateOne(
      { id: deviceId },
      {
        $set: {
          configuration,
          scheduleClock: keepsTime(configuration) ? clock : null,
          ...(mode ? { baseWorkmode: mode.base } : {}),
          ...(standard ? { standardWorkmode: standard } : {}),
          ...(dries && !dried ? { beforeDrying: keptForDrying(keptBeforeDrying) } : !dries && dried ? { beforeDrying: null } : {}),
          ...(germinates
            ? { beforeGermination: keptForGermination(before) }
            : backFromGermination || driesFromGermination
              ? { beforeGermination: null }
              : {}),
          ...(band.rested !== undefined ? { restedHumidityBand: band.rested } : {}),
          ...(ended
            ? { germinationChoices: GERMINATION_FORGOTTEN.germinationChoices }
            : said && Object.keys(said).length > 0
              ? { germinationChoices: choices }
              : {}),
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
    // A device that germinates now - begun, chosen about, or sent its step again -
    // has its "too humid" told what it is to do there, rather than at the next
    // reading, and one asked to warn gets the stage's to warn with.
    if (configuration.workmode === 'breed') await this.tellGermination(deviceId);

    const choicesChanged = !ended && (kept.warnTooHumid !== choices.warnTooHumid || kept.humidifierHolds !== choices.humidifierHolds);
    return {
      before,
      after: configuration,
      changed: JSON.stringify(before) !== JSON.stringify(configuration) || choicesChanged,
      ...(choicesChanged ? { choices: { before: kept, after: choices } } : {}),
    };
  }

  /** The alarms are the alarm engine's, and one it could not be told about must not fail the write the device already has. */
  private async tellGermination(deviceId: string): Promise<void> {
    try {
      await this.germinationSink()?.germinationChanged(deviceId);
    } catch (error) {
      logger.error(`Could not tell the alarms that device ${deviceId} germinates: ${error}`);
    }
  }

  private germinationSink(): DeviceGerminationSink | null {
    try {
      return this.modules?.get<DeviceGerminationSink>(DEVICE_GERMINATION_SINK, { strict: false }) ?? null;
    } catch {
      // A server put together without the alarms - a test of this module alone - has nobody to tell.
      return null;
    }
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

/** Where germination's own humidity is written: the night's, the one half the dark mode holds. */
const GERMINATION_HUMIDITY_PATH = 'night.humidity';

const standingNow = (configuration: DeviceConfiguration | null): string | null =>
  typeof configuration?.workmode === 'string' ? configuration.workmode : null;

/** The night's figures germination may write over that settings name, nested as the firmware writes them or flat as an older client did. */
const nightStated = (settings: DeviceConfiguration): string[] =>
  GERMINATION_FIGURES.filter(path => {
    const [section, key] = path.split('.');
    const nested = settings[section];
    return (isSection(nested) && nested[key] !== undefined) || settings[path] !== undefined;
  });

/**
 * The document with its humidifier rested or holding, and what is to be kept
 * of the band it rests with (undefined where that does not change).
 *
 * A humidifier is rested only in germination and only where the grower asked
 * for it, by widening the band it switches by until it never switches on
 * (`HUMIDIFIER_REST_BAND`): the firmware has no switch for it, and in
 * germination nothing else reads the band. The band it had is kept, and put
 * back the moment the humidifier holds again - germination ended, or the
 * grower changed their mind. A document with no `daynight` section has no band
 * to widen, and is not given one.
 */
const humidifierBand = (
  configuration: DeviceConfiguration,
  rests: boolean,
  kept: number | null,
): { configuration: DeviceConfiguration; rested?: number | null } => {
  const daynight = configuration.daynight;
  if (!isSection(daynight)) return { configuration };
  const band = daynight.targetHumidityDiff;
  const resting = band === HUMIDIFIER_REST_BAND;

  if (configuration.workmode === 'breed' && rests) {
    if (resting) return { configuration };
    return {
      configuration: { ...configuration, daynight: { ...daynight, targetHumidityDiff: HUMIDIFIER_REST_BAND } },
      rested: typeof band === 'number' ? band : null,
    };
  }

  if (!resting) return kept === null ? { configuration } : { configuration, rested: null };
  const { targetHumidityDiff: _rest, ...others } = daynight;
  return { configuration: { ...configuration, daynight: kept === null ? others : { ...others, targetHumidityDiff: kept } }, rested: null };
};

/**
 * The choices of germination a write changed, as lines of the same diary entry
 * the figures go in: `germination.warnTooHumid: false → true`. They are no
 * figure of the device's document - the alarm is the cloud's, and a resting
 * humidifier is a band the server writes and hides - so without them the
 * history could not say since when the humidifier rested or "Zu feucht" was
 * quiet.
 */
const choicesMoved = (choices: Written['choices']): string[] =>
  choices
    ? (['warnTooHumid', 'humidifierHolds'] as const)
        .filter(choice => choices.before[choice] !== choices.after[choice])
        .map(choice => `germination.${choice}: ${choices.before[choice]} → ${choices.after[choice]}`)
    : [];

/** A diary line is read, not scrolled: past this many figures the rest are counted rather than listed. */
const MOST_FIGURES = 12;

/**
 * "day.temperature: 24 → 25", one line per figure that moved, in the dotted
 * names the firmware's own diff has always written into these lines.
 */
const changedFigures = (before: unknown, after: unknown): string[] => {
  const lines = figuresMoved(before, after, '');
  return lines.length > MOST_FIGURES ? [...lines.slice(0, MOST_FIGURES), `… ${lines.length - MOST_FIGURES} more`] : lines;
};

const figuresMoved = (before: unknown, after: unknown, path: string): string[] => {
  if (isSection(before) && isSection(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap(key => figuresMoved(before[key], after[key], path ? `${path}.${key}` : key));
  }
  if (HIDDEN_FIGURES.has(path) || JSON.stringify(before) === JSON.stringify(after)) return [];

  return [`${path || 'configuration'}: ${figureOf(before)} → ${figureOf(after)}`];
};

/**
 * Where a document keeps the two times its day starts and ends at: under
 * `daynight` on a controller, a fridge and a smart socket - on a socket no
 * lamp's, but when its switch points by night take over from those by day -
 * and at the top of a stand-alone LIGHT's. An AIR fan has none - its day is
 * what its light sensor sees, and its `day`/`night` are sections of figures.
 */
const LIGHT_WINDOWS = [
  ['daynight.day', 'daynight.night'],
  ['day', 'night'],
] as const;

/** Both times of the light schedule where one of them moved, the one that stayed written as itself on both sides. */
const withScheduleWhole = (lines: string[], after: DeviceConfiguration): string[] =>
  LIGHT_WINDOWS.reduce<string[]>((all, [on, off]) => {
    const named = (path: string) => all.some(line => line.startsWith(`${path}: `));
    if (named(on) === named(off)) return all;

    const missing = named(on) ? off : on;
    const value = nestedAt(after, missing);
    return typeof value === 'number' ? [...all, `${missing}: ${value} → ${value}`].sort() : all;
  }, lines);

/** A device that has never sent its document: a write would reach it as the change alone. */
const sentNoSettings = (configuration: DeviceConfiguration | null | undefined): boolean => !configuration || Object.keys(configuration).length === 0;

const figureOf = (value: unknown): string =>
  value === undefined || value === null ? '–' : typeof value === 'string' ? value : JSON.stringify(value);

const mergeSections = (current: DeviceConfiguration, settings: DeviceConfiguration): DeviceConfiguration =>
  Object.fromEntries(
    Object.entries({ ...current, ...settings }).map(([key, value]) => {
      const before = current[key];
      return [key, isSection(before) && isSection(value) ? { ...before, ...value } : value];
    }),
  );
