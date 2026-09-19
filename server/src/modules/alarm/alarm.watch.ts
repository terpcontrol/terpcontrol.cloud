import { AlarmWatch, Metric, OutputMetric } from '@fg2/shared-types/v1';
import { MetricSample } from './alarm.types';

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
