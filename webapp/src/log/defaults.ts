import type { Entry, EntryDose, EntryReading, FeedEntryValues, GrowListItem, GrowthStage, HumanEntryKind, SchemeWeek } from '@fg2/shared-types/v1';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { useLog, type LogTarget } from './log-context';
import type { MomentBegins } from './Moment';
import { dosesFor, growDayAt, growOriginOf, growWeekAt, schemeWeekOf } from '@fg2/shared-types/v1-schemas/feeding.js';
import { useUpdateGrow } from '@/api/grows';
import { instantOf } from '@/ui/age';
import { enough, growStanding, useMayWith } from '@/ui/session-access';
import { STAGES } from '@/ui/stages';
import { DAY, useZone, zonedAt } from '@/ui/zone';

/**
 * What a kind's view opens on before anybody types anything: the sheet
 * repeats what was done last time rather than asking again - the last can,
 * the scheme at the week the line is dated to, the stage after this one.
 */

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
const lastPour = (entries: Entry[], kind: HumanEntryKind): { litres: number; at: string } | null => {
  const entry = entries.find(one => one.kind === kind && litresOf(one) !== null);
  return entry ? { litres: litresOf(entry)!, at: entry.occurredAt } : null;
};

/**
 * The can a tile opens on, and when it was poured: what that kind last used.
 * A grow that has been watered but never fed still knows how big the can is,
 * so a feed falls back to it rather than asking from nothing.
 */
export const lastCan = (entries: Entry[], kind: HumanEntryKind): { litres: number; at: string } | null =>
  kind === 'feed' ? (lastPour(entries, 'feed') ?? lastPour(entries, 'water')) : lastPour(entries, kind);

export const readingsOf = (entry: Entry | null): EntryReading[] => (entry && 'readings' in entry.values ? entry.values.readings : []);

/**
 * The row of the grid the grow was standing on at that moment - which is the
 * moment the line is dated to, not this one, so a feed written down for last
 * Sunday is dosed the way last Sunday was. Null without a scheme, null before
 * the grow's first phase, and null past the end of a grid.
 */
export const schemeStep = (grow: GrowListItem | undefined, at: Date): SchemeWeek | null =>
  grow?.scheme && grow.summary.weekNumber !== null ? schemeWeekOf(grow.scheme.grid, growWeekAt(growOriginOf(grow), at, grow.summary.zone)) : null;

/**
 * The doses one can of water takes, worked out with the very function the
 * server resolves a logged feed with - so the sheet promises what the entry
 * records, down to the rounding.
 */
export const dosesOf = (grow: GrowListItem | undefined, litres: number | null, at: Date): EntryDose[] =>
  dosesFor(schemeStep(grow, at), litres, grow?.scheme?.strength ?? 1);

/**
 * The doses a recorded feed is corrected with: what it recorded, and for another can of water the same doses per
 * litre. What went into the can is the fact, so the grid is not read again - it may have been edited, or the grow's
 * start moved, since. A feed recorded without its water has no rate to go by and keeps its doses.
 */
export const keptDoses = (recorded: FeedEntryValues, litres: number | null): EntryDose[] =>
  recorded.litres && litres && litres !== recorded.litres
    ? recorded.doses.map(dose => ({ ...dose, amount: Math.round(((dose.amount * litres) / recorded.litres!) * 100) / 100 }))
    : recorded.doses;

/**
 * Which day of the grow the line will be filed under, which is not today's
 * where it has been backdated: the day the sheet promises has to be the day the
 * entry lands on. A place that is not a grow has no day at all.
 */
export const dayAt = (grow: GrowListItem | undefined, target: LogTarget, at: Date): number | null =>
  grow && target.dayNumber !== null ? growDayAt(growOriginOf(grow), at, grow.summary.zone) : target.dayNumber;

/**
 * Where the date the grow began on begins, on its owner's calendar: the start
 * of day 1. A line dated to before it has no day of the grow to stand under.
 */
const growBegan = (grow: GrowListItem): Date => DateTime.fromJSDate(growOriginOf(grow), { zone: grow.summary.zone }).startOf('day').toJSDate();

/**
 * What the moment of a line about a grow is held to: where the grow began,
 * and how its start is moved there by somebody who may manage it. Null for a
 * line about a place, which has no first day. A start moved is answered with
 * the day it is now and the start it had, one write away: what stood on the
 * start moves back with it, as it moved with it.
 */
export const useGrowBegins = (grow: GrowListItem | undefined, target: LogTarget | null): MomentBegins | null => {
  const { t } = useTranslation();
  const zone = useZone();
  const { tell } = useLog();
  const move = useUpdateGrow(grow?.id ?? '');
  const mayManage = enough(useMayWith()(growStanding(grow ?? { ownerId: null, placements: [] })), 'manage');
  if (!grow || !target?.growId) return null;

  const startOn = (startedAt: string) => move.mutateAsync({ startedAt });
  const said = (startedAt: string) => t('grow.told.start', { date: zonedAt(Date.parse(startedAt), zone).toFormat(DAY) });
  const moveTo = async (to: Date) => {
    const startedAt = instantOf(DateTime.fromJSDate(to));
    await startOn(startedAt);
    tell({ label: said(startedAt), undo: () => startOn(grow.startedAt), undone: said(grow.startedAt), from: `start-${grow.id}` });
  };

  return { at: growBegan(grow), move: mayManage ? moveTo : null };
};

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

/**
 * The first week after this one whose grid doses the product, which is what a
 * product left out this week is waiting for: Bio·Bloom in week 3 of a scheme
 * that starts it in week 4 is "from week 4", not a product already stopped.
 */
export const startsAfter = (grow: GrowListItem | undefined, productKey: string, week: number): number | null => {
  const later = (grow?.scheme?.grid ?? []).filter(
    row => row.week > week && row.amounts.some(amount => amount.productKey === productKey && amount.value !== null),
  );

  return later.length === 0 ? null : Math.min(...later.map(row => row.week));
};
