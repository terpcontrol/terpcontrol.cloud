import type { Metric, OpenAlert } from '@fg2/shared-types/v1';

/** How a card writes a figure: the unit beside it, and as many decimals as the sensor is good for. */
export const UNIT: Partial<Record<Metric, string>> = { temperature: '°C', humidity: '%', co2: 'ppm', vpd: 'kPa' };

const DECIMALS: Partial<Record<Metric, number>> = { temperature: 1, humidity: 0, co2: 0, vpd: 2 };

export const figure = (value: number, metric: Metric): string => value.toFixed(DECIMALS[metric] ?? 0);

/** A target, a band edge and the corner of an axis are round numbers more often than not, and read as one. */
export const targetFigure = (value: number, metric: Metric): string => (Number.isInteger(value) ? String(value) : figure(value, metric));

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "Alarm · 78 % RH": the reading that set it off, in the words the card uses
 * for that metric.
 *
 * An alert carries a metric only where a rule watched a reading, so an alarm on
 * an output and one the health loop raised have a number with no unit and no
 * name to put it in - and a bare "1" beside the word Alarm reads as a count of
 * something. Those say what kind of thing happened and stop there, which is the
 * whole of what the card knows.
 */
export const alertLabel = (t: Translate, alert: OpenAlert): string => {
  const reading =
    alert.value !== null && alert.metric
      ? [figure(alert.value, alert.metric), UNIT[alert.metric], t(`home.metric.${alert.metric}`, { defaultValue: alert.metric })]
          .filter(Boolean)
          .join(' ')
      : null;

  return [t(`home.alert.${alert.kind}`), reading].filter(Boolean).join(' · ');
};
