import { DateTime } from 'luxon';
import { PRESETS_OF_STAGE } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { growDayAt } from '@fg2/shared-types/v1-schemas/feeding.js';
import type { GrowCreate, GrowListItem, GrowScheme, GrowthStage, GrowType, PlantBatch } from '@fg2/shared-types/v1';
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

const newestFirst = (one: { startedAt: string }, other: { startedAt: string }): number => other.startedAt.localeCompare(one.startedAt);

/** Every grow that has ever stood in a place, ended or not: a tent whose last run came down is still the tent that held it. */
const stoodIn = (grow: GrowListItem, spaceId: string | null): boolean =>
  spaceId === null
    ? grow.placements.every(placement => placement.spaceId === null)
    : grow.placements.some(placement => placement.spaceId === spaceId);

/** The run after the last one of a set: its name, and one past the highest number any grow sharing that name carries. */
const after = (grows: GrowListItem[], fallback: string): string => {
  const latest = [...grows].sort(newestFirst)[0];
  if (!latest) return fallback;

  const base = baseOf(latest.name);
  const highest = grows.reduce((top, grow) => (baseOf(grow.name) === base ? Math.max(top, numberOf(grow.name)) : top), 0);

  return `${base} #${highest + 1}`;
};

/**
 * The name in the corner of the field: the run after the last one *here*,
 * counted over the grows that have stood in the place being filled. A grower
 * who calls every run in a tent "Spring run" gets "Spring run #3" and one who
 * names them after the strain gets the strain again, which is a worse
 * suggestion and still a better one than an empty field. A place that has never
 * held anything falls back to the account's latest run, and an account with no
 * grows at all to the plain name the catalogue holds.
 */
export const suggestedName = (grows: GrowListItem[], spaceId: string | null, fallback: string): string => {
  const here = grows.filter(grow => stoodIn(grow, spaceId));

  return after(here.length > 0 ? here : grows, fallback);
};

/**
 * The open grow standing in a place, newest first. Starting a second one on top
 * of it is allowed and is sometimes meant, but it is never what a grower should
 * find out afterwards, so the sheet asks this before it says what the tap does.
 */
export const growIn = (grows: GrowListItem[], spaceId: string): GrowListItem | null =>
  grows
    .filter(grow => grow.endedAt === null && grow.placements.some(placement => placement.spaceId === spaceId && placement.endedAt === null))
    .sort(newestFirst)[0] ?? null;

/**
 * The day the grow will read as once it exists: 1 today, and one more for
 * every whole day back the start was put.
 *
 * It is the contract's own `growDayAt` and not an arithmetic of its own,
 * because the two disagreed and the button was the one that was wrong. A grow
 * day is twenty-four hours from the moment the first phase began - the sheet
 * keeps the hour the date was typed at, on purpose, so that a correction moves
 * a grow by whole days - while counting calendar days instead counts the
 * midnights in between, and a clock change is a day with twenty-three of those
 * hours in it. So a start backdated across the spring change promised "Day
 * 207" for a grow that would read 206 the moment it existed, and every
 * backdated start on the far side of the change was over by one.
 */
export const dayNumber = (startedAt: Date, now: DateTime): number => growDayAt(startedAt, now.toJSDate());

/**
 * The preset the grow's own kind puts on the stage. Nobody is asked for it: an
 * autoflower never gets the 12/12 flip, so the two stages that would flip it
 * are refined by the preset that does not, and the stages before them are the
 * same for either kind of plant.
 */
export const presetFor = (type: GrowType, stage: GrowthStage): string | null =>
  type === 'autoflower' && (PRESETS_OF_STAGE[stage] ?? []).includes('autoflower') ? 'autoflower' : null;

/**
 * The strains as the contract counts them. A row that was never named is still
 * a plant - the sheet's own hint says a count is enough - so it goes across
 * under a stand-in name rather than being dropped: a plant's label is made from
 * its strain, and a plant with an empty one is refused on the way in.
 */
export const plantsOf = (rows: PlantRow[], unnamed: string): PlantBatch[] =>
  rows.map(row => ({ strain: row.strain.trim() || unnamed, count: row.count }));

export const growBody = (draft: Draft, name: string, scheme: GrowScheme | null, unnamed: string): GrowCreate => ({
  name,
  type: draft.type,
  startedAt: instantOf(DateTime.fromJSDate(draft.startedAt)),
  spaceId: draft.spaceId,
  plants: plantsOf(draft.plants, unnamed),
  scheme,
});

export interface Told {
  key: string;
  values?: Record<string, string>;
  /** A line about something the tap would disturb, which is said beside the button as well rather than left below the fold. */
  warns?: boolean;
}

/** The chosen place, as the sentences under the chips need to know it. */
export interface TellPlace {
  name: string;
  /** Whether a device steers a climate here; null where the hardware could not be read, which is a state and not "nothing". */
  steered: boolean | null;
  /** The name of the grow already standing here, which a second one would join. */
  standing: string | null;
  /** True where this sheet writes the place's climate itself, which is what pauses a plan running there. */
  writesClimate: boolean;
}

/**
 * What the choices come to, in the order the board prints them: what is already
 * growing where the plants are going, which place is put on which preset now,
 * what the tag on the phases that follow means, and what an autoflower changes
 * about both. Sentences, because what a preset changes is easier to read than
 * to tabulate.
 */
export const tells = (draft: Draft, place: TellPlace | null, stageName: string): Told[] => {
  const told: Told[] = [];

  if (place === null) told.push({ key: 'grow.new.tells.nowhere' });
  else {
    if (place.standing !== null) {
      told.push({
        key: place.writesClimate ? 'grow.new.tells.occupiedSteered' : 'grow.new.tells.occupied',
        values: { grow: place.standing, place: place.name, stage: stageName },
        warns: true,
      });
    }
    if (place.steered === null) told.push({ key: 'grow.new.tells.hardwareUnknown', values: { place: place.name } });
    else if (place.steered) told.push({ key: 'grow.new.tells.preset', values: { place: place.name, stage: stageName } });
    else told.push({ key: 'grow.new.tells.noController', values: { place: place.name } });
  }

  if (place !== null) told.push({ key: 'grow.new.tells.auto' });
  if (draft.type === 'autoflower') told.push({ key: draft.schemeId === null ? 'grow.new.tells.autoflowerAlone' : 'grow.new.tells.autoflower' });

  return told;
};
