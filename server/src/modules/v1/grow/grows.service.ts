import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import type {
  GrowCreate,
  GrowListItem,
  GrowthStage,
  GrowUpdate,
  Phase,
  PhaseCreate,
  PhaseTargets,
  Placement,
  PlacementCreate,
  Plant,
  PlantCreate,
  PlantUpdate,
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

type StoredPlacement = GrowDocument['placements'][number];

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
   * row: their own, and those standing in a space they are a member of. An
   * admin sees every grow, a demo session the demo ones.
   */
  private async visibleTo(ctx: AccessContext): Promise<FilterQuery<GrowDocument>> {
    if (ctx.isAdmin) return {};
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
    const changes: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(body)) {
      if (value !== undefined) changes[field] = field === 'startedAt' || field === 'endedAt' ? instantOrNull(value) : value;
    }

    const changed = await this.grows.findOneAndUpdate({ id }, { $set: changes }, { new: true }).lean<GrowDocument>();
    if (!changed) throw notFound('grow_not_found', 'There is no grow with that id.');

    return serialiseGrow(changed, await this.plantsOf(id), hide);
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

    const preset = body.preset ?? null;
    const spaceId = spaceOf(grow, plantIds);
    const applied = preset !== null && spaceId !== null ? ((await this.presets?.applyToSpace(spaceId, body.stage, preset)) ?? []) : [];
    const controller = applied.length > 0 ? applied[0] : await this.controllerIn(spaceId);

    const phase = await this.phases.setPhase({
      growId,
      stage: body.stage,
      preset,
      source: applied.length > 0 ? 'preset' : 'human',
      // The contract names the person who picked the stage, and nobody picked
      // one when a preset wrote the phase.
      setBy: applied.length > 0 ? null : setBy,
      plantIds: body.plantIds ?? null,
      deviceId: controller?.deviceId ?? null,
      spaceId,
      targets: controller?.targets ?? null,
      startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
    });

    // Putting a grow into the phase it already stands in changes nothing and is
    // not a failure; the phase it stands in comes back.
    return serialisePhase(phase ?? (await this.phaseAlreadyStandingIn(growId, body.stage, preset)), hide);
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
    const everything = await this.scopeOf(grow, null);
    const moving = new Set(await this.scopeOf(grow, body.plantIds ?? null));

    // Moving plants into a space that exists is managing that space.
    if (body.spaceId) await this.access.require(ctx, subjectRef('space', body.spaceId), 'manage');

    const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();
    const placement: StoredPlacement = { id: uuidv4(), spaceId: body.spaceId, startedAt, endedAt: null, plantIds: body.plantIds ?? null };

    const placements = grow.placements.flatMap<StoredPlacement>(existing => {
      const covered = existing.plantIds ?? everything;
      if (existing.endedAt !== null || !covered.some(plantId => moving.has(plantId))) return [existing];

      const stayed = covered.filter(plantId => !moving.has(plantId));
      return [
        { ...existing, endedAt: startedAt },
        ...(stayed.length > 0 ? [{ id: uuidv4(), spaceId: existing.spaceId, startedAt, endedAt: null, plantIds: stayed }] : []),
      ];
    });

    await this.grows.updateOne({ id: growId }, { $set: { placements: [...placements, placement] } });

    await this.entries.write({
      source: 'human',
      authorId,
      growId,
      spaceId: body.spaceId,
      plantIds: body.plantIds ?? [],
      occurredAt: startedAt,
      values: { kind: 'move', placementId: placement.id, spaceId: body.spaceId },
    });

    return serialisePlacement(placement, hide);
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
