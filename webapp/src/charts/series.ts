import { zonedAt } from '@/ui/zone';
import type { ChartOption } from './Chart';
import type { ChartPalette, ChartToken } from './tokens';

/**
 * What a panel of Verlauf is made of, as data, and the ECharts option it comes
 * to: the picture is described here once, so the screen above decides only what
 * belongs on which panel.
 */

export interface PlotSpan {
  from: number;
  to: number;
}

interface PlotScale {
  low: number;
  high: number;
}

/** One point of a curve: when, the mean of its window, and the lowest and highest sample of it where they differ. */
export type PlotPoint = readonly [time: number, value: number | null, min?: number, max?: number];

export interface PlotLine {
  key: string;
  colour: ChartToken;
  /** A curve, or the dots of readings somebody wrote down. */
  shape: 'line' | 'points';
  points: readonly PlotPoint[];
  /** Each line is drawn against its own scale, so a kPa and a per cent share a picture without sharing an axis. */
  scale: PlotScale;
  /** An earlier run or another place laid over: drawn as an intention rather than as this place's measurement. */
  dashed?: boolean;
}

export interface Plot {
  from: number;
  to: number;
  lines: readonly PlotLine[];
  /** When the night's figures held, shaded behind everything. */
  nights: readonly PlotSpan[];
  /** What was aimed at, against the first line's scale. */
  bands: readonly (PlotSpan & PlotScale)[];
  /** When an alarm on this reading was open. */
  alarms: readonly PlotSpan[];
}

/** From this many points down each one is drawn as a dot on its line: a window zoomed that far is read sample by sample. */
const DOTS_UNTIL = 130;

/**
 * The option a plot comes to. The night goes behind the band and both behind
 * the lines. Behind each line lies the stretch between its windows' lowest and
 * highest samples, as two stacked series - a mean alone flattens what was
 * short. The axes stay hidden: the figures are written beside the plot in the
 * document, in the app's own face, where a screen reader finds them.
 */
export const plotOption = (palette: ChartPalette, plot: Plot): ChartOption => ({
  animation: false,
  grid: { left: 0, right: 0, top: 2, bottom: 2 },
  xAxis: { type: 'time', min: plot.from, max: plot.to, show: false },
  yAxis: plot.lines.map(line => ({ type: 'value' as const, min: line.scale.low, max: line.scale.high, show: false })),
  series: plot.lines.flatMap((line, index) => {
    const colour = palette[line.dashed ? 'muted' : line.colour];
    const spread = line.points.some(point => point[2] !== undefined);
    const base = { type: 'line' as const, yAxisIndex: index, silent: true, connectNulls: false, showSymbol: false };

    return [
      ...(spread && !line.dashed
        ? [
            {
              ...base,
              stack: line.key,
              data: line.points.map(([time, value, min]) => [time, value === null ? null : (min ?? value)]),
              lineStyle: { opacity: 0 },
            },
            {
              ...base,
              stack: line.key,
              // A fridge's low below zero and the stretch above it are still one stack.
              stackStrategy: 'all' as const,
              data: line.points.map(([time, value, min, max]) => [time, value === null ? null : (max ?? value) - (min ?? value)]),
              lineStyle: { opacity: 0 },
              areaStyle: { color: colour, opacity: 0.22 },
            },
          ]
        : []),
      {
        ...base,
        data: line.points.map(([time, value]) => [time, value]),
        showSymbol: line.shape === 'points' || line.points.length <= DOTS_UNTIL,
        symbol: 'circle',
        symbolSize: line.shape === 'points' ? 7 : 4,
        itemStyle: line.shape === 'points' ? { color: palette.card, borderColor: colour, borderWidth: 1.5 } : { color: colour },
        lineStyle: { width: line.dashed ? 1.2 : 1.6, type: line.dashed ? ('dashed' as const) : ('solid' as const), color: colour },
        markArea: {
          silent: true,
          data:
            index === 0
              ? [
                  ...plot.nights.map(span => [
                    { xAxis: span.from, itemStyle: { color: nightColour(palette, plot.nights.length) } },
                    { xAxis: span.to },
                  ]),
                  ...plot.bands.map(band => [
                    { xAxis: band.from, yAxis: band.low, itemStyle: { color: palette.band } },
                    { xAxis: band.to, yAxis: band.high },
                  ]),
                  ...plot.alarms.map(span => [{ xAxis: span.from, itemStyle: { color: `${palette.alarm}30` } }, { xAxis: span.to }]),
                ]
              : [],
        },
      },
    ];
  }),
});

/**
 * How strongly the nights are shaded, by how many there are. A day or a week
 * has a handful, and each is a stretch of the chart worth seeing as dark; a
 * grow has thirty and more, and at full strength they drew a barcode of
 * stripes across the whole plot that the curves had to be read through. Past
 * about a fortnight they take `--night-long`, the same shade at half strength:
 * still there, no longer the loudest thing on the card.
 */
const nightColour = (palette: ChartPalette, nights: number): string => (nights > 14 ? palette['night-long'] : palette.night);

/**
 * What a plot is drawn between: everything on it and everything aimed at, with
 * a little air, rounded outwards to a figure worth printing. A plot of one flat
 * value still gets a scale, rather than a line lying on its own edge.
 *
 * The air below is only added where there is room for it. Rounding a spread of
 * 366 to 6132 ppm outwards gives a step of 2000 and a floor of -2000, and a
 * fifth of that card was then a concentration nothing can be in, with the
 * curve squeezed into what was left. Nothing measured or aimed at being below
 * zero is what says the metric has no negative half - a CO2 reading, a
 * humidity, a length - and the floor is zero for those. A fridge that really
 * ran at -4 keeps its cold half, because it handed one in.
 */
export const niceScale = (values: readonly number[], steps = 4): PlotScale => {
  const real = values.filter(value => Number.isFinite(value));
  if (real.length === 0) return { low: 0, high: 1 };

  const low = Math.min(...real);
  const high = Math.max(...real);
  const step = niceStep(Math.max(high - low, Math.abs(high) * 0.02, 0.1) / steps);
  const floor = snapped(Math.floor(low / step - 0.4) * step, step);

  // The ceiling is untouched by this, so a series of nothing but zeroes still
  // spans a step rather than collapsing onto one line.
  return { low: low < 0 ? floor : Math.max(0, floor), high: snapped(Math.ceil(high / step + 0.4) * step, step) };
};

/**
 * A corner as the round number it stands for rather than as the float the
 * multiplication happened to come to.
 *
 * A step of 0.2 taken 169 times is 33.800000000000004 in binary floating point,
 * one unit in the last place above the 33.8 it means. ECharts is handed the two
 * corners as the extent of the axis and then works the same round figures out
 * again itself, and its development build asserts that what it derived still
 * lies inside what it was given: against a corner a hairsbreadth too high that
 * assertion fails, the exception leaves the chart, and with no boundary above
 * it the whole application goes with it - a blank screen over an error of
 * 4e-15. Over one span of a humidity panel in a hundred this is the difference
 * between a screen and a stack trace.
 *
 * The step is always 1, 2, 5 or 10 of some power of ten, so how many decimals
 * it can carry is exact arithmetic rather than a guess, and a corner written
 * out to that many is the round figure itself.
 */
const snapped = (value: number, step: number): number => Number(value.toFixed(Math.max(0, -Math.floor(Math.log10(step)))));

/** 1, 2, 5 or 10 of whatever size the span is, so both ends read as round numbers. */
const niceStep = (rough: number): number => {
  const magnitude = 10 ** Math.floor(Math.log10(rough));

  return [1, 2, 5, 10].map(one => one * magnitude).find(one => one >= rough) ?? magnitude * 10;
};

/**
 * What is on the screen, as a table.
 *
 * A curve is bucketed and an output switches when the tent switched it, so
 * there is no grid the two share: the rows are every instant any column has
 * something to say at. What a column puts in a row it has no instant at
 * depends on what it is. A mean of a window is a measurement, and there was
 * none at that instant, so the cell is empty rather than invented. A state is
 * not: an output that came on at 06:00:13 was still on at 07:00, and saying so
 * is reading the record - without it the file a grower opens to read
 * temperature against light held the two in no row at all.
 *
 * The time column is written where the account is, which is the zone every
 * clock time on the screen is read in: an hour written in the wrong zone looks
 * exactly like an hour, and the rows would quietly disagree with the chart.
 */
export interface CsvColumn {
  label: string;
  points: readonly [number, number | null][];
  /** Set for a state that stands until it changes, which is what makes it readable across the rows it has no instant of its own at. */
  holds?: boolean;
}

export const csvOf = (columns: readonly CsvColumn[], zone: string | null, timeHead = 'time'): string => {
  const times = [...new Set(columns.flatMap(column => column.points.map(([time]) => time)))].sort((one, other) => one - other);
  const cells = columns.map(column => (column.holds ? carried(column.points, times) : measured(column.points, times)));
  const rows = times.map((time, row) => [zonedAt(time, zone).toISO() ?? '', ...cells.map(column => column[row])].join(','));

  return [[timeHead, ...columns.map(column => column.label)].map(quoted).join(','), ...rows].join('\n');
};

/** A column's own instants and nothing else: where it measured nothing, it says nothing. */
const measured = (points: readonly [number, number | null][], times: readonly number[]): string[] => {
  const byTime = new Map(points.map(([time, value]) => [time, value]));

  return times.map(time => cell(byTime.get(time) ?? null));
};

/**
 * A state carried into the rows between its switchings: the last thing it was
 * said to be doing, which is what it was doing. Before anything was heard about
 * it at all there is nothing to carry, and a break in the wave - where the
 * device went quiet - carries a nothing forward exactly as it should.
 */
const carried = (points: readonly [number, number | null][], times: readonly number[]): string[] => {
  let next = 0;
  let last: number | null = null;
  let heard = false;

  return times.map(time => {
    while (next < points.length && points[next][0] <= time) {
      last = points[next][1];
      heard = true;
      next += 1;
    }

    return heard ? cell(last) : '';
  });
};

const cell = (value: number | null): string => (value === null ? '' : String(value));

/** A name a grower gave a measurement may hold a comma, so every heading is quoted and its own quotes doubled. */
const quoted = (cell: string): string => `"${cell.replace(/"/g, '""')}"`;
