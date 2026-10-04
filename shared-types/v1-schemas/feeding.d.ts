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
export declare const schemeWeekOf: (grid: readonly SchemeWeek[], weekNumber: number) => SchemeWeek | null;
/** As much of a grow as its own calendar is read from. Instants are ISO strings on the wire and dates in the database. */
export interface GrowDays {
    startedAt: string | Date;
    phases: readonly {
        startedAt: string | Date;
    }[];
}
/**
 * Where a grow's day 1 begins: the day it started or its earliest phase,
 * whichever came first. The day counter, the week cards, the diary's day stamps
 * and the report all count from this one instant - diary lines written before
 * the first phase belong to the grow as much as the ones after it.
 */
export declare const growOriginOf: (grow: GrowDays) => Date;
/**
 * A grow's day does not begin at midnight. Day 1 begins the moment the first
 * phase did, because a grow begun at 23:00 would otherwise be two days old
 * within the hour.
 */
export declare const growDayAt: (origin: Date, at: string | Date) => number;
/**
 * Which row of the grid the grow is on at that moment: weeks are seven of those
 * days, so week 1 is days 1 to 7 and lines up with a scheme's first row.
 *
 * It is here rather than in either consumer for the same reason `dosesFor` is:
 * the sheet reads the row for the day a feed is dated to and the entry writer
 * reads it again as the line arrives, and a line somebody backdated is exactly
 * where two copies of this would disagree.
 */
export declare const growWeekAt: (origin: Date, at: string | Date) => number;
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
export declare const dosesFor: (week: SchemeWeek | null, litres: number | null, strength?: number) => EntryDose[];
export {};
