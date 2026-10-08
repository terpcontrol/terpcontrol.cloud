import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import type { AccountLayers, CardTrend, DueTask, FollowedGrowCard, HomeAnswer, HomeSpaceCard, LatestStill, SeriesPoint } from '@fg2/shared-types/v1';
import { AccessContext } from '@common/v1/access.types';
import { serialiseEntry } from '@common/v1/entries';
import { peopleNamed } from '@common/v1/people';
import { MODEL_V1 } from '@database/models';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { FollowDocument } from '@database/schemas/v1/follows.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { DataService } from '@modules/data/data.service';
import { demoEntry } from '@utils/demo';
import { layersOf } from '../account/diary-layer';
import { diaryMovedAt } from '../diary/diary-entries';
import { completionsOf, dueTasksOf, remindersAbout } from '../diary/due-tasks';
import { spacesNow } from '../grow/grow-places';
import { growCardOf, redactionOf, serialisePublicCard } from '../grow/grow-serialiser';
import { ownerRedactions } from '../grow/redactions';
import { mergeLive } from '../space/space-live';
import { SpaceLiveService } from '../space/space-live.service';
import { SpacesService } from '../space/spaces.service';
import { alertsRaisedIn, openAlertReader } from './open-alerts';

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
    @InjectModel(MODEL_V1.membership) private readonly memberships: Model<MembershipDocument>,
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
        .map(space => ({ space, grow: grows.find(grow => spacesNow(grow).includes(space.id)) ?? null }))
        .filter(({ space, grow }) => space.kind !== 'room' || grow !== null || devices.some(device => device.spaceId === space.id)),
      // Placeless: started on "no fixed place", which stores a placement with no
      // space, or moved out of everywhere since. A grow whose open placement
      // names a space the reader cannot see is not one, so an archived tent
      // keeps its grow hidden rather than turning it into a placeless card.
      ...grows.filter(grow => spacesNow(grow).length === 0).map(grow => ({ space: null, grow })),
    ];
    const growIds = cards.flatMap(card => (card.grow ? [card.grow.id] : []));

    const trendWindow = { startsAt: new Date(now.getTime() - TREND_HOURS * 3600 * 1000), endsAt: now, stepSeconds: TREND_STEP_SECONDS };
    const [readings, trends, plants, cameras, alerts, reminders, hide] = await Promise.all([
      this.live.readingsOf(devices, now),
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
        .find({
          resolvedAt: null,
          ...alertsRaisedIn(
            spaceIds,
            devices.map(device => device.id),
          ),
        })
        .sort({ startedAt: -1 })
        .lean<StoredAlert[]>(),
      this.reminders.find(remindersAbout(spaceIds, growIds)).lean<ReminderDocument[]>(),
      // A card is only ever read by an owner, a member or the demo tour, so the
      // tour is the one reader anything is hidden from.
      ownerRedactions(
        this.users,
        ctx.isDemo,
        cards.flatMap(card => (card.grow ? [card.grow.ownerId] : [])),
      ),
    ]);
    const [completions, openAlertOf] = await Promise.all([completionsOf(this.entries, reminders), openAlertReader(this.rules, alerts)]);
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
                hide(grow.ownerId),
                now,
              )
            : null,
          // The tour reads a stranger's tent, whose device lines quote URLs.
          entries: entries.map(entry => (ctx.isDemo ? demoEntry(serialiseEntry(entry)) : serialiseEntry(entry))),
          latestStill: still,
          dueTasks: tasks.filter(task => isAbout(task, space?.id ?? null, grow?.id ?? null)),
          openAlerts: alerts
            .filter(alert => space !== null && (alert.spaceId === space.id || (alert.deviceId !== null && here.includes(alert.deviceId))))
            .map(openAlertOf),
        };
      }),
    );

    const [followedGrows, people, layers] = await Promise.all([
      ctx.userId && !ctx.isDemo ? this.followed(ctx.userId, now) : Promise.resolve([]),
      peopleNamed(
        this.users,
        answers.flatMap(card => [...card.entries.map(entry => entry.authorId), ...card.dueTasks.map(task => task.assigneeId)]),
      ),
      this.layersOf(ctx),
    ]);

    return { spaces: answers, followedGrows, people, layers };
  }

  /** The demo tour is shown everything there is, because showing it is the tour's whole purpose. */
  private async layersOf(ctx: AccessContext): Promise<AccountLayers> {
    if (ctx.isDemo || ctx.userId === null) return { diary: true };

    const user = await this.users.findOne({ id: ctx.userId }, { 'preferences.diary': 1 }).lean<Pick<StoredUser, 'preferences'>>();
    return layersOf(ctx.userId, user?.preferences.diary, {
      grows: this.grows,
      entries: this.entries,
      memberships: this.memberships,
      spaces: this.spaces,
    });
  }

  /** The grow's diary where there is a grow; the space's own lines - a device's, an alarm's - where there is none. */
  private newestEntries(spaceId: string | null, growId: string | null): Promise<EntryDocument[]> {
    return this.entries
      .find(growId ? { growId } : { spaceId })
      .sort({ occurredAt: -1, _id: -1 })
      .limit(ENTRIES_PER_CARD)
      .lean<EntryDocument[]>();
  }

  /**
   * The picture a card is shown by: the newest one taken with the light on, so
   * a tent lit by night is not shown dark all day. Where the camera has taken
   * nothing in the light at all, its newest picture stands in.
   */
  private async latestStill(cameraIds: string[]): Promise<LatestStill | null> {
    if (cameraIds.length === 0) return null;

    const newestOf = (lit: boolean) =>
      this.media
        .findOne(
          { cameraId: { $in: cameraIds }, kind: 'still', ...(lit ? { lit: { $ne: false } } : {}) },
          { id: 1, cameraId: 1, capturedAt: 1, lit: 1 },
        )
        .sort({ capturedAt: -1 })
        .lean<Pick<MediaDocument, 'id' | 'cameraId' | 'capturedAt' | 'lit'> | null>();

    const newest = await newestOf(false);
    if (!newest?.cameraId) return null;

    const lightOff = newest.lit === false;
    const still = lightOff ? ((await newestOf(true)) ?? newest) : newest;
    return still.cameraId ? { mediaId: still.id, cameraId: still.cameraId, capturedAt: still.capturedAt.toISOString(), lightOff } : null;
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
}

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
