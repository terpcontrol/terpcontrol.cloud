import { DateTime } from 'luxon';
import type { Metric, SpaceTimeline, TimelineAlarm, TimelinePanel, TimelineSpan, TimelineTarget, TimelineTargets } from '@fg2/shared-types/v1';

/**
 * The arithmetic the stacked panels share: where an instant sits in the window,
 * what was true there, and what a panel's y scale is. All of it is pure, so the
 * cursor can be moved a hundred times a second without touching the chart.
 */

export const at = (iso: string): number => new Date(iso).getTime();

const HOUR_MS = 60 * 60 * 1000;

/**
 * How a moment inside the window is written. A window of a day needs the clock
 * and nothing else; over a week the hour alone would not say which day, and
 * over a grow not even the weekday would.
 */
export const stampOf = (time: number, span: number): string => {
  const stamp = DateTime.fromMillis(time);
  if (span <= 36 * HOUR_MS) return stamp.toFormat('HH:mm');
  if (span <= 10 * 24 * HOUR_MS) return stamp.toFormat('ccc HH:mm');
  return stamp.toFormat('d MMM HH:mm');
};

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
 */
export const scaleOf = (panel: TimelinePanel, stretches: Stretch[]): Scale => {
  const values = [
    ...panel.points.flatMap(point => (point.value === null ? [] : [point.value])),
    ...stretches.flatMap(stretch => [stretch.target.band.low, stretch.target.band.high]),
  ];
  if (values.length === 0) return { low: 0, high: 1 };

  const low = Math.min(...values);
  const high = Math.max(...values);
  const step = niceStep(Math.max(high - low, Math.abs(high) * 0.02, 0.1) / 4);

  return { low: Math.floor(low / step - 0.4) * step, high: Math.ceil(high / step + 0.4) * step };
};

/** 1, 2, 5 or 10 of whatever size the span is, so both corners read as round numbers. */
const niceStep = (rough: number): number => {
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const steps = [1, 2, 5, 10].map(one => one * magnitude);

  return steps.find(one => one >= rough) ?? magnitude * 10;
};

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
