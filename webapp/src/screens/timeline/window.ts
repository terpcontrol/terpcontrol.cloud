import type { Metric, SpaceTimeline, TimelineAlarm, TimelinePanel, TimelineSpan, TimelineTarget, TimelineTargets } from '@fg2/shared-types/v1';
import { niceScale } from '@/charts/series';
import { HOUR_MS } from '@/ui/days';
import { CLOCK, DATED_CLOCK, DATED_CLOCK_WITH_YEAR, DAY_IN_YEAR, zonedAt } from '@/ui/zone';

/**
 * The arithmetic the stacked panels share: where an instant sits in the window,
 * what was true there, and what a panel's y scale is. All of it is pure, so the
 * cursor can be moved a hundred times a second without touching the chart.
 *
 * Everything that writes a moment down takes the zone to write it in, because
 * the axis stops of a week-long window are cut at midnight and midnight is
 * where the account is. A caller with no account to ask - a public window -
 * passes nothing and keeps the browser's.
 */

export const at = (iso: string): number => new Date(iso).getTime();

/**
 * How a moment inside a window is written, from the narrowest that still says
 * which moment it is to the widest. Each entry says strictly more than the one
 * before it, which is what lets a label be widened from the one a span picked
 * until two of them can no longer be read as the same instant.
 */
export const stamps = (): readonly string[] => [CLOCK, `ccc ${CLOCK}`, DATED_CLOCK, DATED_CLOCK_WITH_YEAR];

/**
 * Which of them a window of this width is written with. A window of a day needs
 * the clock and nothing else; over a week the hour alone would not say which
 * day, over a grow not even the weekday would, and over more than a year the
 * month would not say which year.
 */
export const stampFor = (span: number): number => {
  if (span <= 36 * HOUR_MS) return 0;
  if (span <= 10 * 24 * HOUR_MS) return 1;
  return span <= 400 * 24 * HOUR_MS ? 2 : 3;
};

export const stampOf = (time: number, span: number, zone: string | null = null): string => zonedAt(time, zone).toFormat(stamps()[stampFor(span)]);

/**
 * The rung the two ends of a window start at, which is one further on than the
 * rung a moment inside it starts at.
 *
 * A stamp inside a window is read beside everything else on the screen - the
 * range chip, the day counter, the other end of the axis - so the weekday
 * places it. The two ends have nothing beside them and are the only thing on
 * the card that says when it is of, so anything wider than a day and a half
 * names its date: "Tue" to "Sat" says which days of some week and not which
 * week.
 */
export const stampForEnds = (span: number): number => (span <= 36 * HOUR_MS ? 0 : Math.max(2, stampFor(span)));

/** A picture says which day it was taken whatever the window is: it is a thing from a moment rather than the moment itself. */
export const captureOf = (time: number, span: number, zone: string | null = null): string =>
  zonedAt(time, zone).toFormat(span <= 10 * 24 * HOUR_MS ? `ccc ${CLOCK}` : DATED_CLOCK);

/** The same rule for the axis, where the clock stops being worth the room a wide window gives it. */
export const stopOf = (time: number, span: number, zone: string | null = null): string => {
  const stamp = zonedAt(time, zone);
  if (span <= 36 * HOUR_MS) return stamp.toFormat(CLOCK);
  if (span <= 10 * 24 * HOUR_MS) return stamp.toFormat('ccc');
  return stamp.toFormat(DAY_IN_YEAR);
};

/** The most day stops an axis carries, so a week on a phone still has room for each label. */
const MOST_DAY_STOPS = 4;

/**
 * The midnights a window of a few days is labelled at, on the account's
 * clock, or null for a window that is read by the hour or by the month. Quarter
 * points named by their weekday alone put "Sa" a third of the way into a
 * Saturday and no stop on a date, so a grey night could not be told by its
 * day. Every other midnight where there are too many, and none so close to the
 * right end that it would run into "now".
 */
export const daysOnAxis = (from: number, to: number, zone: string | null, live: boolean): number[] | null => {
  const span = to - from;
  if (span <= 36 * HOUR_MS || span > 10 * 24 * HOUR_MS) return null;

  const midnights: number[] = [];
  for (let day = zonedAt(from, zone).startOf('day').plus({ days: 1 }); day.toMillis() < to; day = day.plus({ days: 1 })) {
    midnights.push(day.toMillis());
  }
  const every = Math.ceil(midnights.length / MOST_DAY_STOPS);
  // Counted back from the newest, so the day that is now always carries a stop.
  return midnights.filter((_time, index) => (midnights.length - 1 - index) % every === 0).filter(time => !live || fractionOf(time, from, to) < 0.88);
};

/** "Sa 4." - the day that begins at a midnight of the axis. */
export const dayStopOf = (time: number, zone: string | null, language: string): string => {
  const day = zonedAt(time, zone).setLocale(language);
  return `${day.toFormat('ccc')} ${day.toFormat(language.startsWith('de') ? 'd.' : 'd')}`;
};

/** Where an instant sits across the window, 0 at its left edge and 1 at its right. */
export const fractionOf = (time: number, from: number, to: number): number =>
  to <= from ? 0 : Math.min(1, Math.max(0, (time - from) / (to - from)));

export const spans = (list: TimelineSpan[], time: number): boolean => list.some(span => at(span.startsAt) <= time && time <= at(span.endsAt));

/** The last point at or before the cursor, which is the reading that was true then. */
export const pointAt = (panel: TimelinePanel, time: number): number | null => {
  let found: number | null = null;
  for (const point of panel.points) {
    if (at(point.measuredAt) > time) break;
    found = point.value;
  }
  return found;
};

/**
 * One stretch of the window over which the same target held: a phase's targets
 * cut by the night. Day and night are aimed at differently, so a window drawn
 * against one of them would show half of it as a long fall out of band.
 */
export interface Stretch {
  from: number;
  to: number;
  target: TimelineTarget;
  /** In a night, whose target it is. */
  dark: boolean;
  /**
   * In the hour after a switch between day and night (and a fridge's ramp
   * before it), or after somebody changed the targets: the band reaches over
   * both, which is what the reading is judged by then - a fridge cooling into
   * its night is on its way, not out of band.
   */
  changing: boolean;
  /**
   * One climate held round the clock - a drying room, a germination, 24 or 0
   * hours of light - which has no day and night to tell its band by: what it
   * held instead, which names the band. Null for a day and a night.
   */
  held: ConstantHold | null;
}

/** What a stretch holds where nothing alternates (`TimelineTargets.held`). */
export type ConstantHold = Exclude<NonNullable<TimelineTargets['held']>, 'schedule'>;

const constantOf = (targets: TimelineTargets): ConstantHold | null =>
  targets.held === undefined || targets.held === 'schedule' ? null : targets.held;

/** Both halves' bands as one, around the setpoint of the half the device is changing to; none where either half has none. */
const changingTarget = (to: TimelineTarget | null, other: TimelineTarget | null): TimelineTarget | null =>
  to && other ? { setpoint: to.setpoint, band: { low: Math.min(to.band.low, other.band.low), high: Math.max(to.band.high, other.band.high) } } : null;

export const stretchesOf = (panel: TimelinePanel, nights: TimelineSpan[], from: number, to: number, transitions: TimelineSpan[] = []): Stretch[] =>
  joinedHeld(piecesOf(panel, nights, from, to, transitions));

/** One climate round the clock is one stretch, however often a night or a switch cut the window under it. */
const joinedHeld = (stretches: Stretch[]): Stretch[] =>
  stretches.reduce<Stretch[]>((kept, stretch) => {
    const last = kept.at(-1);
    const same =
      last !== undefined &&
      last.held !== null &&
      last.held === stretch.held &&
      last.changing === stretch.changing &&
      last.to === stretch.from &&
      JSON.stringify(last.target) === JSON.stringify(stretch.target);
    return same ? [...kept.slice(0, -1), { ...last, to: stretch.to }] : [...kept, stretch];
  }, []);

const piecesOf = (panel: TimelinePanel, nights: TimelineSpan[], from: number, to: number, transitions: TimelineSpan[]): Stretch[] =>
  cut(from, to, nights, panel.targets, transitions).flatMap((piece): Stretch[] => {
    const targets = panel.targets.find(one => at(one.startsAt) <= piece.from && at(one.endsAt) >= piece.to);
    if (!targets) return [];

    // One climate round the clock is one band through the whole stretch, whatever the night does.
    const held = constantOf(targets);
    if (held) {
      const target = held === 'always_day' ? targets.day : targets.night;
      return target ? [{ from: piece.from, to: piece.to, target, dark: false, changing: targets.settling === true, held }] : [];
    }

    // The hour after somebody changed the targets comes with its band already
    // reaching over what held before; a switch between the halves is widened here.
    const own = piece.dark ? targets.night : targets.day;
    const target = piece.changing && !targets.settling ? changingTarget(own, piece.dark ? targets.day : targets.night) : own;
    const changing = piece.changing || targets.settling === true;

    return target ? [{ from: piece.from, to: piece.to, target, dark: piece.dark, changing, held: null }] : [];
  });

/**
 * Whether the window holds both a day and a night, which is when a band is
 * worth naming by its half: a window that is night throughout - a drying room,
 * a fridge kept dark - or never is, has one target and no other to tell it
 * from.
 */
export const splitByNight = (nights: TimelineSpan[], from: number, to: number): boolean =>
  nights.some(night => at(night.startsAt) < to && at(night.endsAt) > from) &&
  !nights.some(night => at(night.startsAt) <= from && at(night.endsAt) >= to);

/**
 * The window split where the night began and ended, where one phase handed
 * over to the next, and where a change between day and night began and was
 * over. Each edge has to cut it: a band that only moved with the night would
 * carry the old phase's target through the half of the cycle the grow was
 * moved on in.
 */
const cut = (
  from: number,
  to: number,
  nights: TimelineSpan[],
  targets: TimelineTargets[],
  transitions: TimelineSpan[],
): { from: number; to: number; dark: boolean; changing: boolean }[] => {
  const inside = [...nights, ...targets, ...transitions]
    .flatMap(span => [at(span.startsAt), at(span.endsAt)])
    .filter(edge => edge > from && edge < to);
  const edges = [...new Set([from, ...inside, to])].sort((one, other) => one - other);

  return edges.slice(0, -1).map((edge, index) => {
    const middle = (edge + edges[index + 1]) / 2;
    return { from: edge, to: edges[index + 1], dark: spans(nights, middle), changing: spans(transitions, middle) };
  });
};

/** The target that held at the cursor, which is the band the panel header names. */
export const targetAt = (
  panel: TimelinePanel,
  nights: TimelineSpan[],
  from: number,
  to: number,
  time: number,
  transitions: TimelineSpan[] = [],
): TimelineTarget | null => stretchAt(stretchesOf(panel, nights, from, to, transitions), time)?.target ?? null;

/** The stretch the cursor stands in. */
export const stretchAt = (stretches: Stretch[], time: number): Stretch | null =>
  stretches.find(stretch => stretch.from <= time && time <= stretch.to) ?? null;

/** Only what this panel is about: an alarm the health loop raised without a metric belongs on the rail, not over a curve. */
export const alarmsOf = (alarms: TimelineAlarm[], metric: Metric): TimelineAlarm[] => alarms.filter(alarm => alarm.metric === metric);

export interface Scale {
  low: number;
  high: number;
}

/**
 * What a panel is drawn between: everything measured and everything aimed at,
 * with a little air, rounded outwards to a figure worth printing in the corner.
 *
 * The arithmetic itself is the Charts view's, and is read from there rather
 * than kept a second time here. Two copies of it is how one of them came to be
 * left stopping at the corner the multiplication happened to reach, which
 * ECharts throws on and which cost this screen its whole application; and both
 * screens draw the same metric of the same tent from the same points, so a
 * reader moving between them is owed the same two corner figures anyway.
 */
export const scaleOf = (panel: TimelinePanel, stretches: Stretch[]): Scale =>
  niceScale([
    ...panel.points.flatMap(point => (point.value === null ? [] : [point.value])),
    ...stretches.flatMap(stretch => [stretch.target.band.low, stretch.target.band.high]),
  ]);

/** The frame to show at the cursor: the newest picture taken by then, and the oldest there is before the first one was taken. */
/** The least a picture may stand from the cursor and still be the picture of that moment. */
const FRAME_REACH_MIN = 10 * 60 * 1000;

/**
 * The picture of the moment the cursor is on, or null where the camera took
 * none near it - before it was paired, or in a stretch it could not be read.
 * The nearest picture was shown however far away it was: a cursor on yesterday
 * at 09:52, light off, stood under a lit picture from today at 00:46. Near is
 * twice the camera's usual spacing in the window, so a camera that fires once
 * an hour is not called absent between two of its pictures.
 */
export const frameNear = (camera: SpaceTimeline['cameras'][number] | undefined, time: number) => {
  const frame = frameAt(camera, time);
  if (!camera || !frame) return null;
  const gaps = camera.frames
    .slice(1)
    .map((one, index) => at(one.capturedAt) - at(camera.frames[index].capturedAt))
    .sort((one, other) => one - other);
  const usual = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 0;
  return Math.abs(at(frame.capturedAt) - time) <= Math.max(FRAME_REACH_MIN, 2 * usual) ? frame : null;
};

export const frameAt = (camera: SpaceTimeline['cameras'][number] | undefined, time: number) => {
  if (!camera || camera.frames.length === 0) return null;
  let found = camera.frames[0];
  for (const frame of camera.frames) {
    if (at(frame.capturedAt) > time) break;
    found = frame;
  }
  return found;
};
