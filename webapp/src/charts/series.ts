import { DateTime } from 'luxon';
import type { ChartOption } from './Chart';
import type { ChartPalette, ChartToken } from './tokens';

/**
 * What a plot is made of, apart from what it is about.
 *
 * The Timeline draws one thing - three climate panels over a window - and its
 * panel component knows that. The Charts view draws whatever was ticked: a
 * curve, an output as a square wave, readings somebody wrote down, one scale or
 * two, against dates or against the day of the grow. Those are all the same
 * picture with different lines in it, so a plot is described here as data and
 * turned into an ECharts option in one place, which leaves the screen above
 * deciding only which lines belong on which card.
 */

/** A day of grow is a number and a date is an instant, which are two different axes to ECharts. */
export type PlotAxis = 'time' | 'day';

export interface PlotSpan {
  from: number;
  to: number;
}

/** The green band that was aimed at over one stretch: it moves with the phase and with the light. */
export interface PlotBand extends PlotSpan {
  low: number;
  high: number;
}

export interface PlotScale {
  low: number;
  high: number;
}

export interface PlotLine {
  key: string;
  /** A reading is a curve, an output is a square wave, and something written down is the dots it was written at. */
  shape: 'line' | 'step' | 'points';
  colour: ChartToken;
  /** 0 is the left-hand scale; 1 is the second one a panel of two units that belong together carries. */
  axis: 0 | 1;
  /** A null breaks the line, which is how a setpoint steps down into the night rather than sloping into it. */
  points: readonly [number, number | null][];
  /** Set for the setpoint, which is the one line drawn as an intention rather than as a measurement. */
  dashed?: boolean;
  bands?: readonly PlotBand[];
}

export interface Plot {
  axis: PlotAxis;
  from: number;
  to: number;
  /** One per scale the lines use, so a panel of two units that belong together is two entries here and nowhere else. */
  scales: readonly PlotScale[];
  /** When the light was off, shaded behind everything: every line on the card is shaded by the same nights. */
  nights: readonly PlotSpan[];
  lines: readonly PlotLine[];
}

/** A token at a fraction of itself; the areas behind a line are all washes of one, as on the Timeline. */
const wash = (colour: string, alpha: string): string => `${colour}${alpha}`;

/**
 * The option a plot comes to. The night goes behind the band and both go behind
 * the lines, which is the order ECharts draws series in - so the nights hang off
 * the first line and each band off the line it belongs to, and a panel of two
 * units gets its two bands against their own scales.
 */
export const plotOption = (palette: ChartPalette, plot: Plot): ChartOption => ({
  animation: false,
  grid: { left: 0, right: 0, top: 2, bottom: 2 },
  xAxis: { type: plot.axis === 'time' ? 'time' : 'value', min: plot.from, max: plot.to, show: false },
  yAxis: plot.scales.map(scale => ({ type: 'value' as const, min: scale.low, max: scale.high, show: false })),
  series: plot.lines.map((line, index) => ({
    type: 'line' as const,
    xAxisIndex: 0,
    yAxisIndex: line.axis,
    data: line.points as [number, number | null][],
    showSymbol: line.shape === 'points',
    symbolSize: 7,
    // Hollow, so a reading somebody wrote down reads as a mark on the curve rather than as a blob over it.
    itemStyle: { color: palette.card, borderColor: palette[line.colour], borderWidth: 1.5 },
    connectNulls: false,
    silent: true,
    lineStyle: {
      width: line.dashed ? 1 : 1.2,
      type: line.dashed ? ('dashed' as const) : ('solid' as const),
      color: palette[line.dashed ? 'muted' : line.colour],
    },
    markArea: {
      silent: true,
      data: [
        ...(index === 0 ? plot.nights.map(night => [{ xAxis: night.from, itemStyle: { color: palette['card-2'] } }, { xAxis: night.to }]) : []),
        ...(line.bands ?? []).map(band => [
          { xAxis: band.from, yAxis: band.low, itemStyle: { color: wash(palette.green, '2b') } },
          { xAxis: band.to, yAxis: band.high },
        ]),
      ],
    },
  })),
});

/**
 * An output is spans and not points, so it is drawn as the square wave those
 * spans describe: up where it ran, down where it did not, and flat along the
 * bottom across the stretches of the window it was off for.
 */
export const stepPoints = (spans: readonly PlotSpan[], from: number, to: number): [number, number | null][] => {
  const points: [number, number | null][] = [[from, 0]];
  for (const span of spans) {
    const left = Math.max(from, span.from);
    const right = Math.min(to, span.to);
    if (right > left) points.push([left, 0], [left, 1], [right, 1], [right, 0]);
  }
  points.push([to, 0]);

  return points;
};

/** The dashed setpoint, broken after each stretch so that it steps between phases and between day and night. */
export const setpointPoints = (stretches: readonly (PlotSpan & { value: number })[]): [number, number | null][] =>
  stretches.flatMap(one => [[one.from, one.value] as [number, number | null], [one.to, one.value], [one.to, null]]);

/**
 * What a plot is drawn between: everything on it and everything aimed at, with
 * a little air, rounded outwards to a figure worth printing. A plot of one flat
 * value still gets a scale, rather than a line lying on its own edge.
 */
export const niceScale = (values: readonly number[]): PlotScale => {
  const real = values.filter(value => Number.isFinite(value));
  if (real.length === 0) return { low: 0, high: 1 };

  const low = Math.min(...real);
  const high = Math.max(...real);
  const step = niceStep(Math.max(high - low, Math.abs(high) * 0.02, 0.1) / 4);

  return { low: Math.floor(low / step - 0.4) * step, high: Math.ceil(high / step + 0.4) * step };
};

/** 1, 2, 5 or 10 of whatever size the span is, so both ends read as round numbers. */
const niceStep = (rough: number): number => {
  const magnitude = 10 ** Math.floor(Math.log10(rough));

  return [1, 2, 5, 10].map(one => one * magnitude).find(one => one >= rough) ?? magnitude * 10;
};

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which day of the grow an instant fell on, counting the first as day 1. It is
 * the client's arithmetic on purpose: the answer carries the instant day 1
 * began and nothing else, so two runs of the same tent are two answers laid
 * over each other rather than a shape the server has to invent.
 */
export const dayOfGrow = (time: number, originAt: number): number => (time - originAt) / DAY_MS + 1;

/**
 * What is on the screen, as a table.
 *
 * Climate is bucketed and a reading somebody wrote down is not, so there is no
 * grid the two share: the rows are every instant any drawn line has a value at,
 * and a line with nothing at that instant leaves its cell empty rather than
 * having a figure invented for it. That is the honest shape of a chart of
 * things measured at different rates, and it is what a spreadsheet wants.
 */
export interface CsvColumn {
  label: string;
  points: readonly [number, number | null][];
}

export const csvOf = (columns: readonly CsvColumn[], originAt: number | null): string => {
  const byTime = columns.map(column => new Map(column.points.map(([time, value]) => [time, value])));
  const times = [...new Set(columns.flatMap(column => column.points.map(([time]) => time)))].sort((one, other) => one - other);
  const head = ['time', ...(originAt === null ? [] : ['day']), ...columns.map(column => column.label)];

  const rows = times.map(time =>
    [
      DateTime.fromMillis(time).toISO() ?? '',
      ...(originAt === null ? [] : [String(Math.floor(dayOfGrow(time, originAt)))]),
      ...byTime.map(column => {
        const value = column.get(time);

        return value === undefined || value === null ? '' : String(value);
      }),
    ].join(','),
  );

  return [head.map(quoted).join(','), ...rows].join('\n');
};

/** A name a grower gave a measurement may hold a comma, so every heading is quoted and its own quotes doubled. */
const quoted = (cell: string): string => `"${cell.replace(/"/g, '""')}"`;

/** A table the browser saves rather than opens: the one download the screen does entirely out of what it already has. */
export const downloadCsv = (name: string, csv: string): void => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};
