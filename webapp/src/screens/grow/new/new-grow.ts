import { DateTime } from 'luxon';
import { PRESETS_OF_STAGE } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import type { GrowCreate, GrowScheme, GrowthStage, GrowType, PlantBatch } from '@fg2/shared-types/v1';
import { instantOf } from '@/ui/age';

/**
 * What the new-grow sheet is deciding, and the arithmetic behind the sentences
 * it prints. None of it touches the network, so what the sheet promises can be
 * read - and tested - without a grow being started to find out.
 */

/** The stages a grow can begin in: what is left of the botanical six once the two at the end are gone. */
export const START_STAGES: GrowthStage[] = ['germination', 'seedling', 'vegetative', 'flowering'];

export interface PlantRow {
  /** Its own, because two rows of the same strain are two rows and a name is not an identity. */
  key: string;
  strain: string;
  count: number;
}

export interface Draft {
  name: string;
  plants: PlantRow[];
  type: GrowType;
  /** Where the plants go; null is "no fixed place", which is a place a grow can be in. */
  spaceId: string | null;
  stage: GrowthStage;
  startedAt: Date;
  /** The shipped scheme this grow is fed by, or null for none and one of the grower's own. */
  schemeId: string | null;
}

const NUMBERED = /^(.*?)\s*#(\d+)$/;

const baseOf = (name: string): string => NUMBERED.exec(name)?.[1] ?? name;

const numberOf = (name: string): number => Number(NUMBERED.exec(name)?.[2] ?? 1);

/**
 * The name in the corner of the field: the run after the last one, counted over
 * the grows that share its name. A grower who calls every run "Spring run" gets
 * "Spring run #3" and one who names them after the strain gets the strain
 * again, which is a worse suggestion and still a better one than an empty
 * field. The first grow of an account has nothing to count from, so it is
 * offered the plain name the catalogue holds.
 */
export const suggestedName = (grows: { name: string; startedAt: string }[], fallback: string): string => {
  const latest = [...grows].sort((one, other) => other.startedAt.localeCompare(one.startedAt))[0];
  if (!latest) return fallback;

  const base = baseOf(latest.name);
  const highest = grows.reduce((top, grow) => (baseOf(grow.name) === base ? Math.max(top, numberOf(grow.name)) : top), 0);

  return `${base} #${highest + 1}`;
};

/** The day the grow will read as once it exists: 1 today, and one more for every day back the start was put. */
export const dayNumber = (startedAt: Date, now: DateTime): number =>
  Math.round(now.startOf('day').diff(DateTime.fromJSDate(startedAt).startOf('day'), 'days').days) + 1;

/**
 * The preset the grow's own kind puts on the stage. Nobody is asked for it: an
 * autoflower never gets the 12/12 flip, so the two stages that would flip it
 * are refined by the preset that does not, and the stages before them are the
 * same for either kind of plant.
 */
export const presetFor = (type: GrowType, stage: GrowthStage): string | null =>
  type === 'autoflower' && (PRESETS_OF_STAGE[stage] ?? []).includes('autoflower') ? 'autoflower' : null;

/** The strains as the contract counts them: rows left unnamed are not plants, and are not sent as any. */
export const plantsOf = (rows: PlantRow[]): PlantBatch[] =>
  rows.filter(row => row.strain.trim() !== '').map(row => ({ strain: row.strain.trim(), count: row.count }));

export const growBody = (draft: Draft, name: string, scheme: GrowScheme | null): GrowCreate => ({
  name,
  type: draft.type,
  startedAt: instantOf(DateTime.fromJSDate(draft.startedAt)),
  spaceId: draft.spaceId,
  plants: plantsOf(draft.plants),
  scheme,
});

export interface Told {
  key: string;
  values?: Record<string, string>;
}

/**
 * What the choices come to, in the order the board prints them: which place is
 * put on which preset now, what the tag on the phases that follow means, and
 * what an autoflower changes about both. Sentences, because what a preset
 * changes is easier to read than to tabulate.
 */
export const tells = (draft: Draft, place: { name: string; steered: boolean } | null, stageName: string): Told[] => {
  const told: Told[] = [];

  if (place === null) told.push({ key: 'grow.new.tells.nowhere' });
  else if (place.steered) told.push({ key: 'grow.new.tells.preset', values: { place: place.name, stage: stageName } });
  else told.push({ key: 'grow.new.tells.noController', values: { place: place.name } });

  if (place !== null) told.push({ key: 'grow.new.tells.auto' });
  if (draft.type === 'autoflower') told.push({ key: draft.schemeId === null ? 'grow.new.tells.autoflowerAlone' : 'grow.new.tells.autoflower' });

  return told;
};
