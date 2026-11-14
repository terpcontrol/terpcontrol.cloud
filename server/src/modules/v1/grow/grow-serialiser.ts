import type {
  FollowedGrowCard,
  GrowCard,
  GrowHarvest,
  GrowListItem,
  GrowthStage,
  GrowLocation,
  GrowSummary,
  Phase,
  PhaseGroup,
  Placement,
  Plant,
  PlantLabel,
  UserPrivacy,
} from '@fg2/shared-types/v1';
import type { Model } from 'mongoose';
import { growDayAt, growDayUpTo, growOriginOf, growWeekOfDay, spineOf, stageWeekOf } from '@fg2/shared-types/v1-schemas';
import { AccessRange } from '@common/v1/access.types';
import { outsideRange } from '@common/v1/range';
import { GrowDocument, PhaseDocument, PlacementDocument } from '@database/schemas/v1/grows.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import type { Moved } from './grow-moved';

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

/**
 * What is left out of an answer. A grow read by somebody who is neither its
 * owner nor a member of the space it stands in is served through its owner's
 * privacy settings, which are the first two switches.
 *
 * `authors` is not one of those settings and is not the owner's to turn off: who
 * wrote which line is the account behind it, and a reader outside the tent is
 * told what happened rather than who by. It is why a public page carries no
 * `people` list where the owner's own diary does.
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

/** A plant by its name, for a page that names the plants of a line and is not answered the plants themselves. */
export const labelOf = (plant: Pick<PlantDocument, 'id' | 'growId' | 'label'>): PlantLabel => ({
  id: plant.id,
  growId: plant.growId,
  label: plant.label,
});

/**
 * Which day of its phase a grow is on: the days of the grow this phase has
 * covered, the first of them included. Counted on the grow's own days and not
 * in 24-hour blocks from the phase's own instant, or the header and the report
 * beneath it state two lengths for one phase.
 */
const phaseDayOf = (origin: Date, startedAt: Date, asOf: Date, zone: string | null): number =>
  Math.max(1, growDayUpTo(origin, asOf, zone) - growDayAt(origin, startedAt, zone) + 1);

const covers = (plantIds: string[] | null, plantId: string): boolean => plantIds === null || plantIds.includes(plantId);

/** The phase begun last; of two begun at the same instant, the one written later. */
export const latestPhase = <P extends { startedAt: Date }>(phases: readonly P[]): P | null =>
  phases.reduce<P | null>((best, phase) => (best && best.startedAt > phase.startedAt ? best : phase), null);

/** Where a plant stands: the latest phase written over a scope that includes it. */
const phaseOf = (phases: PhaseDocument[], plantId: string): PhaseDocument | null =>
  latestPhase(phases.filter(phase => covers(phase.plantIds, plantId)));

interface Group {
  phase: PhaseDocument;
  plantIds: string[];
}

/**
 * The plants by the phase each of them stands in, largest group first, which is
 * also how the headline is chosen. Two groups of the same size are ordered by
 * the newer phase, so a grow that has just been split reads as what it has
 * become rather than as what it was.
 */
const groupsOf = (phases: PhaseDocument[], plants: PlantDocument[]): Group[] => {
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

const compare = (one: PhaseDocument, other: PhaseDocument): number => one.startedAt.getTime() - other.startedAt.getTime();

/**
 * Where the plants are now. A grow whose plants are all gone - a migrated one,
 * which has none, or one that has been harvested - still stands somewhere, and
 * the card that draws it says where.
 */
const locationsOf = (placements: PlacementDocument[], plantIds: string[], hide: Redaction): GrowLocation[] => {
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

/**
 * The stages the grow as a whole has been through, oldest first, with the one
 * it stands in now. It is what a phase bar fills, and the grow page's bar and
 * the home card's must fill the same segments: the home card used to fill
 * every stage up to the current one, so a grow started in veg read as having
 * germinated and been a seedling on Home while its own page said it had not.
 */
export const stagesReachedOf = (grow: GrowDocument, stage: GrowthStage | null, now: Date = new Date()): GrowthStage[] => {
  const spine = spineOf(grow.phases, grow.endedAt ?? now).map(phase => phase.stage);

  return [...new Set(stage ? [...spine, stage] : spine)];
};

export const summaryOf = (grow: GrowDocument, plants: PlantDocument[], hide: Redaction, zone: string | null, now: Date = new Date()): GrowSummary => {
  // A grow that has ended stopped counting on the day it ended.
  const asOf = grow.endedAt ?? now;
  // The one origin every day of the grow is counted from, on this header and on
  // every screen beneath it, as dates of its owner's calendar.
  const origin = growOriginOf(grow);
  const groups = groupsOf(grow.phases, plants);
  const headline = groups[0]?.phase ?? latestPhase(grow.phases);
  const dayNumber = grow.phases.length > 0 ? growDayUpTo(origin, asOf, zone) : null;

  const told: PhaseGroup[] = groups.map(group => ({
    stage: group.phase.stage,
    preset: group.phase.preset,
    phaseDay: phaseDayOf(origin, group.phase.startedAt, asOf, zone),
    plantIds: hide.counts ? [] : group.plantIds,
  }));

  return {
    dayNumber,
    stage: headline?.stage ?? null,
    preset: headline?.preset ?? null,
    phaseDay: headline ? phaseDayOf(origin, headline.startedAt, asOf, zone) : null,
    weekNumber: dayNumber === null ? null : growWeekOfDay(dayNumber),
    zone: zone || 'UTC',
    // Which week of its stage, counted from the stage's own start: days 1 to 7 of it are week 1.
    stageWeek: headline ? stageWeekOf(origin, headline.startedAt, growDayUpTo(origin, asOf, zone), zone) : null,
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

/** A grow as a card draws it: Home's card of a place, and every grow on a tent's overview. */
export const growCardOf = (
  grow: GrowDocument,
  plants: PlantDocument[],
  hide: Redaction,
  zone: string | null,
  now: Date,
  summary: GrowSummary = summaryOf(grow, plants, hide, zone, now),
): GrowCard => ({
  growId: grow.id,
  name: grow.name,
  type: grow.type,
  dayNumber: summary.dayNumber,
  phaseDay: summary.phaseDay,
  stageWeek: summary.stageWeek,
  stage: summary.stage,
  stagesReached: stagesReachedOf(grow, summary.stage, now),
  preset: summary.preset,
  isAuto: summary.isAuto,
  plantCount: hide.counts ? null : plants.length,
  strains: [...new Set(plants.map(plant => plant.strain))],
  coverMediaId: grow.coverMediaId,
  stageGroups: summary.groups.map(group => ({ stage: group.stage, plantCount: hide.counts ? null : group.plantIds.length })),
});

/**
 * A public grow as it is named rather than opened: among the grows somebody
 * follows on the home screen, and among the diaries on its author's public page.
 * One card either way, because a grow that has been made public reads the same
 * wherever it is listed - and the handle is the only name its author ever has.
 *
 * `moved` is when it last showed a sign of life and by what (`growsMoved`):
 * what a card saying "Bild vor 5 Min" is read as. The grow's own `updatedAt`
 * is not that: it is the row's write time, which a diary entry never touches
 * and a migration touches for every grow at once, so a card drawn from it said
 * that sixteen diaries were all written the same minute.
 */
export const serialisePublicCard = (
  grow: GrowDocument,
  plants: PlantDocument[],
  handle: string,
  hide: Redaction,
  moved: Moved,
  zone: string | null,
  now: Date = new Date(),
): FollowedGrowCard => {
  const summary = summaryOf(grow, plants, hide, zone, now);

  return {
    growId: grow.id,
    slug: grow.slug,
    name: grow.name,
    handle,
    dayNumber: summary.dayNumber,
    stage: summary.stage,
    // Beside the day number rather than instead of it: 218 is the grow's last
    // day and worth keeping, and the card's own date is when the diary last
    // moved, which is not when the grow ended. Without this a card of a diary
    // that finished in August reads exactly like one of a grow that is running.
    endedAt: grow.endedAt?.toISOString() ?? null,
    coverMediaId: grow.coverMediaId,
    updatedAt: moved.at.toISOString(),
    updatedBy: moved.by,
  };
};

export const serialisePhase = (phase: PhaseDocument, hide: Redaction): Phase => ({
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

export const serialisePlacement = (placement: PlacementDocument, hide: Redaction): Placement => ({
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
export const serialiseGrow = (
  grow: GrowDocument,
  plants: PlantDocument[],
  hide: Redaction,
  zone: string | null,
  now: Date = new Date(),
): GrowListItem => ({
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
  publicCameras: grow.publicCameras !== false,
  slug: grow.slug,
  coverMediaId: grow.coverMediaId,
  filmMediaId: grow.filmMediaId,
  startedAt: grow.startedAt.toISOString(),
  endedAt: grow.endedAt?.toISOString() ?? null,
  isDemo: grow.isDemo,
  createdAt: grow.createdAt.toISOString(),
  updatedAt: grow.updatedAt.toISOString(),
  summary: summaryOf(grow, plants, hide, zone, now),
});

/** The harvest lines of some grows, which is what `harvestOf` adds up. */
export const harvestLinesOf = (
  entries: Model<EntryDocument>,
  growIds: string[],
): Promise<Pick<EntryDocument, 'growId' | 'occurredAt' | 'values' | 'plantIds'>[]> =>
  entries
    .find({ growId: { $in: growIds }, kind: 'harvest' }, { growId: 1, occurredAt: 1, values: 1, plantIds: 1 })
    .lean<Pick<EntryDocument, 'growId' | 'occurredAt' | 'values' | 'plantIds'>[]>();

/**
 * One harvest for the whole grow: when the first plant came down, and what the
 * lot weighed. The report, the grows list and the public page all state it, and
 * a weight that two places worked out separately is a weight one of them could
 * state wrongly.
 *
 * What was weighed is the amounts typed into the harvest's lines, as the diary
 * states them, never the plants' shares added up: a plant deleted from a harvest
 * of several takes its share with it while the line keeps what the scale said
 * (Chris, 2026-11-14), and three pages gave three yields.
 *
 * A harvest is dated, so it belongs to the window like any other line: a plant
 * that came down after a link's window closed has not come down as far as that
 * link is concerned, and a grow whose whole harvest falls outside it has none to
 * state.
 */
export const harvestOf = (
  plants: readonly PlantDocument[],
  lines: readonly Pick<EntryDocument, 'occurredAt' | 'values' | 'plantIds'>[],
  hide: Redaction,
  range: AccessRange,
): GrowHarvest | null => {
  const cut = plants.filter(plant => plant.harvest && !outsideRange(plant.harvest.harvestedAt, range));
  // A plant weighed on the plant alone, without a harvest line naming it, counts by its own weights.
  const unlined = cut.filter(plant => !lines.some(line => line.plantIds.includes(plant.id))).map(plant => plant.harvest!);
  const weighed = lines.flatMap(line =>
    line.values.kind === 'harvest' && !outsideRange(line.occurredAt, range) ? [{ ...line.values, at: line.occurredAt }] : [],
  );
  const dates = [...cut.map(plant => plant.harvest!.harvestedAt), ...weighed.map(line => line.at)];
  if (dates.length === 0) return null;
  // The grow is harvested when its last plant is; till then the harvest is the plants'.
  const growing = plants.some(plant => plant.status !== 'ended' && !cut.includes(plant));

  const total = (weights: (number | null)[]): number | null =>
    weights.some(weight => weight !== null) ? weights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0) : null;

  return {
    harvestedAt: new Date(Math.min(...dates.map(date => date.getTime()))).toISOString(),
    wetWeightG: hide.weights ? null : total([...weighed, ...unlined].map(one => one.wetWeightG)),
    dryWeightG: hide.weights ? null : total([...weighed, ...unlined].map(one => one.dryWeightG)),
    plantIds: growing ? cut.map(plant => plant.id) : [],
  };
};
