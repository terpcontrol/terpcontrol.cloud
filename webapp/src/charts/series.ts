import { growDayAt } from '@fg2/shared-types/v1-schemas/feeding.js';
import { zonedAt } from '@/ui/zone';
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
  /** What the pinned readout calls this line. A line without one is drawn and never read out, which is what a setpoint is. */
  label?: string;
  unit?: string;
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
 * The room a scale's two corner figures need beside the plot, at the width the
 * Timeline gives its own. It is kept on both sides of every plot even where
 * there is no second scale to write in the right-hand one, because the cards of
 * a screen are read against one another at one cursor and a plot that borrowed
 * the spare gutter would put the same instant somewhere else.
 */
export const AXIS_GUTTER = 38;

/**
 * The option a plot comes to. The night goes behind the band and both go behind
 * the lines, which is the order ECharts draws series in - so the nights hang off
 * the first line and each band off the line it belongs to.
 *
 * Exactly one band is filled, whatever a card holds. Two washes of the same
 * green intersect into a third shade and lie over the night's into a fourth, so
 * a panel of two scales would carry four tints all meaning target and none of
 * them saying which scale it belonged to; the later scale's band is drawn as
 * the two rules it really is instead. The axes stay hidden because the figures
 * are written beside the plot in the document, where they can be read in the
 * app's own face and picked up by a screen reader.
 */
export const plotOption = (palette: ChartPalette, plot: Plot): ChartOption => {
  const filled = plot.lines.findIndex(line => (line.bands ?? []).length > 0);

  return {
    animation: false,
    grid: { left: AXIS_GUTTER, right: AXIS_GUTTER, top: 2, bottom: 2 },
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
          ...(index === filled ? (line.bands ?? []) : []).map(band => [
            { xAxis: band.from, yAxis: band.low, itemStyle: { color: wash(palette.green, '2b') } },
            { xAxis: band.to, yAxis: band.high },
          ]),
        ],
      },
      markLine: {
        silent: true,
        symbol: 'none',
        label: { show: false },
        lineStyle: { color: palette.green, width: 1, type: 'solid' as const },
        data: (index === filled ? [] : (line.bands ?? [])).flatMap(band => [
          [
            { xAxis: band.from, yAxis: band.low },
            { xAxis: band.to, yAxis: band.low },
          ],
          [
            { xAxis: band.from, yAxis: band.high },
            { xAxis: band.to, yAxis: band.high },
          ],
        ]),
      },
    })),
  };
};

/** What a line read at the cursor: the last point at or before it, which is what was true there. */
export const valueAt = (points: readonly [number, number | null][], x: number): number | null => {
  let found: number | null = null;
  for (const [time, value] of points) {
    if (time > x) break;
    found = value;
  }

  return found;
};

/**
 * How near a mark the cursor has to stand for that mark to be read out, as a
 * share of the window on the screen. A few pixels of a plot six hundred wide:
 * near enough to be reached by hand at any range, far too near to carry a
 * reading across the weeks between two of them.
 */
const NEAR_ENOUGH = 1 / 200;

/**
 * What one line says at the cursor, which depends on what kind of line it is.
 *
 * A curve and a state both hold: a mean stands for the window it was taken over
 * and an output that came on at six was still on at seven, so both are read as
 * the last point at or before the cursor. A reading somebody wrote down holds
 * nothing. It happened once, at the instant it was written, and the table this
 * screen exports says so - it leaves every other row of that column empty, on
 * the rule that there was no measurement at that instant and the cell is empty
 * rather than invented. Carried forward the same way as a curve, one reading
 * taken in August was pinned under every position of the cursor for the month
 * that followed, four days after the tent had stopped talking at all.
 *
 * So a written reading is answered only where the cursor is actually on it, and
 * the tolerance is a share of the window rather than a step: at a whole grow the
 * step is a pixel and a half, which would make a ticked line unreadable.
 */
export const readAt = (line: Pick<PlotLine, 'shape' | 'points'>, x: number, span: number): number | null => {
  if (line.shape !== 'points') return valueAt(line.points, x);

  const near = Math.abs(span) * NEAR_ENOUGH;
  let found: [number, number | null] | null = null;
  for (const point of line.points) {
    if (point[1] === null || Math.abs(point[0] - x) > near) continue;
    if (!found || Math.abs(point[0] - x) < Math.abs(found[0] - x)) found = point;
  }

  return found?.[1] ?? null;
};

/** A figure beside an axis or under a cursor: round where the scale came out round, and never longer than it is worth. */
export const axisFigure = (value: number): string => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));

/**
 * An output is spans and not points, so it is drawn as the square wave those
 * spans describe: up where it ran, down where it did not, and flat along the
 * bottom across the stretches of the window it was off for.
 *
 * The bottom is a claim about hardware, so it is only drawn as far as anything
 * was heard from it. Past `heardUntil` the wave ends and a break follows, which
 * leaves the rest of the panel empty and makes the pinned readout say nothing
 * there rather than "off" - a device that has said nothing since Saturday was
 * not switched off on Saturday.
 */
export const stepPoints = (spans: readonly PlotSpan[], from: number, to: number, heardUntil = to): [number, number | null][] => {
  const known = Math.max(from, Math.min(to, heardUntil));
  const points: [number, number | null][] = [[from, 0]];
  for (const span of spans) {
    const left = Math.max(from, span.from);
    const right = Math.min(known, span.to);
    if (right > left) points.push([left, 0], [left, 1], [right, 1], [right, 0]);
  }
  points.push([known, 0]);
  if (known < to) points.push([known + 1, null]);

  return points;
};

/** The dashed setpoint, broken after each stretch so that it steps between phases and between day and night. */
export const setpointPoints = (stretches: readonly (PlotSpan & { value: number })[]): [number, number | null][] =>
  stretches.flatMap(one => [[one.from, one.value] as [number, number | null], [one.to, one.value], [one.to, null]]);

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
export const niceScale = (values: readonly number[]): PlotScale => {
  const real = values.filter(value => Number.isFinite(value));
  if (real.length === 0) return { low: 0, high: 1 };

  const low = Math.min(...real);
  const high = Math.max(...real);
  const step = niceStep(Math.max(high - low, Math.abs(high) * 0.02, 0.1) / 4);
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
 * Climate is bucketed, an output switches when the tent switched it and a
 * reading somebody wrote down happened when they wrote it, so there is no grid
 * the three share: the rows are every instant any drawn line has something to
 * say at. Dropping an output's own instants onto the climate's grid would
 * throw away the switching record the export exists for - a lamp that came on
 * at 06:00:13 did not come on at 06:00 - so the rows stay as many as the tent
 * really did something.
 *
 * What a column puts in a row it has no instant at depends on what the column
 * is. A mean of a window and a reading somebody took are measurements, and
 * there was no measurement at that instant, so the cell is empty rather than
 * invented. A state is not a measurement: an output that came on at 06:00:13
 * was still on at 07:00, and saying so is reading the record rather than
 * adding to it - the same thing the pinned readout above the cards says at the
 * cursor. Without that the file a grower opens to read Temp against Light held
 * the two in no row at all: 361 rows carried a temperature, 6,977 carried
 * nothing but an output state, and exactly one carried both.
 *
 * The day column counts the way the grow's own counter counts, out of the
 * contract's arithmetic rather than a second copy of it, so a reading somebody
 * backdated before day 1 reads as day 1 in the table and on the chip alike.
 *
 * The time column is written where the account is, which is the zone every
 * clock time on the screen the button sits on is read in. The zone is asked for
 * rather than defaulted, because a file is read months later by somebody who
 * cannot ask what the browser that wrote it was set to: an hour written in the
 * wrong zone looks exactly like an hour, and the rows would quietly disagree
 * with the chart they were exported from.
 */
export interface CsvColumn {
  label: string;
  points: readonly [number, number | null][];
  /** Set for a state that stands until it changes, which is what makes it readable across the rows it has no instant of its own at. */
  holds?: boolean;
}

export const csvOf = (columns: readonly CsvColumn[], originAt: number | null, zone: string | null): string => {
  const times = [...new Set(columns.flatMap(column => column.points.map(([time]) => time)))].sort((one, other) => one - other);
  const cells = columns.map(column => (column.holds ? carried(column.points, times) : measured(column.points, times)));
  const head = ['time', ...(originAt === null ? [] : ['day']), ...columns.map(column => column.label)];

  const rows = times.map((time, row) =>
    [
      zonedAt(time, zone).toISO() ?? '',
      ...(originAt === null ? [] : [String(growDayAt(new Date(originAt), new Date(time)))]),
      ...cells.map(column => column[row]),
    ].join(','),
  );

  return [head.map(quoted).join(','), ...rows].join('\n');
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

/** A table the browser saves rather than opens: the one download the screen does entirely out of what it already has. */
export const downloadCsv = (name: string, csv: string): void => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};
