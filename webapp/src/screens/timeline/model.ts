import type {
  CardValue,
  GrowSeriesPoint,
  MeasurementDefinition,
  Metric,
  OutputMetric,
  SpaceTimeline,
  TimelineOutputLane,
  TimelineSpan,
} from '@fg2/shared-types/v1';
import { TIMELINE_METRICS } from '@/api/timeline';
import { csvOf, niceScale, type CsvColumn, type Plot, type PlotLine, type PlotPoint, type PlotSpan } from '@/charts/series';
import type { ChartToken } from '@/charts/tokens';
import type { Translate } from '@/i18n/i18n';
import { outputWord } from '@/ui/climate-hardware';
import { decimalFigure, looseFigure } from '@/ui/figures';
import { figure, targetFigure, UNIT } from '@/ui/units';
import { GRAINED_FROM_MS, grainMinutes, type VpdHalf } from './view';
import { alarmsOf, at, spans, stretchesOf } from './window';

/**
 * What one answer comes to on the page: which curves the place has, which of
 * them are ticked, and each panel as the plot, the figures and the strips it
 * is drawn from. All of it is arithmetic on the answer, so the screen holds
 * only the view and hands the rest here.
 */

/** The curves a page opens on where nobody chose: what a grower reads first. */
const FIRST_READ: Metric[] = ['temperature', 'humidity', 'vpd'];

const COLOUR: Partial<Record<Metric, ChartToken>> = {
  temperature: 'temperature',
  humidity: 'humidity',
  vpd: 'brand',
  co2: 'co2',
  leafTemperature: 'green',
  lux: 'warning',
  ppfd: 'warning',
};

/** The decimals a curve's figures are written with in the table: what its sensor delivers. */
const DECIMALS: Partial<Record<Metric, number>> = { temperature: 1, humidity: 1, vpd: 2, leafTemperature: 1 };

/** How finely a panel's scale is rounded outwards: a curve keeps most of the plot's height instead of a round figure's air. */
const SCALE_STEPS = 8;

/** The curve each output acts on, under which its strip stands; the rest stand with the light. */
const ACTS_ON: Partial<Record<OutputMetric, Metric>> = { heater: 'temperature', dehumidifier: 'humidity', co2: 'co2' };

/** What a place has to draw, which is all the sheet offers a tick for. */
export interface Offered {
  metrics: Metric[];
  measurements: MeasurementDefinition[];
  light: boolean;
  outputs: boolean;
  /** Lines a device, the plan or an alarm wrote: never answered to a reader from outside. */
  machine: boolean;
}

export interface Shown extends Omit<Offered, 'measurements' | 'machine'> {
  measurements: string[];
  diary: boolean;
  machine: boolean;
}

const MEASUREMENT = 'm.';

export const offeredOf = (data: SpaceTimeline, measured: readonly { definition: MeasurementDefinition }[]): Offered => ({
  metrics: TIMELINE_METRICS.filter(metric => data.panels.some(panel => panel.metric === metric)),
  measurements: measured.map(one => one.definition),
  light: data.outputs.some(lane => lane.output === 'light'),
  outputs: data.outputs.some(lane => lane.output !== 'light'),
  machine: data.events.some(entry => entry.source !== 'human') || data.machineEvents.total > 0,
});

/** What is ticked where nobody chose, by its keys - also what a place does not have, which a tick elsewhere must not untick. */
export const DEFAULT_SHOW: string[] = [...FIRST_READ, 'light', 'outputs', 'diary', 'machine'];

/** The keys of everything ticked, as the address writes them. */
export const keysOf = (shown: Shown): string[] => [
  ...shown.metrics,
  ...shown.measurements.map(key => MEASUREMENT + key),
  ...(['light', 'outputs', 'diary', 'machine'] as const).filter(key => shown[key]),
];

/** What is drawn: the address's ticks cut to what the place has, or the first read; the reading a link was about is always among it. */
export const shownOf = (keys: string[] | null, offered: Offered, focus: string | null): Shown => {
  const ticked = (key: string) => keys === null || keys.includes(key);
  const metrics = offered.metrics.filter(metric => (keys === null ? FIRST_READ.includes(metric) : keys.includes(metric)) || metric === focus);

  return {
    // A place that measures none of the first three opens on what it does measure.
    metrics: keys === null && metrics.length === 0 ? offered.metrics : metrics,
    measurements: offered.measurements.map(one => one.key).filter(key => keys?.includes(MEASUREMENT + key) ?? offered.metrics.length === 0),
    light: offered.light && (ticked('light') || focus === 'light'),
    outputs: offered.outputs && ticked('outputs'),
    diary: ticked('diary'),
    machine: offered.machine && ticked('machine'),
  };
};

/** One drawn point of an output: the instant its window closes at, its samples, those it ran in, and its mean level in per cent where it has one. */
export type StripPoint = readonly [end: number, heard: number, on: number, level: number | null];

/**
 * One output across the devices that drive it. Everything said about it is
 * counted from `points`, the samples of each drawn window - what it did at the
 * cursor, the share of the time it ran, the table's column and how its strip is
 * filled. `runs` say only when, for the lamp's stretches by the clock: a run is
 * rounded out to the grain it was found at, and no figure is taken from one.
 */
export interface Strip {
  output: OutputMetric;
  name: string;
  /** When any of them ran, joined, in order. */
  runs: PlotSpan[];
  /** Whether a level is said of it: a share of full output, where a switch only runs or does not. */
  levelled: boolean;
  points: StripPoint[];
}

/** What an output did over one drawn point or at one reading: the share of the samples it ran in, and its level in per cent where it has one. */
export interface OutputFigure {
  share: number;
  level: number | null;
}

/** What an output is called: a fridge's name for it where every lane of it is a fridge's. */
const outputTitle = (t: Translate, output: OutputMetric, lanes: readonly TimelineOutputLane[]): string =>
  t(`timeline.output.${outputWord(output, lanes.length > 0 && lanes.every(lane => lane.fridge === true))}`, { defaultValue: output });

const joined = (runs: readonly PlotSpan[]): PlotSpan[] =>
  [...runs]
    .sort((one, other) => one.from - other.from)
    .reduce<PlotSpan[]>((kept, run) => {
      const last = kept.at(-1);
      if (last && run.from <= last.to) last.to = Math.max(last.to, run.to);
      else kept.push({ ...run });
      return kept;
    }, []);

/** The order the strips stand in and are read out in: the lamp first, then what a grower steers by. */
const ORDER: OutputMetric[] = ['light', 'heater', 'dehumidifier', 'co2', 'fan', 'fanInternal', 'fanExternal', 'fanBackwall', 'relais'];

export const stripsOf = (t: Translate, data: SpaceTimeline): Strip[] =>
  ORDER.filter(output => data.outputs.some(lane => lane.output === output)).map(output => {
    const lanes = data.outputs.filter(lane => lane.output === output);
    // Two devices that drive the same output are counted together: the samples of both, and the mean of them all.
    const points = new Map<number, [heard: number, on: number, level: number | null]>();
    for (const point of lanes.flatMap(lane => lane.points ?? [])) {
      const [heard, on, level] = points.get(at(point.measuredAt)) ?? [0, 0, null];
      const sum = (level ?? 0) * heard + (point.level ?? 0) * point.heard;
      points.set(at(point.measuredAt), [
        heard + point.heard,
        on + point.on,
        level === null && point.level === null ? null : sum / (heard + point.heard),
      ]);
    }

    return {
      output,
      name: outputTitle(t, output, lanes),
      runs: joined(lanes.flatMap(lane => lane.spans.map(span => ({ from: at(span.startsAt), to: at(span.endsAt) })))),
      levelled: [...points.values()].some(([, , level]) => level !== null),
      points: [...points].sort(([one], [other]) => one - other).map(([end, [heard, on, level]]) => [end, heard, on, level] as const),
    };
  });

/** The drawn point an instant falls into: a point closes its window, and stands for the step before it. */
const pointAt = (strip: Pick<Strip, 'points'>, time: number, stepMs: number): StripPoint | null =>
  strip.points.find(([end]) => end - stepMs <= time && time < end) ?? (strip.points.at(-1)?.[0] === time ? (strip.points.at(-1) ?? null) : null);

/** What an output did over the drawn point an instant falls into, and null where nothing was heard of it there - which is not "off". */
export const figureAt = (strip: Pick<Strip, 'points'>, time: number, stepMs: number): OutputFigure | null => {
  const point = pointAt(strip, time, stepMs);
  return point ? { share: point[2] / point[1], level: point[3] } : null;
};

/** The share of its samples an output ran in over the window - of the samples heard, not of the window - or null where none was. */
export const shareOf = (strip: Pick<Strip, 'points'>): number | null => {
  const heard = strip.points.reduce((sum, point) => sum + point[1], 0);
  return heard > 0 ? strip.points.reduce((sum, point) => sum + point[2], 0) / heard : null;
};

/** One stretch of a strip that is drawn alike: the share of its samples the output ran in, and how hard. */
export interface StripBlock {
  /** As fractions of the window. */
  from: number;
  to: number;
  share: number;
  level: number | null;
}

/**
 * A strip as it is drawn: each point over the step it stands for, neighbours that say the same joined into one
 * block, so a lamp on all day is one bar and not a row of seams. Where no point stands nothing was heard, and
 * nothing is drawn - not even "off".
 */
export const blocksOf = (strip: Pick<Strip, 'points'>, from: number, to: number, stepMs: number): StripBlock[] => {
  const width = to - from;
  if (width <= 0) return [];

  return strip.points.reduce<StripBlock[]>((kept, [end, heard, on, level], index) => {
    // The last point of a window that ends now is cut short, and begins where the one before it closed.
    const starts = Math.max(from, end - stepMs, strip.points[index - 1]?.[0] ?? from);
    const block = { from: (starts - from) / width, to: (Math.min(to, end) - from) / width, share: on / heard, level };
    const last = kept.at(-1);
    if (block.to <= block.from) return kept;
    if (last && Math.abs(last.to - block.from) < 1e-9 && last.share === block.share && last.level === block.level) last.to = block.to;
    else kept.push(block);
    return kept;
  }, []);
};

/** One curve of a panel, as it is named, read and written. */
export interface Curve {
  key: string;
  name: string;
  unit: string;
  colour: ChartToken;
  /** The figure as it is written beside this curve: a metric to its decimals, a grower's own reading as it was taken. */
  written: (value: number) => string;
  /** How many decimals the table writes every figure of this curve with; none for a reading written as it was taken. */
  decimals?: number;
  corner: (value: number) => string;
  points: PlotPoint[];
  /**
   * The lowest and the highest of the window: of single samples, and of the deficit over more than three days of
   * its means over five minutes - never of the points drawn where the answer says more.
   */
  low: number | null;
  high: number | null;
  /** What the low and the high are of, where they are not of samples: a deficit's over more than three days. */
  of?: string;
  /** Where the device's last reading stands as the curve's last point, in a window that ends now; null elsewhere. */
  lastAt: number | null;
  line: PlotLine;
}

export interface PanelModel {
  key: string;
  /** The reading a link names, which the panel is found and marked by. */
  metric: Metric | null;
  curves: Curve[];
  plot: Plot;
  strips: Strip[];
}

const NO_SPANS: TimelineSpan[] = [];

/** How far past the answer's end a reading may stand and still close its curve: the answer is a beat older than the reading. */
const LATE_MS = 120_000;

/** How far before its stamp a point is drawn: the store stamps a window at its close. */
export const drawnBefore = (stepSeconds: number): number => (stepSeconds <= SAMPLE_SECONDS ? stepSeconds : stepSeconds / 2) * 1000;

/** The step at which a window holds one sample, which is then a point at its own time and no mean. */
export const SAMPLE_SECONDS = 5;

/**
 * Each point where it belongs: a mean at the middle of the window it was taken over, a single sample at the
 * start of the five seconds it was written in - its own time, to the second.
 */
const pointsOf = (points: SpaceTimeline['panels'][number]['points'], before: number): PlotPoint[] =>
  points.map(point =>
    point.min !== undefined && point.max !== undefined
      ? ([at(point.measuredAt) - before, point.value, point.min, point.max] as const)
      : ([at(point.measuredAt) - before, point.value] as const),
  );

/** The lowest and the highest of a curve: of its samples where the points carry them, else of the points themselves. */
export const extremesOf = (points: readonly (readonly [number, number | null, number?, number?])[]): { low: number | null; high: number | null } => {
  const lows = points.flatMap(([, value, min]) => (value === null ? [] : [min ?? value]));
  const highs = points.flatMap(([, value, , max]) => (value === null ? [] : [max ?? value]));
  return lows.length === 0 ? { low: null, high: null } : { low: Math.min(...lows), high: Math.max(...highs) };
};

/** The points of one half of the cycle: VPD by day and by night are two figures, and one line across both is a sawtooth. */
const halfOf = (points: PlotPoint[], nights: TimelineSpan[], half: VpdHalf): PlotPoint[] =>
  half === 'all' ? points : points.map(point => (spans(nights, point[0]) === (half === 'night') ? point : ([point[0], null] as const)));

const metricCurve = (
  t: Translate,
  data: SpaceTimeline,
  metric: Metric,
  half: VpdHalf,
  heardUntil: number,
  compared: Compared | null,
  last: CardValue | null,
): { curve: Curve; bands: Plot['bands'] } | null => {
  const panel = data.panels.find(one => one.metric === metric);
  if (!panel) return null;

  const from = at(data.startsAt);
  const means = pointsOf(panel.points, drawnBefore(data.stepSeconds));
  // The device's last reading closes the curve of a window that ends now: "jetzt" is that reading, on every range,
  // and not the mean of the last hour and a half of a month.
  const lastAt = last?.value != null && last.measuredAt ? at(last.measuredAt) : null;
  // The mean of the window that reading fell into gives way to it, whichever half of the window it fell in: a
  // device that stopped at 16:17 ends on what it read at 16:17, not on the mean of the hour and a half around it.
  const own = drawnBefore(data.stepSeconds);
  const before =
    lastAt === null || lastAt > at(data.endsAt) + LATE_MS || lastAt < from
      ? null
      : means.filter(point => point[1] === null || point[0] < lastAt || point[0] - lastAt > own);
  // A curve with means newer than the reading is ahead of it, and ends on its own.
  const closes = before !== null && !before.some(point => point[1] !== null && point[0] > (lastAt as number));
  const points = halfOf(closes ? [...before, [lastAt as number, last?.value ?? null] as const] : means, data.nights, metric === 'vpd' ? half : 'all');
  const bands = stretchesOf(panel, data.nights, from, heardUntil, data.transitions ?? NO_SPANS).map(stretch => ({
    from: stretch.from,
    to: stretch.to,
    low: stretch.target.band.low,
    high: stretch.target.band.high,
  }));
  // The lowest and the highest are the window's own, as the answer has them; the reading that closes the curve
  // is "now" and no part of them.
  const { low, high } = extremesOf(halfOf(means, data.nights, metric === 'vpd' ? half : 'all'));
  const colour = COLOUR[metric] ?? 'ink';
  // What is laid over is drawn against the same scale, so the scale holds it too.
  const laid = (compared?.data.panels.find(one => one.metric === metric)?.points ?? []).flatMap(point => (point.value === null ? [] : [point.value]));
  const scale = niceScale(
    [...(low === null || high === null ? [] : [low, high]), ...bands.flatMap(band => [band.low, band.high]), ...laid],
    SCALE_STEPS,
  );

  return {
    bands,
    curve: {
      key: metric,
      name: t(`timeline.metric.${metric}`, { defaultValue: metric }),
      unit: UNIT[metric] ?? '',
      colour,
      // A humidity is read to the tenth here, as the sensor delivers it and the old charts did: "Hoch 75" over a
      // highest sample of 74,6 is wrong, and a dehumidifier's swing of a per cent is what is looked for. Start's
      // tile rounds the same reading to whole per cent.
      written: value => (metric === 'humidity' ? decimalFigure(value, 1) : figure(value, metric)),
      decimals: DECIMALS[metric] ?? 0,
      ...(metric === 'vpd' && at(data.endsAt) - from > GRAINED_FROM_MS
        ? { of: t('timeline.ofMeans', { minutes: grainMinutes({ from, to: at(data.endsAt) }) }) }
        : {}),
      corner: value => targetFigure(value, metric),
      points,
      low,
      high,
      lastAt: closes ? lastAt : null,
      line: { key: metric, colour, shape: 'line', points, scale },
    },
  };
};

/** A grow's own reading over a stretch, as its curve is drawn: on Verlauf among the climate, and alone on the grow's Messwerte. */
export const measurementCurve = (
  definition: MeasurementDefinition,
  readings: readonly GrowSeriesPoint[],
  from: number,
  to: number,
): { curve: Curve; bands: Plot['bands'] } => {
  const points = readings
    .map(reading => [at(reading.measuredAt), reading.value] as const)
    .filter(([time]) => time >= from && time <= to)
    .sort(([one], [other]) => one - other);
  const band =
    definition.targetMin !== null && definition.targetMax !== null ? [{ from, to, low: definition.targetMin, high: definition.targetMax }] : [];
  const { low, high } = extremesOf(points);
  const scale = niceScale([...points.map(([, value]) => value), ...band.flatMap(one => [one.low, one.high])], SCALE_STEPS);

  return {
    bands: band,
    curve: {
      key: MEASUREMENT + definition.key,
      name: definition.name,
      unit: definition.unit,
      colour: 'ink',
      written: looseFigure,
      corner: looseFigure,
      points,
      low,
      high,
      lastAt: null,
      line: { key: MEASUREMENT + definition.key, colour: 'ink', shape: 'points', points, scale },
    },
  };
};

/** What is laid over: another answer's curves, moved by `shift` onto this window, dashed and without a band. */
export interface Compared {
  data: SpaceTimeline;
  shift: number;
}

const comparedLine = (curve: Curve, compared: Compared | null): PlotLine[] => {
  const panel = compared?.data.panels.find(one => one.metric === curve.key);
  if (!compared || !panel) return [];
  const before = drawnBefore(compared.data.stepSeconds);
  return [
    {
      key: `${curve.key}~compared`,
      colour: curve.colour,
      shape: 'line',
      dashed: true,
      scale: curve.line.scale,
      points: panel.points.map(point => [at(point.measuredAt) - before + compared.shift, point.value] as const),
    },
  ];
};

interface PanelsInput {
  shown: Shown;
  one: boolean;
  vpdHalf: VpdHalf;
  measured: readonly { definition: MeasurementDefinition; points: readonly GrowSeriesPoint[] }[];
  compared: Compared | null;
  /**
   * What the device drawn reads now, as Start says it, where the window ends now: each curve's last point. With
   * `silentSince`, the instant of its last reading where it has stopped reporting by the offline rule.
   */
  now: { values: readonly CardValue[]; silentSince: number | null } | null;
  /** Where the strips with no curve of their own stand: under the last panel, or in a card of their own. */
  restUnderLast: boolean;
}

/**
 * The panels in the order they stack, each with the strips of the outputs that
 * act on it. `rest` is what acts on none of the curves drawn: the light, the
 * fans, a socket's relay.
 */
export const panelsOf = (
  t: Translate,
  data: SpaceTimeline,
  strips: readonly Strip[],
  input: PanelsInput,
): { panels: PanelModel[]; rest: Strip[] } => {
  const [from, to] = [at(data.startsAt), at(data.endsAt)];
  // After the last thing heard nothing is known, the light schedule included: the band and the night stop there, so
  // the stretch after it is the blank it is rather than a day that went on.
  const quiet = input.now?.silentSince ?? quietSince(data);
  const heardUntil = quiet === null ? to : Math.min(to, quiet + (input.now?.silentSince != null ? 0 : drawnBefore(data.stepSeconds)));
  const nights = data.nights
    .map(night => ({ from: at(night.startsAt), to: Math.min(at(night.endsAt), heardUntil) }))
    .filter(night => night.to > night.from);
  const drawn = [
    ...input.shown.metrics.flatMap(metric => {
      const last = input.now?.values.find(value => value.metric === metric && value.value !== null) ?? null;
      const made = metricCurve(t, data, metric, input.vpdHalf, heardUntil, input.compared, last);
      return made ? [{ ...made, metric: metric as Metric | null }] : [];
    }),
    ...input.measured
      .filter(one => input.shown.measurements.includes(one.definition.key))
      .map(one => ({ ...measurementCurve(one.definition, one.points, from, to), metric: null as Metric | null })),
  ];
  const stripsFor = (metric: Metric | null) =>
    input.shown.outputs ? strips.filter(strip => metric !== null && ACTS_ON[strip.output] === metric) : [];
  const placed = new Set(drawn.flatMap(one => stripsFor(one.metric)).map(strip => strip.output));
  const rest = strips.filter(strip => (strip.output === 'light' ? input.shown.light : input.shown.outputs && !placed.has(strip.output)));

  const panels: PanelModel[] =
    input.one && drawn.length > 1
      ? [
          {
            key: 'one',
            metric: null,
            curves: drawn.map(one => one.curve),
            // Several scales share the picture, so no band is drawn: it would be read against the wrong one.
            plot: {
              from,
              to,
              nights,
              bands: [],
              alarms: [],
              lines: drawn.flatMap(one => [one.curve.line, ...comparedLine(one.curve, input.compared)]),
            },
            strips: strips.filter(strip => placed.has(strip.output)),
          },
        ]
      : drawn.map(one => ({
          key: one.curve.key,
          metric: one.metric,
          curves: [one.curve],
          plot: {
            from,
            to,
            nights,
            bands: one.bands,
            alarms: (one.metric ? alarmsOf(data.alarms, one.metric) : []).map(alarm => ({
              from: at(alarm.startedAt),
              to: alarm.endedAt ? at(alarm.endedAt) : to,
            })),
            lines: [one.curve.line, ...comparedLine(one.curve, input.compared)],
          },
          strips: stripsFor(one.metric),
        }));

  const last = panels.at(-1);
  if (input.restUnderLast && last) return { panels: [...panels.slice(0, -1), { ...last, strips: [...last.strips, ...rest] }], rest: [] };
  return { panels, rest };
};

/**
 * The point nearest the cursor: what was measured there, and null across a silence. Within a step and a half of
 * it - or anywhere on the line between two points, as an hourly history draws it: where a line is drawn there is a
 * nearer end to read.
 */
export const nearestPoint = (points: readonly PlotPoint[], time: number, reach: number): PlotPoint | null => {
  let found: PlotPoint | null = null;
  let joined = false;
  for (const [index, point] of points.entries()) {
    if (point[1] === null) continue;
    if (found === null || Math.abs(point[0] - time) < Math.abs(found[0] - time)) found = point;
    // The stretch from the point before to this one holds the cursor and no break.
    const before = points[index - 1];
    if (before && before[1] !== null && before[0] <= time && time <= point[0]) joined = true;
    if (point[0] > time) break;
  }
  return found && (joined || Math.abs(found[0] - time) <= reach) ? found : null;
};

/** How near the cursor a point has to stand to be read at it. */
export const reachOf = (data: Pick<SpaceTimeline, 'stepSeconds' | 'startsAt' | 'endsAt'>, curve: Pick<Curve, 'line'>): number =>
  curve.line.shape === 'points' ? (at(data.endsAt) - at(data.startsAt)) / 100 : Math.max(data.stepSeconds, 1) * 1500;

/** When the place last measured, where it has been quiet since; null while it is still heard. */
export const quietSince = (data: SpaceTimeline): number | null => {
  if (data.panels.length === 0 || !data.panels.every(panel => panel.points.at(-1)?.value === null)) return null;
  const heard = data.panels.flatMap(panel => panel.points.filter(point => point.value !== null).map(point => at(point.measuredAt)));
  // Where its last point is drawn.
  return heard.length === 0 ? null : Math.max(...heard) - drawnBefore(data.stepSeconds);
};

/**
 * What is on the screen, as a table: every curve ticked with the lowest and
 * highest of each window beside its mean, and every output drawn as the state
 * it held.
 */
export const csvFor = (
  t: Translate,
  panels: readonly PanelModel[],
  strips: readonly Strip[],
  stepMs: number,
  /** The device's last reading where it closes the curves, which is then the table's last row. */
  reading: { at: number; outputs: ReadonlyMap<OutputMetric, OutputFigure> } | null,
  zone: string | null,
  decimalComma: boolean,
): string => {
  // A deficit is worked out, not measured, and its column says so.
  const named = (curve: Curve) => (curve.key === 'vpd' ? t('timeline.csvVpd') : curve.name);
  const titled = (curve: Curve, what: string | null = null) =>
    [named(curve), what].filter(Boolean).join(' · ') + (curve.unit ? ` (${curve.unit})` : '');
  const curves = panels.flatMap(panel => panel.curves);
  // An output is written at the instants the curves' points stand at, so it adds no rows of its own; with no curve
  // drawn, where its own points are drawn.
  const before = drawnBefore(stepMs / 1000);
  const drawn = [
    ...new Set(curves.flatMap(curve => (curve.line.shape === 'line' ? curve.points.flatMap(point => (point[1] === null ? [] : [point[0]])) : []))),
  ];
  const rows = (drawn.length > 0 ? drawn : [...new Set(strips.flatMap(strip => strip.points.map(point => point[0] - before)))]).sort(
    (one, other) => one - other,
  );
  const columns: CsvColumn[] = [
    ...curves.flatMap(curve => {
      const spread = curve.points.some(point => point[2] !== undefined);
      const column = (label: string, points: [number, number | null][]): CsvColumn => ({ label, points, decimals: curve.decimals });
      return [
        column(
          titled(curve),
          curve.points.map(([time, value]) => [time, value]),
        ),
        ...(spread
          ? [
              column(
                titled(curve, t('timeline.low')),
                curve.points.map(([time, value, min]) => [time, value === null ? null : (min ?? value)]),
              ),
              column(
                titled(curve, t('timeline.high')),
                curve.points.map(([time, value, , max]) => [time, value === null ? null : (max ?? value)]),
              ),
            ]
          : []),
      ];
    }),
    // Every output at the same instants, counted from the samples of that point's window: its mean level in per cent
    // of full output, a sample in which it was off counting as 0, and for one that only switches the share of the
    // samples it ran in. The row of the device's last reading says what the reading says, as the card does. Nothing
    // where nothing was heard, so no row says 0 for an output nobody measured.
    ...strips.map((strip): CsvColumn => ({
      label: t('timeline.csvLevel', { output: strip.name }),
      decimals: 0,
      points: rows.flatMap(time => {
        const said = reading !== null && time === reading.at ? (reading.outputs.get(strip.output) ?? null) : figureAt(strip, time, stepMs);
        return said ? [[time, said.level ?? said.share * 100] as [number, number | null]] : [];
      }),
    })),
  ];

  return csvOf(columns, zone, t('timeline.csvTime'), decimalComma);
};
