import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { DateTime } from 'luxon';
import type {
  CameraStill,
  Metric,
  OpenAlert,
  OverviewCamera,
  OverviewGrow,
  OverviewTargets,
  OverviewTask,
  Person,
  SpaceOverview,
  Setpoints,
} from '@fg2/shared-types/v1';
import { metric as metricSchema, outputMetric } from '@fg2/shared-types/v1-schemas';
import { AccessRange, Grant } from '@common/v1/access.types';
import { serialiseEntry } from '@common/v1/entries';
import { clampRange, withinRange } from '@common/v1/range';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { DataService } from '@modules/data/data.service';
import { setpointsOf } from '../device/setpoints';
import { NOTHING_HIDDEN, Redaction, redactionOf, summaryOf } from '../grow/grow-serialiser';
import { dueTasksOf, occurrencePrefix } from '../home/due-tasks';
import { liveOfDevice, mergeLive, setpointOf } from '../space/space-live';
import { SpaceLiveService } from '../space/space-live.service';
import { SpacesService } from '../space/spaces.service';
import { STEERED, verdictOf } from './climate-verdict';

/**
 * The tent page's landing tab: what is true in one space now, what needs a
 * human, what grows there, what its cameras saw today, how the last day went
 * and what was last written.
 *
 * It is the home card of that space read at the depth a page has room for, so
 * the live half is the one `/live` answers - the same devices, through the same
 * two functions - and only the four things a card has no room for are worked out
 * here: the verdict, the day's pictures, every grow standing here rather than
 * the headline one, and enough of a due task to tick it off without a second
 * read.
 *
 * Every read is clamped to what the caller was granted, because this is a route
 * a share link reaches: the window is the link's, and a grow read by somebody
 * who is neither its owner nor a member is served through its owner's privacy.
 */

/** How many lines of the diary a page opens with. */
const ENTRIES_ON_THE_PAGE = 8;

/** The window the verdict is drawn from, and how finely it is read. */
const VERDICT_HOURS = 24;

/**
 * Two minutes a window. Fine enough to put an excursion's start within a minute
 * or two of when it happened and to count an actuator's runs; coarse enough that
 * a day is one query of a few hundred points per field.
 */
const VERDICT_STEP_SECONDS = 120;

/**
 * At most one still per slot of the day, so the strip spans the day rather than
 * the last few minutes of it: a camera takes one every 30 seconds and a row of
 * thumbnails holds a handful.
 */
const STILL_SLOTS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class OverviewService {
  constructor(
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.plant) private readonly plants: Model<PlantDocument>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    @InjectModel(MODEL_V1.alert) private readonly alerts: Model<StoredAlert>,
    @InjectModel(MODEL_V1.alarmRule) private readonly rules: Model<StoredAlarmRule>,
    @InjectModel(MODEL_V1.reminder) private readonly reminders: Model<ReminderDocument>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly places: SpacesService,
    private readonly live: SpaceLiveService,
    private readonly data: DataService,
  ) {}

  public async read(grant: Grant, spaceId: string, now: Date = new Date()): Promise<SpaceOverview> {
    const [space, devices] = await Promise.all([this.places.require(spaceId), this.live.devicesIn([spaceId])]);
    // Nothing later than now, and nothing outside what the caller was granted:
    // the answer of a share link is the link's window, not the tent's whole life.
    const range = clampRange(grant, { endsAt: now });
    const until = range.endsAt ?? now;

    const [readings, grows, cameras, alerts, owner] = await Promise.all([
      Promise.all(devices.map(async device => ({ device, reading: await this.data.live(device.id) }))),
      this.grows
        .find({ endedAt: null, placements: { $elemMatch: { spaceId, endedAt: null } } })
        .sort({ startedAt: -1, id: -1 })
        .lean<GrowDocument[]>(),
      grant.includeCameras
        ? this.cameras.find({ spaceId, removedAt: null }).sort({ createdAt: 1, id: 1 }).lean<CameraDocument[]>()
        : Promise.resolve([]),
      this.alerts
        .find({ $and: [{ resolvedAt: null }, this.raisedHere(spaceId, devices), withinRange('startedAt', range)] })
        .sort({ startedAt: -1 })
        .lean<StoredAlert[]>(),
      this.users.findOne({ id: space.ownerId }, { id: 1, preferences: 1 }).lean<Pick<StoredUser, 'id' | 'preferences'> | null>(),
    ]);
    const growIds = grows.map(grow => grow.id);

    // The controller is what a tent's climate is; a plug's thermometer standing
    // beside it reports a temperature but aims at nothing, so it gets no verdict.
    const [steering = null] = readings.flatMap(({ device, reading }) => {
      const targets = setpointsOf(device.configuration, reading.isDay);
      return targets ? [{ deviceId: device.id, targets }] : [];
    });
    const window = clampedWindow(grant, { startsAt: new Date(until.getTime() - VERDICT_HOURS * 3600 * 1000), endsAt: until });

    const [plants, reminders, entries, stills, hide, series] = await Promise.all([
      this.plants
        .find({ growId: { $in: growIds } })
        .sort({ createdAt: 1, _id: 1 })
        .lean<PlantDocument[]>(),
      this.reminders
        .find({
          $or: [
            { 'subject.type': 'space', 'subject.id': spaceId },
            { 'subject.type': 'grow', 'subject.id': { $in: growIds } },
          ],
        })
        .lean<ReminderDocument[]>(),
      this.entries
        .find({ $and: [{ $or: [{ spaceId }, { growId: { $in: growIds } }] }, withinRange('occurredAt', range)] })
        .sort({ occurredAt: -1, _id: -1 })
        .limit(ENTRIES_ON_THE_PAGE)
        .lean<EntryDocument[]>(),
      this.stillsToday(cameras, owner?.preferences.timezone ?? null, range, until),
      this.redactionFor(grant, grows),
      steering
        ? this.data.series(steering.deviceId, {
            metrics: STEERED,
            // Every output in the same read: what the verdict counts runs of, and
            // the light it tells day from night by.
            outputs: outputMetric.options,
            ...window,
            stepSeconds: VERDICT_STEP_SECONDS,
          })
        : Promise.resolve(null),
    ]);

    const [completions, watched] = await Promise.all([this.completionsOf(reminders), this.metricsOf(alerts)]);
    const dueTasks = dueTasksOf(reminders, completions, now).map(task => ({ ...task, defaults: defaultsOf(task.id, reminders) }));

    return {
      spaceId: space.id,
      name: space.name,
      kind: space.kind,
      roomId: space.roomId,
      deviceIds: devices.map(device => device.id),
      ...mergeLive(readings.map(liveOfDevice)),
      targets: steering ? targetsOf(steering.targets) : null,
      verdict: verdictOf(series, steering?.targets ?? null, window),
      grows: grows.map(grow =>
        growHere(
          grow,
          spaceId,
          plants.filter(plant => plant.growId === grow.id),
          hide.get(grow.ownerId) ?? NOTHING_HIDDEN,
          now,
        ),
      ),
      cameras: cameras.map(camera => cameraHere(camera, stills.get(camera.id) ?? [])),
      entries: entries.map(serialiseEntry),
      dueTasks,
      openAlerts: alerts.map(alert => openAlertOf(alert, watched.get(alert.ruleId ?? '') ?? null)),
      people: await this.peopleIn(entries, dueTasks),
    };
  }

  /** An alert of this space, or of a device standing in it. */
  private raisedHere(spaceId: string, devices: StoredDevice[]): FilterQuery<StoredAlert> {
    return { $or: [{ spaceId }, { deviceId: { $in: devices.map(device => device.id) } }] };
  }

  /**
   * The day's pictures, one per slot, per camera. A camera takes 2880 stills a
   * day, so the newest handful of them would be the last few minutes; the slot
   * each picture falls in is grouped in the database rather than read out and
   * thinned here.
   *
   * The day is the one the tent stands in - its owner's, not its reader's - so
   * that a shared tent and its grower see the same strip.
   */
  private async stillsToday(
    cameras: CameraDocument[],
    timezone: string | null,
    range: AccessRange,
    until: Date,
  ): Promise<Map<string, CameraStill[]>> {
    if (cameras.length === 0) return new Map();

    const local = DateTime.fromJSDate(until, { zone: timezone ?? 'UTC' });
    const startOfDay = (local.isValid ? local : DateTime.fromJSDate(until, { zone: 'UTC' })).startOf('day').toJSDate();
    const from = clampRange({ range }, { startsAt: startOfDay }).startsAt ?? startOfDay;
    const slotMs = Math.floor(DAY_MS / STILL_SLOTS);

    const rows = await Promise.all(
      cameras.map(async camera => {
        const found = await this.media.aggregate<{ mediaId: string; capturedAt: Date }>([
          { $match: { cameraId: camera.id, kind: 'still', capturedAt: { $gte: from, $lte: until } } },
          { $sort: { capturedAt: 1 } },
          {
            $group: {
              _id: { $floor: { $divide: [{ $subtract: ['$capturedAt', from] }, slotMs] } },
              mediaId: { $first: '$id' },
              capturedAt: { $first: '$capturedAt' },
            },
          },
          { $sort: { capturedAt: 1 } },
        ]);

        return [camera.id, found.map(row => ({ mediaId: row.mediaId, capturedAt: row.capturedAt.toISOString() }))] as const;
      }),
    );

    return new Map(rows);
  }

  /** Whose privacy applies to each grow standing here; nothing is hidden from an owner or a member. */
  private async redactionFor(grant: Grant, grows: GrowDocument[]): Promise<Map<string, Redaction>> {
    if (!grant.redacted) return new Map();

    const ownerIds = [...new Set(grows.map(grow => grow.ownerId))];
    const owners = await this.users.find({ id: { $in: ownerIds } }, { id: 1, privacy: 1 }).lean<Pick<StoredUser, 'id' | 'privacy'>[]>();

    return new Map(owners.map(owner => [owner.id, redactionOf(true, owner.privacy)]));
  }

  /** What each open alert's rule watches: an alert stores the reading, its rule the metric the reading is of. */
  private async metricsOf(alerts: StoredAlert[]): Promise<Map<string, Metric>> {
    const ruleIds = [...new Set(alerts.flatMap(alert => (alert.ruleId ? [alert.ruleId] : [])))];
    if (ruleIds.length === 0) return new Map();

    const rules = await this.rules.find({ id: { $in: ruleIds } }, { id: 1, metric: 1 }).lean<Pick<StoredAlarmRule, 'id' | 'metric'>[]>();
    return new Map(rules.map(rule => [rule.id, rule.metric]));
  }

  /** The entries that completed a task of these reminders: a one-off by its id, a rhythm by any of its occurrences. */
  private completionsOf(reminders: ReminderDocument[]): Promise<EntryDocument[]> {
    if (reminders.length === 0) return Promise.resolve([]);

    return this.entries
      .find({ $or: reminders.map(reminder => ({ taskId: reminder.onceAt ? reminder.id : { $regex: `^${occurrencePrefix(reminder.id)}` } })) })
      .lean<EntryDocument[]>();
  }

  /** Everyone the page names, once, so "Mia fed" needs no second read. */
  private async peopleIn(entries: EntryDocument[], tasks: OverviewTask[]): Promise<Person[]> {
    const ids = new Set([...entries.map(entry => entry.authorId), ...tasks.map(task => task.assigneeId)]);
    ids.delete(null);
    if (ids.size === 0) return [];

    const people = await this.users.find({ id: { $in: [...ids] } }, { id: 1, handle: 1 }).lean<Pick<StoredUser, 'id' | 'handle'>[]>();
    return people.map(person => ({ id: person.id, handle: person.handle }));
  }
}

/** A window with both ends named, narrowed to what the caller was granted. */
const clampedWindow = (grant: Grant, asked: { startsAt: Date; endsAt: Date }): { startsAt: Date; endsAt: Date } => {
  const range = clampRange(grant, asked);

  return { startsAt: range.startsAt ?? asked.startsAt, endsAt: range.endsAt ?? asked.endsAt };
};

/**
 * Both halves of the cycle, in the order a card draws them. `/live` answers the
 * half the tent is in now, which is what a reading is held against; the header
 * states the pair, and the verdict's bands are these widened by `TARGET_BAND`.
 */
const targetsOf = (both: Setpoints): OverviewTargets => {
  const metrics = metricSchema.options.filter(name => both.day[name] !== undefined || both.night[name] !== undefined);

  return {
    day: metrics.map(name => setpointOf(name, both.day[name] ?? null)),
    night: metrics.map(name => setpointOf(name, both.night[name] ?? null)),
  };
};

/** The reminder a derived task came from: a one-off is its id, a rhythm its id and the day. */
const defaultsOf = (taskId: string, reminders: ReminderDocument[]): ReminderDocument['defaults'] =>
  reminders.find(reminder => taskId === reminder.id || taskId.startsWith(occurrencePrefix(reminder.id)))?.defaults ?? null;

/**
 * Day 1 is the day the grow's first phase began, counted as the grow serialiser
 * counts it - in elapsed days rather than calendar ones, because the grower's
 * midnight is not the server's.
 */
const dayNumberOn = (grow: GrowDocument, at: Date): number | null => {
  const first = grow.phases.reduce<Date | null>((earliest, phase) => (earliest && earliest <= phase.startedAt ? earliest : phase.startedAt), null);

  return first ? Math.max(1, Math.floor((at.getTime() - first.getTime()) / DAY_MS) + 1) : null;
};

const growHere = (grow: GrowDocument, spaceId: string, plants: PlantDocument[], hide: Redaction, now: Date): OverviewGrow => {
  const summary = summaryOf(grow, plants, hide, now);
  // The placement that put these plants here, which is not where the grow began:
  // a grow moves between tents and its day counter carries on across the move.
  const placement = grow.placements
    .filter(one => one.spaceId === spaceId && one.endedAt === null)
    .reduce<GrowDocument['placements'][number] | null>((first, one) => (first && first.startedAt <= one.startedAt ? first : one), null);
  const placedAt = placement?.startedAt ?? grow.startedAt;

  return {
    growId: grow.id,
    name: grow.name,
    type: grow.type,
    dayNumber: summary.dayNumber,
    phaseDay: summary.phaseDay,
    weekNumber: summary.weekNumber,
    stage: summary.stage,
    preset: summary.preset,
    isAuto: summary.isAuto,
    plantCount: hide.counts ? null : plants.length,
    strains: [...new Set(plants.map(plant => plant.strain))],
    coverMediaId: grow.coverMediaId,
    stageGroups: summary.groups.map(group => ({ stage: group.stage, plantCount: hide.counts ? null : group.plantIds.length })),
    placedAt: placedAt.toISOString(),
    placedOnDay: dayNumberOn(grow, placedAt),
  };
};

const cameraHere = (camera: CameraDocument, stills: CameraStill[]): OverviewCamera => ({
  cameraId: camera.id,
  name: camera.name,
  lastStillAt: camera.state.lastStillAt?.toISOString() ?? null,
  stills,
});

const openAlertOf = (alert: StoredAlert, metric: Metric | null): OpenAlert => ({
  alertId: alert.id,
  kind: alert.kind,
  severity: alert.severity,
  startedAt: alert.startedAt.toISOString(),
  value: alert.value,
  metric,
});
