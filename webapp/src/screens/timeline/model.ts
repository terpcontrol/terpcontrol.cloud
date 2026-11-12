import type {
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
import type { VpdHalf } from './view';
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

/** One output across the devices that drive it, as its strip is drawn and its state read. */
export interface Strip {
  output: OutputMetric;
  name: string;
  /** When any of them ran, joined, in order. */
  runs: PlotSpan[];
  /** How far anything is known about it; past that the strip is blank rather than "off". */
  heardUntil: number;
  /** How hard it ran, window by window, where a device says so: a share of full output in per cent. */
  levels: [number, number][];
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
    const levels = new Map<number, number>();
    for (const lane of lanes) {
      if (lane.level?.unit !== 'percent') continue;
      for (const point of lane.level.points)
        if (point.value !== null) levels.set(at(point.measuredAt), Math.max(levels.get(at(point.measuredAt)) ?? 0, point.value));
    }

    return {
      output,
      name: outputTitle(t, output, lanes),
      runs: joined(lanes.flatMap(lane => lane.spans.map(span => ({ from: at(span.startsAt), to: at(span.endsAt) })))),
      heardUntil: Math.max(...lanes.map(lane => at(lane.heardUntil))),
      levels: [...levels].sort(([one], [other]) => one - other),
    };
  });

/** How many slices a strip is cut into: about one to a pixel of a phone's width. */
const SLICES = 360;

/** The share of each slice of the window an output ran for; null where nothing was heard of it. */
export const slicesOf = (strip: Pick<Strip, 'runs' | 'heardUntil'>, from: number, to: number, count = SLICES): (number | null)[] => {
  const width = (to - from) / count;
  let run = 0;

  return Array.from({ length: count }, (_, index) => {
    const start = from + index * width;
    const end = Math.min(start + width, strip.heardUntil);
    if (end <= start) return null;

    while (run < strip.runs.length && strip.runs[run].to <= start) run += 1;
    let ran = 0;
    for (let next = run; next < strip.runs.length && strip.runs[next].from < end; next += 1) {
      ran += Math.max(0, Math.min(strip.runs[next].to, end) - Math.max(strip.runs[next].from, start));
    }
    return ran / (end - start);
  });
};

/** What an output did at one instant: running or not, how hard where it says, and null where nobody heard of it. */
export const stateAt = (strip: Strip, time: number, stepMs: number): { on: boolean; level: number | null } | null => {
  if (time > strip.heardUntil) return null;
  const on = strip.runs.some(run => run.from <= time && time < run.to) || strip.runs.at(-1)?.to === time;
  // A level closes the window it stands for.
  const level = on ? (strip.levels.find(([end]) => end >= time && end - stepMs <= time)?.[1] ?? null) : null;
  return { on, level };
};

/** The share of the heard part of the window an output ran for, or null where nothing was heard. */
export const shareOf = (strip: Strip, from: number, to: number): number | null => {
  const heard = Math.min(to, strip.heardUntil) - from;
  if (heard <= 0) return null;
  return strip.runs.reduce((sum, run) => sum + Math.max(0, Math.min(run.to, to) - Math.max(run.from, from)), 0) / heard;
};

/** One curve of a panel, as it is named, read and written. */
export interface Curve {
  key: string;
  name: string;
  unit: string;
  colour: ChartToken;
  /** The figure as it is written beside this curve: a metric to its decimals, a grower's own reading as it was taken. */
  written: (value: number) => string;
  corner: (value: number) => string;
  points: PlotPoint[];
  /** The lowest and the highest of the window, samples and not means where the answer has them. */
  low: number | null;
  high: number | null;
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

/** Each point at the middle of the window its mean was taken over, which the store stamps at its close. */
const pointsOf = (points: SpaceTimeline['panels'][number]['points'], halfStep: number): PlotPoint[] =>
  points.map(point =>
    point.min !== undefined && point.max !== undefined
      ? ([at(point.measuredAt) - halfStep, point.value, point.min, point.max] as const)
      : ([at(point.measuredAt) - halfStep, point.value] as const),
  );

const extremesOf = (points: readonly PlotPoint[]): { low: number | null; high: number | null } => {
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
): { curve: Curve; bands: Plot['bands'] } | null => {
  const panel = data.panels.find(one => one.metric === metric);
  if (!panel) return null;

  const from = at(data.startsAt);
  const points = halfOf(pointsOf(panel.points, (data.stepSeconds * 1000) / 2), data.nights, metric === 'vpd' ? half : 'all');
  const bands = stretchesOf(panel, data.nights, from, heardUntil, data.transitions ?? NO_SPANS).map(stretch => ({
    from: stretch.from,
    to: stretch.to,
    low: stretch.target.band.low,
    high: stretch.target.band.high,
  }));
  const { low, high } = extremesOf(points);
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
      // Verlauf reads a humidity to the tenth the sensor delivers: a dehumidifier's swing of a per cent is what is looked for here.
      written: value => (metric === 'humidity' ? decimalFigure(value, 1) : figure(value, metric)),
      corner: value => targetFigure(value, metric),
      points,
      low,
      high,
      line: { key: metric, colour, shape: 'line', points, scale },
    },
  };
};

const measurementCurve = (
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
  const half = (compared.data.stepSeconds * 1000) / 2;
  return [
    {
      key: `${curve.key}~compared`,
      colour: curve.colour,
      shape: 'line',
      dashed: true,
      scale: curve.line.scale,
      points: panel.points.map(point => [at(point.measuredAt) - half + compared.shift, point.value] as const),
    },
  ];
};

interface PanelsInput {
  shown: Shown;
  one: boolean;
  vpdHalf: VpdHalf;
  measured: readonly { definition: MeasurementDefinition; points: readonly GrowSeriesPoint[] }[];
  compared: Compared | null;
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
  const quiet = quietSince(data);
  const heardUntil = quiet === null ? to : quiet + (data.stepSeconds * 1000) / 2;
  const nights = data.nights
    .map(night => ({ from: at(night.startsAt), to: Math.min(at(night.endsAt), heardUntil) }))
    .filter(night => night.to > night.from);
  const drawn = [
    ...input.shown.metrics.flatMap(metric => {
      const made = metricCurve(t, data, metric, input.vpdHalf, heardUntil, input.compared);
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

/** The point nearest the cursor, within a step and a half of it: what was measured there, and null across a silence. */
export const nearestPoint = (points: readonly PlotPoint[], time: number, reach: number): PlotPoint | null => {
  let found: PlotPoint | null = null;
  for (const point of points) {
    if (point[1] === null) continue;
    if (found === null || Math.abs(point[0] - time) < Math.abs(found[0] - time)) found = point;
    else if (point[0] > time) break;
  }
  return found && Math.abs(found[0] - time) <= reach ? found : null;
};

/** How near the cursor a point has to stand to be read at it. */
export const reachOf = (data: Pick<SpaceTimeline, 'stepSeconds' | 'startsAt' | 'endsAt'>, curve: Pick<Curve, 'line'>): number =>
  curve.line.shape === 'points' ? (at(data.endsAt) - at(data.startsAt)) / 100 : Math.max(data.stepSeconds, 1) * 1500;

/** When the place last measured, where it has been quiet since; null while it is still heard. */
export const quietSince = (data: SpaceTimeline): number | null => {
  if (data.panels.length === 0 || !data.panels.every(panel => panel.points.at(-1)?.value === null)) return null;
  const heard = data.panels.flatMap(panel => panel.points.filter(point => point.value !== null).map(point => at(point.measuredAt)));
  // Where its last point is drawn: the middle of the window that point is the mean of.
  return heard.length === 0 ? null : Math.max(...heard) - (data.stepSeconds * 1000) / 2;
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
  from: number,
  to: number,
  zone: string | null,
): string => {
  const titled = (curve: Curve, what: string | null = null) =>
    [curve.name, what].filter(Boolean).join(' · ') + (curve.unit ? ` (${curve.unit})` : '');
  const curves = panels.flatMap(panel => panel.curves);
  const columns: CsvColumn[] = [
    ...curves.flatMap(curve => {
      const spread = curve.points.some(point => point[2] !== undefined);
      return [
        { label: titled(curve), points: curve.points.map(([time, value]) => [time, value] as [number, number | null]) },
        ...(spread
          ? [
              {
                label: titled(curve, t('timeline.low')),
                points: curve.points.map(([time, value, min]) => [time, value === null ? null : (min ?? value)] as [number, number | null]),
              },
              {
                label: titled(curve, t('timeline.high')),
                points: curve.points.map(([time, value, , max]) => [time, value === null ? null : (max ?? value)] as [number, number | null]),
              },
            ]
          : []),
      ];
    }),
    ...strips.map(strip => ({
      label: t('timeline.csvOutput', { output: strip.name }),
      holds: true,
      points: [
        [from, 0] as [number, number | null],
        ...strip.runs.flatMap(run => [
          [Math.max(from, run.from), 1] as [number, number | null],
          ...(run.to < strip.heardUntil ? [[run.to, 0] as [number, number | null]] : []),
        ]),
        ...(strip.heardUntil < to ? [[strip.heardUntil + 1, null] as [number, number | null]] : []),
      ],
    })),
  ];

  return csvOf(columns, zone, t('timeline.csvTime'));
};
