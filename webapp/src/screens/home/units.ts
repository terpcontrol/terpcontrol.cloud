import type { Metric, OpenAlert } from '@fg2/shared-types/v1';
import type { DateTime } from 'luxon';
import { ageLabel, silentSince } from '@/ui/age';
import { decimalFigure } from '@/ui/figures';

/** How a card writes a figure: the unit beside it, and as many decimals as the sensor is good for. */
export const UNIT: Partial<Record<Metric, string>> = { temperature: '°C', humidity: '%', co2: 'ppm', vpd: 'kPa' };

const DECIMALS: Partial<Record<Metric, number>> = { temperature: 1, humidity: 0, co2: 0, vpd: 2 };

/**
 * A reading as a card writes it. A figure that rounds away to nothing is
 * written as nothing rather than as "-0": a scale is stretched a little past
 * what it holds, so a series flat at zero - a tent whose CO2 sensor answers
 * zero on every sample - puts its low corner a hairsbreadth below, and rounding
 * that to the decimals the sensor is good for kept the minus sign in front of a
 * zero. Nothing ever measured minus nothing.
 *
 * The rounding happens on the number and the writing happens after it, because
 * the written form is the reader's and a German one has a comma in the middle
 * that no arithmetic here could read back.
 */
export const figure = (value: number, metric: Metric): string => {
  const decimals = DECIMALS[metric] ?? 0;
  const rounded = Number(value.toFixed(decimals));

  return decimalFigure(rounded === 0 ? 0 : rounded, decimals);
};

/** A target, a band edge and the corner of an axis are round numbers more often than not, and read as one. */
export const targetFigure = (value: number, metric: Metric): string => (Number.isInteger(value) ? String(value) : figure(value, metric));

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "Mould watch · 78 % RH": the rule and the reading that set it off, in the
 * words the card uses for that metric; "Alarm" where no rule is named.
 *
 * An alert carries a metric only where a rule watched a reading, so an alarm on
 * an output and one the health loop raised have a number with no unit and no
 * name to put it in - and a bare "1" beside the word Alarm reads as a count of
 * something. Those say what kind of thing happened and stop there, which is the
 * whole of what the card knows.
 *
 * Silence is the exception the contract makes: `offline` is a metric so that the
 * health loop's rule can be an ordinary reading rule, and the reading it carries
 * is a number of seconds. Printed as a figure it read "337256 offline", which is
 * the least useful true thing a card could say about a tent nobody has heard
 * from - so it is said as a span, in the same words every other age on the
 * screen uses.
 *
 * Those seconds are counted from when the device was last *heard*, which is not
 * the same instant as its last sample and on a migrated device can be half a
 * day earlier. So the span is worded as the pill beside it is worded, "last
 * heard", and never as a silence of readings: calling it that put "quiet for
 * 4 d" on a card whose own figures were dated three days ago.
 */
export const alertLabel = (t: Translate, alert: OpenAlert, now: DateTime): string => {
  if (isSilence(alert)) {
    // Counted on from when the silence began, not frozen at the raise, so this
    // agrees with the Alerts card and the Devices row on every later day too.
    const quiet = alert.value === null ? null : t('home.alert.quietFor', { age: ageLabel(silentSince(alert), now) });
    return [t(`home.alert.${alert.kind}`), quiet].filter(Boolean).join(' · ');
  }

  const reading =
    alert.value !== null && alert.metric
      ? [figure(alert.value, alert.metric), UNIT[alert.metric], t(`home.metric.${alert.metric}`, { defaultValue: alert.metric })]
          .filter(Boolean)
          .join(' ')
      : null;

  // A rule's name leads where there is one, as it leads the alert card and the
  // diary line: two rules on one sensor otherwise made two banners on one
  // place that were word for word the same.
  const what = alert.kind === 'threshold' && alert.name ? alert.name : t(`home.alert.${alert.kind}`);
  return [what, reading].filter(Boolean).join(' · ');
};

/**
 * Whether an alert is about a device gone quiet. Its age is already in its label,
 * counted from the silence, so a line does not add how long ago the cloud noticed.
 */
export const isSilence = (alert: Pick<OpenAlert, 'kind' | 'metric'>): boolean => alert.kind === 'offline' || alert.metric === 'offline';
