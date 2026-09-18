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
import { TARGET_BAND, VALUE_AGE } from '@fg2/shared-types/v1-schemas';

/**
 * How the last day went, read out of one aggregation.
 *
 * The window is read once - every steered metric, the light and every output in
 * a single series - and every question the verdict answers is then counted off
 * the same points: how much of the time the tent held its band, the runs that
 * left it, and how often each actuator came on. Asking Influx once per question
 * would give four reads that disagree at their edges.
 *
 * Day and night are told apart by the light output rather than by a clock,
 * because the grower's day is when the lamp is on, and each half is judged
 * against its own targets. A device that drives no light at all has no halves to
 * tell apart, so the half it says it is in now is used for the whole window.
 *
 * Nothing here reaches for a database, so what the verdict says about a set of
 * points can be read - and tested - as arithmetic.
 */

/**
 * The metrics a controller holds a target for, and therefore the only ones a
 * band can be drawn around. It is also what the window is read with, so nothing
 * is fetched that the verdict has nothing to say about.
 */
export const STEERED: readonly Metric[] = ['temperature', 'humidity', 'co2'];

/**
 * A controller only raises CO2 while the light is on, so its one target is a day
 * target. A dark tent falling back to fresh air is the plants breathing and not
 * an excursion, which is why the night has no band for it.
 */
const DAY_ONLY: readonly Metric[] = ['co2'];

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

const countMetric = (
  metric: Metric,
  points: SeriesPoint[],
  stepSeconds: number,
  isDay: (index: number) => boolean,
  targets: Setpoints | null,
): ClimateVerdictMetric => {
  const dayBand = bandOf(targets?.day[metric], metric);
  const nightBand = DAY_ONLY.includes(metric) ? null : bandOf(targets?.night[metric], metric);

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
    const band = isDay(index) ? dayBand : nightBand;
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

/**
 * Which half of the cycle each window fell in, from the light output.
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

export const verdictOf = (series: DeviceSeries | null, targets: Setpoints | null, window: { startsAt: Date; endsAt: Date }): ClimateVerdict => {
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

  const halves = halvesOf(series, targets?.active !== 'night');
  const isDay = (index: number): boolean => halves[index] ?? targets?.active !== 'night';

  // A metric with neither a reading nor a target here is not a row of nulls: it
  // is a metric this tent says nothing about.
  const metrics = STEERED.map(metric =>
    countMetric(metric, series.metrics.find(row => row.metric === metric)?.points ?? [], series.stepSeconds, isDay, targets),
  ).filter(row => row.minValue !== null || row.dayBand !== null || row.nightBand !== null);

  const inBand = metrics.reduce((sum, row) => sum + row.inBandSeconds, 0);
  const judged = inBand + metrics.reduce((sum, row) => sum + row.outOfBandSeconds, 0);

  return {
    ...empty,
    rating: worstOf(metrics.map(row => row.rating)),
    inBandFraction: judged === 0 ? null : inBand / judged,
    metrics,
    actuators: series.outputs.flatMap(output => runsOf(output, series.stepSeconds) ?? []),
    trend: trendOf(series.metrics.find(row => row.metric === 'temperature')?.points ?? [], 'temperature', series.endsAt, series.stepSeconds),
  };
};
