import { DateTime } from 'luxon';
import type { Metric, SpaceTimeline, TimelineAlarm, TimelinePanel, TimelineSpan, TimelineTarget, TimelineTargets } from '@fg2/shared-types/v1';
import { niceScale } from '@/charts/series';

/**
 * The arithmetic the stacked panels share: where an instant sits in the window,
 * what was true there, and what a panel's y scale is. All of it is pure, so the
 * cursor can be moved a hundred times a second without touching the chart.
 */

export const at = (iso: string): number => new Date(iso).getTime();

const HOUR_MS = 60 * 60 * 1000;

/**
 * How a moment inside a window is written, from the narrowest that still says
 * which moment it is to the widest. Each entry says strictly more than the one
 * before it, which is what lets a label be widened from the one a span picked
 * until two of them can no longer be read as the same instant.
 */
export const STAMPS = ['HH:mm', 'ccc HH:mm', 'd MMM HH:mm', 'd MMM yyyy HH:mm'] as const;

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

export const stampOf = (time: number, span: number): string => DateTime.fromMillis(time).toFormat(STAMPS[stampFor(span)]);

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
export const captureOf = (time: number, span: number): string =>
  DateTime.fromMillis(time).toFormat(span <= 10 * 24 * HOUR_MS ? 'ccc HH:mm' : 'd MMM HH:mm');

/** The same rule for the axis, where the clock stops being worth the room a wide window gives it. */
export const stopOf = (time: number, span: number): string => {
  const stamp = DateTime.fromMillis(time);
  if (span <= 36 * HOUR_MS) return stamp.toFormat('HH:mm');
  if (span <= 10 * 24 * HOUR_MS) return stamp.toFormat('ccc');
  return stamp.toFormat('d MMM');
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
 * cut by the light. Day and night are aimed at differently, so a window drawn
 * against one of them would show half of it as a long fall out of band.
 */
export interface Stretch {
  from: number;
  to: number;
  target: TimelineTarget;
}

export const stretchesOf = (panel: TimelinePanel, nights: TimelineSpan[], from: number, to: number): Stretch[] =>
  cut(from, to, nights, panel.targets).flatMap(piece => {
    const targets = panel.targets.find(one => at(one.startsAt) <= piece.from && at(one.endsAt) >= piece.to);
    const target = targets ? (piece.dark ? targets.night : targets.day) : null;

    return target ? [{ from: piece.from, to: piece.to, target }] : [];
  });

/**
 * The window split where the light went off and on again, and where one phase
 * handed over to the next. Both edges have to cut it: a band that only moved
 * with the lamp would carry the old phase's target through the half of the
 * cycle the grow was moved on in.
 */
const cut = (from: number, to: number, nights: TimelineSpan[], targets: TimelineTargets[]): { from: number; to: number; dark: boolean }[] => {
  const inside = [...nights, ...targets].flatMap(span => [at(span.startsAt), at(span.endsAt)]).filter(edge => edge > from && edge < to);
  const edges = [...new Set([from, ...inside, to])].sort((one, other) => one - other);

  return edges.slice(0, -1).map((edge, index) => ({ from: edge, to: edges[index + 1], dark: spans(nights, (edge + edges[index + 1]) / 2) }));
};

/** The target that held at the cursor, which is the band the panel header names. */
export const targetAt = (panel: TimelinePanel, nights: TimelineSpan[], from: number, to: number, time: number): TimelineTarget | null =>
  stretchesOf(panel, nights, from, to).find(stretch => stretch.from <= time && time <= stretch.to)?.target ?? null;

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
export const frameAt = (camera: SpaceTimeline['cameras'][number] | undefined, time: number) => {
  if (!camera || camera.frames.length === 0) return null;
  let found = camera.frames[0];
  for (const frame of camera.frames) {
    if (at(frame.capturedAt) > time) break;
    found = frame;
  }
  return found;
};
