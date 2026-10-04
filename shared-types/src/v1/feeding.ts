import type { z } from 'zod';
import type { schemeWeek } from './common.js';
import type { entryDose } from './diary.js';

type SchemeWeek = z.infer<typeof schemeWeek>;
type EntryDose = z.infer<typeof entryDose>;

/**
 * Turning a feeding grid into the doses that go into the can, and working out
 * which row of it a given day of a grow is.
 *
 * Two parties have to get the same numbers out of the same grid: the feed sheet,
 * which draws them beside the water before anybody taps anything, and the
 * server, which resolves a feed logged as planned into the doses it stores. A
 * board that did its own arithmetic and a server that did its own would agree
 * until the day one of them rounded differently, and the entry would then say
 * something the person never saw.
 *
 * So it is stated once, here, beside the grid it reads - and what the server
 * writes down is the *result*, never the grid: a scheme edited next month leaves
 * every line already written alone.
 */

/** The row a grid states for that week, or nothing where it states none. */
export const schemeWeekOf = (grid: readonly SchemeWeek[], weekNumber: number): SchemeWeek | null =>
  grid.find(week => week.week === weekNumber) ?? null;

const DAY_MS = 24 * 60 * 60 * 1000;

const moment = (at: string | Date): number => new Date(at).getTime();

/** As much of a grow as its own calendar is read from. Instants are ISO strings on the wire and dates in the database. */
export interface GrowDays {
  startedAt: string | Date;
  phases: readonly { startedAt: string | Date }[];
}

/**
 * Where a grow's day 1 begins: the day it started or its earliest phase,
 * whichever came first. The day counter, the week cards, the diary's day stamps
 * and the report all count from this one instant - diary lines written before
 * the first phase belong to the grow as much as the ones after it.
 */
export const growOriginOf = (grow: GrowDays): Date => new Date(Math.min(moment(grow.startedAt), ...grow.phases.map(phase => moment(phase.startedAt))));

/**
 * A grow's day does not begin at midnight. Day 1 begins the moment the first
 * phase did, because a grow begun at 23:00 would otherwise be two days old
 * within the hour.
 */
export const growDayAt = (origin: Date, at: string | Date): number => Math.max(1, Math.floor((moment(at) - origin.getTime()) / DAY_MS) + 1);

/**
 * Which row of the grid the grow is on at that moment: weeks are seven of those
 * days, so week 1 is days 1 to 7 and lines up with a scheme's first row.
 *
 * It is here rather than in either consumer for the same reason `dosesFor` is:
 * the sheet reads the row for the day a feed is dated to and the entry writer
 * reads it again as the line arrives, and a line somebody backdated is exactly
 * where two copies of this would disagree.
 */
export const growWeekAt = (origin: Date, at: string | Date): number => Math.floor((growDayAt(origin, at) - 1) / 7) + 1;

/**
 * The doses one can of water takes, at this week and this strength.
 *
 * A product the week prints no figure for is not this week's and is left out
 * rather than dosed at zero: a can with no Bio·Grow in it and a can with 0 ml of
 * it are the same can, and the row the sheet greys out is "stops week 4".
 *
 * `unit` loses the per-litre the grid states its figures in - `ml/l` becomes
 * `ml` - because that is what the multiplication did. A grid unit with no `/`
 * in it is a figure that was never per litre, so it is dosed as it stands.
 */
export const dosesFor = (week: SchemeWeek | null, litres: number | null, strength = 1): EntryDose[] => {
  if (!week || litres === null || !Number.isFinite(litres) || litres <= 0) return [];

  return week.amounts.flatMap(amount =>
    amount.value === null
      ? []
      : [
          {
            productKey: amount.productKey,
            name: amount.name,
            amount: rounded(amount.value * litres * strength),
            unit: perLitreOff(amount.unit),
          },
        ],
  );
};

/**
 * Two decimals. A dose is poured out of a measuring cap, so the third decimal is
 * a digit nobody can act on - and floating point would otherwise put seventeen
 * of them on the screen for 0.1 ml/l of three litres.
 */
const rounded = (value: number): number => Math.round(value * 100) / 100;

const perLitreOff = (unit: string): string => unit.split('/')[0].trim() || unit;
