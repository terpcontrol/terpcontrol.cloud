import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { MyGrowCard, MyGrowPage, MyGrowPlace, Person, StrainCount, UserPrivacy } from '@fg2/shared-types/v1';
import { AccessContext } from '@common/v1/access.types';
import { CursorPage, decodeCursor, encodeCursor, pageLimit, PagePosition } from '@common/v1/pages';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { harvestOf } from '../diary/report.service';
import { NOTHING_HIDDEN, Redaction, redactionOf, summaryOf } from '../grow/grow-serialiser';
import { GrowsService } from '../grow/grows.service';

/** Every window a harvest may fall in: the reader of this list owns the grows or is let in where they stand. */
const WHOLE_LIFE = { startsAt: null, endsAt: null };

type Ordered = Pick<GrowDocument, 'id' | 'startedAt' | 'endedAt'>;

/**
 * "My grows": every grow an account can see, running and finished, each as one
 * card with its picture, where it stands, what was sown and what came down.
 *
 * The home draws the places and what stands in each of them now, so a grow
 * that has ended, a second grow sharing a tent and a grow somebody else runs in
 * a tent the account was let into were each on no screen of their own. This is
 * the one list that holds them all.
 *
 * Which grows is `visibleTo`'s answer, the same the grow list gives: the
 * account's own, and those standing in a place it is a member of. They are put
 * in order before anything is read about them - running ones first, newest
 * first, then the finished ones by the day they ended - and only the page asked
 * for is worked out, so a long history costs one small read for the order and
 * then a page's worth of cards.
 */
@Injectable()
export class MyGrowsService {
  constructor(
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.plant) private readonly plants: Model<PlantDocument>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.camera) private readonly cameras: Model<CameraDocument>,
    @InjectModel(MODEL_V1.entry) private readonly entries: Model<EntryDocument>,
    @InjectModel(MODEL_V1.media) private readonly media: Model<MediaDocument>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    private readonly growing: GrowsService,
  ) {}

  public async list(ctx: AccessContext, query: PageQuery, now: Date = new Date()): Promise<MyGrowPage> {
    const all = await this.grows.find(await this.growing.visibleTo(ctx), { id: 1, startedAt: 1, endedAt: 1 }).lean<Ordered[]>();
    const page = pageAfter(all.sort(inOrder), query);
    if (page.items.length === 0) return { items: [], nextCursor: null };

    const ids = page.items.map(grow => grow.id);
    const grows = await this.grows.find({ id: { $in: ids } }).lean<GrowDocument[]>();
    const spaceIds = [...new Set(grows.flatMap(grow => grow.placements.flatMap(placement => (placement.spaceId ? [placement.spaceId] : []))))];

    const [plants, spaces, cameras, photos, hide, owners] = await Promise.all([
      this.plants
        .find({ growId: { $in: ids } })
        .sort({ createdAt: 1, _id: 1 })
        .lean<PlantDocument[]>(),
      this.spaces.find({ id: { $in: spaceIds } }, { id: 1, name: 1 }).lean<Pick<SpaceDocument, 'id' | 'name'>[]>(),
      // A camera that has since been removed is a tombstone whose pictures keep their link, so it is asked as well.
      this.cameras.find({ spaceId: { $in: spaceIds } }, { id: 1, spaceId: 1 }).lean<Pick<CameraDocument, 'id' | 'spaceId'>[]>(),
      this.newestPhotos(ids),
      this.redactionFor(ctx, grows),
      this.ownersOf(ctx, grows),
    ]);
    const stills = new Map(await Promise.all(grows.map(async grow => [grow.id, await this.newestLitStill(grow, cameras, now)] as const)));

    const cards = grows.map((grow): MyGrowCard => {
      const own = plants.filter(plant => plant.growId === grow.id);
      const hidden = hide(grow.ownerId);
      const summary = summaryOf(grow, own, hidden, now);

      return {
        growId: grow.id,
        name: grow.name,
        type: grow.type,
        startedAt: grow.startedAt.toISOString(),
        endedAt: grow.endedAt?.toISOString() ?? null,
        dayNumber: summary.dayNumber,
        stage: summary.stage,
        stageWeek: summary.stageWeek,
        places: placesOf(grow, summary.locations, spaces),
        owner: owners.get(grow.ownerId) ?? null,
        plantCount: hidden.counts ? null : own.length,
        strains: strainsOf(own, hidden),
        coverMediaId: grow.coverMediaId ?? stills.get(grow.id) ?? photos.get(grow.id) ?? null,
        harvest: harvestOf(own, hidden, WHOLE_LIFE),
      };
    });

    // In the order worked out above; a grow deleted between the two reads is simply not there.
    return { items: ids.flatMap(id => cards.filter(card => card.growId === id)), nextCursor: page.nextCursor };
  }

  /**
   * The newest picture a camera took with the light on while the grow stood in
   * front of it: inside each of its stays in a place and inside its own life,
   * so a tent that has moved on to the next grow does not lend it that one's
   * plants. A camera that never saw the tent lit gives nothing.
   */
  private async newestLitStill(grow: GrowDocument, cameras: Pick<CameraDocument, 'id' | 'spaceId'>[], now: Date): Promise<string | null> {
    const end = grow.endedAt ?? now;
    const stays = grow.placements.flatMap(placement => {
      const eyes = cameras.filter(camera => camera.spaceId !== null && camera.spaceId === placement.spaceId).map(camera => camera.id);
      const from = placement.startedAt > grow.startedAt ? placement.startedAt : grow.startedAt;
      const until = placement.endedAt && placement.endedAt < end ? placement.endedAt : end;
      return eyes.length > 0 && from <= until ? [{ cameraId: { $in: eyes }, capturedAt: { $gte: from, $lte: until } }] : [];
    });
    if (stays.length === 0) return null;

    const still = await this.media
      .findOne({ $and: [{ kind: 'still', lit: { $ne: false } }, { $or: stays }] }, { id: 1 })
      .sort({ capturedAt: -1 })
      .lean<Pick<MediaDocument, 'id'>>();
    return still?.id ?? null;
  }

  /** The newest picture written into each grow's diary, on whatever line carries it. */
  private async newestPhotos(growIds: string[]): Promise<Map<string, string>> {
    const rows = await this.entries.aggregate<{ _id: string; mediaId: string }>([
      { $match: { growId: { $in: growIds }, 'mediaIds.0': { $exists: true } } },
      { $sort: { occurredAt: -1, _id: -1 } },
      { $group: { _id: '$growId', mediaId: { $first: { $arrayElemAt: ['$mediaIds', 0] } } } },
    ]);
    return new Map(rows.map(row => [row._id, row.mediaId]));
  }

  /**
   * Whose privacy applies to each grow. The list only ever holds what the
   * reader owns or is a member where it stands, so the demo tour is the one
   * reader anything is hidden from - as on the grow list.
   */
  private async redactionFor(ctx: AccessContext, grows: GrowDocument[]): Promise<(ownerId: string) => Redaction> {
    if (!ctx.isDemo) return () => NOTHING_HIDDEN;

    const owners = await this.users
      .find({ id: { $in: [...new Set(grows.map(grow => grow.ownerId))] } }, { id: 1, privacy: 1 })
      .lean<Pick<StoredUser, 'id' | 'privacy'>[]>();
    const privacy = new Map(owners.map(owner => [owner.id, owner.privacy as UserPrivacy]));
    return ownerId => redactionOf(true, privacy.get(ownerId));
  }

  /**
   * Who runs the grows that are not the reader's own. The demo tour is shown
   * its grows as its own, because whose they are is not what it is touring.
   */
  private async ownersOf(ctx: AccessContext, grows: GrowDocument[]): Promise<Map<string, Person>> {
    if (ctx.isDemo || ctx.userId === null) return new Map();

    const others = [...new Set(grows.map(grow => grow.ownerId).filter(ownerId => ownerId !== ctx.userId))];
    if (others.length === 0) return new Map();

    const people = await this.users.find({ id: { $in: others } }, { id: 1, handle: 1 }).lean<Pick<StoredUser, 'id' | 'handle'>[]>();
    return new Map(people.map(person => [person.id, { id: person.id, handle: person.handle }]));
  }
}

/** Running before finished; inside each, the newest first - by its start while it runs, by its end once it is over. */
const keyOf = (grow: Ordered): { rank: number; at: Date } =>
  grow.endedAt === null ? { rank: 0, at: grow.startedAt } : { rank: 1, at: grow.endedAt };

const compareKeys = (one: { rank: number; at: Date; id: string }, other: { rank: number; at: Date; id: string }): number =>
  one.rank - other.rank || other.at.getTime() - one.at.getTime() || (one.id < other.id ? 1 : one.id > other.id ? -1 : 0);

const inOrder = (one: Ordered, other: Ordered): number => compareKeys({ ...keyOf(one), id: one.id }, { ...keyOf(other), id: other.id });

/**
 * The cursor is the last card's place in the order: which half it was in, the
 * instant it was sorted by and its id. It is continued from that place rather
 * than from the card itself, so a grow ended or deleted between two pages moves
 * or goes without the next page skipping or repeating anything.
 */
const RUNNING = 'r';
const ENDED = 'e';

const positionOf = (grow: Ordered): PagePosition => {
  const key = keyOf(grow);
  return { at: key.at, id: `${key.rank === 0 ? RUNNING : ENDED}|${grow.id}` };
};

const pageAfter = (ordered: Ordered[], query: PageQuery): CursorPage<Ordered> => {
  const limit = pageLimit(query.limit);
  let rest = ordered;

  if (query.cursor) {
    const { at, id } = decodeCursor(query.cursor);
    const [half, ...growId] = id.split('|');
    const after = { rank: half === RUNNING ? 0 : 1, at, id: growId.join('|') };
    rest = ordered.filter(grow => compareKeys({ ...keyOf(grow), id: grow.id }, after) > 0);
  }

  const items = rest.slice(0, limit);
  return { items, nextCursor: rest.length > limit ? encodeCursor(positionOf(items[items.length - 1])) : null };
};

/**
 * Where a card says the grow is: the places its plants stand in now, else - for
 * a grow whose placements have all been closed - the one it stood in last. A
 * place that is gone altogether, not even kept as a tombstone, is left out
 * rather than named wrongly.
 */
const placesOf = (grow: GrowDocument, locations: { spaceId: string | null }[], spaces: Pick<SpaceDocument, 'id' | 'name'>[]): MyGrowPlace[] => {
  const last = grow.placements.reduce<GrowDocument['placements'][number] | null>(
    (latest, placement) => (latest && (latest.endedAt?.getTime() ?? 0) >= (placement.endedAt?.getTime() ?? 0) ? latest : placement),
    null,
  );
  const spaceIds = locations.length > 0 ? locations.map(location => location.spaceId) : last ? [last.spaceId] : [];

  return [...new Set(spaceIds)].flatMap((spaceId): MyGrowPlace[] => {
    if (spaceId === null) return [{ spaceId: null, name: null }];
    const space = spaces.find(candidate => candidate.id === spaceId);
    return space ? [{ spaceId, name: space.name }] : [];
  });
};

/** Each strain once, in the order it was sown, with how many plants of it - unless the owner hides counts. */
const strainsOf = (plants: PlantDocument[], hide: Redaction): StrainCount[] =>
  [...new Set(plants.map(plant => plant.strain))].map(strain => ({
    strain,
    count: hide.counts ? null : plants.filter(plant => plant.strain === strain).length,
  }));
