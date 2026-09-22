import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type {
  GrowCreate,
  GrowListItem,
  GrowthStage,
  GrowUpdate,
  HarvestCreate,
  HarvestResult,
  MeasurementDefinition,
  Phase,
  PhaseCreate,
  PhaseTargets,
  PhaseUpdate,
  Placement,
  PlacementCreate,
  PlacementUpdate,
  Plant,
  PlantCreate,
  PlantUpdate,
  SplitCreate,
  SplitResult,
  UserPrivacy,
} from '@fg2/shared-types/v1';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { CursorPage, afterCursor, pageLimit, pageOf, readLimit } from '@common/v1/pages';
import { conflict, notFound, unprocessable } from '@common/v1/problem';
import { PageQuery } from '@common/v1/validation';
import { MODEL_V1 } from '@database/models';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { MembershipDocument } from '@database/schemas/v1/memberships.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { ShareLinkDocument } from '@database/schemas/v1/share-links.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { targetsOf } from '../phase/phase-targets';
import { PhaseWriterService } from '../phase/phase-writer.service';
import { CLIMATE_PRESETS, ClimatePresets } from './climate-presets.port';
import { NOTHING_HIDDEN, Redaction, redactionOf, serialiseGrow, serialisePhase, serialisePlacement, serialisePlant } from './grow-serialiser';

/**
 * The `grows` collection and the `plants` beside it: what is growing, where it
 * stands and what phase it is in.
 *
 * A grow is not a device and does not need one - it is the story of a set of
 * plants, and the tent is only where they happen to be. So nothing here reaches
 * for hardware except in one place: entering a phase on a preset puts the
 * controllers of that space on the climate the preset asks for, which is what
 * makes a phase "auto".
 */

type StoredPhase = GrowDocument['phases'][number];
type StoredPlacement = GrowDocument['placements'][number];

/** What a move says: where the plants go, when, and which of them. */
interface Move {
  spaceId: string | null;
  startedAt: Date;
  plantIds: string[] | null;
}

@Injectable()
export class GrowsService {
  constructor(
    @InjectModel(MODEL_V1.grow) private readonly grows: Model<GrowDocument>,
    @InjectModel(MODEL_V1.plant) private readonly plants: Model<PlantDocument>,
    @InjectModel(MODEL_V1.device) private readonly devices: Model<StoredDevice>,
    @InjectModel(MODEL_V1.membership) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(MODEL_V1.space) private readonly spaces: Model<SpaceDocument>,
    @InjectModel(MODEL_V1.user) private readonly users: Model<StoredUser>,
    @InjectModel(MODEL_V1.shareLink) private readonly shareLinks: Model<ShareLinkDocument>,
    // A move and a harvest each leave a line behind, and correcting one moves
    // the line with it: the rows are read here as well as written through the
    // writer below.
    @InjectModel(MODEL_V1.entry) private readonly entryRows: Model<EntryDocument>,
    private readonly access: AccessService,
    private readonly phases: PhaseWriterService,
    private readonly entries: EntryWriterService,
    @Optional() @Inject(CLIMATE_PRESETS) private readonly presets: ClimatePresets | null = null,
  ) {}

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  public async require(id: string): Promise<GrowDocument> {
    const grow = await this.grows.findOne({ id }).lean<GrowDocument>();
    if (!grow) throw notFound('grow_not_found', 'There is no grow with that id.');

    return grow;
  }

  /**
   * A grow by the address its public page is read at. The slug is unique, so
   * there is at most one - and it is answered whatever the grow's visibility is,
   * because whether a stranger may see it is `access()`'s decision and not a
   * lookup's.
   */
  public bySlug(slug: string): Promise<GrowDocument | null> {
    return this.grows.findOne({ slug }).lean<GrowDocument>();
  }

  /**
   * What is growing in a place right now, as an id and nothing more.
   *
   * It is what the alarms ask through `GROW_IN_SPACE`: an alarm happens in a
   * tent, and a tent with a grow standing in it has a diary the line belongs
   * in. The newest open placement answers it, because two grows can share a
   * tent while one is on its way out.
   */
  public async growIdIn(spaceId: string): Promise<string | null> {
    const grow = await this.grows
      .findOne({ endedAt: null, placements: { $elemMatch: { spaceId, endedAt: null } } }, { id: 1 })
      .sort({ startedAt: -1, id: -1 })
      .lean<Pick<GrowDocument, 'id'>>();

    return grow?.id ?? null;
  }

  /** Oldest first, and the plants of one batch share an instant, so the order they were written in decides between them. */
  public plantsOf(growId: string): Promise<PlantDocument[]> {
    return this.plants.find({ growId }).sort({ createdAt: 1, _id: 1 }).lean<PlantDocument[]>();
  }

  /** The grow with its plants, which the summary is worked out from. */
  public async read(id: string, hide: Redaction): Promise<GrowListItem> {
    const grow = await this.require(id);
    return serialiseGrow(grow, await this.plantsOf(id), hide);
  }

  public async list(ctx: AccessContext, query: PageQuery, spaceId?: string): Promise<CursorPage<GrowListItem>> {
    const limit = pageLimit(query.limit);
    const place = spaceId ? { placements: { $elemMatch: { spaceId, endedAt: null } } } : {};

    // Combined rather than merged into one object: the visibility and the cursor
    // are each an `$or` of their own, and one would silently replace the other -
    // which would hand out everything that sorts after the cursor from the
    // second page on, while the first page looked right.
    const conditions: FilterQuery<GrowDocument>[] = [await this.visibleTo(ctx), place, afterCursor('startedAt', query.cursor)];

    const rows = await this.grows.find({ $and: conditions }).sort({ startedAt: -1, id: -1 }).limit(readLimit(limit)).lean<GrowDocument[]>();

    const page = pageOf(rows, limit, grow => ({ at: grow.startedAt, id: grow.id }));
    const plants = await this.plants.find({ growId: { $in: page.items.map(grow => grow.id) } }).lean<PlantDocument[]>();

    // A list only ever holds what the caller owns or shares, so the one reader
    // whose view is narrowed here is the demo tour.
    const privacy = ctx.isDemo ? await this.privacyOf(page.items.map(grow => grow.ownerId)) : new Map<string, UserPrivacy>();

    return {
      items: page.items.map(grow =>
        serialiseGrow(
          grow,
          plants.filter(plant => plant.growId === grow.id),
          redactionOf(ctx.isDemo, privacy.get(grow.ownerId)),
        ),
      ),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * The grows a caller may see at all, as one filter rather than a decision per
   * row: their own, and those standing in a space they are a member of. A demo
   * session sees the demo ones.
   *
   * An administrator is not widened here: every screen this filter feeds - the
   * grow list, the diary's subjects - is the person's own, and an install-wide
   * answer would put strangers' grows in them. The office still opens a named
   * grow through `access()`.
   */
  public async visibleTo(ctx: AccessContext): Promise<FilterQuery<GrowDocument>> {
    if (ctx.isDemo || ctx.userId === null) return { isDemo: true };

    const rows = await this.memberships.find({ userId: ctx.userId }, { spaceId: 1 }).lean();
    const held = rows.map(row => row.spaceId);
    if (held.length === 0) return { ownerId: ctx.userId };

    // A membership on a room covers the spaces standing in it, so the rooms are
    // widened to what is inside them before a grow is looked for by its
    // placements - which is the rule `access()` decides one grow by, from the
    // other end.
    const inside = await this.spaces.find({ roomId: { $in: held } }, { id: 1 }).lean();
    const spaceIds = [...new Set([...held, ...inside.map(space => space.id)])];

    return { $or: [{ ownerId: ctx.userId }, { 'placements.spaceId': { $in: spaceIds } }] };
  }

  /** What a grant comes to for the serialisers: the privacy of whoever owns the thing being read. */
  public async redaction(grant: Grant): Promise<Redaction> {
    if (!grant.redacted) return NOTHING_HIDDEN;

    const owner = grant.privacyOwnerId ? await this.users.findOne({ id: grant.privacyOwnerId }, { privacy: 1 }).lean<StoredUser>() : null;
    return redactionOf(true, owner?.privacy);
  }

  /**
   * The plants of a grow. How many there are is the count the owner may have
   * chosen to hide, and a list of them states it however it is served, so a
   * reader it is hidden from is answered an empty page rather than a shorter
   * lie.
   */
  public async listPlants(growId: string, hide: Redaction): Promise<CursorPage<Plant>> {
    if (hide.counts) return { items: [], nextCursor: null };

    // One page, always: a grow holds a tent's worth of plants.
    return { items: (await this.plantsOf(growId)).map(plant => serialisePlant(plant, hide)), nextCursor: null };
  }

  // -------------------------------------------------------------------------
  // The grow itself
  // -------------------------------------------------------------------------

  /**
   * The new-grow sheet: a name, the plants as strain and count, where it is and
   * what it is fed. The phase it starts in is appended by `POST
   * /grows/{id}/phases`, which is also what the stage picker and the plan write
   * through, so a grow enters its first phase exactly as it enters its fifth.
   */
  public async create(ctx: AccessContext, body: GrowCreate): Promise<GrowListItem> {
    const ownerId = ctx.userId;
    if (!ownerId || ctx.isDemo) throw conflict('no_account', 'A grow belongs to somebody, and this session is nobody.');

    // Putting a grow into a space that exists is managing that space.
    if (body.spaceId) await this.access.require(ctx, subjectRef('space', body.spaceId), 'manage');
    requireDistinctKeys(body.measurements ?? []);

    const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();
    const id = uuidv4();

    const grow = await this.grows.create({
      id,
      ownerId,
      name: body.name,
      description: body.description ?? null,
      type: body.type,
      phases: [],
      // Always one, so that a grow always answers where it is - and "no fixed
      // place" is a placement of its own rather than the absence of one.
      placements: [{ id: uuidv4(), spaceId: body.spaceId ?? null, startedAt, endedAt: null, plantIds: null }],
      scheme: body.scheme ?? null,
      measurements: body.measurements ?? [],
      visibility: body.visibility ?? 'private',
      slug: await this.slugFor(body.name),
      coverMediaId: null,
      filmMediaId: null,
      startedAt,
      endedAt: null,
      isDemo: false,
    });

    const plants = await this.sow(id, body.plants);
    return serialiseGrow(grow.toObject<GrowDocument>(), plants, NOTHING_HIDDEN);
  }

  /** "Amnesia × 8" is eight plants labelled "Amnesia 1" to "Amnesia 8". */
  private async sow(growId: string, batches: GrowCreate['plants']): Promise<PlantDocument[]> {
    const createdAt = new Date();
    const counted = new Map<string, number>();

    const plants = batches.flatMap(batch =>
      Array.from({ length: batch.count }, () => {
        const number = (counted.get(batch.strain) ?? 0) + 1;
        counted.set(batch.strain, number);

        return {
          id: uuidv4(),
          growId,
          strain: batch.strain,
          label: `${batch.strain} ${number}`,
          status: 'active' as const,
          harvest: null,
          createdAt,
        };
      }),
    );

    if (plants.length > 0) await this.plants.insertMany(plants);
    return plants;
  }

  public async update(id: string, body: GrowUpdate, hide: Redaction): Promise<GrowListItem> {
    if (body.measurements !== undefined) await this.checkMeasurements(id, body.measurements);

    const changes: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(body)) {
      if (value !== undefined) changes[field] = field === 'startedAt' || field === 'endedAt' ? instantOrNull(value) : value;
    }

    const changed = await this.grows.findOneAndUpdate({ id }, { $set: changes }, { new: true }).lean<GrowDocument>();
    if (!changed) throw notFound('grow_not_found', 'There is no grow with that id.');

    return serialiseGrow(changed, await this.plantsOf(id), hide);
  }

  /**
   * What this grow measures, written again as a whole list.
   *
   * A reading carries a key and a number and nothing else - what it is called,
   * what unit it is in and whether it belongs to a plant or to the grow all live
   * here - so these definitions are not a settings list that can be rewritten
   * freely. Taking out a key entries already carry would leave numbers in the
   * diary that nothing can name, and turning one from per grow to per plant
   * would make readings already written say something they never said. Both are
   * refused while any reading uses the key, and the refusal says how many there
   * are, in the same spirit as a space that is not deleted while somebody is
   * still a member of it: what has to happen first is something a person does to
   * their own diary deliberately, line by line, and not something an edit of a
   * list does for them in passing.
   *
   * Everything else about a definition - its name, its unit, its target, whether
   * it is drawn - is free to change at any time, because none of it is what a
   * reading was keyed by.
   */
  private async checkMeasurements(growId: string, wanted: MeasurementDefinition[]): Promise<void> {
    requireDistinctKeys(wanted);

    const grow = await this.require(growId);
    const kept = new Map(wanted.map(definition => [definition.key, definition]));
    const gone = grow.measurements.filter(was => !kept.has(was.key)).map(was => was.key);
    const rescoped = grow.measurements.filter(was => kept.get(was.key)?.perPlant === !was.perPlant).map(was => was.key);

    const used = await this.keysWithReadings(growId, [...gone, ...rescoped]);
    if (used.size === 0) return;

    const removed = gone.filter(key => used.has(key));
    if (removed.length > 0) {
      throw unprocessable('measurement_has_readings', 'This grow has readings under that measurement, which would be left without a name.', [
        { field: 'measurements', code: 'in_use', detail: `${removed.join(', ')}; turn it off the chart instead, or delete the entries first.` },
      ]);
    }

    throw unprocessable('measurement_scope_fixed', 'Per plant or per grow is chosen once, and readings have been taken under this one.', [
      { field: 'measurements', code: 'immutable', detail: rescoped.filter(key => used.has(key)).join(', ') },
    ]);
  }

  /** Which of these keys the grow's diary already holds a reading under. */
  private async keysWithReadings(growId: string, keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();

    const wanted = new Set(keys);
    const used = await this.entryRows.distinct('values.readings.key', { growId, 'values.readings.key': { $in: keys } });

    return new Set(used.filter((key): key is string => typeof key === 'string' && wanted.has(key)));
  }

  /**
   * A grow really is deleted - it is not a place history keeps naming, the way a
   * space and a camera are. Its plants go with it; the diary it wrote and the
   * pictures it holds are removed by the sweep that deletes what nothing can
   * reach any more.
   *
   * So do the links onto it. They would resolve to nothing in any case, but a
   * link is decided by what it points at, and one pointing at a grow that is
   * gone is a row its owner can see in their list and never take out of it.
   */
  public async remove(id: string): Promise<void> {
    const removed = await this.grows.findOneAndDelete({ id }).lean<GrowDocument>();
    if (!removed) throw notFound('grow_not_found', 'There is no grow with that id.');

    await this.plants.deleteMany({ growId: id });
    await this.shareLinks.deleteMany({ 'subject.type': 'grow', 'subject.id': id });
  }

  /**
   * Unique and stable, assigned at creation, so that making a grow public never
   * changes its address. The name is tried as it reads and only falls back to a
   * suffix where that is taken, because the address is the one part of a public
   * page a person reads aloud.
   */
  private async slugFor(name: string): Promise<string> {
    const stem = slugify(name) || 'grow';

    for (const candidate of [stem, ...Array.from({ length: 5 }, () => `${stem}-${uuidv4().slice(0, 6)}`)]) {
      if (!(await this.grows.exists({ slug: candidate }))) return candidate;
    }

    return `${stem}-${uuidv4()}`;
  }

  // -------------------------------------------------------------------------
  // Plants
  // -------------------------------------------------------------------------

  public async plantById(id: string): Promise<PlantDocument> {
    const plant = await this.plants.findOne({ id }).lean<PlantDocument>();
    if (!plant) throw notFound('plant_not_found', 'There is no plant with that id.');

    return plant;
  }

  /** One plant, which is what replaces a dead one; a whole row of the sheet is created with the grow. */
  public async addPlant(growId: string, body: PlantCreate, hide: Redaction): Promise<Plant> {
    const standing = await this.plantsOf(growId);
    const taken = standing.filter(plant => plant.strain === body.strain).length;

    const plant: PlantDocument = {
      id: uuidv4(),
      growId,
      strain: body.strain,
      label: body.label ?? `${body.strain} ${taken + 1}`,
      status: 'active',
      harvest: null,
      createdAt: new Date(),
    };

    await this.plants.create(plant);
    return serialisePlant(plant, hide);
  }

  public async updatePlant(id: string, body: PlantUpdate, hide: Redaction): Promise<Plant> {
    const changes: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(body)) {
      if (value !== undefined) changes[field] = field === 'harvest' ? harvestOf(body.harvest) : value;
    }

    const changed = await this.plants.findOneAndUpdate({ id }, { $set: changes }, { new: true }).lean<PlantDocument>();
    if (!changed) throw notFound('plant_not_found', 'There is no plant with that id.');

    return serialisePlant(changed, hide);
  }

  public async removePlant(id: string): Promise<void> {
    const removed = await this.plants.findOneAndDelete({ id }).lean<PlantDocument>();
    if (!removed) throw notFound('plant_not_found', 'There is no plant with that id.');

    await this.forgetPlant(removed.growId, id);
  }

  /**
   * A plant that is gone leaves the grow's two lists as well.
   *
   * A phase and a placement each state a set of plants, and an id in one of them
   * that names no plant any more is a plant the grow still claims to have: the
   * summary puts it somewhere and the count includes it. A row whose whole scope
   * was that one plant goes with it, because a phase of nobody and a placement
   * of nobody say nothing about the rest of the grow.
   */
  private async forgetPlant(growId: string, plantId: string): Promise<void> {
    const grow = await this.grows.findOne({ id: growId }).lean<GrowDocument>();
    if (!grow) return;

    const without = <T extends { plantIds: string[] | null }>(rows: T[]): T[] =>
      rows.flatMap(row => {
        if (row.plantIds === null || !row.plantIds.includes(plantId)) return [row];

        const kept = row.plantIds.filter(id => id !== plantId);
        return kept.length > 0 ? [{ ...row, plantIds: kept }] : [];
      });

    await this.grows.updateOne({ id: growId }, { $set: { phases: without(grow.phases), placements: without(grow.placements) } });
  }

  // -------------------------------------------------------------------------
  // Phases and placements
  // -------------------------------------------------------------------------

  /**
   * Entering a phase. Where the plants stand in a space with a controller and a
   * preset was asked for, the controller is put on it first: the phase then
   * carries what it runs, which is the only way a phase that is over can still
   * draw its target band, and it is marked as set by the preset, which is the
   * "auto" tag on the screen.
   */
  public async addPhase(growId: string, body: PhaseCreate, setBy: string | null, hide: Redaction): Promise<Phase> {
    const grow = await this.require(growId);
    const plantIds = await this.scopeOf(grow, body.plantIds ?? null);

    const phase = await this.enterPhase(
      growId,
      {
        stage: body.stage,
        preset: body.preset ?? null,
        plantIds: body.plantIds ?? null,
        startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
      },
      spaceOf(grow, plantIds),
      setBy,
    );

    return serialisePhase(phase, hide);
  }

  /**
   * The phase itself, whether it was the stage picker or a split that asked for
   * it. `spaceId` is where the plants it is about stand, which the caller works
   * out - a split knows it, because it has just put them there.
   */
  private async enterPhase(
    growId: string,
    request: { stage: GrowthStage; preset: string | null; plantIds: string[] | null; startedAt?: Date },
    spaceId: string | null,
    setBy: string | null,
  ): Promise<StoredPhase> {
    const applied =
      request.preset !== null && spaceId !== null ? ((await this.presets?.applyToSpace(spaceId, request.stage, request.preset)) ?? []) : [];
    const controller = applied.length > 0 ? applied[0] : await this.controllerIn(spaceId);

    const phase = await this.phases.setPhase({
      growId,
      stage: request.stage,
      preset: request.preset,
      source: applied.length > 0 ? 'preset' : 'human',
      // The contract names the person who picked the stage, and nobody picked
      // one when a preset wrote the phase.
      setBy: applied.length > 0 ? null : setBy,
      plantIds: request.plantIds,
      deviceId: controller?.deviceId ?? null,
      spaceId,
      targets: controller?.targets ?? null,
      startedAt: request.startedAt,
    });

    // Putting a grow into the phase it already stands in changes nothing and is
    // not a failure; the phase it stands in comes back.
    return phase ?? (await this.phaseAlreadyStandingIn(growId, request.stage, request.preset));
  }

  /**
   * A phase entered with the wrong stage or on the wrong day. The writer owns
   * both halves of the correction - the phase and the line that announced it -
   * so this is the scope check and nothing else.
   */
  public async updatePhase(growId: string, phaseId: string, body: PhaseUpdate, hide: Redaction): Promise<Phase> {
    if (body.plantIds !== undefined && body.plantIds !== null) await this.scopeOf(await this.require(growId), body.plantIds);

    const corrected = await this.phases.correctPhase(growId, phaseId, {
      stage: body.stage,
      preset: body.preset,
      startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
      plantIds: body.plantIds,
    });

    return serialisePhase(corrected, hide);
  }

  public removePhase(growId: string, phaseId: string): Promise<void> {
    return this.phases.removePhase(growId, phaseId);
  }

  private async phaseAlreadyStandingIn(growId: string, stage: GrowthStage, preset: string | null): Promise<GrowDocument['phases'][number]> {
    const grow = await this.require(growId);
    const standing = grow.phases
      .filter(phase => phase.stage === stage && phase.preset === preset)
      .reduce<GrowDocument['phases'][number] | null>((latest, phase) => (latest && latest.startedAt > phase.startedAt ? latest : phase), null);

    if (!standing) throw conflict('phase_not_written', 'The grow could not be put into that phase.');
    return standing;
  }

  /**
   * A move: the open placement of these plants is closed and a new one opened.
   * Where it covered plants that are not moving, they keep the place they are
   * in under a row of their own - a placement states a set of plants, and a set
   * cannot shrink.
   */
  public async addPlacement(ctx: AccessContext, growId: string, body: PlacementCreate, authorId: string | null, hide: Redaction): Promise<Placement> {
    const grow = await this.require(growId);
    await this.scopeOf(grow, body.plantIds ?? null);
    await this.requireSpaceFor(ctx, body.spaceId);

    const placement = await this.movePlants(
      grow,
      { spaceId: body.spaceId, startedAt: body.startedAt ? new Date(body.startedAt) : new Date(), plantIds: body.plantIds ?? null },
      authorId,
    );

    return serialisePlacement(placement, hide);
  }

  /** The move itself, which a split makes as well: the open placement of these plants is closed and a new one opened. */
  private async movePlants(grow: GrowDocument, move: Move, authorId: string | null): Promise<StoredPlacement> {
    const everything = await this.scopeOf(grow, null);
    const moving = new Set(move.plantIds ?? everything);
    // A move that names no plants is the whole grow moving, and a grow with no
    // plants of its own - a migrated one has none - moves as much as any other.
    // Asked as "is this every plant" rather than by matching ids, which an empty
    // set never does, and which would leave the grow open in two places at once.
    const takesEverything = move.plantIds === null;
    const placement: StoredPlacement = { id: uuidv4(), spaceId: move.spaceId, startedAt: move.startedAt, endedAt: null, plantIds: move.plantIds };

    const placements = grow.placements.flatMap<StoredPlacement>(existing => {
      const covered = existing.plantIds ?? everything;
      if (existing.endedAt !== null || !(takesEverything || covered.some(plantId => moving.has(plantId)))) return [existing];

      const stayed = covered.filter(plantId => !moving.has(plantId));
      return [
        { ...existing, endedAt: move.startedAt },
        ...(stayed.length > 0 ? [{ id: uuidv4(), spaceId: existing.spaceId, startedAt: move.startedAt, endedAt: null, plantIds: stayed }] : []),
      ];
    });

    await this.grows.updateOne({ id: grow.id }, { $set: { placements: [...placements, placement] } });

    await this.entries.write({
      source: 'human',
      authorId,
      growId: grow.id,
      spaceId: move.spaceId,
      plantIds: move.plantIds ?? [],
      occurredAt: move.startedAt,
      values: { kind: 'move', placementId: placement.id, spaceId: move.spaceId },
    });

    return placement;
  }

  /**
   * A placement recorded wrongly, `endedAt` included - which is also how a
   * placement somebody forgot to close is closed on the day the plants really
   * left. Moving them is `POST /grows/{id}/placements` and appends a row; this
   * repairs the row that is already there, and the line that announced it with
   * it, because the timeline says where the plants went and would otherwise go
   * on saying the wrong thing.
   */
  public async updatePlacement(ctx: AccessContext, growId: string, placementId: string, body: PlacementUpdate, hide: Redaction): Promise<Placement> {
    const grow = await this.require(growId);
    const standing = grow.placements.find(placement => placement.id === placementId);
    if (!standing) throw notFound('placement_not_found', 'There is no placement of that grow with that id.');

    if (body.plantIds !== undefined && body.plantIds !== null) await this.scopeOf(grow, body.plantIds);
    if (body.spaceId !== undefined) await this.requireSpaceFor(ctx, body.spaceId);

    const corrected: StoredPlacement = {
      ...standing,
      spaceId: body.spaceId === undefined ? standing.spaceId : body.spaceId,
      startedAt: body.startedAt ? new Date(body.startedAt) : standing.startedAt,
      endedAt: body.endedAt === undefined ? standing.endedAt : body.endedAt === null ? null : new Date(body.endedAt),
      plantIds: body.plantIds === undefined ? standing.plantIds : body.plantIds,
    };

    if (corrected.endedAt !== null && corrected.endedAt < corrected.startedAt) {
      throw unprocessable('placement_ends_before_it_starts', 'Plants cannot leave a place before they arrived in it.', [
        { field: 'endedAt', code: 'before_start', detail: 'The end of a placement is not earlier than its start.' },
      ]);
    }

    const placements = [...grow.placements.filter(placement => placement.id !== placementId), corrected].sort(
      (one, other) => one.startedAt.getTime() - other.startedAt.getTime(),
    );
    await this.grows.updateOne({ id: growId }, { $set: { placements } });

    await this.entryRows.updateOne(
      { growId, kind: 'move', 'values.placementId': placementId },
      {
        $set: {
          occurredAt: corrected.startedAt,
          spaceId: corrected.spaceId,
          plantIds: corrected.plantIds ?? [],
          'values.spaceId': corrected.spaceId,
        },
      },
    );

    return serialisePlacement(corrected, hide);
  }

  /**
   * A move that never happened. The line that announced it goes with it, because
   * a diary entry naming a placement that is gone points at nothing.
   *
   * A grow always answers where it is - the overview, the week cards and
   * `access()` all read the open placements to say which spaces a grow is in -
   * so the last open one is not removed. Saying "nowhere" is a move to a
   * `spaceId` of null, which is a place a grow can be in rather than the absence
   * of one.
   */
  public async removePlacement(growId: string, placementId: string): Promise<void> {
    const grow = await this.require(growId);
    if (!grow.placements.some(placement => placement.id === placementId)) {
      throw notFound('placement_not_found', 'There is no placement of that grow with that id.');
    }

    const kept = grow.placements.filter(placement => placement.id !== placementId);
    if (!kept.some(placement => placement.endedAt === null)) {
      throw conflict('grow_stands_nowhere', 'This is the only placement saying where the grow is. Move the grow instead of removing it.');
    }

    await this.grows.updateOne({ id: growId }, { $set: { placements: kept } });
    await this.entryRows.deleteMany({ growId, kind: 'move', 'values.placementId': placementId });
  }

  /** Putting plants into a space that exists is managing that space, which the guard on the route has not decided about. */
  private async requireSpaceFor(ctx: AccessContext, spaceId: string | null | undefined): Promise<void> {
    if (spaceId) await this.access.require(ctx, subjectRef('space', spaceId), 'manage');
  }

  // -------------------------------------------------------------------------
  // Harvests and splits
  // -------------------------------------------------------------------------

  /**
   * Cutting plants down. Naming none takes every plant that is still standing,
   * which is the ordinary harvest; naming some is the staggered one, and the
   * rest of the grow carries on above them.
   *
   * A grow ends when its last plant comes down, because there is nothing left
   * for it to be a story of. It ends on the day of the harvest rather than the
   * day it was typed in, so the day counter stops where the grow really did.
   */
  public async harvest(growId: string, body: HarvestCreate, authorId: string | null, hide: Redaction): Promise<HarvestResult> {
    const grow = await this.require(growId);
    const standing = await this.plantsOf(growId);

    const named = body.plantIds ?? null;
    if (named !== null) await this.scopeOf(grow, named);

    const cut = named === null ? standing.filter(plant => plant.status === 'active') : standing.filter(plant => named.includes(plant.id));
    const again = cut.filter(plant => plant.harvest !== null);
    if (again.length > 0) {
      throw conflict('plants_already_harvested', 'Some of the plants named have already come down. Correct what one weighed on the plant itself.', [
        { field: 'plantIds', code: 'already_harvested', detail: again.map(plant => plant.label).join(', ') },
      ]);
    }
    if (cut.length === 0) throw conflict('nothing_to_harvest', 'Every plant of this grow has already come down.');

    const harvestedAt = body.harvestedAt ? new Date(body.harvestedAt) : new Date();
    const wet = shareOut(body.wetWeightG ?? null, cut.length);
    const dry = shareOut(body.dryWeightG ?? null, cut.length);

    const harvested = cut.map((plant, index) => ({
      ...plant,
      status: 'harvested' as const,
      harvest: { harvestedAt, wetWeightG: wet[index], dryWeightG: dry[index] },
    }));

    await this.plants.bulkWrite(
      harvested.map(plant => ({ updateOne: { filter: { id: plant.id }, update: { $set: { status: plant.status, harvest: plant.harvest } } } })),
    );

    const plantIds = harvested.map(plant => plant.id);
    const entry = await this.entries.write({
      source: 'human',
      authorId,
      growId,
      spaceId: spaceOf(grow, plantIds),
      plantIds,
      occurredAt: harvestedAt,
      // The totals as they were typed in, not a plant's share of them: the
      // timeline states the harvest, and the shares are the plants' own.
      values: { kind: 'harvest', wetWeightG: body.wetWeightG ?? null, dryWeightG: body.dryWeightG ?? null },
    });

    if (standing.every(plant => plantIds.includes(plant.id) || plant.status !== 'active') && grow.endedAt === null) {
      await this.grows.updateOne({ id: growId }, { $set: { endedAt: harvestedAt } });
    }

    return { plants: harvested.map(plant => serialisePlant(plant, hide)), entryId: entry.id };
  }

  /**
   * Some plants go their own way while the rest of the grow carries on: a mother
   * kept back, a clone run started beside its parents, four drying in the fridge
   * while four go on flowering.
   *
   * It is one action rather than a phase and a move made in turn, because those
   * two would each leave the grow half split, and because the phase has to be
   * read from where the plants have gone: the split is placed first, so a stage
   * with a preset puts the fridge on it and snapshots what the fridge runs.
   */
  public async split(ctx: AccessContext, growId: string, body: SplitCreate, authorId: string | null, hide: Redaction): Promise<SplitResult> {
    const grow = await this.require(growId);
    await this.scopeOf(grow, body.plantIds);

    if (body.stage === undefined && body.spaceId === undefined) {
      throw unprocessable('split_does_nothing', 'A split gives the plants a phase of their own, a place of their own, or both.', [
        { field: 'stage', code: 'nothing_to_do', detail: 'Name a stage, a space, or both.' },
      ]);
    }

    const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();
    await this.requireSpaceFor(ctx, body.spaceId);

    const placement =
      body.spaceId === undefined ? null : await this.movePlants(grow, { spaceId: body.spaceId, startedAt, plantIds: body.plantIds }, authorId);

    const phase =
      body.stage === undefined
        ? null
        : await this.enterPhase(
            growId,
            { stage: body.stage, preset: body.preset ?? null, plantIds: body.plantIds, startedAt },
            placement ? placement.spaceId : spaceOf(grow, body.plantIds),
            authorId,
          );

    return {
      plantIds: body.plantIds,
      phase: phase && serialisePhase(phase, hide),
      placement: placement && serialisePlacement(placement, hide),
    };
  }

  /** The plants a request is about: the ones it names, checked against the grow, or all of them. */
  private async scopeOf(grow: GrowDocument, plantIds: string[] | null): Promise<string[]> {
    const standing = (await this.plantsOf(grow.id)).map(plant => plant.id);
    if (plantIds === null) return standing;

    const strangers = plantIds.filter(plantId => !standing.includes(plantId));
    if (strangers.length > 0) {
      throw unprocessable('plants_not_in_grow', 'Some of the plants named are not in this grow.', [
        { field: 'plantIds', code: 'unknown', detail: strangers.join(', ') },
      ]);
    }

    return plantIds;
  }

  /** The controller whose climate the phase snapshots: the first device in the space that states targets at all. */
  private async controllerIn(spaceId: string | null): Promise<{ deviceId: string; targets: PhaseTargets } | null> {
    if (spaceId === null) return null;

    const devices = await this.devices.find({ spaceId }, { id: 1, configuration: 1 }).lean<StoredDevice[]>();

    for (const device of devices) {
      const targets = targetsOf(device.configuration);
      if (targets) return { deviceId: device.id, targets };
    }

    return null;
  }

  private async privacyOf(ownerIds: string[]): Promise<Map<string, UserPrivacy>> {
    const owners = await this.users.find({ id: { $in: [...new Set(ownerIds)] } }, { id: 1, privacy: 1 }).lean<StoredUser[]>();
    return new Map(owners.map(owner => [owner.id, owner.privacy]));
  }
}

const slugify = (name: string): string =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

const instantOrNull = (value: unknown): Date | null => (typeof value === 'string' ? new Date(value) : null);

/**
 * The harvest sheet weighs what came down, while the model keeps a weight per
 * plant so that a staggered harvest adds up rather than being counted twice.
 * So the figure is shared out evenly over the plants it was weighed for, and the
 * last of them takes whatever rounding left over, which keeps the total exactly
 * what somebody typed in. A plant that really weighed something else is
 * corrected on the plant, which is what `PATCH /plants/{id}` is for.
 */
const shareOut = (total: number | null, count: number): (number | null)[] => {
  if (total === null || count === 0) return Array.from({ length: count }, () => null);

  const each = round(total / count);
  return Array.from({ length: count }, (_, index) => (index < count - 1 ? each : round(total - each * (count - 1))));
};

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * A key is what a reading is filed under, so two definitions sharing one would
 * make every reading of either ambiguous. Refused where the list is written
 * rather than sorted out where it is read.
 */
const requireDistinctKeys = (definitions: MeasurementDefinition[]): void => {
  const keys = definitions.map(definition => definition.key);
  const twice = keys.find((key, at) => keys.indexOf(key) !== at);
  if (!twice) return;

  throw unprocessable('measurement_key_twice', 'Two measurements of a grow cannot share a key.', [
    { field: 'measurements', code: 'duplicate', detail: twice },
  ]);
};

const harvestOf = (harvest: PlantUpdate['harvest']): PlantDocument['harvest'] =>
  harvest ? { ...harvest, harvestedAt: new Date(harvest.harvestedAt) } : null;

/** Where the plants a request is about stand: the open placement that still covers them. */
const spaceOf = (grow: GrowDocument, plantIds: string[]): string | null => {
  const open = grow.placements
    .filter(placement => placement.endedAt === null)
    .sort((one, other) => other.startedAt.getTime() - one.startedAt.getTime());

  const covering = open.find(placement => placement.plantIds === null || placement.plantIds.some(plantId => plantIds.includes(plantId)));
  return covering?.spaceId ?? null;
};
