import type { DeviceSeries, Metric, PhaseTargets, WeekClimate } from '@fg2/shared-types/v1';
import { TARGET_BAND } from '@fg2/shared-types/v1-schemas';

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
 * Nothing here talks to a database. One read per controller happens above; this
 * is what its points mean.
 */

/** What a week card and a report chapter state. Anything else a device writes is a diagnostic no screen asks for. */
export const CLIMATE_METRICS: readonly Metric[] = ['temperature', 'humidity', 'co2'];

/** A window counts as lit when the output was on for more than half of it, which is what a mean of 1s and 0s says. */
const LIT = 0.5;

export interface ClimateSummary {
  climate: WeekClimate[];
  /** Hours of light per day over the stretch; null where no controller reported a light output. */
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
 * The summary of one stretch. Several controllers in one tent are several
 * thermometers in the same air, so their windows are pooled rather than averaged
 * per device and then averaged again - which would weigh a device that was
 * offline half the week as heavily as one that was not.
 *
 * `targets` is the climate the phase recorded; only the two metrics a controller
 * holds between two ends are counted as in or out of band, because CO2 is raised
 * towards its target rather than kept off both sides of it.
 */
export const summariseClimate = (series: readonly DeviceSeries[], targets: PhaseTargets | null): ClimateSummary => {
  const windows = series.flatMap(windowsOf);

  return {
    climate: CLIMATE_METRICS.flatMap(metric => climateOf(metric, windows)),
    lightHours: lightHoursOf(series),
    inBandPercent: inBandPercentOf(windows, targets),
  };
};

const windowsOf = (series: DeviceSeries): Window[] => {
  const light = series.outputs.find(output => output.output === 'light')?.points ?? [];

  // `aggregateWindow` stamps every field's windows identically, so the index is
  // the instant and the series are already aligned with each other.
  return (series.metrics[0]?.points ?? light).map((_, index) => {
    const lit = light[index]?.value ?? null;

    return {
      values: new Map(
        series.metrics.flatMap(one => {
          const value = one.points[index]?.value ?? null;
          return value === null ? [] : [[one.metric, value] as const];
        }),
      ),
      isDay: lit === null ? null : lit > LIT,
    };
  });
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
 * How long the light was on each day.
 *
 * It is the share of the time the light was on times twenty-four, counted over
 * the windows that hold a reading rather than over every window of the stretch.
 * A device writes a sample when it has one and the windows are the server's own,
 * so a stretch read at a finer resolution than the device recorded is mostly
 * empty windows - counting those as dark would make a tent on 12/12 answer six
 * hours. It also makes the figure right for a week that is not over, where the
 * hours so far are not yet a week's worth.
 *
 * The controllers of one tent switch one light, so the fullest answer wins
 * rather than the sum: two controllers reporting the same twelve hours do not
 * make twenty-four.
 */
const lightHoursOf = (series: readonly DeviceSeries[]): number | null => {
  const perDevice = series.flatMap(one => {
    const known = (one.outputs.find(output => output.output === 'light')?.points ?? []).filter(point => point.value !== null);
    const lit = known.filter(point => (point.value as number) > LIT).length;

    return known.length > 0 ? [(lit / known.length) * 24] : [];
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
