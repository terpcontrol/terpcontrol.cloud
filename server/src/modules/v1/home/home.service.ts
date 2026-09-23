import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import type {
  CardTrend,
  DueTask,
  FollowedGrowCard,
  GrowCard,
  HomeAnswer,
  HomeSpaceCard,
  LatestStill,
  Metric,
  OpenAlert,
  Person,
  SeriesPoint,
  UserPrivacy,
} from '@fg2/shared-types/v1';
import { AccessContext } from '@common/v1/access.types';
import { serialiseEntry } from '@common/v1/entries';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { FollowDocument } from '@database/schemas/v1/follows.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { DataService } from '@modules/data/data.service';
import { diaryMovedAt } from '../diary/diary-entries';
import { NOTHING_HIDDEN, Redaction, redactionOf, serialisePublicCard, summaryOf } from '../grow/grow-serialiser';
import { mergeLive } from '../space/space-live';
import { SpaceLiveService } from '../space/space-live.service';
import { SpacesService } from '../space/spaces.service';
import { dueTasksOf, occurrencePrefix } from './due-tasks';

/**
 * The home screen: one card per space, with everything the card shows already
 * on it. A space is a place and a card is a place with what stands in it, so
 * this is the one read that walks from the places a person can see to their
 * devices, their grows, the newest lines of the diary, the newest picture, what
 * is due and what is alarming - a handful of queries, and one Influx read per
 * device.
 *
 * A grow standing in no place at all gets a card of its own, with the ids null
 * and the climate half empty. Without it the diary-only grower - the balcony,
 * the windowsill, the tent with no controller - would start a grow and find the
 * home unchanged, because a place is the only thing the cards would be counted
 * from.
 *
 * Every figure here is what a screen draws and nothing else: the day counter
 * and the phase come from the grow serialiser, the age of a value from the
 * shared constant, the tasks from the reminders. Nothing is decided twice.
 */

/** How many lines of the diary a card shows: the newest, and enough to see who has been in. */
const ENTRIES_PER_CARD = 3;

/** The sparkline: a day of temperature in half-hour windows, which is coarse enough for a stamp and fine enough to see the night. */
const TREND_METRIC = 'temperature';
const TREND_HOURS = 24;
const TREND_STEP_SECONDS = 1800;

interface Card {
  /** Null on the card that stands for a grow with no place, which is drawn from the grow alone. */
  space: SpaceDocument | null;
  grow: GrowDocument | null;
}

@Injectable()
export class HomeService {
  constructor(
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.plant) private readonly plants: Model<PlantDocument>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    @InjectModel(MODEL_V1.alert) private readonly alerts: Model<StoredAlert>,
    @InjectModel(MODEL_V1.alarmRule) private readonly rules: Model<StoredAlarmRule>,
    @InjectModel(MODEL_V1.reminder) private readonly reminders: Model<ReminderDocument>,
    @InjectModel(MODEL_V1.follow) private readonly follows: Model<FollowDocument>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly places: SpacesService,
    private readonly live: SpaceLiveService,
    private readonly data: DataService,
  ) {}

  public async read(ctx: AccessContext, now: Date = new Date()): Promise<HomeAnswer> {
    // An administrator's home is their own tents, not every customer's - which
    // is now what `visibleTo` answers for anybody, so this no longer has to say
    // so for itself. What an admin may look at is the fleet's business, and the
    // fleet has its own routes.
    const spaces = await this.spaces
      .find({ $and: [await this.places.visibleTo(ctx), { archivedAt: null }] })
      .sort({ createdAt: 1, id: 1 })
      .lean<SpaceDocument[]>();
    const spaceIds = spaces.map(space => space.id);

    const [devices, grows] = await Promise.all([
      this.live.devicesIn(spaceIds),
      this.grows
        .find({
          // Combined rather than merged: the ownership scope is an `$or` of its
          // own and would silently replace the branch that finds placed grows.
          $and: [
            { endedAt: null },
            {
              $or: [
                { placements: { $elemMatch: { spaceId: { $in: spaceIds }, endedAt: null } } },
                { $and: [ownGrows(ctx), { placements: { $not: { $elemMatch: { spaceId: { $ne: null }, endedAt: null } } } }] },
              ],
            },
          ],
        })
        .sort({ startedAt: -1 })
        .lean<GrowDocument[]>(),
    ]);

    // A room is where tents are grouped, not a card of its own - unless
    // something stands in the room itself. A placeless grow follows the places,
    // because it has no order among them and the app lifts whatever needs a
    // person to the top anyway.
    const cards: Card[] = [
      ...spaces
        .map(space => ({ space, grow: grows.find(grow => standsIn(grow, space.id)) ?? null }))
        .filter(({ space, grow }) => space.kind !== 'room' || grow !== null || devices.some(device => device.spaceId === space.id)),
      ...grows.filter(standsNowhere).map(grow => ({ space: null, grow })),
    ];
    const growIds = cards.flatMap(card => (card.grow ? [card.grow.id] : []));

    const trendWindow = { startsAt: new Date(now.getTime() - TREND_HOURS * 3600 * 1000), endsAt: now, stepSeconds: TREND_STEP_SECONDS };
    const [readings, trends, plants, cameras, alerts, reminders, hide] = await Promise.all([
      this.live.readingsOf(devices),
      this.data.trends(
        devices.map(device => device.id),
        TREND_METRIC,
        trendWindow,
      ),
      this.plants
        .find({ growId: { $in: growIds } })
        .sort({ createdAt: 1, _id: 1 })
        .lean<PlantDocument[]>(),
      this.cameras.find({ spaceId: { $in: spaceIds }, removedAt: null }, { id: 1, spaceId: 1 }).lean<CameraDocument[]>(),
      this.alerts
        .find({ resolvedAt: null, $or: [{ spaceId: { $in: spaceIds } }, { deviceId: { $in: devices.map(device => device.id) } }] })
        .sort({ startedAt: -1 })
        .lean<StoredAlert[]>(),
      this.reminders
        .find({
          $or: [
            { 'subject.type': 'space', 'subject.id': { $in: spaceIds } },
            { 'subject.type': 'grow', 'subject.id': { $in: growIds } },
          ],
        })
        .lean<ReminderDocument[]>(),
      this.redactionFor(ctx, cards),
    ]);
    const [completions, watched] = await Promise.all([this.completionsOf(reminders), this.metricsOf(alerts)]);
    const tasks = dueTasksOf(reminders, completions, now);

    const answers = await Promise.all(
      cards.map(async ({ space, grow }): Promise<HomeSpaceCard> => {
        const here = space ? devices.filter(device => device.spaceId === space.id).map(device => device.id) : [];
        const eyes = space ? cameras.filter(camera => camera.spaceId === space.id).map(camera => camera.id) : [];
        const [entries, still] = await Promise.all([this.newestEntries(space?.id ?? null, grow?.id ?? null), this.latestStill(eyes)]);
        const inSpace = readings.filter(reading => here.includes(reading.deviceId));

        return {
          spaceId: space?.id ?? null,
          // A card with no place is known by its grow, which is the only name it has.
          name: space?.name ?? grow!.name,
          kind: space?.kind ?? null,
          roomId: space?.roomId ?? null,
          deviceIds: here,
          ...mergeLive(inSpace),
          trend: trendOf(here, trends, trendWindow),
          grow: grow
            ? growCardOf(
                grow,
                plants.filter(plant => plant.growId === grow.id),
                hide.get(grow.ownerId) ?? NOTHING_HIDDEN,
                now,
              )
            : null,
          entries: entries.map(serialiseEntry),
          latestStill: still,
          dueTasks: tasks.filter(task => isAbout(task, space?.id ?? null, grow?.id ?? null)),
          openAlerts: alerts
            .filter(alert => space !== null && (alert.spaceId === space.id || (alert.deviceId !== null && here.includes(alert.deviceId))))
            .map(alert => openAlertOf(alert, watched.get(alert.ruleId ?? '') ?? null)),
        };
      }),
    );

    const followedGrows = ctx.userId && !ctx.isDemo ? await this.followed(ctx.userId, now) : [];

    return { spaces: answers, followedGrows, people: await this.peopleIn(answers) };
  }

  /**
   * Whose privacy applies to each grow. A card is only ever read by an owner, a
   * member or the demo tour, so the tour is the one reader anything is hidden from.
   */
  private async redactionFor(ctx: AccessContext, cards: Card[]): Promise<Map<string, Redaction>> {
    if (!ctx.isDemo) return new Map();

    const ownerIds = [...new Set(cards.flatMap(card => (card.grow ? [card.grow.ownerId] : [])))];
    const owners = await this.users.find({ id: { $in: ownerIds } }, { id: 1, privacy: 1 }).lean<Pick<StoredUser, 'id' | 'privacy'>[]>();

    return new Map(owners.map(owner => [owner.id, redactionOf(true, owner.privacy as UserPrivacy)]));
  }

  /** The grow's diary where there is a grow; the space's own lines - a device's, an alarm's - where there is none. */
  private newestEntries(spaceId: string | null, growId: string | null): Promise<EntryDocument[]> {
    return this.entries
      .find(growId ? { growId } : { spaceId })
      .sort({ occurredAt: -1, _id: -1 })
      .limit(ENTRIES_PER_CARD)
      .lean<EntryDocument[]>();
  }

  private async latestStill(cameraIds: string[]): Promise<LatestStill | null> {
    if (cameraIds.length === 0) return null;

    const still = await this.media
      .findOne({ cameraId: { $in: cameraIds }, kind: 'still' }, { id: 1, cameraId: 1, capturedAt: 1 })
      .sort({ capturedAt: -1 })
      .lean<Pick<MediaDocument, 'id' | 'cameraId' | 'capturedAt'> | null>();

    return still && still.cameraId ? { mediaId: still.id, cameraId: still.cameraId, capturedAt: still.capturedAt.toISOString() } : null;
  }

  /**
   * What each open alert's rule watches: an alert stores the reading, its rule
   * the metric the reading is of. A rule on an output names no metric, so the
   * card says what happened without a unit to say it in.
   */
  private async metricsOf(alerts: StoredAlert[]): Promise<Map<string, Metric>> {
    const ruleIds = [...new Set(alerts.flatMap(alert => (alert.ruleId ? [alert.ruleId] : [])))];
    if (ruleIds.length === 0) return new Map();

    const rules = await this.rules.find({ id: { $in: ruleIds } }, { id: 1, watch: 1 }).lean<Pick<StoredAlarmRule, 'id' | 'watch'>[]>();
    return new Map(rules.flatMap(rule => (rule.watch.kind === 'reading' ? [[rule.id, rule.watch.metric] as [string, Metric]] : [])));
  }

  /** The entries that completed a task of these reminders: a one-off by its id, a rhythm by any of its occurrences. */
  private completionsOf(reminders: ReminderDocument[]): Promise<EntryDocument[]> {
    if (reminders.length === 0) return Promise.resolve([]);

    return this.entries
      .find({ $or: reminders.map(reminder => ({ taskId: reminder.onceAt ? reminder.id : { $regex: `^${occurrencePrefix(reminder.id)}` } })) })
      .lean<EntryDocument[]>();
  }

  /**
   * The grows this person follows. Following is what a public page offers, so
   * only a grow that is still public is listed - one that has been made private
   * since is nobody's to keep watching.
   */
  private async followed(userId: string, now: Date): Promise<FollowedGrowCard[]> {
    const follows = await this.follows.find({ userId }).sort({ createdAt: -1 }).lean<FollowDocument[]>();
    if (follows.length === 0) return [];

    const grows = await this.grows.find({ id: { $in: follows.map(follow => follow.growId) }, visibility: 'public' }).lean<GrowDocument[]>();
    const [plants, owners, moved] = await Promise.all([
      this.plants.find({ growId: { $in: grows.map(grow => grow.id) } }).lean<PlantDocument[]>(),
      this.users.find({ id: { $in: grows.map(grow => grow.ownerId) } }, { id: 1, handle: 1, privacy: 1 }).lean<StoredUser[]>(),
      diaryMovedAt(
        this.entries,
        grows.map(grow => grow.id),
      ),
    ]);

    return follows.flatMap(follow => {
      const grow = grows.find(candidate => candidate.id === follow.growId);
      const owner = grow && owners.find(candidate => candidate.id === grow.ownerId);
      if (!grow || !owner) return [];

      return [
        serialisePublicCard(
          grow,
          plants.filter(plant => plant.growId === grow.id),
          owner.handle,
          redactionOf(true, owner.privacy),
          moved.get(grow.id) ?? null,
          now,
        ),
      ];
    });
  }

  /** Everyone the cards name, once, so "Mia fed" needs no second read. */
  private async peopleIn(cards: HomeSpaceCard[]): Promise<Person[]> {
    const ids = new Set(cards.flatMap(card => [...card.entries.map(entry => entry.authorId), ...card.dueTasks.map(task => task.assigneeId)]));
    ids.delete(null);
    if (ids.size === 0) return [];

    const people = await this.users.find({ id: { $in: [...ids] } }, { id: 1, handle: 1 }).lean<Pick<StoredUser, 'id' | 'handle'>[]>();
    return people.map(person => ({ id: person.id, handle: person.handle }));
  }
}

const standsIn = (grow: GrowDocument, spaceId: string): boolean =>
  grow.placements.some(placement => placement.spaceId === spaceId && placement.endedAt === null);

/**
 * A grow with no open placement into any space: either started on "no fixed
 * place", which stores a placement with no space, or moved out of everywhere
 * since. A grow whose open placement names a space the reader cannot see is
 * not one of these, so an archived tent keeps its grow hidden rather than
 * turning it into a placeless card.
 */
const standsNowhere = (grow: GrowDocument): boolean => !grow.placements.some(placement => placement.spaceId !== null && placement.endedAt === null);

/**
 * The grows a placeless card may be drawn from. Standing in no space, such a
 * grow can be reached by no membership, so ownership is the whole of the
 * widening `visibleTo` would do for it.
 */
const ownGrows = (ctx: AccessContext): FilterQuery<GrowDocument> => (ctx.isDemo || ctx.userId === null ? { isDemo: true } : { ownerId: ctx.userId });

/** The first device in the space that has a day of history; a card draws one line, not one per device. */
const trendOf = (deviceIds: string[], trends: Map<string, SeriesPoint[]>, window: { endsAt: Date; stepSeconds: number }): CardTrend | null => {
  const points = deviceIds.map(id => trends.get(id)).find(own => own !== undefined);

  return points
    ? { metric: TREND_METRIC, stepSeconds: window.stepSeconds, endsAt: window.endsAt.toISOString(), points: points.map(point => point.value) }
    : null;
};

const isAbout = (task: DueTask, spaceId: string | null, growId: string | null): boolean =>
  task.subject.type === 'space' ? task.subject.id === spaceId : task.subject.id === growId;

const growCardOf = (grow: GrowDocument, plants: PlantDocument[], hide: Redaction, now: Date): GrowCard => {
  const summary = summaryOf(grow, plants, hide, now);

  return {
    growId: grow.id,
    name: grow.name,
    type: grow.type,
    dayNumber: summary.dayNumber,
    phaseDay: summary.phaseDay,
    stage: summary.stage,
    preset: summary.preset,
    isAuto: summary.isAuto,
    plantCount: hide.counts ? null : plants.length,
    strains: [...new Set(plants.map(plant => plant.strain))],
    coverMediaId: grow.coverMediaId,
    stageGroups: summary.groups.map(group => ({ stage: group.stage, plantCount: hide.counts ? null : group.plantIds.length })),
  };
};

const openAlertOf = (alert: StoredAlert, metric: Metric | null): OpenAlert => ({
  alertId: alert.id,
  kind: alert.kind,
  severity: alert.severity,
  startedAt: alert.startedAt.toISOString(),
  value: alert.value,
  metric,
});
