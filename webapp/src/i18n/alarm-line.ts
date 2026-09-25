import type { i18n as I18n } from 'i18next';
import type { Metric } from '@fg2/shared-types/v1';
import { figure, targetFigure, UNIT } from '@/screens/home/units';

/**
 * An alarm's diary line, in the reader's language.
 *
 * The server writes the whole of what an alarm line says into one English
 * parameter, as the old app always did, and the migrated diaries hold two
 * hundred thousand of them in the same shape:
 *
 *   `<rule> (<watched>), value=<n>[, upper threshold=<n|n/a>, lower threshold=<n|n/a>][, extreme value=<n|n/a>]`
 *   `<rule>, last heard <span> ago` and `<rule>, back after <span>` for silence
 *
 * Printed as it came, a German page read "value=21.841, upper threshold=21"
 * beside an alert card saying "Temperatur 21,8 °C › 21" about the same
 * instant. So the parameter is read back into its parts here and written the
 * way the alert card writes them: the reading rounded to what the sensor is
 * good for, with the reader's decimal mark and the edge it crossed. A silence
 * is said as how long the device had been silent when the alarm was raised -
 * the line is dated at that moment - rather than as an "ago" that stops
 * counting the moment it is written.
 *
 * Anything that does not have one of these shapes is left to the caller, which
 * shows it as it came.
 */
export const alarmLineText = (i18n: I18n, param: string, triggered: boolean): string | null =>
  thresholdLine(i18n, param, triggered) ?? silenceLine(i18n, param, triggered);

const THRESHOLD = /^(.*) \(([A-Za-z0-9_]+)\), value=([^,]+?)(?:, upper threshold=([^,]+?), lower threshold=([^,]+?))?(?:, extreme value=([^,]+?))?$/;
const SILENT = /^(.*), last heard (.+) ago$/;
const BACK_AFTER = /^(.*), back after (.+)$/;
const BACK = /^(.*), back$/;

/** The name the cloud gives the offline rule it keeps for every device, which is the rule's name on most of these lines. */
const KEPT_OFFLINE_RULE = 'Device offline';

const numberOf = (text: string | undefined): number | null => {
  if (text === undefined || text === 'n/a' || text === 'null') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

const isReading = (watched: string): watched is Metric => watched in UNIT;

const ruleName = (i18n: I18n, name: string): string => (name === KEPT_OFFLINE_RULE ? i18n.t('alarmLine.deviceOffline') : name);

const reading = (value: number, metric: Metric): string => [figure(value, metric), UNIT[metric]].filter(Boolean).join(' ');

const thresholdLine = (i18n: I18n, param: string, triggered: boolean): string | null => {
  const match = THRESHOLD.exec(param);
  if (!match) return null;

  const [, name, watched, rawValue, rawUpper, rawLower, rawExtreme] = match;
  const value = numberOf(rawValue);
  if (value === null) return null;

  if (!isReading(watched)) {
    const output = i18n.t(`alerts.output.${watched}`, { defaultValue: watched });
    return `${ruleName(i18n, name)} · ${i18n.t(value > 0 ? 'alarmLine.outputOn' : 'alarmLine.outputOff', { output })}`;
  }

  const metric = i18n.t(`alerts.metric.${watched}`, { defaultValue: i18n.t(`home.metric.${watched}`, { defaultValue: watched }) });
  const upper = numberOf(rawUpper);
  const lower = numberOf(rawLower);
  const extreme = numberOf(rawExtreme);
  const edge = (sign: string, bound: number) => [sign, targetFigure(bound, watched), UNIT[watched]].filter(Boolean).join(' ');
  const crossed = upper !== null && value > upper ? edge('›', upper) : lower !== null && value < lower ? edge('‹', lower) : null;

  const parts = [`${ruleName(i18n, name)} · ${metric} ${reading(value, watched)}${triggered && crossed ? ` ${crossed}` : ''}`];
  if (!triggered && extreme !== null) parts.push(i18n.t('alarmLine.worst', { value: reading(extreme, watched) }));

  return parts.join(' · ');
};

const silenceLine = (i18n: I18n, param: string, triggered: boolean): string | null => {
  if (triggered) {
    const silent = SILENT.exec(param);
    return silent ? `${ruleName(i18n, silent[1])} · ${i18n.t('alarmLine.silentFor', { span: silent[2] })}` : null;
  }

  const after = BACK_AFTER.exec(param);
  if (after) return `${ruleName(i18n, after[1])} · ${i18n.t('alarmLine.backAfter', { span: after[2] })}`;

  const back = BACK.exec(param);
  return back ? `${ruleName(i18n, back[1])} · ${i18n.t('alarmLine.back')}` : null;
};
