import type { Metric, OpenAlert } from '@fg2/shared-types/v1';

/** How a card writes a figure: the unit beside it, and as many decimals as the sensor is good for. */
export const UNIT: Partial<Record<Metric, string>> = { temperature: '°C', humidity: '%', co2: 'ppm', vpd: 'kPa' };

const DECIMALS: Partial<Record<Metric, number>> = { temperature: 1, humidity: 0, co2: 0, vpd: 2 };

export const figure = (value: number, metric: Metric): string => value.toFixed(DECIMALS[metric] ?? 0);

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Alarm · 78 % RH": the reading that set it off, in the words the card uses for that metric. */
export const alertLabel = (t: Translate, alert: OpenAlert): string => {
  const reading =
    alert.value === null
      ? ''
      : alert.metric
        ? [figure(alert.value, alert.metric), UNIT[alert.metric], t(`home.metric.${alert.metric}`, { defaultValue: alert.metric })]
            .filter(Boolean)
            .join(' ')
        : String(alert.value);

  return t(`home.alert.${alert.kind}`, { value: reading });
};
