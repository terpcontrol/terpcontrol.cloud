import { AlarmWatch, AlertKind, Metric, OutputMetric } from '@fg2/shared-types/v1';
import { MetricSample } from '@modules/device-protocol/device-sinks';

/**
 * What a watch means, in one place.
 *
 * A rule watches a reading the device measures or an output it drives, and the
 * two are told apart everywhere the engine, the delivery and the screens touch
 * one: which sample answers it, what trips it, and what it is called in a
 * message. Every one of those questions is asked of the watch here rather than
 * with a second `kind` check somewhere else.
 */

/** A band, where the watch has one. A running output is on or off and has none. */
export interface Band {
  upper: number | null;
  lower: number | null;
}

/** What the rule watches, as the one word a message names it by. */
export const watchedName = (watch: AlarmWatch): Metric | OutputMetric => (watch.kind === 'reading' ? watch.metric : watch.output);

export const bandOf = (watch: AlarmWatch): Band | null => (watch.kind === 'output_running' ? null : { upper: watch.upper, lower: watch.lower });

/**
 * The band a rule's messages state, where it has one to state. A rule watching
 * something with no band around it - the health metrics, and an output watched
 * for running at all - says nothing about thresholds, exactly as the alarm on a
 * fridge compressor always has.
 */
export const statedBand = (rule: { watch: AlarmWatch } | null): Band | null => {
  const band = rule ? bandOf(rule.watch) : null;
  return band && (band.upper !== null || band.lower !== null) ? band : null;
};

/**
 * What the rule watches, in the word somebody's home automation has always read
 * off `sensorType`: the metric, or the output - which is the same word the old
 * alarms sent for four of the five outputs, `co2_valve` having become `co2`.
 * An alert with no rule says what kind of alert it is, as it always has.
 */
export const watchedOf = (rule: { watch: AlarmWatch } | null, alert: { kind: AlertKind }): string => (rule ? watchedName(rule.watch) : alert.kind);

/**
 * Whether the value is the thing the rule is there for: outside the band it
 * allows, or - for an output watched for running at all - the output doing
 * anything. A watch with no bound either way is never out of bounds, which is
 * what `offline` is: the health loop decides that one, not a threshold.
 */
export const isOutOfBounds = (watch: AlarmWatch, value: number): boolean => {
  const band = bandOf(watch);
  if (!band) return value > 0;

  return (band.upper !== null && value > band.upper) || (band.lower !== null && value < band.lower);
};

/** What this sample says about the watch; undefined where the device reported nothing of it. */
export const watchedValue = (watch: AlarmWatch, sample: MetricSample): number | undefined =>
  watch.kind === 'reading' ? sample.values[watch.metric] : sample.outputs[watch.output];
