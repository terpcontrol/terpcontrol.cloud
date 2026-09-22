import type {
  DeviceSeries,
  GrowthStage,
  Metric,
  PhaseTargets,
  SeriesPoint,
  TimelineOutputLane,
  TimelinePanel,
  TimelineSpan,
  TimelineTarget,
  TimelineTargets,
} from '@fg2/shared-types/v1';
import { METRIC_DECIMALS, TARGET_BAND, VALUE_AGE } from '@fg2/shared-types/v1-schemas';

/**
 * What the windows of a read mean once they are on the screen: the stacked
 * panels, the band that applied across each of them, the night, and the lanes
 * under them.
 *
 * Nothing here reaches for a database, so what the timeline says about a set of
 * points can be read - and tested - as arithmetic. One read per controller
 * happens above; this is what its points come to.
 */

/**
 * The three panels the timeline stacks, in the order it stacks them. VPD is
 * deliberately not among them: it is a computed number that wants its own axis
 * and its leaf offset explained, and it belongs to the charting view.
 */
export const PANEL_METRICS: readonly Metric[] = ['temperature', 'humidity', 'co2'];

/**
 * A controller only raises CO2 while the light is on, so its one target is a day
 * target and the dark half carries no band: a tent falling back to fresh air at
 * night is the plants breathing and not a miss.
 */
const DAY_ONLY: readonly Metric[] = ['co2'];

/** A window counts as on when the output ran for more than half of it, which is what a mean of ones and zeroes says. */
const ON = 0.5;

/** One stretch of the window over which the same targets applied, before it is stated per metric. */
export interface TargetStretch {
  startsAt: Date;
  endsAt: Date;
  /** Null where the targets are the controller's own configuration rather than a phase's snapshot. */
  phaseId: string | null;
  stage: GrowthStage | null;
  targets: PhaseTargets | null;
}

/**
 * The panels, each with the bands that applied across it.
 *
 * A metric with no reading in the window has no panel rather than a panel of
 * nulls: a tent without a CO2 sensor reports no CO2, and that is what makes the
 * third panel appear only where there is something to draw in it.
 *
 * Which metrics are stacked is the timeline's three unless a caller says
 * otherwise. The Charts view says otherwise: it draws whatever was ticked,
 * VPD included, and there is no second way of turning points into a panel.
 *
 * Several controllers in one tent are several thermometers in the same air, so
 * the windows they share are averaged into one line rather than drawn as two -
 * the panel is what the tent read, not what each device did.
 */
export const panelsOf = (
  series: readonly DeviceSeries[],
  stretches: readonly TargetStretch[],
  metrics: readonly Metric[] = PANEL_METRICS,
): TimelinePanel[] =>
  metrics.flatMap(metric => {
    const points = pooled(series, metric);

    return points.some(point => point.value !== null) ? [{ metric, points, targets: targetsOf(metric, stretches) }] : [];
  });

/** The band and the dashed line of one metric, one row per stretch that holds a target for it at all. */
export const targetsOf = (metric: Metric, stretches: readonly TargetStretch[]): TimelineTargets[] =>
  stretches.flatMap(stretch => {
    const day = halfOf(metric, setpointIn(stretch.targets, metric, 'day'));
    const night = DAY_ONLY.includes(metric) ? null : halfOf(metric, setpointIn(stretch.targets, metric, 'night'));
    if (day === null && night === null) return [];

    return [
      {
        startsAt: stretch.startsAt.toISOString(),
        endsAt: stretch.endsAt.toISOString(),
        phaseId: stretch.phaseId,
        stage: stretch.stage,
        day,
        night,
      },
    ];
  });

/**
 * When the light was off, which is what the panels are shaded by. It is the
 * tent's own cycle and not hours of the clock, because the grower's day is when
 * the lamp is on.
 *
 * The controllers of one tent switch one lamp, so the first that reports the
 * output answers for the space rather than two of them shading it twice.
 */
export const nightsOf = (series: readonly DeviceSeries[], window: SeriesWindow): TimelineSpan[] => {
  const lit = series.find(one => one.outputs.some(output => output.output === 'light' && output.points.some(point => point.value !== null)));
  const light = lit?.outputs.find(output => output.output === 'light');

  return lit && light ? spansOf(light.points, value => value <= ON, window, lit.stepSeconds) : [];
};

/** One lane per output a device reported, as the stretches it ran for. A device that said nothing about an output has no lane. */
export const lanesOf = (series: readonly DeviceSeries[], window: SeriesWindow): TimelineOutputLane[] =>
  series.flatMap(one =>
    one.outputs.flatMap(output =>
      output.points.some(point => point.value !== null)
        ? [{ output: output.output, deviceId: one.deviceId, spans: spansOf(output.points, value => value > ON, window, one.stepSeconds) }]
        : [],
    ),
  );

/** The window the lanes and the night are read against. */
export interface SeriesWindow {
  startsAt: Date;
  endsAt: Date;
}

/** How many of a device's usual gaps in a row count as it having stopped, rather than as its having been slow once. */
const SILENT_AFTER = 4;

/**
 * How long a device may say nothing before a run stops being carried across it.
 *
 * Not one number. Firmware reports every half minute, a backfilled history every
 * hour, and a whole grow is read in windows wider than either, so what counts as
 * a silence is measured against the rhythm this device actually kept over this
 * window - and never falls below the threshold the rest of the app calls a
 * device gone by.
 */
const silenceOf = (points: readonly SeriesPoint[], stepSeconds: number): number => {
  const heard = points.flatMap(point => (point.value === null ? [] : [millis(point.measuredAt)]));
  const gaps = heard
    .slice(1)
    .map((instant, index) => instant - heard[index])
    .sort((one, other) => one - other);
  // Three quarters of the way up rather than the middle: a device that is slow
  // every fourth sample is keeping that rhythm too.
  const usual = gaps.length === 0 ? stepSeconds * 1000 : gaps[Math.floor(gaps.length * 0.75)];

  return Math.max(VALUE_AGE.staleSeconds * 1000, SILENT_AFTER * usual);
};

/**
 * A run of windows in which something held, as one span.
 *
 * A window with no reading neither starts nor ends a run: an output is what it
 * was last reported to be until something reports otherwise, and a device
 * reporting every five minutes into one-minute windows leaves four empty ones
 * between every sample.
 *
 * A silence long enough to call the device gone is different. Nothing is known
 * about the lamp while nobody was reporting, so the run ends where the device
 * was last heard and a new one begins where it came back - the same break the
 * curve above it draws, rather than a lane that runs straight through the hole
 * in the line.
 */
const spansOf = (points: readonly SeriesPoint[], holds: (value: number) => boolean, window: SeriesWindow, stepSeconds: number): TimelineSpan[] => {
  const silence = silenceOf(points, stepSeconds);
  const spans: TimelineSpan[] = [];
  // The instants are the ones the points carry, so a span lines up with the
  // curve above it rather than with a second idea of where a window began.
  let from: string | null = null;
  let heard: { at: string; held: boolean } | null = null;
  const close = (at: string) => {
    if (from !== null) spans.push({ startsAt: from, endsAt: at });
    from = null;
  };

  for (const point of points) {
    if (point.value === null) continue;

    const held = holds(point.value);
    if (heard === null || millis(point.measuredAt) - millis(heard.at) > silence) {
      // The first thing the device said in this window, or the first after it
      // came back. A device that was already reporting when the window opened
      // was running before it, so its state is drawn from the edge; one that
      // only turned up later is drawn from where it turned up.
      close(heard?.at ?? point.measuredAt);
      if (held) from = opensAt(point.measuredAt, heard === null ? window.startsAt : null, silence);
    } else if (held !== heard.held) {
      if (held) from = point.measuredAt;
      else close(point.measuredAt);
    }
    heard = { at: point.measuredAt, held };
  }

  // A run still going where the device was last heard is closed at the end of
  // the window, unless the device has been quiet for long enough since.
  if (heard !== null) close(window.endsAt.getTime() - millis(heard.at) > silence ? heard.at : window.endsAt.toISOString());

  return spans;
};

/** Where the first run of the window begins: at its edge where the device was already there, and at the first sample where it was not. */
const opensAt = (measuredAt: string, startsAt: Date | null, silence: number): string =>
  startsAt && millis(measuredAt) - startsAt.getTime() <= silence ? startsAt.toISOString() : measuredAt;

const millis = (instant: string): number => new Date(instant).getTime();

/**
 * One metric across every controller of the space, window by window. The reads
 * share a window and a step, so the instant is what joins them.
 *
 * Only the windows something was read in are answered, with a break written
 * between two of them the space fell silent across. A window with no reading is
 * not a hole in the measurement: a device sampling every hour into windows of
 * three minutes leaves nineteen empty ones between every sample, and a series of
 * holes with a lone reading between them is a line that cannot be drawn at all.
 * What the curve has to break at is the silence, which is the same thing the
 * lanes under it break at.
 */
const pooled = (series: readonly DeviceSeries[], metric: Metric): SeriesPoint[] => {
  const readings = new Map<string, number[]>();

  for (const one of series) {
    for (const point of one.metrics.find(row => row.metric === metric)?.points ?? []) {
      if (point.value === null) continue;
      readings.set(point.measuredAt, [...(readings.get(point.measuredAt) ?? []), point.value]);
    }
  }

  const heard = [...readings.entries()]
    .sort(([one], [other]) => one.localeCompare(other))
    .map(([measuredAt, values]) => ({ measuredAt, value: rounded(mean(values), metric) }));

  return broken(heard, silenceOf(heard, series[0]?.stepSeconds ?? 0));
};

/** The readings with a null between the two the space went quiet between, which is where the line stops and starts again. */
const broken = (points: readonly SeriesPoint[], silence: number): SeriesPoint[] =>
  points.flatMap((point, index) => {
    const before = points[index - 1];
    if (!before || millis(point.measuredAt) - millis(before.measuredAt) <= silence) return [point];

    // The break belongs at the instant after the last thing anybody said, not
    // halfway across the silence, which would claim a reading was due there.
    return [{ measuredAt: new Date(millis(before.measuredAt) + 1).toISOString(), value: null }, point];
  });

const setpointIn = (targets: PhaseTargets | null, metric: Metric, half: 'day' | 'night'): number | null => {
  if (targets === null) return null;
  if (metric === 'co2') return half === 'day' ? targets.co2 : null;

  return metric === 'temperature' || metric === 'humidity' ? targets[half][metric] : null;
};

const halfOf = (metric: Metric, setpoint: number | null): TimelineTarget | null => {
  const tolerance = TARGET_BAND[metric];
  if (setpoint === null || tolerance === undefined) return null;

  return { setpoint, band: { low: rounded(setpoint - tolerance, metric), high: rounded(setpoint + tolerance, metric) } };
};

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

/** What the sensor can say, and no more: the mean of two readings is otherwise seventeen digits of which one is a measurement. */
const rounded = (value: number, metric: Metric): number => {
  const factor = 10 ** METRIC_DECIMALS[metric];

  return Math.round(value * factor) / factor;
};
