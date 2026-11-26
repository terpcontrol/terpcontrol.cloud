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
/**
 * The most water one line takes, in litres: more than any tent is given at once, so a figure beyond it is a slip of
 * the finger and is refused - by the form before it is sent, and by the route - rather than written.
 */
export declare const MAX_LITRES = 100;
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
 * The instant a grow began: when it started or its earliest phase, whichever
 * came first. The date it falls on is day 1 (`growDayAt`), and the day counter,
 * the diary's days and the report all count from it - diary lines written
 * before the first phase belong to the grow as much as the ones after it.
 */
export declare const growOriginOf: (grow: GrowDays) => Date;
/**
 * A grow's day is a date on its owner's calendar: day 1 is the date the grow
 * began on (`growOriginOf`), whatever the hour, and the day changes at
 * midnight there - so this morning's watering stands under today on every
 * screen. `zone` is the owner's (`summary.zone` on the wire); it is counted in
 * dates and not in hours because a day of the calendar is 23 or 25 hours long
 * twice a year.
 */
export declare const growDayAt: (origin: Date, at: string | Date, zone: string | null) => number;
/**
 * The day a stretch of the grow ends on: that of the last instant inside it. A
 * window that closes at midnight, or a grow that ended then, has not begun the
 * date after.
 */
export declare const growDayUpTo: (origin: Date, endsAt: string | Date, zone: string | null) => number;
/**
 * Which week of the grow a day of it falls in: weeks are seven of those days,
 * so week 1 is days 1 to 7 and lines up with a scheme's first row.
 *
 * It takes a *grow* day. Which week of its own stage a day is in is another
 * count, from the stage's start: `stageWeekOf`.
 */
export declare const growWeekOfDay: (day: number) => number;
/**
 * Which row of the grid the grow is on at that moment.
 *
 * It is here rather than in either consumer for the same reason `dosesFor` is:
 * the sheet reads the row for the day a feed is dated to and the entry writer
 * reads it again as the line arrives, and a line somebody backdated is exactly
 * where two copies of this would disagree.
 */
export declare const growWeekAt: (origin: Date, at: string | Date, zone: string | null) => number;
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
