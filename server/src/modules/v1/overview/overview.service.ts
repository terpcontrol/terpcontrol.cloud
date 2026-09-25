import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { DateTime } from 'luxon';
import type {
  CameraStill,
  Entry,
  OverviewCamera,
  OverviewGrow,
  OverviewTargets,
  OverviewTask,
  Person,
  SpaceOverview,
  Setpoints,
} from '@fg2/shared-types/v1';
import { growDayAt, growOriginOf, metric as metricSchema, outputMetric } from '@fg2/shared-types/v1-schemas';
import { AccessRange, Grant } from '@common/v1/access.types';
import { clampRange, seenOf, withinRange } from '@common/v1/range';
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
import { readingNamesOf, serialiseDiaryEntry } from '../diary/diary-entries';
import { NOTHING_HIDDEN, Redaction, growUpTo, redactionOf, stagesReachedOf, summaryOf } from '../grow/grow-serialiser';
import { dueTasksOf, occurrencePrefix } from '../home/due-tasks';
import { liveOfDevice, mergeLive, setpointOf } from '../space/space-live';
import { SpaceLiveService } from '../space/space-live.service';
import { SpacesService } from '../space/spaces.service';
import { STEERED, verdictOf } from './climate-verdict';
import { openAlertReader } from '../home/open-alerts';

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
 * The working half of the page goes with it - what is due and what is alarming
 * is for whoever keeps the tent, and a reader who arrived on a link is not one
 * of them.
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
    /**
     * Whether the window this is read through has already closed, which is what
     * separates a tent page from a tent page as it stood.
     *
     * A link carries a window, and the window belongs to the link: what is true
     * in the tent *now* - the readings, what the controller is aiming for, when
     * the camera last fired, which grow stands here today - is all dated after
     * the window and is therefore none of that reader's business. So a closed
     * window answers the diary, the pictures and the climate of the window and
     * no "now" at all.
     */
    const closed = range.endsAt !== null && range.endsAt < now;

    const [readings, grows, cameras, alerts, owner] = await Promise.all([
      closed ? Promise.resolve([]) : Promise.all(devices.map(async device => ({ device, reading: await this.data.live(device.id) }))),
      this.growsHere(spaceId, range, closed),
      grant.includeCameras
        ? this.cameras.find({ spaceId, removedAt: null }).sort({ createdAt: 1, id: 1 }).lean<CameraDocument[]>()
        : Promise.resolve([]),
      this.alerts
        .find({ $and: [{ resolvedAt: null }, this.raisedHere(spaceId, devices), withinRange('startedAt', range)] })
        .sort({ startedAt: -1 })
        .lean<StoredAlert[]>(),
      this.users
        .findOne({ id: space.ownerId }, { id: 1, preferences: 1, privacy: 1 })
        .lean<Pick<StoredUser, 'id' | 'preferences' | 'privacy'> | null>(),
    ]);
    const growIds = grows.map(grow => grow.id);

    // The controller is what a tent's climate is; a plug's thermometer standing
    // beside it reports a temperature but aims at nothing, so it gets no verdict.
    // Which device that is follows from its configuration rather than from a
    // reading, so a window with no "now" in it still knows where to read the
    // series from - what is not answered through it is the targets themselves.
    const [steering = null] = devices.flatMap(device => {
      const targets = setpointsOf(
        device.configuration,
        readings.find(one => one.device.id === device.id)?.reading.isDay ?? true,
        device.state?.hardware,
      );
      return targets ? [{ deviceId: device.id, targets }] : [];
    });
    const window = seenOf({ startsAt: new Date(until.getTime() - VERDICT_HOURS * 3600 * 1000), endsAt: until }, range);

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

    const [completions, openAlertOf] = await Promise.all([this.completionsOf(reminders), openAlertReader(this.rules, alerts)]);
    // The band a window is judged against is the controller's configuration as
    // it stands now, which a closed window may not be told either - so a tent
    // read through one is stated rather than graded.
    const band = closed ? null : (steering?.targets ?? null);
    const verdict = verdictOf(series, band, window);

    /**
     * What is due here and what is alarming are the working half of the page,
     * and they belong to the people who keep the tent. A stranger who opened a
     * link, and anybody reading a public grow, gets the diary and the climate
     * and neither of these - which is what the contract means by a shared tent
     * page whose tasks and alerts are empty.
     */
    const forKeepers = !grant.redacted;
    const dueTasks = forKeepers ? dueTasksOf(reminders, completions, now).map(task => ({ ...task, defaults: defaultsOf(task.id, reminders) })) : [];
    // The lines themselves are served through the same privacy as the grows
    // above them: a harvest entry carries the weights the card is already
    // hiding, and a photo line names the camera a link may not have been made
    // to carry.
    const lines = redactionOf(grant.redacted, owner?.privacy);
    const told = entries.map(entry => serialiseDiaryEntry(entry, lines, grant.includeCameras));

    return {
      spaceId: space.id,
      name: space.name,
      kind: space.kind,
      // How the place is arranged and what hardware stands in it are the
      // grower's, not the reader's: a shared tent page is a tent, and a room id
      // and a device id tie it to the rest of an account.
      roomId: grant.redacted ? null : space.roomId,
      deviceIds: grant.redacted ? null : devices.map(device => device.id),
      ...mergeLive(readings.map(liveOfDevice)),
      targets: closed || !steering ? null : targetsOf(steering.targets),
      verdict: grant.redacted ? { ...verdict, deviceId: null } : verdict,
      grows: grows.map(grow =>
        growHere(
          growUpTo(grow, until),
          spaceId,
          plants.filter(plant => plant.growId === grow.id),
          hide(grow.ownerId),
          until,
        ),
      ),
      cameras: cameras.map(camera => cameraHere(camera, stills.get(camera.id) ?? [], closed)),
      entries: told,
      readingNames: readingNamesOf(grows),
      dueTasks,
      openAlerts: forKeepers ? alerts.map(openAlertOf) : [],
      people: await this.peopleIn(told, dueTasks),
    };
  }

  /** An alert of this space, or of a device standing in it. */
  private raisedHere(spaceId: string, devices: StoredDevice[]): FilterQuery<StoredAlert> {
    return { $or: [{ spaceId }, { deviceId: { $in: devices.map(device => device.id) } }] };
  }

  /**
   * Which grows stand here, which is a question with a date on it.
   *
   * While the window is open that is what stands here now: a grow that has not
   * ended, placed here and not moved on. A window that has closed asks the same
   * question of the window instead - a grow that stood here during it, whether
   * or not it still does - because a grow started last week is not part of what
   * a link handed out in August was sent to show, name, strains and all.
   */
  private growsHere(spaceId: string, range: AccessRange, closed: boolean): Promise<GrowDocument[]> {
    // Still running, still standing here. A window that is open keeps up with
    // the tent, so this is also what a link with no end answers.
    const current: FilterQuery<GrowDocument> = { endedAt: null, placements: { $elemMatch: { spaceId, endedAt: null } } };

    // Over before the window opened, in either sense: the grow itself, or the
    // placement that put it here. An open start leaves nothing to be before.
    const started = range.startsAt ? { $or: [{ endedAt: null }, { endedAt: { $gt: range.startsAt } }] } : {};
    const during: FilterQuery<GrowDocument> = {
      ...started,
      placements: { $elemMatch: { spaceId, startedAt: { $lte: range.endsAt }, ...started } },
    };

    return this.grows
      .find(closed ? during : current)
      .sort({ startedAt: -1, id: -1 })
      .lean<GrowDocument[]>();
  }

  /**
   * The day's pictures, one per slot, per camera. A camera takes 2880 stills a
   * day, so the newest handful of them would be the last few minutes; the slot
   * each picture falls in is grouped in the database rather than read out and
   * thinned here.
   *
   * The last picture of each slot is the one kept, not the first. Every slot but
   * one is over by the time it is read and either end of it would do, but the
   * slot the day is still inside is not: taking its first froze the strip on a
   * picture up to two hours old under a heading that says "today", while the
   * home card and the camera page beside it drew the current one. The id and
   * the instant are taken from the same end so a tile's stamp belongs to the
   * picture above it.
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
              mediaId: { $last: '$id' },
              capturedAt: { $last: '$capturedAt' },
            },
          },
          { $sort: { capturedAt: 1 } },
        ]);

        return [camera.id, found.map(row => ({ mediaId: row.mediaId, capturedAt: row.capturedAt.toISOString() }))] as const;
      }),
    );

    return new Map(rows);
  }

  /**
   * Whose privacy applies to each grow standing here; nothing is hidden from an
   * owner or a member.
   *
   * It answers a function rather than a map because the miss matters: an owner
   * whose row could not be read - deleted, or deleted from under their grows -
   * hides everything, which is the direction every other path already takes and
   * the only one that is safe from somebody who is already a stranger. A map
   * with a fallback beside it is a fallback somebody reads as "nothing to hide".
   */
  private async redactionFor(grant: Grant, grows: GrowDocument[]): Promise<(ownerId: string) => Redaction> {
    if (!grant.redacted) return () => NOTHING_HIDDEN;

    const ownerIds = [...new Set(grows.map(grow => grow.ownerId))];
    const owners = await this.users.find({ id: { $in: ownerIds } }, { id: 1, privacy: 1 }).lean<Pick<StoredUser, 'id' | 'privacy'>[]>();
    const byOwner = new Map(owners.map(owner => [owner.id, redactionOf(true, owner.privacy)]));

    return ownerId => byOwner.get(ownerId) ?? redactionOf(true, undefined);
  }

  /** The entries that completed a task of these reminders: a one-off by its id, a rhythm by any of its occurrences. */
  private completionsOf(reminders: ReminderDocument[]): Promise<EntryDocument[]> {
    if (reminders.length === 0) return Promise.resolve([]);

    return this.entries
      .find({ $or: reminders.map(reminder => ({ taskId: reminder.onceAt ? reminder.id : { $regex: `^${occurrencePrefix(reminder.id)}` } })) })
      .lean<EntryDocument[]>();
  }

  /**
   * Everyone the page names, once, so "Mia fed" needs no second read. Asked of
   * the lines as they are answered rather than as they are stored: a page that
   * names nobody has nobody to look up.
   */
  private async peopleIn(entries: Entry[], tasks: OverviewTask[]): Promise<Person[]> {
    const ids = new Set([...entries.map(entry => entry.authorId), ...tasks.map(task => task.assigneeId)]);
    ids.delete(null);
    if (ids.size === 0) return [];

    const people = await this.users.find({ id: { $in: [...ids] } }, { id: 1, handle: 1 }).lean<Pick<StoredUser, 'id' | 'handle'>[]>();
    return people.map(person => ({ id: person.id, handle: person.handle }));
  }
}

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
 * The grow's own day at an instant, counted from the one origin the grow
 * serialiser counts its header from - so "here since day 22" and "Day 32" on
 * the same card are days of the same calendar. Null before the first phase, as
 * the day counter is.
 */
const dayNumberOn = (grow: GrowDocument, at: Date): number | null => (grow.phases.length > 0 ? growDayAt(growOriginOf(grow), at) : null);

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
    stageWeek: summary.stageWeek,
    weekNumber: summary.weekNumber,
    stage: summary.stage,
    stagesReached: stagesReachedOf(grow, summary.stage, now),
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

/**
 * A camera of this tent, with what it saw. `lastStillAt` is the one thing on it
 * that is about now rather than about the window: it is when the camera last
 * fired, which for a reader whose window closed in August is a fact about
 * September. The strip itself is already clamped, so what is left is a camera
 * that says what it took and not what it is taking.
 */
const cameraHere = (camera: CameraDocument, stills: CameraStill[], closed: boolean): OverviewCamera => ({
  cameraId: camera.id,
  name: camera.name,
  lastStillAt: closed ? null : (camera.state.lastStillAt?.toISOString() ?? null),
  stills,
});
