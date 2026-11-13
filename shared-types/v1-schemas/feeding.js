"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dosesFor = exports.growWeekAt = exports.growWeekOfDay = exports.growDayUpTo = exports.growDayAt = exports.growOriginOf = exports.schemeWeekOf = void 0;
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
const schemeWeekOf = (grid, weekNumber) => grid.find(week => week.week === weekNumber) ?? null;
exports.schemeWeekOf = schemeWeekOf;
const DAY_MS = 24 * 60 * 60 * 1000;
const moment = (at) => new Date(at).getTime();
/**
 * The instant a grow began: when it started or its earliest phase, whichever
 * came first. The date it falls on is day 1 (`growDayAt`), and the day counter,
 * the diary's days and the report all count from it - diary lines written
 * before the first phase belong to the grow as much as the ones after it.
 */
const growOriginOf = (grow) => new Date(Math.min(moment(grow.startedAt), ...grow.phases.map(phase => moment(phase.startedAt))));
exports.growOriginOf = growOriginOf;
/** One formatter per zone: building one costs far more than asking it for a date. */
const calendars = new Map();
const calendarOf = (zone) => {
    const key = zone || 'UTC';
    let calendar = calendars.get(key);
    if (!calendar) {
        try {
            calendar = new Intl.DateTimeFormat('en-CA', { timeZone: key, year: 'numeric', month: 'numeric', day: 'numeric' });
        }
        catch {
            // A zone nobody knows counts as UTC, which is what an account starts on.
            calendar = calendarOf(null);
        }
        calendars.set(key, calendar);
    }
    return calendar;
};
/** The date an instant falls on in a zone, as a count of days - so two of them subtract to the dates between. */
const dateIn = (at, zone) => {
    const said = (type, parts) => Number(parts.find(part => part.type === type)?.value);
    const parts = calendarOf(zone).formatToParts(at);
    return Date.UTC(said('year', parts), said('month', parts) - 1, said('day', parts)) / DAY_MS;
};
/**
 * A grow's day is a date on its owner's calendar: day 1 is the date the grow
 * began on (`growOriginOf`), whatever the hour, and the day changes at
 * midnight there - so this morning's watering stands under today on every
 * screen. `zone` is the owner's (`summary.zone` on the wire); it is counted in
 * dates and not in hours because a day of the calendar is 23 or 25 hours long
 * twice a year.
 */
const growDayAt = (origin, at, zone) => Math.max(1, dateIn(moment(at), zone) - dateIn(origin.getTime(), zone) + 1);
exports.growDayAt = growDayAt;
/**
 * The day a stretch of the grow ends on: that of the last instant inside it. A
 * window that closes at midnight, or a grow that ended then, has not begun the
 * date after.
 */
const growDayUpTo = (origin, endsAt, zone) => (0, exports.growDayAt)(origin, new Date(Math.max(origin.getTime(), moment(endsAt) - 1)), zone);
exports.growDayUpTo = growDayUpTo;
/**
 * Which week of the grow a day of it falls in: weeks are seven of those days,
 * so week 1 is days 1 to 7 and lines up with a scheme's first row.
 *
 * It takes a *grow* day. Which week of its own stage a day is in is another
 * count, from the stage's start: `stageWeekOf`.
 */
const growWeekOfDay = (day) => Math.floor((day - 1) / 7) + 1;
exports.growWeekOfDay = growWeekOfDay;
/**
 * Which row of the grid the grow is on at that moment.
 *
 * It is here rather than in either consumer for the same reason `dosesFor` is:
 * the sheet reads the row for the day a feed is dated to and the entry writer
 * reads it again as the line arrives, and a line somebody backdated is exactly
 * where two copies of this would disagree.
 */
const growWeekAt = (origin, at, zone) => (0, exports.growWeekOfDay)((0, exports.growDayAt)(origin, at, zone));
exports.growWeekAt = growWeekAt;
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
const dosesFor = (week, litres, strength = 1) => {
    if (!week || litres === null || !Number.isFinite(litres) || litres <= 0)
        return [];
    return week.amounts.flatMap(amount => amount.value === null
        ? []
        : [
            {
                productKey: amount.productKey,
                name: amount.name,
                amount: rounded(amount.value * litres * strength),
                unit: perLitreOff(amount.unit),
            },
        ]);
};
exports.dosesFor = dosesFor;
/**
 * Two decimals. A dose is poured out of a measuring cap, so the third decimal is
 * a digit nobody can act on - and floating point would otherwise put seventeen
 * of them on the screen for 0.1 ml/l of three litres.
 */
const rounded = (value) => Math.round(value * 100) / 100;
const perLitreOff = (unit) => unit.split('/')[0].trim() || unit;
