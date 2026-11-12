import { DateTime } from 'luxon';
import type { GrowCreate, GrowListItem, GrowthStage } from '@fg2/shared-types/v1';
import { instantOf } from '@/ui/age';

/**
 * What the form that starts a grow decides before it writes. None of it
 * touches the network, so what the form promises can be read - and tested -
 * without a grow being started to find out.
 */

/** The stages a grow can begin in: what is left of the botanical six once the two at the end are gone. */
export const START_STAGES: GrowthStage[] = ['germination', 'seedling', 'vegetative', 'flowering'];

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
 * The grow as it is created: one strain and how many of it, in a place or in
 * none. A count is enough - a plant's label is made from its strain, so one
 * nobody named goes across under a stand-in name rather than being refused.
 * The kind of plant and what it is fed are the grow page's to change.
 */
export const growBody = (plants: { name: string; strain: string; count: number }, spaceId: string | null, startedAt: Date): GrowCreate => ({
  name: plants.name,
  type: 'photoperiod',
  startedAt: instantOf(DateTime.fromJSDate(startedAt)),
  spaceId,
  plants: [{ strain: plants.strain, count: plants.count }],
  scheme: null,
});

/**
 * Whether the stage a new grow begins in is only recorded in a place that
 * already holds a grow. Germination is dark, and the plants growing there need
 * their light: the seeds' darkness is not the default for them. The grower who
 * means it sets "Keimung · dunkel" under Steuerung, where the plants already
 * there are in view.
 */
export const recordsOnly = (stage: GrowthStage, standing: unknown): boolean => stage === 'germination' && standing !== null;
