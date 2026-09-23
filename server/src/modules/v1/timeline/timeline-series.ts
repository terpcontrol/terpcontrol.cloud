import type {
  DeviceSeries,
  GrowthStage,
  Metric,
  OutputMetric,
  PhaseTargets,
  SeriesPoint,
  TimelineOutputLane,
  TimelinePanel,
  TimelineSpan,
  TimelineTarget,
  TimelineTargets,
} from '@fg2/shared-types/v1';
import { METRIC_DECIMALS, TARGET_BAND, VALUE_AGE } from '@fg2/shared-types/v1-schemas';
import type { DeviceHistory, OutputHistory } from '@modules/data/data.service';
import type { OutputSwitching } from '@modules/data/flux';

/**
 * What the windows of a read mean once they are on the screen: the stacked
 * panels, the band that applied across each of them, the night, and the lanes
 * under them.
 *
 * Nothing here reaches for a database, so what the timeline says about a read
 * can be read - and tested - as arithmetic. What comes in is what one read per
 * controller answered: the curve, window by window, and the switchings of the
 * outputs, which are instants rather than windows because a state is not a
 * measurement and averaging one loses the very thing a lane is about.
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
export const nightsOf = (histories: readonly DeviceHistory[], window: SeriesWindow): TimelineSpan[] => {
  const lit = histories.find(one => outputIn(one, 'light').switchings.length > 0);

  return lit ? spansOf(outputIn(lit, 'light'), false, lit.series, window) : [];
};

/** One lane per output a device reported, as the stretches it ran for. A device that said nothing about an output has no lane. */
export const lanesOf = (histories: readonly DeviceHistory[], window: SeriesWindow): TimelineOutputLane[] =>
  histories.flatMap(one =>
    one.outputs.flatMap(output =>
      output.switchings.length > 0
        ? [{ output: output.output, deviceId: one.series.deviceId, spans: spansOf(output, true, one.series, window) }]
        : [],
    ),
  );

/** What one device said about one output, or nothing where it was not asked about it or never reported it. */
const outputIn = (history: DeviceHistory, output: OutputMetric): OutputHistory =>
  history.outputs.find(one => one.output === output) ?? { output, switchings: [] };

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
 * The stretches of the window one output held a state for.
 *
 * Two things decide a span, and they are two different facts. The switchings
 * say what the output was doing - they are the instants the store found it
 * changing, so a span is as long as the output really ran and not as long as
 * the windows the curve happens to be drawn with. What was heard says how far
 * that may be carried: nothing is known about the lamp while nobody was
 * reporting, so a run is cut where the device was last heard and picked up
 * where it came back, which is the same break the curve above it draws rather
 * than a lane running straight through the hole in the line.
 *
 * A run still going where the device was last heard therefore ends there and
 * not at the edge of the window - a device that has said nothing for three days
 * is not three days of "off".
 */
const spansOf = (output: OutputHistory, on: boolean, series: DeviceSeries, window: SeriesWindow): TimelineSpan[] => {
  const points = series.outputs.find(one => one.output === output.output)?.points ?? [];

  return overlapping(stateStretches(output.switchings, on), heardStretches(points, window, series.stepSeconds)).map(stretch => ({
    startsAt: new Date(stretch.from).toISOString(),
    endsAt: new Date(stretch.to).toISOString(),
  }));
};

/** A stretch of the window in instants, before it is written as a span. */
interface Stretch {
  from: number;
  to: number;
}

/**
 * The stretches the state was the one asked about. The last switching runs on
 * for ever, because nothing after it says otherwise; how far it is actually
 * drawn is decided by what was heard.
 */
const stateStretches = (switchings: readonly OutputSwitching[], on: boolean): Stretch[] =>
  switchings.flatMap((switching, index) => {
    if (switching.on !== on) return [];
    const next = switchings[index + 1];

    return [{ from: millis(switching.at), to: next ? millis(next.at) : Number.POSITIVE_INFINITY }];
  });

/**
 * The stretches the device was reporting across, which is all anything can be
 * known about.
 *
 * A device that was already reporting when the window opened was running before
 * it, so the first stretch is drawn from the edge rather than from its first
 * sample; one that only turned up later is drawn from where it turned up, and
 * the same rule closes the far end.
 */
const heardStretches = (points: readonly SeriesPoint[], window: SeriesWindow, stepSeconds: number): Stretch[] => {
  const heard = points.flatMap(point => (point.value === null ? [] : [millis(point.measuredAt)]));
  if (heard.length === 0) return [];

  const silence = silenceOf(points, stepSeconds);
  const stretches: Stretch[] = [{ from: heard[0], to: heard[0] }];
  for (const at of heard.slice(1)) {
    const last = stretches[stretches.length - 1];
    if (at - last.to > silence) stretches.push({ from: at, to: at });
    else last.to = at;
  }

  const opens = stretches[0];
  const closes = stretches[stretches.length - 1];
  if (opens.from - window.startsAt.getTime() <= silence) opens.from = window.startsAt.getTime();
  if (window.endsAt.getTime() - closes.to <= silence) closes.to = window.endsAt.getTime();

  return stretches;
};

/** Where two lists of stretches are both true, in order. Neither list overlaps itself, so the answer does not either. */
const overlapping = (one: readonly Stretch[], other: readonly Stretch[]): Stretch[] =>
  one
    .flatMap(mine =>
      other.flatMap(theirs => {
        const from = Math.max(mine.from, theirs.from);
        const to = Math.min(mine.to, theirs.to);

        return to > from ? [{ from, to }] : [];
      }),
    )
    .sort((mine, theirs) => mine.from - theirs.from);

const millis = (instant: string): number => new Date(instant).getTime();

/**
 * One metric across every controller of the space, window by window. The reads
 * share a window and a step, so the instant is what joins them.
 *
 * Only the windows something was read in are answered, with a break written
 * between two of them the space fell silent across, and one after the last of
 * them where the space has been silent since. A window with no reading is not a
 * hole in the measurement: a device sampling every hour into windows of three
 * minutes leaves nineteen empty ones between every sample, and a series of
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

  const silence = silenceOf(heard, series[0]?.stepSeconds ?? 0);
  return closed(broken(heard, silence), series[0] ? millis(series[0].endsAt) : null, silence);
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

/**
 * The same break after the last reading, where the window runs on past it.
 *
 * A silence at the end of a window is the one nobody closed, and it is the one
 * a reader is most likely to be looking at: both screens read a line at the
 * cursor as the last point at or before it, so a tent that fell quiet on
 * Saturday went on printing Saturday's figures under Wednesday's clock,
 * undimmed and undated. Closing it here says the same thing an interior gap
 * already says - nothing was measured here - and says it on the Charts header,
 * the Timeline header and the cursor's dot at once.
 */
const closed = (points: readonly SeriesPoint[], endsAt: number | null, silence: number): SeriesPoint[] => {
  const last = points[points.length - 1];
  if (!last || last.value === null || endsAt === null || endsAt - millis(last.measuredAt) <= silence) return [...points];

  return [...points, { measuredAt: new Date(millis(last.measuredAt) + 1).toISOString(), value: null }];
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
