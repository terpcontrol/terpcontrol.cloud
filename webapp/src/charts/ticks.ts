import type { DateTime, DurationLikeObject } from 'luxon';
import { CLOCK, zonedAt } from '@/ui/zone';

/**
 * The gridlines of a chart over time: instants a reader counts by - the full
 * hour, midnight, the first of a month - rather than the window cut into equal
 * parts, which lands on 14:51 and 20:51 and says nothing a clock does.
 *
 * The old charts drew such lines at every scale, and a chart with only its two
 * ends written under it left a reader of a week counting days by eye. So the
 * step is the finest one that still leaves each label room, the lines fall where
 * the account's clock and calendar turn over, and each label says only what
 * the line adds: an hour within a day, the weekday at a midnight, a date where
 * the window runs past a week.
 */
export interface Tick {
  at: number;
  label: string;
}

type Unit = 'minute' | 'hour' | 'day' | 'month' | 'year';

interface Step {
  unit: Unit;
  count: number;
  /** Roughly how long the step is, to pick it by. */
  ms: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const STEPS: Step[] = [
  ...[5, 10, 15, 30].map(count => ({ unit: 'minute' as const, count, ms: count * MINUTE })),
  ...[1, 2, 3, 6, 12].map(count => ({ unit: 'hour' as const, count, ms: count * HOUR })),
  ...[1, 2, 7, 14].map(count => ({ unit: 'day' as const, count, ms: count * DAY })),
  ...[1, 2, 3, 6].map(count => ({ unit: 'month' as const, count, ms: count * 30 * DAY })),
  { unit: 'year', count: 1, ms: 365 * DAY },
];

/** How much room a label wants beside the window's two ends, which is what decides how many of them fit across a plot. */
export const TICK_ROOM_PX = 72;

/**
 * And on a row of its own. A phone's plot is a quarter of a metre of glass
 * with the two ends of the window written under it, and between "25. Sep 16:04"
 * and "2. Okt 16:04" there was no room left for a single date: a week and a
 * month were read without one. There the gridlines are named on a row of their
 * own, where a date needs only its own width and a little air.
 */
export const NARROW_TICK_ROOM_PX = 52;

/** Below this width a plot's gridlines are named on that row of their own. */
export const NARROW_PLOT_PX = 480;

/**
 * How many lines a plot of this width carries at most: never fewer than two,
 * and never so many that the plot turns into a grid. Not rounded down, because
 * what has to fit is the room between two lines: four weeks of a month are 58
 * pixels apart on a phone, and a fifth of a line short of five is still room
 * for every one of them.
 */
export const ticksFor = (widthPx: number, room = TICK_ROOM_PX): number => Math.min(10, Math.max(2, widthPx / room));

/** The first instant at or after `from` that a step of this kind starts on, in the account's zone. */
const firstOn = (from: number, step: Step, zone: string | null): DateTime => {
  const start = zonedAt(from, zone);
  switch (step.unit) {
    case 'minute': {
      const floor = start.startOf('hour');
      return floor.plus({ minutes: Math.ceil(start.diff(floor, 'minutes').minutes / step.count) * step.count });
    }
    case 'hour': {
      const floor = start.startOf('day');
      return floor.plus({ hours: Math.ceil(start.diff(floor, 'hours').hours / step.count) * step.count });
    }
    case 'day':
      // A week is counted from a Monday, a fortnight too; a day or two from the next midnight.
      return step.count >= 7
        ? start.startOf('week').plus({ weeks: start.equals(start.startOf('week')) ? 0 : 1 })
        : start.equals(start.startOf('day'))
          ? start
          : start.startOf('day').plus({ days: 1 });
    case 'month': {
      const floor = start.startOf('year');
      const months = Math.ceil(start.diff(floor, 'months').months / step.count) * step.count;
      return floor.plus({ months });
    }
    case 'year':
      return start.equals(start.startOf('year')) ? start : start.startOf('year').plus({ years: 1 });
  }
};

const plusOne = (step: Step): DurationLikeObject => ({ [`${step.unit}s`]: step.count });

/** What a line says, given the step and the width of the window it is drawn across. */
const labelOf = (time: DateTime, step: Step, span: number, dayInYear: string): string => {
  if (step.unit === 'minute' || step.unit === 'hour') {
    if (time.hour !== 0 || time.minute !== 0) return time.toFormat(CLOCK);
    // Midnight is the day turning over, which is what the line is there to show.
    return span <= 7 * DAY ? time.toFormat('ccc') : time.toFormat(dayInYear);
  }
  // A week of days is read by weekday, and the day of the month beside it in the reader's own way ("So 27.", "Sun 27").
  if (step.unit === 'day')
    return step.count === 1 && span <= 8 * DAY ? `${time.toFormat('ccc')} ${time.toFormat(dayInYear.split(' ')[0])}` : time.toFormat(dayInYear);
  if (step.unit === 'month') return time.month === 1 ? time.toFormat('yyyy') : time.toFormat('LLL');

  return time.toFormat('yyyy');
};

/**
 * The lines of a window between two instants, at most `most` of them.
 *
 * `dayInYear` is the reader's short date ("27. Sep", "27 Sep"); it is handed
 * in rather than imported so that a test can pin it without loading a language.
 */
export const timeTicks = (from: number, to: number, zone: string | null, most: number, dayInYear: string): Tick[] => {
  const span = to - from;
  if (!(span > 0) || most < 1) return [];
  const step = STEPS.find(one => span / one.ms <= most) ?? STEPS[STEPS.length - 1];
  // A line hard against either end says what the end already says, and its label would sit on the end's.
  const margin = span * 0.04;
  const ticks: Tick[] = [];

  for (let time = firstOn(from, step, zone); time.toMillis() < to && ticks.length <= most + 1; time = time.plus(plusOne(step))) {
    const at = time.toMillis();
    if (at <= from + margin || at >= to - margin) continue;
    ticks.push({ at, label: labelOf(time, step, span, dayInYear) });
  }

  return ticks;
};
