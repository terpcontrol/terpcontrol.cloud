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
import { METRIC_DECIMALS, TARGET_BAND } from '@fg2/shared-types/v1-schemas';

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
 * Several controllers in one tent are several thermometers in the same air, so
 * the windows they share are averaged into one line rather than drawn as two -
 * the panel is what the tent read, not what each device did.
 */
export const panelsOf = (series: readonly DeviceSeries[], stretches: readonly TargetStretch[]): TimelinePanel[] =>
  PANEL_METRICS.flatMap(metric => {
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
export const nightsOf = (series: readonly DeviceSeries[], window: { endsAt: Date }): TimelineSpan[] => {
  const light = series.flatMap(one => one.outputs.filter(output => output.output === 'light' && output.points.some(point => point.value !== null)));

  return light.length === 0 ? [] : spansOf(light[0].points, value => value <= ON, window);
};

/** One lane per output a device reported, as the stretches it ran for. A device that said nothing about an output has no lane. */
export const lanesOf = (series: readonly DeviceSeries[], window: { endsAt: Date }): TimelineOutputLane[] =>
  series.flatMap(one =>
    one.outputs.flatMap(output =>
      output.points.some(point => point.value !== null)
        ? [{ output: output.output, deviceId: one.deviceId, spans: spansOf(output.points, value => value > ON, window) }]
        : [],
    ),
  );

/**
 * A run of windows in which something held, as one span.
 *
 * A window with no reading neither starts nor ends a run: an output is what it
 * was last reported to be until something reports otherwise, and a device
 * reporting every five minutes into one-minute windows leaves four empty ones
 * between every sample. The windows before the first reading take that reading's
 * state, which is the same lamp seen from the other side, and a run still going
 * at the end of the window is closed there - the answer says nothing about what
 * happened afterwards.
 */
const spansOf = (points: readonly SeriesPoint[], holds: (value: number) => boolean, window: { endsAt: Date }): TimelineSpan[] => {
  const first = points.map(point => point.value).find((value): value is number => value !== null);
  if (first === undefined) return [];

  const spans: TimelineSpan[] = [];
  let held = holds(first);
  // The instants are the ones the points carry, so a span lines up with the
  // curve above it rather than with a second idea of where a window began.
  let from: string | null = held ? points[0].measuredAt : null;

  for (const point of points) {
    if (point.value === null || holds(point.value) === held) continue;

    held = !held;
    if (from === null) from = point.measuredAt;
    else {
      spans.push({ startsAt: from, endsAt: point.measuredAt });
      from = null;
    }
  }
  if (from !== null) spans.push({ startsAt: from, endsAt: window.endsAt.toISOString() });

  return spans;
};

/**
 * One metric across every controller of the space, window by window. The reads
 * share a window and a step, so the instant is what joins them; a window no
 * device had a reading in stays null, so the chart draws the gap rather than
 * joining across it.
 */
const pooled = (series: readonly DeviceSeries[], metric: Metric): SeriesPoint[] => {
  const readings = new Map<string, number[]>();

  for (const one of series) {
    for (const point of one.metrics.find(row => row.metric === metric)?.points ?? []) {
      const known = readings.get(point.measuredAt) ?? [];
      readings.set(point.measuredAt, point.value === null ? known : [...known, point.value]);
    }
  }

  return [...readings.entries()]
    .sort(([one], [other]) => one.localeCompare(other))
    .map(([measuredAt, values]) => ({ measuredAt, value: values.length === 0 ? null : rounded(mean(values), metric) }));
};

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
