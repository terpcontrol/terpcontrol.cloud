import type { GrowSeries, MeasurementDefinition, Metric, OutputMetric, TimelinePanel } from '@fg2/shared-types/v1';
import { CHART_METRICS, CHART_OUTPUTS } from '@/api/charts';
import { csvOf, dayOfGrow, niceScale, setpointPoints, stepPoints, type CsvColumn, type Plot, type PlotLine } from '@/charts/series';
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

export const cardsOf = (t: Translate, series: GrowSeries, picked: Picked, layout: Layout, offered: Offered, leafOffset: number | null): Card[] => {
  const drawn = drawnOf(t, series, picked, offered, leafOffset);
  if (drawn.length === 0) return [];

  const cards = layout === 'overlay' ? [overlaid(t, drawn)] : stacked(t, drawn);

  return cards.map(card => (layout === 'day_of_grow' ? rebased(card, at(series.originAt)) : card)).map(card => framed(card, series, layout));
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
  const scales = units.map(name => niceScale(drawn.filter(one => one.unit === name).flatMap(one => one.values)));

  return {
    key,
    title,
    about,
    unit: unit || units.filter(Boolean).join(' · '),
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

/** Every ticked line, in the order the chips stand in, as something that can be put on a card. */
const drawnOf = (t: Translate, series: GrowSeries, picked: Picked, offered: Offered, leafOffset: number | null): Drawn[] => [
  ...offered.metrics
    .filter(metric => picked.metrics.includes(metric))
    .flatMap(metric => {
      const panel = series.climate.find(one => one.metric === metric);

      return panel ? [metricDrawn(t, metric, panel, series, leafOffset)] : [];
    }),
  ...offered.measurements
    .filter(definition => picked.measurements.includes(definition.key))
    .flatMap(definition => {
      const measured = series.measurements.find(one => one.key === definition.key);

      return measured ? [measurementDrawn(t, definition, measured.points, at(series.startsAt), at(series.endsAt))] : [];
    }),
  ...offered.outputs
    .filter(output => picked.outputs.includes(output))
    .flatMap(output => {
      const lanes = series.outputs.filter(one => one.output === output);

      return lanes.length > 0 ? [outputDrawn(t, output, lanes, at(series.startsAt), at(series.endsAt))] : [];
    }),
];

const metricDrawn = (t: Translate, metric: Metric, panel: TimelinePanel, series: GrowSeries, leafOffset: number | null): Drawn => {
  const from = at(series.startsAt);
  const to = at(series.endsAt);
  const stretches = stretchesOf(panel, series.nights, from, to);
  const points = panel.points.map(point => [at(point.measuredAt), point.value] as [number, number | null]);
  const title = t(`charts.metric.${metric}`, { defaultValue: metric });
  const unit = UNIT[metric] ?? '';

  return {
    key: metric,
    title,
    about: aboutMetric(t, metric, stretches.length > 0, leafOffset),
    unit,
    values: [
      ...panel.points.flatMap(point => (point.value === null ? [] : [point.value])),
      ...stretches.flatMap(stretch => [stretch.target.band.low, stretch.target.band.high]),
    ],
    lines: [
      {
        key: metric,
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
 * A grower's own measurement: the readings as they were written, joined by a
 * thin line so that a season reads as a shape, and the target as one dashed
 * line across the window. There is no green band here, and that is deliberate -
 * a definition carries a target and no tolerance, so a band around it would be
 * a width nobody chose.
 */
const measurementDrawn = (
  t: Translate,
  definition: MeasurementDefinition,
  readings: readonly { measuredAt: string; value: number }[],
  from: number,
  to: number,
): Drawn => {
  const points = readings.map(reading => [at(reading.measuredAt), reading.value] as [number, number | null]);

  return {
    key: definition.key,
    title: definition.name,
    about: [t('charts.about.measured'), definition.perPlant ? t('charts.about.perPlant') : null].filter(Boolean).join(' · '),
    unit: definition.unit,
    values: [...readings.map(reading => reading.value), ...(definition.target === null ? [] : [definition.target])],
    lines: [
      { key: definition.key, shape: 'points', colour: 'ink', axis: 0, points },
      ...(definition.target === null
        ? []
        : [
            {
              key: `${definition.key}-target`,
              shape: 'line' as const,
              colour: 'muted' as ChartToken,
              axis: 0 as const,
              dashed: true,
              points: setpointPoints([{ from, to, value: definition.target }]),
            },
          ]),
    ],
    csv: { label: definition.unit ? `${definition.name} (${definition.unit})` : definition.name, points },
  };
};

/** An output as the square wave its spans describe. Two controllers in one tent are two lanes and one line. */
const outputDrawn = (
  t: Translate,
  output: OutputMetric,
  lanes: readonly { spans: readonly { startsAt: string; endsAt: string }[] }[],
  from: number,
  to: number,
): Drawn => {
  const spans = lanes
    .flatMap(lane => lane.spans.map(span => ({ from: at(span.startsAt), to: at(span.endsAt) })))
    .sort((one, other) => one.from - other.from);
  const points = stepPoints(spans, from, to);
  const title = t(`timeline.output.${output}`, { defaultValue: output });

  return {
    key: `out-${output}`,
    title,
    about: t('charts.about.output'),
    unit: '',
    values: [0, 1],
    lines: [{ key: `out-${output}`, shape: 'step', colour: 'warning', axis: 0, points }],
    csv: { label: t('charts.csvOutput', { output: title }), points },
  };
};

const aboutMetric = (t: Translate, metric: Metric, steered: boolean, leafOffset: number | null): string =>
  [steered ? t('charts.about.band') : null, metric === 'vpd' && leafOffset !== null ? t('charts.about.leaf', { offset: signed(leafOffset) }) : null]
    .filter(Boolean)
    .join(' · ');

/** "−2", with the minus a typesetter would use: the offset is a difference and reads as one. */
const signed = (value: number): string => (value < 0 ? `−${Math.abs(value)}` : `+${value}`);

/** The table behind the CSV button: exactly the lines that are on the screen, in the order they are drawn. */
export const csvForCards = (t: Translate, series: GrowSeries, picked: Picked, offered: Offered, leafOffset: number | null): string =>
  csvOf(
    drawnOf(t, series, picked, offered, leafOffset).map(one => one.csv),
    at(series.originAt),
  );
