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
import { BY_CLOCK } from '@/charts/ticks';
import { csvOf, niceScale, type CsvColumn, type Plot, type PlotLine, type PlotPoint, type PlotSpan } from '@/charts/series';
import type { ChartToken } from '@/charts/tokens';
import type { Translate } from '@/i18n/i18n';
import { outputWord } from '@/ui/climate-hardware';
import { decimalFigure, looseFigure } from '@/ui/figures';
import { VALUE_AGE } from '@fg2/shared-types/v1-schemas/value-age.js';
import { figure, targetFigure, UNIT } from '@/ui/units';
import { CLOCK, zonedAt } from '@/ui/zone';
import { GRAINED_FROM_MS, grainMinutes, type VpdHalf } from './view';
import { alarmsOf, at, spans, stretchesOf } from './window';

/**
 * What one answer comes to on the page: which curves the place has, which of them are ticked, and each panel as the
 * plot, the figures and the strips it is drawn from. All of it is arithmetic on the answer, so the screen holds only
 * the view and hands the rest here.
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
  machine: data.events.some(entry => entry.source !== 'human') || data.machineEvents.total > 0 || (data.stretches ?? []).length > 0,
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
  const measurements = offered.measurements.map(one => one.key).filter(key => keys?.includes(MEASUREMENT + key) ?? offered.metrics.length === 0);
  // An address that names no curve the place has - none at all, the diary alone, a word that is none - draws the
  // first ones: there is one answer to "no curve", and it is not an empty page.
  const first = keys === null || (measurements.length === 0 && !offered.metrics.some(metric => keys.includes(metric)));
  const metrics = offered.metrics.filter(metric => (first ? FIRST_READ.includes(metric) : keys.includes(metric)) || metric === focus);

  return {
    // A place that measures none of the first three opens on what it does measure.
    metrics: first && metrics.length === 0 ? offered.metrics : metrics,
    measurements,
    light: offered.light && (ticked('light') || focus === 'light'),
    outputs: offered.outputs && ticked('outputs'),
    diary: ticked('diary'),
    machine: offered.machine && ticked('machine'),
  };
};

/** One drawn point of an output: its window's close, its samples, those it ran in, its mean level in per cent, and the server's word that a silence lay before it. */
export type StripPoint = readonly [end: number, heard: number, on: number, level: number | null, resumed?: boolean];

/** One output across the devices that drive it. Everything said about it is counted from `points`, the samples of each drawn window. */
export interface Strip {
  output: OutputMetric;
  name: string;
  points: StripPoint[];
  /** The stretches it ran for, by the second where the read knew it. */
  runs: PlotSpan[];
  /** What stands beside its name, fact by fact: the lamp's stretches by the clock, the share of the time it ran, how hard; null where nothing was heard. */
  said: string[] | null;
}

/** What an output did over one drawn point or at one reading: the share of the samples it ran in, and its level in per cent where it has one. */
export type OutputFigure = { share: number; level: number | null };

/** What an output is called: a fridge's name for it where every lane of it is a fridge's. */
const outputTitle = (t: Translate, output: OutputMetric, lanes: readonly TimelineOutputLane[]): string =>
  t(`timeline.output.${outputWord(output, lanes.length > 0 && lanes.every(lane => lane.fridge === true))}`, { defaultValue: output });

/** The order the strips stand in and are read out in: the lamp first, then what a grower steers by. */
const ORDER: OutputMetric[] = ['light', 'heater', 'dehumidifier', 'co2', 'fan', 'fanInternal', 'fanExternal', 'fanBackwall', 'relais'];

/** Where the lamp's words are read by: the account's zone, whether the window ends now, and the reading's instant once it is stale. */
type Said = { zone: string | null; live: boolean; quietAt: number | null };

export const stripsOf = (t: Translate, data: SpaceTimeline, said: Said = { zone: null, live: false, quietAt: null }): Strip[] =>
  ORDER.filter(output => data.outputs.some(lane => lane.output === output)).map(output => {
    const lanes = data.outputs.filter(lane => lane.output === output);
    // Two devices that drive the same output are counted together: the samples of both, and the mean of them all.
    const points = new Map<number, [heard: number, on: number, level: number | null, resumed: boolean]>();
    for (const { measuredAt, heard, on, level, resumed } of lanes.flatMap(lane => lane.points ?? [])) {
      const [known, ran, mean, quiet] = points.get(at(measuredAt)) ?? [0, 0, level, true];
      const mixed = mean === null || level === null ? null : (mean * known + level * heard) / (known + heard);
      points.set(at(measuredAt), [known + heard, ran + on, mixed, quiet && resumed === true]);
    }

    const strip = {
      output,
      name: outputTitle(t, output, lanes),
      points: [...points].sort(([one], [other]) => one - other).map(([end, said]) => [end, ...said] as const),
      // The spans say only when, for the lamp's stretches by the clock and a silence's ends: no figure is taken from a run.
      runs: lanes.flatMap(lane => lane.spans.map(span => ({ from: at(span.startsAt), to: at(span.endsAt) }))),
    };
    const blocks = blocksOf(strip, at(data.startsAt), at(data.endsAt), Math.max(data.stepSeconds, 1) * 1000);
    const share = overTime(blocks, block => block.share);
    if (share === null) return { ...strip, said: null };
    // One sample is no share of any time: it is said as what it was.
    const [once] = strip.points.length === 1 && strip.points[0][1] === 1 ? strip.points : [];
    if (once) return { ...strip, said: [once[2] === 0 ? t('timeline.off') : once[3] === null ? t('timeline.on') : `${Math.round(once[3])}\u00a0%`] };
    if (output === 'light') return { ...strip, said: lightWords(t, strip, data, share, said) };
    // One driven at a level adds how hard it ran: its mean level over the time it was heard, off counting as none.
    const level = strip.points.some(point => point[3] !== null) && share > 0 ? overTime(blocks, block => block.level ?? 0) : null;
    const mean = level === null ? [] : [t('timeline.meanLevel', { level: Math.round(level) })];
    return { ...strip, said: [t('timeline.lightShare', { share: Math.round(share * 100) }), ...mean] };
  });

/**
 * Where the stretch each point of a strip stands for begins: the point before it - a device slower than it is drawn
 * is one stretch, as its curve is a line -, or its own step where the server says the device had been silent.
 */
const startsOf = (points: readonly StripPoint[], from: number, stepMs: number): number[] =>
  points.map(([end, , , , resumed], index) => Math.max(from, resumed ? end - stepMs : (points[index - 1]?.[0] ?? from)));

/**
 * The lamp over the window, fact by fact and in one order at every range: its lit stretches by the clock where they
 * are few, the share of the time it was on, how bright - with its stretch, or once where every stretch ran alike.
 * A stretch is named by the ends it has, a switch only where one is, and each fact once (app-ux.md §7).
 */
const lightWords = (t: Translate, light: Pick<Strip, 'points' | 'runs'>, data: SpaceTimeline, share: number, said: Said): string[] => {
  const { zone, live, quietAt } = said;
  const [from, to, stepMs] = [at(data.startsAt), at(data.endsAt), Math.max(data.stepSeconds, 1) * 1000];
  const clock = (time: number) => zonedAt(time, zone).toFormat(stepMs < 60_000 ? `${CLOCK}:ss` : CLOCK);
  const percent = (level: number | null) => (level === null ? null : `${level}\u00a0%`);
  const gapTo = (time: number) => t('timeline.lightGap', { to: clock(time) });
  // How bright a stretch ran while it was lit: the middle of its points' levels, which a ramp at either end does not move.
  const levelOf = (run: PlotSpan): number | null => {
    const lit = light.points.filter(([end, , on]) => end > run.from && end <= run.to + stepMs && on > 0);
    const levels = lit.map(([, heard, on, level]) => Math.round(((level ?? 0) * heard) / on)).sort((one, other) => one - other);
    return levels[levels.length >> 1] ?? null;
  };
  const ran = t('timeline.lightShare', { share: Math.round(share * 100) });
  const lit = light.runs.filter(one => one.to > from && one.from < to).sort((one, other) => one.from - other.from);
  if (lit.length === 0 || lit.length > 3 || to - from > BY_CLOCK)
    return [ran, lit.length > 0 ? percent(levelOf({ from, to })) : null].flatMap(one => one ?? []);

  const starts = startsOf(light.points, from, stepMs);
  const heard = (time: number) => light.points.some(([end], index) => starts[index] <= time && time < end);
  const levels = lit.map(levelOf);
  const alike = levels.every(level => level === levels[0]);
  // Nothing was heard a step before it began: the device came back with the lamp lit, and nothing switched.
  const resumed = lit.map(one => one.from > from && !heard(Math.max(from, one.from - stepMs)));
  const stretches = lit.flatMap((one, index) => {
    const [began, stale] = [one.from > from, quietAt !== null && one.to >= quietAt - stepMs];
    const ended = one.to < to || stale;
    // Heard a step after the stretch ended: the lamp was switched off, by its device or by one that took the place over.
    const quiet = stale || (ended && !heard(Math.min(one.to + stepMs, to - 1)));
    // Heard again later: the silence is over, and the stretch ends in a gap rather than on the device's last word.
    const back = stale ? undefined : light.points.find(([end]) => end - stepMs > one.to);
    const mark = quiet && !back ? 'Quiet' : '';
    const until = clock(stale ? (quietAt as number) : one.to);
    const [open, shut] = [began ? (live ? 'lightSince' : 'lightFrom') : 'lightThroughout', `${began ? 'lightSpan' : 'lightUntil'}${mark}`];
    const key = resumed[index] ? `lightOn${ended ? `Until${mark}` : ''}` : ended ? shut : open;
    // The gap after it is said here unless the next stretch begins where it ends, and says it.
    const gap = quiet && back && !(resumed[index + 1] && lit[index + 1].from <= back[0]);
    const facts = [resumed[index] ? gapTo(one.from) : null, t(`timeline.${key}`, { from: clock(one.from), to: until })];
    return [...facts, alike ? null : percent(levels[index]), gap ? gapTo(back[0] - stepMs) : null];
  });
  const always = Math.round(share * 100) === 100;
  return [...stretches, always ? null : ran, alike && !(always && (levels[0] ?? 100) >= 100) ? percent(levels[0]) : null].flatMap(one => one ?? []);
};

/** The drawn point an instant falls into: a point closes its window, and stands for the step before it. */
const pointAt = (strip: Pick<Strip, 'points'>, time: number, stepMs: number): StripPoint | undefined =>
  strip.points.find(([end]) => end - stepMs <= time && time < end) ?? strip.points.findLast(([end]) => end === time);

/** What an output did over that point, and null where nothing was heard of it there, which is not "off". */
export const figureAt = (strip: Pick<Strip, 'points'>, time: number, stepMs: number): OutputFigure | null => {
  const point = pointAt(strip, time, stepMs);
  return point ? { share: point[2] / point[1], level: point[3] } : null;
};

/** Whether that point is one sample of every output: it is then no mean, and its stamp does not call it one. */
export const singleAt = (strips: readonly Pick<Strip, 'points'>[], time: number, stepMs: number): boolean => {
  const found = strips.flatMap(strip => [pointAt(strip, time, stepMs)].filter(point => point !== undefined));
  return found.length > 0 && found.every(point => point[1] === 1);
};

/**
 * What an output's drawn stretches come to over the time its device was heard - not over the window, and not by
 * samples: a day of live samples outweighed a week of history, and a 12/12 lamp read 61 %. Null where none was heard.
 */
export const overTime = (blocks: readonly StripBlock[], of: (block: StripBlock) => number): number | null => {
  const heard = blocks.reduce((sum, block) => sum + block.to - block.from, 0);
  return heard > 0 ? blocks.reduce((sum, block) => sum + of(block) * (block.to - block.from), 0) / heard : null;
};

/** One stretch of a strip that is drawn alike, its ends as fractions of the window. */
export type StripBlock = { from: number; to: number } & OutputFigure;

/**
 * A strip as it is drawn: each point over the step it stands for, neighbours that say the same as one block.
 * Where no point stands nothing was heard, and nothing is drawn - not even "off".
 */
export const blocksOf = (strip: Pick<Strip, 'points'>, from: number, to: number, stepMs: number): StripBlock[] => {
  const width = to - from;
  if (width <= 0) return [];

  const starts = startsOf(strip.points, from, stepMs);
  return strip.points.reduce<StripBlock[]>((kept, [end, heard, on, level], index) => {
    const block = { from: (starts[index] - from) / width, to: (Math.min(to, end) - from) / width, share: on / heard, level };
    const last = kept.at(-1);
    if (block.to <= block.from) return kept;
    if (last && last.to === block.from && last.share === block.share && last.level === block.level) last.to = block.to;
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
  /** The lowest and the highest of the window: of single samples, and of a deficit beyond three days of its five-minute means. */
  low: number | null;
  high: number | null;
  /** What the low and the high are of, where they are not of samples: a deficit's over more than three days. */
  of?: string;
  /** Where the device's last reading stands as the curve's last point, in a window that ends now; null elsewhere. */
  lastAt: number | null;
  /** The stretch a point stands for where that is not its whole window - what was heard of one a silence or the read's end cuts. */
  over?: ReadonlyMap<number, PlotSpan>;
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

/** A drawn point with the window it is the mean of, and the stretch it stands for where that is not the whole window. */
interface Placed {
  point: PlotPoint;
  opens: number;
  stamp: number;
  over: PlotSpan | null;
}

/** What was heard of a window: the window less every silence, a silence's own ends being samples that were heard. */
const heardParts = (opens: number, stamp: number, silences: readonly (readonly [number, number])[]): PlotSpan[] => {
  const parts: PlotSpan[] = [];
  let from = opens;
  for (const [since, until] of silences) {
    if (until <= from || since >= stamp) continue;
    if (since >= from) parts.push({ from, to: since });
    from = Math.max(from, until);
  }
  if (from <= stamp) parts.push({ from, to: stamp });
  return parts;
};

/**
 * Each point where it belongs: a mean at the middle of its window, a single sample at its own time. Where the read's
 * end cuts a window short, or a silence ends or begins in it, its point stands in the middle of what was heard of it,
 * at a whole second - never inside the silence beside it: a window whose one sample is the last before a silence
 * stands on that sample. The grid is read off the first point, which closes a window.
 */
const placedOf = (points: SpaceTimeline['panels'][number]['points'], stepSeconds: number, silences: readonly TimelineSpan[]): Placed[] => {
  const [grid, step] = [at(points.find(point => point.value !== null)?.measuredAt ?? points[0]?.measuredAt ?? ''), stepSeconds * 1000];
  const quiet = silences.map(span => [at(span.startsAt), at(span.endsAt)] as const).sort(([one], [other]) => one - other);
  return points.map(point => {
    const stamp = at(point.measuredAt);
    const opens = stamp - ((stamp - grid) % step || step);
    // The longest stretch that was heard; the first of two alike.
    const part = heardParts(opens, stamp, quiet).reduce<PlotSpan | null>(
      (best, one) => (best && best.to - best.from >= one.to - one.from ? best : one),
      null,
    );
    const whole = point.value === null || stepSeconds <= SAMPLE_SECONDS || part === null || part.to - part.from === step;
    const time = whole
      ? stamp - drawnBefore(stepSeconds)
      : part.to === part.from
        ? Math.floor(part.from / 1000) * 1000
        : Math.round((part.from + part.to) / 2000) * 1000;
    const drawn =
      point.min !== undefined && point.max !== undefined ? ([time, point.value, point.min, point.max] as const) : ([time, point.value] as const);
    return { point: drawn, opens, stamp, over: whole ? null : part };
  });
};

/** The stretches a curve was heard over: from the window its first point after a silence stands for to its last point's stamp, or to `until`. */
const heardOf = (points: SpaceTimeline['panels'][number]['points'], stepMs: number, until: number | null): PlotSpan[] => {
  const runs: PlotSpan[] = [];
  points.forEach((point, index) => {
    if (point.value === null) return;
    if (points[index - 1]?.value != null) runs[runs.length - 1].to = at(point.measuredAt);
    else runs.push({ from: at(point.measuredAt) - stepMs, to: at(point.measuredAt) });
  });
  if (until !== null && runs.length > 0) runs[runs.length - 1].to = until;
  return runs;
};

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
  const placed = placedOf(panel.points, data.stepSeconds, data.silences);
  const means = placed.map(one => one.point);
  // The device's last reading closes the curve: "jetzt" is that reading, not the mean of a month's last hour and a half.
  const lastAt = last?.value != null && last.measuredAt ? at(last.measuredAt) : null;
  // The mean of the window that reading fell into gives way to it: a device that stopped at 16:17 ends on that
  // reading, and the table carries the last sample once.
  const own = drawnBefore(data.stepSeconds);
  const kept =
    lastAt === null || lastAt > at(data.endsAt) + LATE_MS || lastAt < from
      ? null
      : placed.filter(
          ({ point, opens, stamp }) => point[1] === null || (!(opens <= lastAt && lastAt <= stamp) && (point[0] < lastAt || point[0] - lastAt > own)),
        );
  const before = kept?.map(one => one.point) ?? null;
  // A curve with means newer than the reading is ahead of it, and ends on its own.
  const closes = before !== null && !before.some(point => point[1] !== null && point[0] > (lastAt as number));
  const halved = (list: PlotPoint[]) => halfOf(list, data.nights, metric === 'vpd' ? half : 'all');
  const closing = [lastAt as number, last?.value ?? null] as const;
  const points = halved(closes ? [...before, closing] : means);
  // A target is drawn only where the curve was heard: not through a silence, not before the first reading, and on
  // to the window's end only under a reading that closes the curve.
  const heard = heardOf(panel.points, data.stepSeconds * 1000, closes ? heardUntil : null);
  const bands = stretchesOf(panel, data.nights, from, heardUntil, data.transitions ?? NO_SPANS).flatMap(stretch =>
    heard.flatMap(run => {
      const [start, end] = [Math.max(stretch.from, run.from), Math.min(stretch.to, run.to)];
      return end > start ? [{ from: start, to: end, low: stretch.target.band.low, high: stretch.target.band.high }] : [];
    }),
  );
  // The lowest and the highest are the window's, as the answer has them, with the reading: "Tief 0,90" over 0,79 is none.
  const { low, high } = extremesOf(halved(closes ? [...means, closing] : means));
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
      // A humidity is read to the tenth here, as the sensor delivers it: "Hoch 75" over a highest sample of 74,6
      // is wrong, and a dehumidifier's swing of a per cent is what is looked for. Start rounds it to whole per cent.
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
      over: new Map((closes ? (kept ?? placed) : placed).flatMap(one => (one.over ? [[one.point[0], one.over] as const] : []))),
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
  /** The device's last reading where the window holds it: each curve's last point. `silentSince` is its instant once it is stale. */
  now: { values: readonly CardValue[]; silentSince: number | null } | null;
  /** Where the strips with no curve of their own stand: under the last panel, or in a card of their own. */
  restUnderLast: boolean;
}

/**
 * The panels in the order they stack, each with the strips of the outputs that act on it. `rest` is what acts on none
 * of the curves drawn: the light, the fans, a socket's relay.
 */
export const panelsOf = (
  t: Translate,
  data: SpaceTimeline,
  strips: readonly Strip[],
  input: PanelsInput,
): { panels: PanelModel[]; rest: Strip[] } => {
  const [from, to] = [at(data.startsAt), at(data.endsAt)];
  // After a reading gone stale nothing is known: the band and the night stop at it. The answer shades no night
  // nobody reported in, and a band keeps to where its curve was heard.
  const heardUntil = Math.min(to, input.now?.silentSince ?? to);
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

  const panel = (key: string, metric: Metric | null, of: typeof drawn, own: Strip[]): PanelModel => ({
    key,
    metric,
    curves: of.map(one => one.curve),
    plot: {
      from,
      to,
      nights,
      // Several scales share one picture, so no band is drawn there: it would be read against the wrong one.
      bands: of.length === 1 ? of[0].bands : [],
      alarms: (of.length === 1 && metric ? alarmsOf(data.alarms, metric) : []).map(alarm => ({
        from: at(alarm.startedAt),
        to: alarm.endedAt ? at(alarm.endedAt) : to,
      })),
      lines: of.flatMap(one => [one.curve.line, ...comparedLine(one.curve, input.compared)]),
    },
    strips: own,
  });
  const panels =
    input.one && drawn.length > 1
      ? [
          panel(
            'one',
            null,
            drawn,
            strips.filter(strip => placed.has(strip.output)),
          ),
        ]
      : drawn.map(one => panel(one.curve.key, one.metric, [one], stripsFor(one.metric)));

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

/**
 * Where the cursor rests while nobody set it: on the last thing heard, which the card and every head then say. The
 * device's last reading where the window holds it, whatever is ticked, else the window's last drawn point - for a
 * place of outputs alone the last of their points, where a curve's would be drawn.
 */
export const restOf = (curves: readonly Curve[], strips: readonly Strip[], to: number, stepMs: number, readingAt: number | null): number => {
  const drawn = curves.flatMap(curve => (curve.line.shape === 'line' ? (curve.points.findLast(point => point[1] !== null)?.[0] ?? []) : []));
  const heard = strips.flatMap(strip => strip.points.at(-1)?.[0] ?? []).map(end => end - drawnBefore(stepMs / 1000));
  return readingAt ?? (drawn.length > 0 ? Math.max(...drawn) : heard.length > 0 ? Math.max(...heard) : to);
};

/** The device's last reading as the cursor reads it: its instant, and what it carries. */
type Heard = { at: number; values: readonly CardValue[] };

/**
 * What the cursor reads: one point - `at`, null where none stands near - which every figure and every output under
 * one stamp is of: the nearest on any line drawn. A curve with no figure there has none, which the card names with
 * a dash. On the device's last reading every curve reads what the reading carries of it; a value the reading says
 * from an instant older than a reading stays fresh says when (`saidAt`). A grow's measurements keep their own reach.
 */
export const readAt = (curves: readonly Curve[], cursor: number, reach: (curve: Curve) => number, reading: Heard | null) => {
  const lines = curves.filter(curve => curve.line.shape === 'line');
  const near = lines.flatMap(curve => nearestPoint(curve.points, cursor, reach(curve))?.[0] ?? []);
  const stood = cursor === reading?.at ? cursor : (near.sort((one, other) => Math.abs(one - cursor) - Math.abs(other - cursor))[0] ?? null);
  const onReading = stood !== null && (stood === reading?.at || lines.some(curve => curve.lastAt === stood));

  return {
    at: stood,
    onReading,
    points: curves.map(curve => {
      const line = curve.line.shape === 'line';
      const said = onReading && line ? reading?.values.find(value => value.metric === curve.key && value.value !== null) : undefined;
      const saidAt = said?.measuredAt ? at(said.measuredAt) : null;
      const where = onReading && curve.lastAt !== null ? curve.lastAt : stood;
      const point = line
        ? (curve.points.findLast(one => one[0] === where && one[1] !== null) ?? null)
        : nearestPoint(curve.points, cursor, reach(curve));
      const old = saidAt !== null && reading !== null && reading.at - saidAt > VALUE_AGE.liveSeconds * 1000;
      return { curve, point, value: said?.value ?? point?.[1] ?? null, saidAt: old ? saidAt : null };
    }),
  };
};

/**
 * The silence a cursor stands in, as the answer says it - one wider than two steps, so the cursor snaps to no
 * neighbour's mean inside it - with each end it was seen to have: null where it begins or ends with the window.
 */
export const silenceAt = (data: SpaceTimeline, cursor: number): [number | null, number | null] | null => {
  const [from, to] = [at(data.startsAt), at(data.endsAt)];
  const quiet = data.silences.map(span => [at(span.startsAt), at(span.endsAt)]).find(([since, until]) => since < cursor && cursor < until);
  return quiet && quiet[1] - quiet[0] > 2 * data.stepSeconds * 1000 ? [quiet[0] > from ? quiet[0] : null, quiet[1] < to ? quiet[1] : null] : null;
};

/**
 * What is on the screen, as a table: every curve ticked with the lowest and highest of each window beside its mean,
 * and every output drawn as the state it held.
 */
export const csvFor = (
  t: Translate,
  panels: readonly PanelModel[],
  strips: readonly Strip[],
  stepMs: number,
  /** Where the device's last reading closes the curves - the table's last row - and what it says of every output. */
  readingAt: number | null,
  said: ReadonlyMap<OutputMetric, OutputFigure>,
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
      const column = (what: string | null, of: (point: PlotPoint) => number | undefined): CsvColumn => ({
        label: titled(curve, what),
        decimals: curve.decimals,
        points: curve.points.map(point => [point[0], point[1] === null ? null : (of(point) ?? point[1])]),
      });
      const spread = curve.points.some(point => point[2] !== undefined);
      return [
        column(null, () => undefined),
        ...(spread ? [column(t('timeline.low'), point => point[2]), column(t('timeline.high'), point => point[3])] : []),
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
        const one = time === readingAt ? (said.get(strip.output) ?? null) : figureAt(strip, time, stepMs);
        return one ? [[time, one.level ?? one.share * 100] as [number, number | null]] : [];
      }),
    })),
  ];

  return csvOf(columns, zone, t('timeline.csvTime'), decimalComma);
};
