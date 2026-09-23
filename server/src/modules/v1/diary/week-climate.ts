import type { Metric, PhaseTargets, WeekClimate } from '@fg2/shared-types/v1';
import { TARGET_BAND } from '@fg2/shared-types/v1-schemas';
import { DeviceHistory } from '@modules/data/data.service';
import { RunningSpan, runningFor, runningSpansOf } from '@modules/data/flux';

/**
 * What a stretch of a grow's climate came to, from the windows a time-series
 * read answered.
 *
 * The day and the night are the tent's cycle rather than hours of the clock, so
 * they are told apart by the controller's own light output: that is what makes
 * "25.0° day avg · 20.6° night avg" the two halves a grower set rather than two
 * halves of a calendar day. A device that drives no light - a fridge drying,
 * a tent lit from a socket nobody told the server about - answers one average
 * and neither half.
 *
 * What the lamp did is read from its switchings and never from what its output
 * averaged over a window. `out_light` is a percentage of full brightness, so a
 * quarter-hour that was dark for all but a minute still averages above zero and
 * a lamp dimmed to 60 % averages below any threshold worth setting - a mean
 * cannot be made to answer "was it on" at any value. The switchings say when it
 * started and stopped, which is the same thing the charts draw.
 *
 * Nothing here talks to a database. Two reads per controller happen above; this
 * is what they mean together.
 */

/** What a week card and a report chapter state. Anything else a device writes is a diagnostic no screen asks for. */
export const CLIMATE_METRICS: readonly Metric[] = ['temperature', 'humidity', 'co2'];

const HOURS_A_DAY = 24;

const A_DAY_MS = HOURS_A_DAY * 60 * 60 * 1000;

export interface ClimateSummary {
  climate: WeekClimate[];
  /**
   * Hours of light per day over the stretch; null where no controller was heard
   * about its light output for a day's worth of the stretch.
   */
  lightHours: number | null;
  /**
   * The share of the windows in which every steered metric sat inside its band,
   * as a percentage; null where nothing held a target.
   */
  inBandPercent: number | null;
}

/** One window of one controller: what was measured, and whether the light was on. */
interface Window {
  values: Map<Metric, number>;
  isDay: boolean | null;
}

/**
 * What one device's lamp did over the stretch: the stretches it ran for, and
 * the instant anything at all is known from.
 *
 * The switchings are read from the raw samples, so a day old enough to have
 * been summarised away has none - and a day nobody can read the lamp of is
 * neither day nor night rather than dark. Guessing it from the summarised mean
 * would be the same arithmetic this exists to replace: the mean of a percentage
 * says how bright, not how long.
 */
interface Lamp {
  spans: RunningSpan[];
  knownFrom: number | null;
}

/**
 * The summary of one stretch. Several controllers in one tent are several
 * thermometers in the same air, so their windows are pooled rather than averaged
 * per device and then averaged again - which would weigh a device that was
 * offline half the week as heavily as one that was not.
 *
 * `targets` is the climate the phase recorded; only the two metrics a controller
 * holds between two ends are counted as in or out of band, because CO2 is raised
 * towards its target rather than kept off both sides of it.
 */
export const summariseClimate = (histories: readonly DeviceHistory[], targets: PhaseTargets | null): ClimateSummary => {
  const windows = histories.flatMap(windowsOf);

  return {
    climate: CLIMATE_METRICS.flatMap(metric => climateOf(metric, windows)),
    lightHours: lightHoursOf(histories),
    inBandPercent: inBandPercentOf(windows, targets),
  };
};

const lampOf = (history: DeviceHistory): Lamp => {
  const switchings = history.outputs.find(output => output.output === 'light')?.switchings ?? [];

  return { spans: runningSpansOf(switchings), knownFrom: switchings.length > 0 ? Date.parse(switchings[0].at) : null };
};

const windowsOf = (history: DeviceHistory): Window[] => {
  const { series } = history;
  const lamp = lampOf(history);
  const light = series.outputs.find(output => output.output === 'light')?.points ?? [];
  const step = series.stepSeconds * 1000;

  // `aggregateWindow` stamps every field's windows identically, so the index is
  // the instant and the series are already aligned with each other. A window is
  // stamped at its end, so the window an instant names is the step before it.
  return (series.metrics[0]?.points ?? light).map((point, index) => {
    const ends = Date.parse(point.measuredAt);
    // A window the device said nothing about the light in belongs to neither
    // half of the cycle, whatever else was measured in it.
    const heard = light[index]?.value ?? null;

    return {
      values: new Map(
        series.metrics.flatMap(one => {
          const value = one.points[index]?.value ?? null;
          return value === null ? [] : [[one.metric, value] as const];
        }),
      ),
      isDay: heard === null || lamp.knownFrom === null || ends <= lamp.knownFrom ? null : litThrough(lamp, ends - step, ends),
    };
  });
};

/**
 * Which half of the cycle a window belongs to: the one it was in for all of
 * itself, and neither where the lamp switched inside it.
 *
 * A window is a mean of everything measured in it, so one the lamp switched
 * during holds air from both halves of the cycle and is an average of neither.
 * There are two such windows a day at most, and putting them in the half they
 * were in for the greater part would drag that half's average towards the other
 * one - which is exactly the figure the two halves exist to keep apart.
 */
const litThrough = (lamp: Lamp, from: number, to: number): boolean | null => {
  const ran = runningFor(lamp.spans, from, to);

  return ran === 0 ? false : ran >= to - from ? true : null;
};

const climateOf = (metric: Metric, windows: Window[]): WeekClimate[] => {
  const valuesOf = (rows: Window[]): number[] =>
    rows.flatMap(row => {
      const value = row.values.get(metric);
      return value === undefined ? [] : [value];
    });
  const all = valuesOf(windows);
  if (all.length === 0) return [];

  return [
    {
      metric,
      minValue: round(Math.min(...all)),
      maxValue: round(Math.max(...all)),
      averageValue: mean(all),
      dayAverage: mean(valuesOf(windows.filter(window => window.isDay === true))),
      nightAverage: mean(valuesOf(windows.filter(window => window.isDay === false))),
    },
  ];
};

/**
 * How long the light was on each day: the time the lamp really ran, over the
 * time the device was really heard, scaled to a day.
 *
 * Both halves are counted over the windows that hold a reading rather than over
 * every window of the stretch. A device writes a sample when it has one and the
 * windows are the server's own, so a stretch read at a finer resolution than the
 * device recorded is mostly empty windows - counting those as dark would make a
 * tent on 12/12 answer six hours. It also makes the figure right for a week that
 * is not over, where the hours so far are not yet a week's worth.
 *
 * A figure stated per day needs a day behind it, which is why less than that is
 * refused outright. An hour of readings says nothing about how a week was lit,
 * and the arithmetic does not care that it was an hour: a lamp that came on for
 * the last seven minutes of a grow that ended at teatime was otherwise stated as
 * a week of light around the clock, on the last card of a diary that was curing.
 *
 * The controllers of one tent switch one light, so the fullest answer wins
 * rather than the sum: two controllers reporting the same twelve hours do not
 * make twenty-four.
 */
const lightHoursOf = (histories: readonly DeviceHistory[]): number | null => {
  const perDevice = histories.flatMap(history => {
    const { series } = history;
    const lamp = lampOf(history);
    const step = series.stepSeconds * 1000;
    let heard = 0;
    let lit = 0;

    for (const point of series.outputs.find(output => output.output === 'light')?.points ?? []) {
      const ends = Date.parse(point.measuredAt);
      if (point.value === null || lamp.knownFrom === null || ends <= lamp.knownFrom) continue;

      const starts = Math.max(ends - step, lamp.knownFrom);
      heard += ends - starts;
      lit += runningFor(lamp.spans, starts, ends);
    }

    return heard >= A_DAY_MS ? [(lit / heard) * HOURS_A_DAY] : [];
  });

  return perDevice.length > 0 ? round(Math.max(...perDevice)) : null;
};

const inBandPercentOf = (windows: Window[], targets: PhaseTargets | null): number | null => {
  if (!targets) return null;

  const judged = windows.filter(window => bandsFor(window, targets).length > 0);
  if (judged.length === 0) return null;

  const inside = judged.filter(window => bandsFor(window, targets).every(({ value, target, width }) => Math.abs(value - target) <= width));
  return round((inside.length / judged.length) * 100);
};

/** What can be judged in this window: a metric the controller holds a target for, in the half of the cycle it is in. */
const bandsFor = (window: Window, targets: PhaseTargets): { value: number; target: number; width: number }[] => {
  const half = window.isDay === false ? targets.night : targets.day;

  return (['temperature', 'humidity'] as const).flatMap(metric => {
    const value = window.values.get(metric);
    const target = half[metric];
    const width = TARGET_BAND[metric];

    return value !== undefined && target !== null && width !== undefined ? [{ value, target, width }] : [];
  });
};

const mean = (values: number[]): number | null => (values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null);

/** One decimal, which is what every figure on these cards is drawn with. */
const round = (value: number): number => Math.round(value * 10) / 10;
