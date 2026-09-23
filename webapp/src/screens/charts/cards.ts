import type { GrowSeries, MeasurementDefinition, Metric, OutputMetric, TimelinePanel, TimelineTarget, TimelineTargets } from '@fg2/shared-types/v1';
import { vapourPressureDeficit } from '@fg2/shared-types/v1-schemas/vpd.js';
import { CHART_METRICS, CHART_OUTPUTS } from '@/api/charts';
import {
  axisFigure,
  csvOf,
  dayOfGrow,
  niceScale,
  setpointPoints,
  stepPoints,
  type CsvColumn,
  type Plot,
  type PlotLine,
  type PlotSpan,
} from '@/charts/series';
import type { ChartToken } from '@/charts/tokens';
import { UNIT } from '../home/units';
import { at, stretchesOf } from '../timeline/window';

/**
 * Which lines the answer can offer, which of them are ticked, and what that
 * comes to as cards.
 *
 * All of it is arithmetic on one answer, so the screen above holds only what
 * was ticked and hands the rest here to be drawn. Two rules live in this file
 * and are worth naming, because both are the board's.
 *
 * A chip is offered only for a line the account really has. The answer is asked
 * for every metric, every output and every measurement the grow charts, so a
 * metric no controller reported has no panel in it, an output nothing drives
 * has no lane and a measurement nobody has taken has no series - and none of
 * those three is offered.
 *
 * Two units share a panel only when they belong together. Temperature and
 * humidity do, which is why the board draws them overlaid on two axes; a tenth
 * of a kPa and a thousand ppm against one scale would say something untrue
 * about both, so everything else gets a card of its own.
 */

export interface Picked {
  metrics: Metric[];
  outputs: OutputMetric[];
  measurements: string[];
}

export type Layout = 'stacked' | 'overlay' | 'day_of_grow';

/** The one pair of units that belongs on one panel: what a tent is steered by, read together. */
const TOGETHER: Metric[] = ['temperature', 'humidity'];

/** The colour a line is drawn in. VPD and a grower's own measurements are ink: they are figures rather than signals. */
const METRIC_COLOUR: Partial<Record<Metric, ChartToken>> = { temperature: 'temperature', humidity: 'humidity', co2: 'co2' };

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** How far the leaf sits under the air in either half of the cycle, which is what turns a pair of targets into a deficit. */
export interface LeafOffsets {
  day: number;
  night: number;
}

/** A plant, as far as a chart needs one: a reading per plant is a line per plant, and each of them is called something. */
export interface PlantName {
  id: string;
  label: string;
}

/** The earlier run laid over this one, which is what the day-of-grow layout exists for. */
export interface Compared {
  series: GrowSeries;
  name: string;
}

/** What this answer has to offer, in the order the chips are drawn. */
export interface Offered {
  metrics: Metric[];
  outputs: OutputMetric[];
  measurements: MeasurementDefinition[];
}

export const offeredBy = (series: GrowSeries | undefined, definitions: readonly MeasurementDefinition[]): Offered => ({
  metrics: CHART_METRICS.filter(metric => (series?.climate ?? []).some(panel => panel.metric === metric && panel.points.length > 0)),
  outputs: CHART_OUTPUTS.filter(output => (series?.outputs ?? []).some(lane => lane.output === output && lane.spans.length > 0)),
  measurements: definitions.filter(definition => (series?.measurements ?? []).some(one => one.key === definition.key && one.points.length > 0)),
});

/** A saved view of a grow that has moved on draws less rather than failing, so what it names is cut to what is there. */
export const prunedTo = (picked: Picked, offered: Offered): Picked => ({
  metrics: picked.metrics.filter(metric => offered.metrics.includes(metric)),
  outputs: picked.outputs.filter(output => offered.outputs.includes(output)),
  measurements: picked.measurements.filter(key => offered.measurements.some(definition => definition.key === key)),
});

export const isEmpty = (picked: Picked): boolean => picked.metrics.length === 0 && picked.outputs.length === 0 && picked.measurements.length === 0;

/**
 * What a saved view named and this grow cannot draw. A view holds a question
 * and not a grow's readings, so one saved over another run opens here as well -
 * and then it has to say what it could not draw, rather than quietly drawing
 * fewer lines than the name on the chip promises.
 */
export const droppedBy = (t: Translate, picked: Picked, offered: Offered, defined: readonly MeasurementDefinition[]): string[] => [
  ...picked.metrics.filter(metric => !offered.metrics.includes(metric)).map(metric => t(`charts.metric.${metric}`, { defaultValue: metric })),
  ...picked.measurements
    .filter(key => !offered.measurements.some(one => one.key === key))
    .map(key => defined.find(one => one.key === key)?.name ?? key),
  ...picked.outputs.filter(output => !offered.outputs.includes(output)).map(output => t(`timeline.output.${output}`, { defaultValue: output })),
];

/** What the screen opens on: the climate a grower reads first, and nothing the account has not got. */
export const defaultPick = (offered: Offered): Picked => ({
  metrics: offered.metrics.filter(metric => metric !== 'co2'),
  outputs: [],
  measurements: [],
});

export interface Card {
  key: string;
  title: string;
  /** The muted clause after the title, saying what this panel is. */
  about: string;
  /** At the right of the header; two units that belong together are written as one. */
  unit: string;
  /** Each scale's two ends as they are written beside the plot; null where the scale is a switch and a figure would be an invention. */
  scaleEnds: ({ low: string; high: string } | null)[];
  plot: Plot;
  /** What the card could not take, named rather than dropped in silence. */
  left: string[];
}

/** One line before it is put on a card: what it is drawn from, what it is called and what it is measured in. */
interface Drawn {
  key: string;
  title: string;
  about: string;
  unit: string;
  lines: PlotLine[];
  /** Everything the scale of this line's unit has to hold: what was measured, and what was aimed at. */
  values: number[];
  csv: CsvColumn;
}

export interface CardsInput {
  picked: Picked;
  layout: Layout;
  offered: Offered;
  leaf: LeafOffsets | null;
  plants: readonly PlantName[];
  /** Set only in the day-of-grow layout, which is the one thing two runs can share an axis in. */
  compared?: Compared;
}

export const cardsOf = (t: Translate, series: GrowSeries, input: CardsInput): Card[] => {
  const drawn = alongside(t, drawnOf(t, series, input), series, input);
  if (drawn.length === 0) return [];

  const cards = input.layout === 'overlay' ? [overlaid(t, drawn)] : stacked(t, drawn);

  return cards
    .map(card => (input.layout === 'day_of_grow' ? rebased(card, at(series.originAt)) : card))
    .map(card => framed(card, series, input.layout));
};

/**
 * One card per line, except the two that belong together: they are the panel
 * the board draws as "Temp + RH", with the second of them against its own
 * scale.
 */
const stacked = (t: Translate, drawn: Drawn[]): Card[] => {
  const pair = TOGETHER.every(metric => drawn.some(one => one.key === metric))
    ? TOGETHER.map(metric => drawn.find(one => one.key === metric)!)
    : null;
  const cards = drawn
    .filter(one => !pair || !TOGETHER.includes(one.key as Metric))
    .map(one => cardOf(one.key, one.title, one.about, one.unit, [one], []));

  if (pair) cards.unshift(cardOf(pair.map(one => one.key).join('+'), pair.map(one => one.title).join(' + '), t('charts.about.pair'), '', pair, []));

  return cards;
};

/**
 * Everything on one card. The first unit is the card's; a second joins it only
 * where the two belong together, and whatever is in a third is named as left
 * out rather than drawn against a scale that is not its own.
 */
const overlaid = (t: Translate, drawn: Drawn[]): Card => {
  const units = [...new Set(drawn.map(one => one.unit))];
  const kept = units.slice(0, together(drawn, units) ? 2 : 1);
  const taken = drawn.filter(one => kept.includes(one.unit));
  const left = drawn.filter(one => !kept.includes(one.unit));

  return cardOf(
    'overlay',
    taken.map(one => one.title).join(' + '),
    t(kept.length > 1 ? 'charts.about.pair' : 'charts.about.overlay'),
    '',
    taken,
    left.map(one => one.title),
  );
};

/** Two units on one card only when they are the pair a tent is steered by, or when they are in truth one unit. */
const together = (drawn: Drawn[], units: string[]): boolean => {
  if (units.length <= 1) return true;
  const both = units.slice(0, 2).map(unit => drawn.find(one => one.unit === unit));

  return both.every(one => one !== undefined && TOGETHER.includes(one.key as Metric));
};

/** The card, with each line put against the scale its unit owns and each scale worked out from what lands on it. */
const cardOf = (key: string, title: string, about: string, unit: string, drawn: Drawn[], left: string[]): Card => {
  const units = [...new Set(drawn.map(one => one.unit))];
  const lines = drawn.flatMap(one => one.lines.map(line => ({ ...line, axis: (units.indexOf(one.unit) === 1 ? 1 : 0) as 0 | 1 })));
  const on = units.map(name => drawn.filter(one => one.unit === name));
  const scales = on.map(here => niceScale(here.flatMap(one => one.values)));

  return {
    key,
    title,
    about,
    unit: unit || units.filter(Boolean).join(' · '),
    // A square wave runs between off and on, and the round figures a scale is
    // stretched to - -0.5 and 1.5 - are not states anything was ever in.
    scaleEnds: scales.map((scale, index) =>
      on[index].every(one => one.lines.every(line => line.shape === 'step')) ? null : { low: axisFigure(scale.low), high: axisFigure(scale.high) },
    ),
    plot: { axis: 'time', from: 0, to: 0, scales, nights: [], lines },
    left,
  };
};

/** The window, the nights and the axis, which are the same for every card on the screen. */
const framed = (card: Card, series: GrowSeries, layout: Layout): Card => {
  const origin = at(series.originAt);
  const day = layout === 'day_of_grow';
  const stamp = (time: number) => (day ? dayOfGrow(time, origin) : time);

  return {
    ...card,
    plot: {
      ...card.plot,
      axis: day ? 'day' : 'time',
      from: stamp(at(series.startsAt)),
      to: stamp(at(series.endsAt)),
      nights: series.nights.map(night => ({ from: stamp(at(night.startsAt)), to: stamp(at(night.endsAt)) })),
    },
  };
};

/** Every x on the card counted in days rather than in dates, which is what makes two runs of one tent comparable. */
const rebased = (card: Card, originAt: number): Card => ({
  ...card,
  plot: {
    ...card.plot,
    lines: card.plot.lines.map(line => ({
      ...line,
      points: line.points.map(([time, value]) => [dayOfGrow(time, originAt), value] as [number, number | null]),
      bands: (line.bands ?? []).map(band => ({ ...band, from: dayOfGrow(band.from, originAt), to: dayOfGrow(band.to, originAt) })),
    })),
  },
});

/**
 * The earlier run's lines, folded in beside the ones they can be read against.
 *
 * Two grows are two answers about two different stretches of the calendar, and
 * the only thing that makes them one picture is the day counter. So the other
 * run's instants are moved onto this one's origin here, and the day axis that
 * rebases every x afterwards counts both of them from their own day 1 without a
 * second rebasing having to be kept in step with the first. It carries no band
 * and no setpoint: what the earlier run was aimed at is not what this one is,
 * and two greens on one card cannot be told apart anyway.
 */
const alongside = (t: Translate, drawn: Drawn[], series: GrowSeries, input: CardsInput): Drawn[] => {
  const compared = input.compared;
  if (!compared || input.layout !== 'day_of_grow') return drawn;

  const other = drawnOf(t, compared.series, { ...input, compared: undefined, leaf: null });
  const origin = at(series.originAt);
  const theirs = at(compared.series.originAt);

  return drawn.map(one => {
    const mine = other.find(two => two.key === one.key);
    if (!mine) return one;

    const lines = mine.lines
      .filter(line => line.label !== undefined)
      .map(line => ({
        ...line,
        key: `${line.key}~compared`,
        label: `${line.label} · ${compared.name}`,
        dashed: true,
        bands: undefined,
        points: line.points.map(([time, value]) => [time - theirs + origin, value] as [number, number | null]),
      }));

    return { ...one, lines: [...one.lines, ...lines], values: [...one.values, ...mine.lines.flatMap(valuesOf)] };
  });
};

const valuesOf = (line: PlotLine): number[] => line.points.flatMap(([, value]) => (value === null ? [] : [value]));

/** Every ticked line, in the order the chips stand in, as something that can be put on a card. */
const drawnOf = (t: Translate, series: GrowSeries, input: CardsInput): Drawn[] => [
  ...input.offered.metrics
    .filter(metric => input.picked.metrics.includes(metric))
    .flatMap(metric => {
      const panel = series.climate.find(one => one.metric === metric);

      return panel ? [metricDrawn(t, metric, panel, series, input.leaf)] : [];
    }),
  ...input.offered.measurements
    .filter(definition => input.picked.measurements.includes(definition.key))
    .flatMap(definition => {
      const measured = series.measurements.find(one => one.key === definition.key);

      return measured ? [measurementDrawn(t, definition, measured.points, input.plants, at(series.startsAt), at(series.endsAt))] : [];
    }),
  ...input.offered.outputs
    .filter(output => input.picked.outputs.includes(output))
    .flatMap(output => {
      const lanes = series.outputs.filter(one => one.output === output);

      return lanes.length > 0 ? [outputDrawn(t, output, lanes, at(series.startsAt), at(series.endsAt))] : [];
    }),
];

const metricDrawn = (t: Translate, metric: Metric, panel: TimelinePanel, series: GrowSeries, leaf: LeafOffsets | null): Drawn => {
  const from = at(series.startsAt);
  const to = at(series.endsAt);
  const aimed = metric === 'vpd' && panel.targets.length === 0 && leaf ? { ...panel, targets: vpdTargetsOf(series, leaf) } : panel;
  const stretches = stretchesOf(aimed, series.nights, from, to);
  const points = panel.points.map(point => [at(point.measuredAt), point.value] as [number, number | null]);
  const title = t(`charts.metric.${metric}`, { defaultValue: metric });
  const unit = UNIT[metric] ?? '';

  return {
    key: metric,
    title,
    about: aboutMetric(t, metric, stretches.length > 0, leaf),
    unit,
    values: [
      ...panel.points.flatMap(point => (point.value === null ? [] : [point.value])),
      ...stretches.flatMap(stretch => [stretch.target.band.low, stretch.target.band.high]),
    ],
    lines: [
      {
        key: metric,
        label: title,
        unit,
        shape: 'line',
        colour: METRIC_COLOUR[metric] ?? 'ink',
        axis: 0,
        points,
        bands: stretches.map(stretch => ({ from: stretch.from, to: stretch.to, low: stretch.target.band.low, high: stretch.target.band.high })),
      },
      ...(stretches.length > 0
        ? [
            {
              key: `${metric}-setpoint`,
              shape: 'line' as const,
              colour: 'muted' as ChartToken,
              axis: 0 as const,
              dashed: true,
              points: setpointPoints(stretches.map(stretch => ({ from: stretch.from, to: stretch.to, value: stretch.target.setpoint }))),
            },
          ]
        : []),
    ],
    csv: { label: unit ? `${title} (${unit})` : title, points },
  };
};

/**
 * What the VPD panel is aimed at.
 *
 * A controller is steered by a temperature and a humidity and never by a
 * deficit, so there is no VPD target anywhere upstream to hand down: the band
 * is what the pair the tent is already steered to amounts to, worked out along
 * the contract's own curve - the one the targets screen prints beside the two
 * dials and the one the server charts a reading's VPD along. That is also what
 * makes it move with the phase without being told to: it is read off the two
 * bands that already do.
 *
 * Its ends are the corners of the box those two describe, because the deficit
 * rises with the air and falls with the humidity - cool and damp is its low end
 * and warm and dry its high one - and each half of the cycle uses the leaf
 * offset the device holds for that half.
 */
const vpdTargetsOf = (series: GrowSeries, leaf: LeafOffsets): TimelineTargets[] => {
  const warm = series.climate.find(one => one.metric === 'temperature');
  const damp = series.climate.find(one => one.metric === 'humidity');
  if (!warm || !damp) return [];

  return warm.targets.flatMap(stretch => {
    const wet = damp.targets.find(one => one.startsAt === stretch.startsAt && one.endsAt === stretch.endsAt);
    if (!wet) return [];

    return [{ ...stretch, day: vpdTarget(stretch.day, wet.day, leaf.day), night: vpdTarget(stretch.night, wet.night, leaf.night) }];
  });
};

const vpdTarget = (warm: TimelineTarget | null, damp: TimelineTarget | null, offset: number): TimelineTarget | null =>
  warm && damp
    ? {
        setpoint: deficit(warm.setpoint, damp.setpoint, offset),
        band: { low: deficit(warm.band.low, damp.band.high, offset), high: deficit(warm.band.high, damp.band.low, offset) },
      }
    : null;

/** Two decimals, which is what a kPa is worth and what every other VPD figure in the app is written to. */
const deficit = (temperature: number, humidity: number, offset: number): number =>
  Math.round(vapourPressureDeficit(temperature, temperature + offset, Math.min(100, Math.max(0, humidity))) * 100) / 100;

/**
 * A grower's own measurement: the readings as they were written, joined by a
 * thin line so that a season reads as a shape, and what was aimed at drawn the
 * way the climate panels draw it - a green band where the definition names both
 * ends, and one dashed line where it names only one, because a band needs two
 * sides and half of one is a threshold rather than a range.
 *
 * A measurement taken per plant is a line per plant. One line through every
 * plant's readings in the order they happen to have been written is a zig-zag
 * between three different plants and says nothing true about any of them.
 */
const measurementDrawn = (
  t: Translate,
  definition: MeasurementDefinition,
  readings: readonly { measuredAt: string; value: number; plantId: string | null }[],
  plants: readonly PlantName[],
  from: number,
  to: number,
): Drawn => {
  const points = readings.map(reading => [at(reading.measuredAt), reading.value] as [number, number | null]);
  // One end alone is a line to stay under or over; two are the band above.
  const edge = definition.targetMin !== null && definition.targetMax !== null ? null : (definition.targetMin ?? definition.targetMax);
  const bands =
    definition.targetMin !== null && definition.targetMax !== null
      ? [{ from, to, low: definition.targetMin, high: definition.targetMax }]
      : undefined;
  const perPlant = definition.perPlant ? [...new Set(readings.map(reading => reading.plantId))] : [null];

  return {
    key: definition.key,
    title: definition.name,
    about: [t('charts.about.measured'), definition.perPlant ? t('charts.about.perPlant') : null].filter(Boolean).join(' · '),
    unit: definition.unit,
    values: [...readings.map(reading => reading.value), ...[definition.targetMin, definition.targetMax].filter((end): end is number => end !== null)],
    lines: [
      ...perPlant.map((plantId, index) => ({
        key: plantId === null ? definition.key : `${definition.key}:${plantId}`,
        label: plantLabel(definition.name, plantId, plants),
        unit: definition.unit,
        shape: 'points' as const,
        colour: 'ink' as ChartToken,
        axis: 0 as const,
        points: readings
          .filter(reading => plantId === null || reading.plantId === plantId)
          .map(reading => [at(reading.measuredAt), reading.value] as [number, number | null]),
        // The target belongs to the measurement and not to a plant, so it is drawn once however many plants carry it.
        bands: index === 0 ? bands : undefined,
      })),
      ...(edge === null
        ? []
        : [
            {
              key: `${definition.key}-target`,
              shape: 'line' as const,
              colour: 'muted' as ChartToken,
              axis: 0 as const,
              dashed: true,
              points: setpointPoints([{ from, to, value: edge }]),
            },
          ]),
    ],
    csv: { label: definition.unit ? `${definition.name} (${definition.unit})` : definition.name, points },
  };
};

/** "Height · Amnesia 1", or the measurement's own name where it is about the grow rather than about one plant. */
const plantLabel = (name: string, plantId: string | null, plants: readonly PlantName[]): string => {
  const plant = plantId === null ? null : plants.find(one => one.id === plantId);

  return plant ? `${name} · ${plant.label}` : name;
};

/**
 * An output as the square wave its spans describe.
 *
 * Two controllers in one tent each drive their own light and answer their own
 * lane, and the line is when any of them ran: overlapping spans are joined
 * first, because a list sorted by start alone walks back across the panel the
 * moment one machine's window begins inside another's. The card says how many
 * were pooled rather than passing off two machines as one.
 *
 * The wave is drawn as far as the last of them was heard from, and no further.
 * It is the latest and not the earliest of the lanes on purpose: where one
 * controller of a tent has gone quiet and another is still reporting, the tent's
 * lamp is still known about, and cutting at the first silence would erase what
 * the second machine is saying.
 */
const outputDrawn = (
  t: Translate,
  output: OutputMetric,
  lanes: readonly { deviceId: string; spans: readonly { startsAt: string; endsAt: string }[]; heardUntil: string }[],
  from: number,
  to: number,
): Drawn => {
  const spans = joined(
    lanes.flatMap(lane => lane.spans.map(span => ({ from: at(span.startsAt), to: at(span.endsAt) }))).sort((one, other) => one.from - other.from),
  );
  const points = stepPoints(spans, from, to, Math.max(...lanes.map(lane => at(lane.heardUntil))));
  const title = t(`timeline.output.${output}`, { defaultValue: output });
  const devices = new Set(lanes.map(lane => lane.deviceId)).size;

  return {
    key: `out-${output}`,
    title,
    about: devices > 1 ? t('charts.about.outputPooled', { count: devices }) : t('charts.about.output'),
    unit: '',
    values: [0, 1],
    lines: [{ key: `out-${output}`, label: title, shape: 'step', colour: 'warning', axis: 0, points }],
    // A state stands until it switches, so the column reads across the rows the climate put in the table.
    csv: { label: t('charts.csvOutput', { output: title }), points, holds: true },
  };
};

/** Spans sorted by start, run together where they touch or overlap, so the wave only ever steps forwards. */
const joined = (spans: readonly PlotSpan[]): PlotSpan[] =>
  spans.reduce<PlotSpan[]>((run, span) => {
    const last = run.at(-1);
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else run.push({ ...span });

    return run;
  }, []);

const aboutMetric = (t: Translate, metric: Metric, steered: boolean, leaf: LeafOffsets | null): string =>
  [steered ? t('charts.about.band') : null, metric === 'vpd' && leaf ? leafAbout(t, leaf) : null].filter(Boolean).join(' · ');

/**
 * What the VPD card takes the leaf to be.
 *
 * A device holds two offsets, one for each half of the cycle, because a leaf
 * under a lamp is warmer than the air and a dark one is not - and the band is
 * worked out with whichever applies over each stretch. Naming the day figure
 * alone left the raised blocks over the night strips unexplained: on the
 * restored install every device holds −2 by day and 0 at night, so half of the
 * band on that one card came from an assumption the caption denied. Where the
 * two agree there is only one assumption to name, and it is named as before.
 */
const leafAbout = (t: Translate, leaf: LeafOffsets): string =>
  leaf.day === leaf.night
    ? t('charts.about.leaf', { offset: signed(leaf.day) })
    : t('charts.about.leafHalves', { day: signed(leaf.day), night: signed(leaf.night) });

/** "−2", with the minus a typesetter would use: the offset is a difference and reads as one. No leaf sits "+0" above the air. */
const signed = (value: number): string => (value === 0 ? '0' : value < 0 ? `−${Math.abs(value)}` : `+${value}`);

/** The table behind the CSV button: exactly the lines that are on the screen, in the order they are drawn. */
export const csvForCards = (t: Translate, series: GrowSeries, input: CardsInput): string =>
  csvOf(
    drawnOf(t, series, input).map(one => one.csv),
    at(series.originAt),
  );
