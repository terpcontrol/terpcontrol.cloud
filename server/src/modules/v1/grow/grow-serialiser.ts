import type {
  FollowedGrowCard,
  GrowListItem,
  GrowLocation,
  GrowSummary,
  Phase,
  PhaseGroup,
  Placement,
  Plant,
  UserPrivacy,
} from '@fg2/shared-types/v1';
import { growOriginOf, growWeekAt, stageWeekOf } from '@fg2/shared-types/v1-schemas';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';

/**
 * What a grow's `phases[]` and `placements[]` mean, worked out here and nowhere
 * else.
 *
 * The day counter, the phase a plant stands in, the week the feeding grid is
 * read at, the groups a split leaves behind and where each plant is are all
 * implied by the same two lists. Every screen shows some of them, so a client
 * that worked them out itself would work them out again per screen and per
 * client - and the first of them to count a day differently would be a bug
 * nobody could see in the data. They ride on every answer that carries a grow
 * instead.
 */

type StoredPhase = GrowDocument['phases'][number];
type StoredPlacement = GrowDocument['placements'][number];

/**
 * What is left out of an answer. A grow read by somebody who is neither its
 * owner nor a member of the space it stands in is served through its owner's
 * privacy settings, which are the first two switches.
 *
 * `authors` is not one of those settings and is not the owner's to turn off: who
 * wrote which line is the account behind it, and a reader outside the tent is
 * told what happened rather than who by. It is why a public page carries no
 * `people` list where the owner's own week cards do.
 */
export interface Redaction {
  weights: boolean;
  counts: boolean;
  authors: boolean;
}

export const NOTHING_HIDDEN: Redaction = { weights: false, counts: false, authors: false };

/**
 * Whose privacy applies is decided by `access()`; this is what it comes to. An
 * owner whose settings could not be read hides both, because the safe direction
 * for a reader who is already a stranger is the quieter one.
 */
export const redactionOf = (redacted: boolean, privacy: UserPrivacy | null | undefined): Redaction =>
  redacted ? { weights: privacy?.hideWeights ?? true, counts: privacy?.hideCounts ?? true, authors: true } : NOTHING_HIDDEN;

/**
 * A scope that is not shown is empty rather than absent: `null` already means
 * every plant of the grow, which would say more than the count that is being
 * hidden.
 */
const scope = (plantIds: string[] | null, hide: Redaction): string[] | null => (hide.counts && plantIds !== null ? [] : plantIds);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Day 1 is the day the grow started. Counted in elapsed days rather than in
 * calendar days: the grower's midnight is not the server's, and a grow begun at
 * 23:00 would otherwise be two days old within the hour.
 */
const dayNumberOf = (from: Date, asOf: Date): number => Math.max(1, Math.floor((asOf.getTime() - from.getTime()) / DAY_MS) + 1);

/** Weeks are counted like days, so week 1 is days 1 to 7 and lines up with the feeding grid's first row. */
const weekNumberOf = (dayNumber: number): number => Math.floor((dayNumber - 1) / 7) + 1;

const covers = (plantIds: string[] | null, plantId: string): boolean => plantIds === null || plantIds.includes(plantId);

const latest = (phases: StoredPhase[]): StoredPhase | null =>
  phases.reduce<StoredPhase | null>((best, phase) => (best && best.startedAt > phase.startedAt ? best : phase), null);

const earliest = (phases: StoredPhase[]): StoredPhase | null =>
  phases.reduce<StoredPhase | null>((best, phase) => (best && best.startedAt <= phase.startedAt ? best : phase), null);

/** Where a plant stands: the latest phase written over a scope that includes it. */
const phaseOf = (phases: StoredPhase[], plantId: string): StoredPhase | null => latest(phases.filter(phase => covers(phase.plantIds, plantId)));

interface Group {
  phase: StoredPhase;
  plantIds: string[];
}

/**
 * The plants by the phase each of them stands in, largest group first, which is
 * also how the headline is chosen. Two groups of the same size are ordered by
 * the newer phase, so a grow that has just been split reads as what it has
 * become rather than as what it was.
 */
const groupsOf = (phases: StoredPhase[], plants: PlantDocument[]): Group[] => {
  const byPhase = new Map<string, Group>();

  for (const plant of plants) {
    const phase = phaseOf(phases, plant.id);
    if (!phase) continue;

    const group = byPhase.get(phase.id) ?? { phase, plantIds: [] };
    group.plantIds.push(plant.id);
    byPhase.set(phase.id, group);
  }

  return [...byPhase.values()].sort((one, other) => other.plantIds.length - one.plantIds.length || compare(other.phase, one.phase));
};

const compare = (one: StoredPhase, other: StoredPhase): number => one.startedAt.getTime() - other.startedAt.getTime();

/**
 * Where the plants are now. A grow whose plants are all gone - a migrated one,
 * which has none, or one that has been harvested - still stands somewhere, and
 * the card that draws it says where.
 */
const locationsOf = (placements: StoredPlacement[], plantIds: string[], hide: Redaction): GrowLocation[] => {
  const open = placements.filter(placement => placement.endedAt === null).sort((one, other) => one.startedAt.getTime() - other.startedAt.getTime());

  if (plantIds.length === 0) return [...new Set(open.map(placement => placement.spaceId))].map(spaceId => ({ spaceId, plantIds: [] }));

  // The later placement wins, so a move that was recorded without closing what
  // it replaced still reads as one place per plant.
  const where = new Map<string, string | null>();
  for (const placement of open) {
    for (const plantId of placement.plantIds ?? plantIds) where.set(plantId, placement.spaceId);
  }

  const located = new Map<string | null, string[]>();
  for (const [plantId, spaceId] of where) located.set(spaceId, [...(located.get(spaceId) ?? []), plantId]);

  return [...located].map(([spaceId, ids]) => ({ spaceId, plantIds: hide.counts ? [] : ids }));
};

/**
 * The grow as it stood at one instant, for a reader whose window closed before
 * now.
 *
 * The window belongs to the link, so the story stops where the window does: a
 * phase written after it is not part of what was sent, and a grow that ended
 * afterwards has not ended as far as that reader is concerned. Without this the
 * day counter runs to today and the headline names a stage entered long after
 * the link was handed out - both of them facts dated outside the window.
 */
export const growUpTo = (grow: GrowDocument, at: Date): GrowDocument => ({
  ...grow,
  phases: grow.phases.filter(phase => phase.startedAt <= at),
  // A placement that was closed after the instant was still open at it, which is
  // what makes "where the plants are" answer where they were.
  placements: grow.placements
    .filter(placement => placement.startedAt <= at)
    .map(placement => (placement.endedAt !== null && placement.endedAt > at ? { ...placement, endedAt: null } : placement)),
  endedAt: grow.endedAt !== null && grow.endedAt <= at ? grow.endedAt : null,
});

export const summaryOf = (grow: GrowDocument, plants: PlantDocument[], hide: Redaction, now: Date = new Date()): GrowSummary => {
  // A grow that has ended stopped counting on the day it ended.
  const asOf = grow.endedAt ?? now;
  // The origin the week cards count from, which is what the stage week is read
  // against; the day counter below keeps counting from the first phase.
  const origin = growOriginOf(grow);
  const first = earliest(grow.phases);
  const groups = groupsOf(grow.phases, plants);
  const headline = groups[0]?.phase ?? latest(grow.phases);
  const dayNumber = first ? dayNumberOf(first.startedAt, asOf) : null;

  const told: PhaseGroup[] = groups.map(group => ({
    stage: group.phase.stage,
    preset: group.phase.preset,
    phaseDay: dayNumberOf(group.phase.startedAt, asOf),
    plantIds: hide.counts ? [] : group.plantIds,
  }));

  return {
    dayNumber,
    stage: headline?.stage ?? null,
    preset: headline?.preset ?? null,
    phaseDay: headline ? dayNumberOf(headline.startedAt, asOf) : null,
    weekNumber: dayNumber === null ? null : weekNumberOf(dayNumber),
    // Which week of its stage, counted against the grow's own weeks rather than
    // by dividing the phase's days by seven. The week cards count it that way,
    // and the header sits directly above the first of them: a stage begun
    // mid-week is in its second week on the Monday the grow's next week begins,
    // and the two figures only ever coincided when a phase happened to start on
    // a week boundary.
    stageWeek: headline ? stageWeekOf(origin, headline.startedAt, growWeekAt(origin, asOf)) : null,
    // What the "auto" tag is drawn from: a preset or the plan put the grow here.
    isAuto: headline !== null && headline.source !== 'human',
    // One group is every plant in the same phase, which the headline already says.
    groups: told.length > 1 ? told : [],
    locations: locationsOf(
      grow.placements,
      plants.map(plant => plant.id),
      hide,
    ),
  };
};

/**
 * A public grow as it is named rather than opened: among the grows somebody
 * follows on the home screen, and among the diaries on its author's public page.
 * One card either way, because a grow that has been made public reads the same
 * wherever it is listed - and the handle is the only name its author ever has.
 *
 * `movedAt` is when its diary last had something written in it, which is what a
 * card saying "3 d ago" is read as. The grow's own `updatedAt` is not that: it
 * is the row's write time, which a diary entry never touches and a migration
 * touches for every grow at once, so a card drawn from it says that sixteen
 * diaries were all written the same minute. A grow nobody has written in yet is
 * dated from the day it started rather than from whenever its row was saved.
 */
export const serialisePublicCard = (
  grow: GrowDocument,
  plants: PlantDocument[],
  handle: string,
  hide: Redaction,
  movedAt: Date | null,
  now: Date = new Date(),
): FollowedGrowCard => {
  const summary = summaryOf(grow, plants, hide, now);

  return {
    growId: grow.id,
    slug: grow.slug,
    name: grow.name,
    handle,
    dayNumber: summary.dayNumber,
    stage: summary.stage,
    coverMediaId: grow.coverMediaId,
    updatedAt: (movedAt ?? grow.startedAt).toISOString(),
  };
};

export const serialisePhase = (phase: StoredPhase, hide: Redaction): Phase => ({
  id: phase.id,
  stage: phase.stage,
  preset: phase.preset,
  startedAt: phase.startedAt.toISOString(),
  source: phase.source,
  plantIds: scope(phase.plantIds, hide),
  deviceId: phase.deviceId,
  targets: phase.targets,
  setBy: phase.setBy,
});

export const serialisePlacement = (placement: StoredPlacement, hide: Redaction): Placement => ({
  id: placement.id,
  spaceId: placement.spaceId,
  startedAt: placement.startedAt.toISOString(),
  endedAt: placement.endedAt?.toISOString() ?? null,
  plantIds: scope(placement.plantIds, hide),
});

export const serialisePlant = (plant: PlantDocument, hide: Redaction): Plant => ({
  id: plant.id,
  growId: plant.growId,
  strain: plant.strain,
  label: plant.label,
  status: plant.status,
  harvest: plant.harvest
    ? {
        harvestedAt: plant.harvest.harvestedAt.toISOString(),
        wetWeightG: hide.weights ? null : plant.harvest.wetWeightG,
        dryWeightG: hide.weights ? null : plant.harvest.dryWeightG,
      }
    : null,
  createdAt: plant.createdAt.toISOString(),
});

/** Field by field, because `_id` rides on a stored document and never leaves the server. */
export const serialiseGrow = (grow: GrowDocument, plants: PlantDocument[], hide: Redaction, now: Date = new Date()): GrowListItem => ({
  id: grow.id,
  ownerId: grow.ownerId,
  name: grow.name,
  description: grow.description,
  type: grow.type,
  phases: grow.phases.map(phase => serialisePhase(phase, hide)),
  placements: grow.placements.map(placement => serialisePlacement(placement, hide)),
  scheme: grow.scheme,
  measurements: grow.measurements,
  visibility: grow.visibility,
  slug: grow.slug,
  coverMediaId: grow.coverMediaId,
  filmMediaId: grow.filmMediaId,
  startedAt: grow.startedAt.toISOString(),
  endedAt: grow.endedAt?.toISOString() ?? null,
  isDemo: grow.isDemo,
  createdAt: grow.createdAt.toISOString(),
  updatedAt: grow.updatedAt.toISOString(),
  summary: summaryOf(grow, plants, hide, now),
});
