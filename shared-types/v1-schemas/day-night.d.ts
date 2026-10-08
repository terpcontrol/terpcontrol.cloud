/**
 * Day and night as a fridge and a tent controller keep them, in the one place
 * the server, the screens and the simulator read it from.
 *
 * The firmware decides by the clock and by nothing else. Its document holds two
 * times of day as seconds past midnight UTC - `daynight.day`, when the light
 * comes on, and `daynight.night`, when it goes off - and about once a second it
 * compares the UTC time of day with them, strictly: between the two it is day,
 * otherwise night, a window that runs past midnight wrapping round it, and two
 * equal times never being day at all. In the day the lamp ramps up to its limit
 * and down again inside the window, the day's figures hold and CO2 is dosed; at
 * night the night's figures hold. Whether the lamp really shines meanwhile - a
 * limit of 0 %, a lamp held off from the cloud, a lamp the heat dimmed, 15 % in
 * maintenance - changes nothing about which figures hold.
 *
 * The work mode decides whether there is a day at all. The standard modes and
 * the greenhouse mode run the schedule; drying and germination hold the night's
 * figures round the clock in the dark; switched off, nothing is held.
 *
 * A fridge glides its targets between the two halves while the lamp ramps
 * (`daynight.linearChange`, which the server always writes); a controller
 * switches them with the clock.
 *
 * A smart plug compares the same two times the same way, and acts on them only
 * where its document says to (`plugScheduleOf`).
 *
 * No schema, and nothing imported but the schema-free reading of a document,
 * so a client and the simulator can share the arithmetic without pulling zod
 * and the whole contract in.
 */
export declare const DAY_SECONDS: number;
/** Seconds round the clock: 25:00 is 01:00, and an hour before 00:30 is 23:30. */
export declare const roundTheClock: (seconds: number) => number;
/**
 * The window every firmware - a fridge's, a controller's, a socket's, a fan's
 * and a lamp's - runs where its document states none: on at 06:00, off at
 * 22:00 UTC.
 */
export declare const FIRMWARE_LIGHTS_ON: number;
export declare const FIRMWARE_LIGHTS_OFF: number;
/** Minutes of each dimming ramp where a fridge's or a controller's document states none. */
export declare const FIRMWARE_RAMP_MINUTES = 15;
/**
 * How long after a switch between day and night the climate is given to follow
 * the new half's targets before it is judged against them alone.
 *
 * A fridge needs about forty minutes to come down from a day of 25 °C to a
 * night of 21 °C, and a tent warms up after the lamp comes on. Judged against
 * the new half from the second it begins, every evening read "too warm since
 * 20:02" and every morning "too cold since 08:02", which is the device doing
 * exactly what it was told. Meanwhile a reading anywhere between the two halves'
 * bands is on target; one outside both is not.
 */
export declare const SETTLE_SECONDS: number;
/**
 * Where 24 hours of light are written: both times past any time of day, the
 * night one second before the day.
 *
 * The firmware cannot be told "always" in so many words. Two equal times are
 * always night, and a window one second short of a day - what was written for
 * 24 hours before - left two seconds of night a day, with the evening ramp
 * dimming the lamp to nothing before them and the morning ramp bringing it back
 * after: a dip of half an hour every day, the fridge gliding its targets towards
 * the night meanwhile and its CO2 stopping. With the day starting after the
 * night and the night beyond any second of the clock, its own comparisons find
 * every second to be day, the evening ramp never begins (the night is further
 * away than any ramp is long) and the morning ramp's factor overflows to full.
 * The hour the light came on is kept in the times, so going back to a
 * photoperiod starts from it.
 */
export declare const ALWAYS_LIT_FROM: number;
/** The light schedule as a person sets it. */
export interface LightWindow {
    /** When the light comes on, in seconds past midnight UTC. */
    lightsOn: number;
    /** How long it stays on, in hours, to the minute: 0 is always night, 24 always day. */
    lightHours: number;
}
/**
 * The window two times of a document make, read the way the firmware reads
 * them: whatever they are, the hours are the ones it runs as day. A light that
 * goes off at the second it comes on is no light at all, and one a second or
 * two short of a day - as 24 hours used to be written - is a whole day.
 * Missing times are the firmware's own.
 */
export declare const lightWindowOf: (day: number | null | undefined, night: number | null | undefined) => LightWindow;
/**
 * The two times to write for a window: the one place they are worked out, for
 * the targets page, a preset, a plan step and the clocks changing alike.
 *
 * - 24 hours is a day that never ends (see `ALWAYS_LIT_FROM`).
 * - 0 hours is the light coming on and going off at the same second, which the
 *   firmware reads as always night.
 * - A light that goes off at midnight UTC on the dot goes off a second before
 *   it. The firmware works its evening ramp out without going round the clock,
 *   so at 0 it found the ramp running all day, clamped it to full and dropped it:
 *   the lamp went out hard, a fridge stopped gliding into the night, and the CO2
 *   it should stop during the ramp ran on to the last second.
 */
export declare const lightWindowTimes: (window: LightWindow) => {
    day: number;
    night: number;
};
/**
 * When the light goes off, in seconds past midnight UTC, for saying it and for
 * drawing it: the hour it comes on again for a light that never goes off, or
 * never comes on. The times a document is written with are another matter - a
 * whole day, no day and a light off at midnight UTC each have their own form
 * there (`lightWindowTimes`).
 */
export declare const lightsOffOf: (window: LightWindow) => number;
/** What the firmware decides a fridge's or a controller's day and night from, as its document states it. */
export interface Cycle {
    /** The two times as the document holds them (see `lightWindowOf`). */
    day: number;
    night: number;
    /** The work mode; null where the document states none, which is read as the standard mode. */
    workmode: string | null;
    /** Minutes of the dimming ramps inside the day. */
    sunrise: number;
    sunset: number;
    /** Whether the targets glide between the halves while the lamp ramps: a fridge with `daynight.linearChange`. */
    glides: boolean;
}
/**
 * The modes that run a day and a night by the clock. The firmware treats any
 * word it does not know as off, and the fridge's experimental mode runs the
 * clock with every output off.
 */
export declare const SCHEDULED_MODES: readonly string[];
/** The cycle a document runs, or null for hardware that keeps none and for no document at all. */
export declare const cycleOf: (type: string, configuration: Record<string, unknown> | null | undefined) => Cycle | null;
/**
 * What a cycle amounts to.
 *
 * - `schedule`: a day and a night by the clock.
 * - `always_day`, `always_night`: 24 and 0 hours of light - one half held round the clock.
 * - `drying`, `germination`: the night's figures held round the clock in the dark.
 * - `off`: nothing held at all.
 */
export type CycleKind = 'schedule' | 'always_day' | 'always_night' | 'drying' | 'germination' | 'off';
export declare const cycleKindOf: (cycle: Cycle) => CycleKind;
/** The UTC time of day of an instant, in whole seconds: the firmware's own clock. */
export declare const utcSecondsOf: (at: number) => number;
/** Whether the firmware calls this second of the clock day, by its own strict comparisons. Only the times; the work mode is the caller's. */
export declare const isDayAt: (cycle: Pick<Cycle, "day" | "night">, seconds: number) => boolean;
/**
 * The day and night a smart plug keeps, or null where it keeps none: the two
 * times of its document, to be read with `isDayAt`.
 *
 * Its firmware works its day out about once a second with the comparisons
 * above, in every work mode, from `daynight.day` and `daynight.night` (on at
 * 06:00 and off at 22:00 UTC where the document states none). Only with
 * `usedaynight` does anything follow it - the night's switch points after dark,
 * and CO2 dosed by day only. Without it, the firmware's default, the plug holds
 * its day's switch points round the clock and its day is a figure nothing
 * reads, so it is no schedule here either.
 *
 * A plug has no lamp, and this is what tells its VPD the day from the night
 * where it has one.
 */
export declare const plugScheduleOf: (type: string, configuration: Record<string, unknown> | null | undefined) => Pick<Cycle, "day" | "night"> | null;
/**
 * How far the morning and the evening ramp have come at this second of the
 * day: 1 is the lamp at full and a fridge on its day's figures. Worked out as
 * the firmware works it out - unsigned, without going round the clock - so a
 * ramp that crosses midnight UTC is cut short here exactly as it is on the
 * device.
 */
export declare const rampsAt: (cycle: Cycle, seconds: number) => {
    sunrise: number;
    sunset: number;
};
/** A target a fridge is gliding to: `factor` of the way from the night's figure to the day's. */
export declare const glidingTarget: (day: number, night: number, factor: number) => number;
/** A change from one half's targets to the other's, and the time the climate is given to follow it. */
export interface Transition {
    from: 'day' | 'night';
    to: 'day' | 'night';
    /** Epoch milliseconds: when it began - the start of a fridge's ramp, or the switch - and when the climate is judged against `to` alone again. */
    startsAt: number;
    until: number;
    /** While a fridge's targets glide, how far they have come from the night's figures (0) to the day's (1); null once they have arrived. */
    glide: number | null;
}
/** Where a device stands in its cycle at an instant. */
export interface CycleMoment {
    kind: CycleKind;
    /** Which half's figures hold: the night's in drying and germination, and for a light that never comes on. */
    active: 'day' | 'night';
    /** `constant` where nothing alternates. */
    period: 'day' | 'night' | 'constant';
    /** Epoch milliseconds: when the half began and when it ends; null where nothing alternates. */
    since: number | null;
    until: number | null;
    transition: Transition | null;
}
/** Where a cycle stands at an instant (epoch milliseconds). */
export declare const cycleAt: (cycle: Cycle, at: number) => CycleMoment;
/** A stretch of time, in epoch milliseconds. */
export interface Span {
    from: number;
    to: number;
}
/**
 * The nights of a schedule over a range: the stretches between the light going
 * off and coming on again, which a chart shades and a diary averages apart.
 *
 * Only a schedule has any. Drying, germination and a light that is on or off
 * round the clock hold one climate the whole time - there is no night to tell
 * from a day - and answering them as one long night shaded a whole drying week
 * grey under "the night" and named its band the night's.
 */
export declare const nightsIn: (cycle: Cycle, range: Span) => Span[];
/** When a schedule is changing between its halves over a range (see `SETTLE_SECONDS`); none for anything else. */
export declare const transitionsIn: (cycle: Cycle, range: Span) => Span[];
