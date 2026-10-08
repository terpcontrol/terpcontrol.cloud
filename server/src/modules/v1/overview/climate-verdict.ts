import type {
  ActuatorRuns,
  CardTrend,
  ClimateExcursion,
  ClimateVerdict,
  ClimateVerdictMetric,
  DeviceSeries,
  Metric,
  SeriesPoint,
  Setpoints,
  TargetBand,
  VerdictRating,
} from '@fg2/shared-types/v1';
import { DAY_ONLY, STEERED, TARGET_BAND, VALUE_AGE } from '@fg2/shared-types/v1-schemas';
import { SETTLE_SECONDS, cycleAt, type Cycle } from '@fg2/shared-types/v1-schemas/day-night.js';
import { bandOverRecordAt, type RecordedClimate } from '../device/held-targets';

/**
 * How the last day went, read out of one aggregation.
 *
 * The window is read once - every steered metric, the light and every output in
 * a single series - and every question the verdict answers is then counted off
 * the same points: how much of the time the tent held its band, the runs that
 * left it, and how often each actuator came on. Asking Influx once per question
 * would give four reads that disagree at their edges.
 *
 * Day and night are told apart the way the device tells them apart: by the
 * light schedule and the work mode in its document (`day-night.ts`), whatever
 * the lamp happened to do, and each half is judged against its own targets.
 * Around each switch the climate is given time to follow (`SETTLE_SECONDS`, and
 * a fridge's ramp before it): a reading anywhere between the two halves' bands
 * is in band then, so a fridge cooling into its night is not an excursion every
 * evening. A device with no schedule - an AIR fan - is told apart by its light
 * output where it has one, and otherwise by the half it says it is in now.
 *
 * Each window is judged by what the device aimed at *then*, where its target
 * record says (`held-targets.ts`): a light moved from eight to one o'clock at
 * eleven does not turn the morning that was a day into a night after the fact,
 * and the hour after any change is given to the climate the same way the hour
 * after a switch is - anything between what held before and what holds now.
 *
 * Nothing here reaches for a database, so what the verdict says about a set of
 * points can be read - and tested - as arithmetic.
 */

/** Where the rating turns over, as a share of the time inside the band. */
const GOOD_ABOVE = 0.95;
const WATCH_ABOVE = 0.8;

/**
 * Shorter than this is the controller working rather than an excursion: a
 * hysteresis band crossed for one window would otherwise put thirty "excursions"
 * in a sentence that has room for one. The time still counts against the share -
 * what is suppressed is the naming, not the arithmetic.
 */
const MIN_EXCURSION_SECONDS = 600;

/**
 * A window with no reading is a gap and not a fact, so it neither counts nor
 * interrupts an excursion: a device reporting every five minutes into two-minute
 * windows leaves four empty ones between every sample, and a run broken at each
 * of them would count one excursion as fifty.
 *
 * An excursion does end at a gap longer than the age at which a value counts as
 * offline, because an excursion names an interval - "02:10 to 05:30" - and
 * nobody can say the tent was out of band through hours nothing was heard in.
 * An actuator's run count claims no interval, only that a reading showed it on
 * after one showed it off, so it is carried across any gap: an output is what it
 * was last reported to be until something reports otherwise.
 */
const gapEndsItAfter = (stepSeconds: number): number => Math.max(1, Math.ceil(VALUE_AGE.staleSeconds / Math.max(1, stepSeconds)));

/** How many points the verdict's own line carries. A day at a glance, not the series behind it. */
const TREND_POINTS = 48;

/** A value at or below zero is off, whether the output is a relay or a percentage. */
const isOn = (value: number | null): boolean => value !== null && value > 0;

const bandOf = (target: number | undefined, metric: Metric): TargetBand | null => {
  const tolerance = TARGET_BAND[metric];
  return target === undefined || tolerance === undefined ? null : { low: target - tolerance, high: target + tolerance };
};

const ratingOf = (share: number): VerdictRating => (share > GOOD_ABOVE ? 'good' : share > WATCH_ABOVE ? 'watch' : 'poor');

/** The worst of them, which is what the headline says; null while none of them has a band. */
const worstOf = (ratings: (VerdictRating | null)[]): VerdictRating | null =>
  (['poor', 'watch', 'good'] as const).find(rating => ratings.includes(rating)) ?? null;

interface Run {
  from: number;
  to: number;
  above: boolean;
  extremeValue: number;
}

/** A run of windows outside the band, closed at the last window that was still out. */
const excursionOf = (run: Run, points: SeriesPoint[], stepSeconds: number, open: boolean): ClimateExcursion | null => {
  const windows = run.to - run.from + 1;
  if (windows * stepSeconds < MIN_EXCURSION_SECONDS) return null;

  return {
    startedAt: points[run.from].measuredAt,
    endedAt: open ? null : points[run.to].measuredAt,
    above: run.above,
    extremeValue: run.extremeValue,
  };
};

/** Which half each window was held to, and whether the device was changing between them then. */
type HalfAt = (index: number) => { half: 'day' | 'night'; changing: boolean };

/** The band one window of one metric is judged by, or none where nothing was held for it then. */
type BandAt = (metric: Metric, index: number) => TargetBand | null;

const bandsOf = (metric: Metric, targets: Setpoints | null): { dayBand: TargetBand | null; nightBand: TargetBand | null } => ({
  dayBand: bandOf(targets?.day[metric], metric),
  nightBand: DAY_ONLY.includes(metric) ? null : bandOf(targets?.night[metric], metric),
});

/**
 * The band one window is judged by: its half's, or while the device changes
 * halves both of them as one - and nothing where either half holds no target
 * for the metric, since there is no telling what it should have read.
 */
const bandAt = (halfAt: HalfAt, index: number, bands: { dayBand: TargetBand | null; nightBand: TargetBand | null }): TargetBand | null => {
  const { half, changing } = halfAt(index);
  if (!changing) return half === 'day' ? bands.dayBand : bands.nightBand;

  return bands.dayBand && bands.nightBand
    ? { low: Math.min(bands.dayBand.low, bands.nightBand.low), high: Math.max(bands.dayBand.high, bands.nightBand.high) }
    : null;
};

const countMetric = (
  metric: Metric,
  points: SeriesPoint[],
  stepSeconds: number,
  judgeAt: BandAt,
  targets: Setpoints | null,
): ClimateVerdictMetric => {
  const { dayBand, nightBand } = bandsOf(metric, targets);

  const values = points.map(point => point.value).filter((value): value is number => value !== null);
  const excursions: ClimateExcursion[] = [];
  const endsAfter = gapEndsItAfter(stepSeconds);
  let run: Run | null = null;
  let gap = 0;
  let inWindows = 0;
  let outWindows = 0;

  const close = (ending: Run | null, open: boolean): null => {
    const excursion = ending && excursionOf(ending, points, stepSeconds, open);
    if (excursion) excursions.push(excursion);
    return null;
  };

  for (const [index, point] of points.entries()) {
    const band = judgeAt(metric, index);
    const value = point.value;
    if (value === null) {
      gap += 1;
      if (gap >= endsAfter) run = close(run, false);
      continue;
    }
    gap = 0;

    // A half the metric is not steered in is not a verdict on it, so whatever
    // was running ends at the edge of the half rather than crossing into it.
    if (band === null) {
      run = close(run, false);
      continue;
    }

    if (value >= band.low && value <= band.high) {
      inWindows += 1;
      run = close(run, false);
      continue;
    }

    outWindows += 1;
    // Leaving the band over one edge and coming back over the other is two
    // excursions, not one long one, so a side that changed starts a new run.
    const above = value > band.high;
    if (run === null || run.above !== above) {
      close(run, false);
      run = { from: index, to: index, above, extremeValue: value };
    } else {
      run.to = index;
      run.extremeValue = above ? Math.max(run.extremeValue, value) : Math.min(run.extremeValue, value);
    }
  }
  close(run, true);

  const counted = inWindows + outWindows;
  const inBandSeconds = inWindows * stepSeconds;
  const outOfBandSeconds = outWindows * stepSeconds;

  return {
    metric,
    rating: counted === 0 ? null : ratingOf(inWindows / counted),
    minValue: values.length ? Math.min(...values) : null,
    maxValue: values.length ? Math.max(...values) : null,
    averageValue: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    dayBand,
    nightBand,
    inBandSeconds,
    outOfBandSeconds,
    excursions,
  };
};

/**
 * Each window of one metric as the verdict judges it: in its band, out of it,
 * or not judged at all - no reading, or a half of the cycle the metric is not
 * steered in. The same rule `countMetric` counts by, kept per window so the
 * headline share can ask of each window whether everything judged in it held.
 */
const judgedWindows = (points: SeriesPoint[], metric: Metric, judgeAt: BandAt): (boolean | null)[] =>
  points.map((point, index) => {
    const band = judgeAt(metric, index);
    return point.value === null || band === null ? null : point.value >= band.low && point.value <= band.high;
  });

const runsOf = (output: DeviceSeries['outputs'][number], stepSeconds: number): ActuatorRuns | null => {
  if (!output.points.some(point => point.value !== null)) return null;

  let runCount = 0;
  let onWindows = 0;
  let wasOn = false;

  for (const point of output.points) {
    if (point.value === null) continue;

    const on = isOn(point.value);
    if (on) {
      onWindows += 1;
      if (!wasOn) runCount += 1;
    }
    wasOn = on;
  }

  return { output: output.output, runCount, forSeconds: onWindows * stepSeconds };
};

/** The middle of each window, which is the instant it is judged at: an aggregated point is stamped at its end. */
const middlesOf = (series: DeviceSeries): number[] => {
  const middle = (series.stepSeconds * 1000) / 2;
  return (series.metrics.find(row => row.points.length > 0)?.points ?? series.outputs[0]?.points ?? []).map(
    point => Date.parse(point.measuredAt) - middle,
  );
};

/** Which half of the cycle each window fell in by the device's schedule, read at the middle of the window. */
const scheduledHalves = (series: DeviceSeries, cycle: Cycle): HalfAt => {
  const moments = middlesOf(series).map(at => cycleAt(cycle, at));

  return index => {
    const moment = moments[index];
    return moment ? { half: moment.active, changing: moment.transition !== null } : { half: 'day', changing: false };
  };
};

/**
 * Which half of the cycle each window fell in, from the light output, for a
 * device that keeps no schedule of its own.
 *
 * The state is carried across the windows that hold no reading - the lamp does
 * not go out because nothing was sampled - and backwards over the ones before
 * the first reading, which is the same lamp seen from the other side. A device
 * that drives no light at all has no halves to tell apart, and then the one it
 * says it is in now is the only one there is to hold the window against.
 */
const halvesOf = (series: DeviceSeries, fallback: boolean): boolean[] => {
  const light = series.outputs.find(output => output.output === 'light')?.points ?? [];
  const length = Math.max(0, ...series.metrics.map(row => row.points.length), light.length);
  const first = light.find(point => point.value !== null);

  let known = first ? isOn(first.value) : fallback;
  return Array.from({ length }, (_unused, index) => {
    const value = light[index]?.value ?? null;
    if (value !== null) known = isOn(value);
    return known;
  });
};

/** The window as a line: the read points averaged down to something a card draws. */
const trendOf = (points: SeriesPoint[], metric: Metric, endsAt: string, stepSeconds: number): CardTrend | null => {
  if (points.length === 0) return null;

  const width = Math.max(1, Math.ceil(points.length / TREND_POINTS));
  const buckets: (number | null)[] = [];

  for (let start = 0; start < points.length; start += width) {
    const values = points
      .slice(start, start + width)
      .map(point => point.value)
      .filter((value): value is number => value !== null);
    buckets.push(values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  }

  return { metric, stepSeconds: width * stepSeconds, endsAt, points: buckets };
};

export const verdictOf = (
  series: DeviceSeries | null,
  targets: Setpoints | null,
  window: { startsAt: Date; endsAt: Date },
  cycle: Cycle | null = null,
  /** What the device aimed at over the window, oldest first (`recordOf`); judged by `targets` and `cycle` where empty. */
  record: readonly RecordedClimate[] = [],
  hardware: Record<string, string> = {},
): ClimateVerdict => {
  const forSeconds = Math.round((window.endsAt.getTime() - window.startsAt.getTime()) / 1000);
  const empty: ClimateVerdict = {
    deviceId: series?.deviceId ?? null,
    startsAt: window.startsAt.toISOString(),
    endsAt: window.endsAt.toISOString(),
    forSeconds,
    stepSeconds: series?.stepSeconds ?? 0,
    rating: null,
    inBandFraction: null,
    metrics: [],
    actuators: [],
    trend: null,
  };
  if (!series) return empty;

  const halves = cycle ? null : halvesOf(series, targets?.active !== 'night');
  const halfAt: HalfAt = cycle
    ? scheduledHalves(series, cycle)
    : index => ({ half: (halves?.[index] ?? targets?.active !== 'night') ? 'day' : 'night', changing: false });
  const judgeAt = judgeOf(series, targets, halfAt, record, hardware, halves);

  // A metric with neither a reading nor a target here is not a row of nulls: it
  // is a metric this tent says nothing about.
  const metrics = STEERED.map(metric =>
    countMetric(metric, series.metrics.find(row => row.metric === metric)?.points ?? [], series.stepSeconds, judgeAt, targets),
  ).filter(row => row.minValue !== null || row.dayBand !== null || row.nightBand !== null);

  // The share is of the time, not of the metrics: a window counts as in band
  // only when every metric judged in it was. Pooling the metrics' seconds made
  // a tent too warm and too dry the whole time, with only its CO2 in band,
  // read "33 % in band" - a third of the day, to anybody reading the sentence.
  const judged = STEERED.map(metric => judgedWindows(series.metrics.find(row => row.metric === metric)?.points ?? [], metric, judgeAt));
  const length = Math.max(0, ...judged.map(states => states.length));
  let inBand = 0;
  let counted = 0;
  for (let index = 0; index < length; index += 1) {
    const states = judged.map(row => row[index] ?? null).filter((state): state is boolean => state !== null);
    if (states.length === 0) continue;
    counted += 1;
    if (states.every(Boolean)) inBand += 1;
  }

  return {
    ...empty,
    rating: worstOf(metrics.map(row => row.rating)),
    inBandFraction: counted === 0 ? null : inBand / counted,
    metrics,
    actuators: series.outputs.flatMap(output => runsOf(output, series.stepSeconds) ?? []),
    trend: trendOf(series.metrics.find(row => row.metric === 'temperature')?.points ?? [], 'temperature', series.endsAt, series.stepSeconds),
  };
};

/**
 * How each window of each metric is judged: by the record where it reaches -
 * what was aimed at then, and the hour after each change - and by the targets
 * and the cycle of now where there is no record to ask. The lamp stands in for
 * the half of a row recorded before cycles were.
 */
const judgeOf = (
  series: DeviceSeries,
  targets: Setpoints | null,
  halfAt: HalfAt,
  record: readonly RecordedClimate[],
  hardware: Record<string, string>,
  lamp: boolean[] | null,
): BandAt => {
  const bands = new Map<Metric, ReturnType<typeof bandsOf>>(STEERED.map(metric => [metric, bandsOf(metric, targets)]));
  if (record.length === 0) return (metric, index) => bandAt(halfAt, index, bands.get(metric) ?? { dayBand: null, nightBand: null });

  const sorted = [...record].sort((one, other) => one.at - other.at);
  const middles = middlesOf(series);
  const lit = lamp ?? halvesOf(series, targets?.active !== 'night');
  // Where a row says nothing of its cycle the lamp tells the halves apart, and
  // the hour after it switched is given to the climate as a schedule gives it.
  const switchedAt = middles.filter((_at, index) => index > 0 && lit[index] !== lit[index - 1]);
  const changing = middles.map(at => switchedAt.some(switched => at >= switched && at - switched < SETTLE_SECONDS * 1000));
  return (metric, index) => {
    const at = middles[index];
    return at === undefined ? null : bandOverRecordAt(sorted, metric, at, (lit[index] ?? true) ? 'day' : 'night', hardware, changing[index] ?? false);
  };
};
