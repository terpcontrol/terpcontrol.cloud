import type { i18n as I18n } from 'i18next';
import type { AlarmRule, AlarmWatch, Metric } from '@fg2/shared-types/v1';
import { OFFLINE_RULE_NAME } from '@fg2/shared-types/v1-schemas/alert-routing.js';
import { figureWithUnit, targetWithUnit, UNIT } from '@/ui/units';
import type { Translate } from './i18n';

/** What a preset's rules are called, by what each watches: a stage writes the same four whichever preset it stands on. */
const PRESET_TITLE: Record<string, string> = {
  'temperature-upper': 'tooHot',
  'temperature-lower': 'tooCold',
  'humidity-upper': 'tooHumid',
  'co2-upper': 'co2High',
};

/**
 * The names those rules are stored under, which is all an open alert or a line of the diary says of its rule: the
 * four a stage writes, and the ones a single tap under Steuerung writes (`alarms/templates.ts`), which are stored
 * under the same kind of name so that they read in the reader's language too.
 */
const STORED_TITLE: Record<string, string> = {
  'Too hot': 'tooHot',
  'Too cold': 'tooCold',
  'Too humid': 'tooHumid',
  'CO₂ too high': 'co2High',
  'Too dry': 'tooDry',
  'CO₂ cylinder empty': 'co2Empty',
  'Fridge runs without a break': 'running',
};

const presetTitle = (watch: AlarmWatch): string | null => {
  if (watch.kind !== 'reading') return null;
  const side = watch.upper !== null ? 'upper' : watch.lower !== null ? 'lower' : null;

  return side ? (PRESET_TITLE[`${watch.metric}-${side}`] ?? null) : null;
};

/**
 * What a rule is called, wherever it is named. The server names its own rules
 * in English - the one it keeps for every device and the four a stage applies
 * - so those are titled in the reader's language: from what the rule watches,
 * else from the name it is stored under, which is how a rule made by one tap
 * is named as well. A rule somebody named keeps its name.
 */
export const ruleTitle = (t: Translate, { name, origin, watch }: Pick<AlarmRule, 'name'> & Partial<Pick<AlarmRule, 'origin' | 'watch'>>): string => {
  if (origin === 'always' || (!origin && name === OFFLINE_RULE_NAME)) return t('alarms.offlineRule');
  const title = (origin === 'preset' && watch ? presetTitle(watch) : null) ?? STORED_TITLE[name];

  return title ? t(`alarms.presetRule.${title}`) : name;
};

/** What a reading is called wherever an alarm names it, in full: "Blatttemperatur zu hoch". */
export const metricName = (t: Translate, metric: Metric): string => t(`alarms.metric.${metric}`, { defaultValue: metric });

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
export const alarmLineText = (i18n: I18n, param: string, triggered: boolean): string | null => {
  const parts = alarmLineParts(i18n, param, triggered);
  return parts ? [parts.rule, ...parts.said].join(' · ') : null;
};

/**
 * The same line in its parts, for a surface that sets the rule's name as the
 * line and what tripped it under it. `limit` is the reading and the edge it
 * crossed without the figure it had ("Luftfeuchte über 60 %"), for a line that
 * stands for many firings and has no one figure to state.
 */
interface AlarmLine {
  rule: string;
  said: string[];
  limit: string | null;
}

export const alarmLineParts = (i18n: I18n, param: string, triggered: boolean): AlarmLine | null =>
  thresholdLine(i18n, param, triggered) ?? silenceLine(i18n, param, triggered);

const THRESHOLD = /^(.*) \(([A-Za-z0-9_]+)\), value=([^,]+?)(?:, upper threshold=([^,]+?), lower threshold=([^,]+?))?(?:, extreme value=([^,]+?))?$/;
const SILENT = /^(.*), last heard (.+) ago$/;
const BACK_AFTER = /^(.*), back after (.+)$/;
const BACK = /^(.*), back$/;

const numberOf = (text: string | undefined): number | null => {
  if (text === undefined || text === 'n/a' || text === 'null') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

const isReading = (watched: string): watched is Metric => watched in UNIT;

const ruleName = (i18n: I18n, name: string): string => ruleTitle((key, options) => i18n.t(key, options ?? {}), { name });

const thresholdLine = (i18n: I18n, param: string, triggered: boolean): AlarmLine | null => {
  const match = THRESHOLD.exec(param);
  if (!match) return null;

  const [, name, watched, rawValue, rawUpper, rawLower, rawExtreme] = match;
  const value = numberOf(rawValue);
  if (value === null) return null;

  if (!isReading(watched)) {
    const output = i18n.t(`alerts.output.${watched}`, { defaultValue: watched });
    return { rule: ruleName(i18n, name), said: [i18n.t(value > 0 ? 'alarmLine.outputOn' : 'alarmLine.outputOff', { output })], limit: null };
  }

  const metric = metricName((key, options) => i18n.t(key, options ?? {}), watched);
  const upper = numberOf(rawUpper);
  const lower = numberOf(rawLower);
  const extreme = numberOf(rawExtreme);
  // The edge is said in words: "›" is the app's sign for "opens something".
  const edge = (side: 'over' | 'under', bound: number) => i18n.t(`alarmLine.${side}`, { bound: targetWithUnit(bound, watched) });
  const crossed = !triggered
    ? null
    : upper !== null && value > upper
      ? edge('over', upper)
      : lower !== null && value < lower
        ? edge('under', lower)
        : null;

  const said = [`${metric} ${figureWithUnit(value, watched)}`];
  if (crossed) said.push(crossed);
  if (!triggered && extreme !== null) said.push(i18n.t('alarmLine.worst', { value: figureWithUnit(extreme, watched) }));

  // The limit stands as a line of its own, so the reading opens it as a sentence does.
  return { rule: ruleName(i18n, name), said, limit: crossed ? `${metric.charAt(0).toLocaleUpperCase()}${metric.slice(1)} ${crossed}` : null };
};

/**
 * The server writes a span in English symbols - "5 d 10 h", "3 h 20 min" - and
 * the rest of the app writes each unit in the reader's own (`units.*`), so a
 * German diary read "5 d 10 h" under an alert card saying "vor 5 T".
 */
const spanIn = (i18n: I18n, span: string): string =>
  span.replace(/(\d+) (s|min|h|d)\b/g, (_, figure: string, unit: string) => `${figure} ${i18n.t(`units.${unit}`, { defaultValue: unit })}`);

const silenceLine = (i18n: I18n, param: string, triggered: boolean): AlarmLine | null => {
  const line = (rule: string, said: string): AlarmLine => ({ rule: ruleName(i18n, rule), said: [said], limit: null });

  if (triggered) {
    const silent = SILENT.exec(param);
    return silent ? line(silent[1], i18n.t('alarmLine.silentFor', { span: spanIn(i18n, silent[2]) })) : null;
  }

  const after = BACK_AFTER.exec(param);
  if (after) return line(after[1], i18n.t('alarmLine.backAfter', { span: spanIn(i18n, after[2]) }));

  const back = BACK.exec(param);
  return back ? line(back[1], i18n.t('alarmLine.back')) : null;
};
