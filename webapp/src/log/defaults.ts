import type { Entry, EntryDose, EntryReading, GrowListItem, GrowthStage, HumanEntryKind, SchemeWeek } from '@fg2/shared-types/v1';
import type { LogTarget } from './log-context';
import { dosesFor, growDayAt, growOriginOf, growWeekAt, schemeWeekOf } from '@fg2/shared-types/v1-schemas/feeding.js';
import { STAGES } from '@/ui/stages';

/**
 * What a tile offers before anybody types anything.
 *
 * The captions on the board - "2 L · last 3 d", "Bio·Bloom · wk 5" - are what
 * makes one tap enough: the sheet repeats what was done last time rather than
 * asking again. So it reads the newest line of each kind, and the scheme at the
 * week the grow is in.
 */

export const newestOf = (entries: Entry[], kind: HumanEntryKind): Entry | null => entries.find(entry => entry.kind === kind) ?? null;

/** How much water went in, where the line says. Null is a line that did not record a volume at all. */
export const litresOf = (entry: Entry | null): number | null =>
  (entry?.values.kind === 'water' || entry?.values.kind === 'feed' ? entry.values.litres : null) ?? null;

/**
 * The newest line of that kind that knows how big the can was.
 *
 * Not simply the newest: a watering can be recorded without a volume - a task
 * ticked off writes one, and so does a tap on a tile that had nothing to go by -
 * and one of those in between must not make the tile forget the can that has
 * been used every time before it.
 */
const lastVolume = (entries: Entry[], kind: HumanEntryKind): number | null =>
  litresOf(entries.find(entry => entry.kind === kind && litresOf(entry) !== null) ?? null);

/**
 * The can a tile opens on: what that kind last used. A grow that has been
 * watered but never fed still knows how big the can is, so a feed falls back to
 * it rather than asking from nothing.
 */
export const lastCan = (entries: Entry[], kind: HumanEntryKind): number | null =>
  kind === 'feed' ? (lastVolume(entries, 'feed') ?? lastVolume(entries, 'water')) : lastVolume(entries, kind);

export const readingsOf = (entry: Entry | null): EntryReading[] => (entry && 'readings' in entry.values ? entry.values.readings : []);

/**
 * The row of the grid the grow was standing on at that moment - which is the
 * moment the line is dated to, not this one, so a feed written down for last
 * Sunday is dosed the way last Sunday was. Null without a scheme, null before
 * the grow's first phase, and null past the end of a grid.
 */
export const schemeStep = (grow: GrowListItem | undefined, at: Date): SchemeWeek | null =>
  grow?.scheme && grow.summary.weekNumber !== null ? schemeWeekOf(grow.scheme.grid, growWeekAt(growOriginOf(grow), at)) : null;

/**
 * The doses one can of water takes, worked out with the very function the
 * server resolves a logged feed with - so the sheet promises what the entry
 * records, down to the rounding.
 */
export const dosesOf = (grow: GrowListItem | undefined, litres: number | null, at: Date): EntryDose[] =>
  dosesFor(schemeStep(grow, at), litres, grow?.scheme?.strength ?? 1);

/**
 * Which day of the grow the line will be filed under, which is not today's
 * where it has been backdated: the day the sheet promises has to be the day the
 * entry lands on. A place that is not a grow has no day at all.
 */
export const dayAt = (grow: GrowListItem | undefined, target: LogTarget, at: Date): number | null =>
  grow && target.dayNumber !== null ? growDayAt(growOriginOf(grow), at) : target.dayNumber;

/** The phase after the one the grow is in. Nothing follows curing, and a grow with no phase yet is started elsewhere. */
export const nextStage = (grow: GrowListItem | undefined): GrowthStage | null => {
  const at = grow?.summary.stage ? STAGES.indexOf(grow.summary.stage) : -1;
  return at < 0 || at === STAGES.length - 1 ? null : STAGES[at + 1];
};

/**
 * The last week a grid still gives a product, for the row a week greys out: a
 * product this week prints no figure for is not missing, it is finished.
 */
export const stoppedAfter = (grow: GrowListItem | undefined, productKey: string): number | null => {
  const weeks = (grow?.scheme?.grid ?? []).filter(week => week.amounts.some(amount => amount.productKey === productKey && amount.value !== null));

  return weeks.length === 0 ? null : Math.max(...weeks.map(week => week.week));
};
