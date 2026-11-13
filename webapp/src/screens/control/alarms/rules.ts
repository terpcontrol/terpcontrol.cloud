import type { DateTime } from 'luxon';
import type { Translate } from '@/i18n/i18n';
import { headersOf } from '@/ui/headers';
import type {
  AlarmDelivery,
  AlarmDeliveryChannel,
  AlarmOrigin,
  AlarmRule,
  AlarmRuleCreate,
  AlarmWatch,
  Device,
  Me,
  Metric,
  OutputMetric,
  Severity,
  WebhookMethod,
} from '@fg2/shared-types/v1';
import {
  CRITICAL_REPEAT_SECONDS,
  alertCategory,
  inQuietWindow,
  mailFloorSecondsOf,
  repeatSecondsOf,
  silenceOf,
} from '@fg2/shared-types/v1-schemas/alert-routing.js';
import { UNIT, targetFigure } from '@/ui/units';
import { CO2_HOLDERS, hasCo2Sensor, outputWord } from '@/ui/climate-hardware';
import { looseFigure } from '@/ui/figures';
import { channelsLabel, routedChannels } from '@/screens/notifications/reach';
import { timeOf } from '@/screens/notifications/settings';
import { durationLabel, isAhead } from '@/ui/age';
import { clock, zoneOf } from '@/ui/zone';

/**
 * What the alarm screen knows about a rule that the contract does not say in so
 * many words: which readings a device can be asked to watch, what a bound is
 * called in the unit its series carries, and how the sheet's answers become the
 * body the server takes. Pure, so a test can ask each question on its own.
 */

/**
 * Whether this screen knows what a device has to watch, and so whether a new
 * rule can be written for it here. A device's type is an open string - the set
 * grows with the hardware - so nothing is decided by type alone beyond what the
 * sheet has to offer: a device whose type is newer than this build still keeps
 * every rule it has, which is read and switched from the list like any other.
 */
export const watchable = (device: Device): boolean => readingsOf(device).length > 0 || outputsOf(device).length > 0;

/** The order the groups are drawn in: what the stage wrote, what the cloud keeps, what the firmware asked for, and what was written here. */
const ORIGINS: AlarmOrigin[] = ['preset', 'always', 'device', 'human'];

export const groupRules = (rules: AlarmRule[]): { origin: AlarmOrigin; rules: AlarmRule[] }[] =>
  ORIGINS.map(origin => ({ origin, rules: rules.filter(rule => rule.origin === origin) })).filter(group => group.rules.length > 0);

/** How often a rule really repeats: its own interval, or the mail floor for a rule that e-mails. */
export const repeatsEvery = (rule: Pick<AlarmRule, 'repeatSeconds' | 'delivery'>): number =>
  Math.max(rule.repeatSeconds, mailFloorSecondsOf(rule.delivery));

/** The always-on watch: the health loop decides it, so it has no line to cross and cannot be pointed at anything else. */
export const watchesOffline = (watch: AlarmWatch | RuleDraft['watch']): boolean => watch.kind === 'reading' && watch.metric === 'offline';

/** What a rule is called, here and wherever else it is named. */
export { metricName, ruleTitle } from '@/i18n/alarm-line';

/**
 * The outputs each kind of hardware drives, from the list of what every type
 * reports in `docs/device-protocol.md`, section 5.4. A rule can only watch a
 * series the device actually sends, so a tent controller is not offered the
 * fridge's three fans and a fridge is not offered a relay.
 */
const OUTPUTS_OF: Record<string, OutputMetric[]> = {
  controller: ['dehumidifier', 'heater', 'light', 'co2'],
  fridge: ['co2', 'dehumidifier', 'heater', 'light', 'fanInternal', 'fanExternal', 'fanBackwall'],
  plug: ['relais'],
  fan: ['fan'],
  light: ['light'],
};

export const outputsOf = (device: Device): OutputMetric[] => OUTPUTS_OF[device.type] ?? [];

/** What an output is called on this kind of hardware, so "Kompressor läuft dauerhaft" is found where it is looked for. */
export const outputName = (t: Translate, output: OutputMetric, deviceType: string | null): string =>
  t(`alarms.output.${outputWord(output, deviceType === 'fridge')}`, { defaultValue: output });

/**
 * The readings a device reports: what its kind of hardware measures, narrowed
 * by what this one says it has. Temperature, humidity and VPD come with every
 * type that measures anything; the rest are sensors that are fitted or not, and
 * the device says which. `offline` is the health loop's own and is never
 * offered for a rule written here.
 */
type Sensor = 'co2' | 'leaf' | 'light';

const SENSOR_OF: Partial<Record<Metric, Sensor>> = { co2: 'co2', leafTemperature: 'leaf', lux: 'light', ppfd: 'light' };

const HARDWARE_KEY: Record<Sensor, string> = { co2: 'co2', leaf: 'leaf_temp', light: 'ppfd' };

/**
 * Whether the device has the sensor. On a controller or a fridge CO2 is fitted
 * unless the device says it is not - the rule Start's CO₂ reading and the
 * targets' CO2 slider go by, so a fridge whose report says nothing about the
 * sensor but whose readings are on Start is offered "CO₂" here as well. The
 * leaf and light sensors, and a plug's CO2, are extras that are only there
 * where the device says so.
 */
const isFitted = (device: Device, sensor: Sensor): boolean =>
  sensor === 'co2' && CO2_HOLDERS.includes(device.type) ? hasCo2Sensor(device) : device.state.hardware[HARDWARE_KEY[sensor]] === 'on';

/** The sensor a rule needs and the device does not have, or null where it reports what the rule watches. */
export const missingSensor = (watch: AlarmWatch, device: Device): Sensor | null => {
  if (watch.kind !== 'reading') return null;
  const sensor = SENSOR_OF[watch.metric];

  return sensor && !isFitted(device, sensor) ? sensor : null;
};

/**
 * What each kind of hardware measures, from the same list of what every type
 * reports that the outputs above come from - `docs/device-protocol.md`, section
 * 5.4. Every type but the camera carries a temperature and a humidity sensor,
 * and VPD follows from those two, so the climate of a place with nothing in it
 * but a fan is measured by that fan.
 *
 * The optional sensors are still asked about rather than assumed, because
 * whether one is fitted is the device's own answer and not its type's.
 */
const READINGS_OF: Record<string, Metric[]> = {
  controller: ['temperature', 'humidity', 'vpd', 'co2', 'leafTemperature', 'lux', 'ppfd'],
  fridge: ['temperature', 'humidity', 'vpd', 'co2'],
  plug: ['temperature', 'humidity', 'vpd', 'co2'],
  fan: ['temperature', 'humidity', 'vpd'],
  light: ['temperature', 'humidity', 'vpd'],
};

export const readingsOf = (device: Device): Metric[] =>
  (READINGS_OF[device.type] ?? []).filter(metric => {
    const sensor = SENSOR_OF[metric];
    return sensor === undefined || isFitted(device, sensor);
  });

/**
 * What an output's series actually carries, from `docs/device-protocol.md`
 * section 5.4, which lists it output by output because the outputs disagree
 * with one another: a fan runs at 100 where a heater runs at 1, so one answer
 * per output, taken from what that output sends.
 */
type OutputScale = 'percent' | 'fraction' | 'switch' | 'ticks';

const SCALE_OF: Partial<Record<OutputMetric, OutputScale>> = {
  fan: 'percent',
  light: 'percent',
  heater: 'fraction',
  fanInternal: 'fraction',
  fanExternal: 'fraction',
  fanBackwall: 'fraction',
  dehumidifier: 'switch',
  relais: 'switch',
  co2: 'ticks',
};

/** A level this build has never heard of is described as the commonest of them rather than as a percent, which is the reading that misleads. */
const scaleOf = (output: OutputMetric): OutputScale => SCALE_OF[output] ?? 'fraction';

/** What the sheet says a level means, where the figure alone does not say it. A percentage says it with its own sign. */
export const scaleNote = (output: OutputMetric): string | null => {
  const scale = scaleOf(output);

  return scale === 'percent' ? null : `alarms.sheet.${scale}Note`;
};

/**
 * The unit a bound is written in: the card's own for the readings it draws, and
 * for an output whatever its own series carries - a percentage for the ones
 * that send 0 to 100, and nothing for a fraction, a switch or a count of valve
 * openings, none of which is a quantity with a sign.
 */
export const unitOf = (watch: AlarmWatch): string => {
  if (watch.kind === 'reading') return UNIT[watch.metric] ?? '';

  return scaleOf(watch.output) === 'percent' ? '%' : '';
};

/** A level is written as exactly as it was sent: a heater runs between nought and one, so a rounded figure would say nothing. */
const figureOf = (watch: AlarmWatch, value: number): string => (watch.kind === 'reading' ? targetFigure(value, watch.metric) : looseFigure(value));

/** The two bounds of a rule as figures with their unit, "30 °C", each null where the rule sets none; an output watched for running sets neither. */
const boundsOf = (watch: AlarmWatch): { upper: string | null; lower: string | null } => {
  if (watch.kind === 'output_running') return { upper: null, lower: null };
  const unit = unitOf(watch);
  const one = (value: number | null) => (value === null ? null : `${figureOf(watch, value)}${unit ? ` ${unit}` : ''}`);

  return { upper: one(watch.upper), lower: one(watch.lower) };
};

/**
 * "über 30 °C", "unter 16 °C", both with a dot between; an output watched for
 * running has no bound and answers nothing. In words rather than as "› 30" -
 * the same angle is the arrow every link on the page ends in, and the
 * templates already said "über".
 */
export const boundLabel = (t: Translate, watch: AlarmWatch): string => {
  const { upper, lower } = boundsOf(watch);

  return [upper !== null ? t('alarms.bound.above', { value: upper }) : null, lower !== null ? t('alarms.bound.below', { value: lower }) : null]
    .filter(Boolean)
    .join(' · ');
};

/**
 * What an alarm will do to reach this account from now on, in the words every
 * screen says it in: a rule under Steuerung › Alarme and an open alert's card.
 * It is asked of the grade the alarm is announced at and of the rule that
 * addresses it - null for what the health loop raises without one, which is
 * routed and never repeats.
 *
 * It decides in the server's order. A silenced rule tells nobody. A rule with
 * a target of its own sends whatever the account has set. An info alarm is on
 * no row of the grid. A row none of whose channels is set up reaches nobody:
 * `unreached`, said by whoever offers the way to change that. A mute holds
 * everything back and quiet hours everything short of critical (`silenceOf`),
 * read in the account's zone; what was held back is not sent later, so only a
 * rule that repeats is promised to say itself once the night is over.
 */
export const willTell = (
  t: Translate,
  severity: Severity,
  rule: Pick<AlarmRule, 'delivery' | 'repeatSeconds' | 'silencedUntil'> | null,
  me: Me | undefined,
  now: DateTime,
): { said: string[]; unreached: boolean } => {
  const zone = zoneOf(me);
  const said = (...parts: (string | null)[]) => ({ said: parts.filter(part => part !== null), unreached: false });
  const repeats = rule !== null && rule.repeatSeconds > 0;
  const again = repeats ? t('alarms.tell.repeats', { length: durationLabel(repeatsEvery(rule)) }) : t('alarms.tell.once');

  if (rule && isAhead(rule.silencedUntil, now)) return said(t('alarms.tell.silenced', { time: clock(rule.silencedUntil!, zone) }));
  if (rule?.delivery.mode === 'custom')
    return said(rule.delivery.custom ? t(`alarms.channel.${rule.delivery.custom.channel}`) : t('alarms.tell.ownTarget'), again);
  if (!me) return said(again);
  if (alertCategory(severity) === null) return said(t('alarms.tell.nowhere'));

  const routed = routedChannels(me, severity);
  if (!routed.some(channel => channel.configured)) return { said: [], unreached: true };

  const local = zone ? now.setZone(zone) : now;
  const quiet = inQuietWindow(me.notifications.quietHours, local.hour * 60 + local.minute);
  const held = silenceOf(severity, isAhead(me.notifications.mutedUntil ?? null, now), quiet);
  if (held === 'muted') return said(t('alarms.tell.muted', { time: clock(me.notifications.mutedUntil!, zone) }));
  if (held === 'quiet') return said(t(`alarms.tell.${repeats ? 'afterQuiet' : 'quiet'}`, { time: timeOf(me.notifications.quietHours!.toMinute) }));

  return said(t('alarms.tell.toYou', { channels: channelsLabel(t, routed) }), quiet ? t('alarms.tell.through') : null, again);
};

/**
 * What a rule watches, where its title does not already say it.
 *
 * A rule on a reading is titled from that reading, so the metric is on the card
 * twice if this answers as well. A rule on an output running is titled from
 * whatever its author typed - or from nothing at all, for one the firmware
 * wrote - so without this the card states no condition and the duration beside
 * it hangs off nothing. The inbox names the same watch the same way.
 */
export const watchLabel = (t: Translate, watch: AlarmWatch, deviceType: string | null = null): string | null =>
  watch.kind === 'output_running' ? t('alarms.watchRunning', { output: outputName(t, watch.output, deviceType) }) : null;

/**
 * The sheet's answers, in the shape its fields hold them: a bound is a string
 * because an empty field is "no bound", which is not a number, and the times
 * are minutes because that is what a person types.
 */
export interface RuleDraft {
  name: string;
  watch: { kind: 'reading'; metric: Metric } | { kind: 'output_level' | 'output_running'; output: OutputMetric };
  upper: string;
  lower: string;
  forMinutes: number;
  severity: Severity;
  tellBy: 'routing' | AlarmDeliveryChannel;
  email: string;
  url: string;
  method: WebhookMethod;
  /** "Name: value", one per line, as the textarea holds them. */
  headers: string;
  triggeredPayload: string;
  resolvedPayload: string;
  reportErrors: boolean;
  tunnel: boolean;
  includeDetails: boolean;
  repeatMinutes: number;
}

/**
 * The repeat a severity comes with. Changing the severity brings its repeat
 * with it, because the two are one decision - how bad is this, and how often
 * should it be said - and a critical rule that announces itself once and then
 * goes quiet is the one thing nobody asked for. A severity chosen again is not
 * a change, so a repeat typed by hand survives it.
 */
export const withSeverity = (draft: RuleDraft, severity: Severity): RuleDraft =>
  severity === draft.severity ? draft : { ...draft, severity, repeatMinutes: repeatSecondsOf(severity) / 60 };

/**
 * What a new rule starts out watching: the first reading the device measures,
 * or, on hardware that measures nothing, the first output it drives - watched
 * for running at all, because that is the one rule that is complete before a
 * line has been typed into it. Null where this build knows neither, which is
 * hardware newer than itself and is why the sheet is not offered for it.
 */
export const firstWatch = (device: Device): RuleDraft['watch'] | null => {
  const [metric] = readingsOf(device);
  if (metric) return { kind: 'reading', metric };

  const [output] = outputsOf(device);

  return output ? { kind: 'output_running', output } : null;
};

/** What a draft watches before anything is known about the device: the reading every climate rule is about. */
export const DEFAULT_WATCH: RuleDraft['watch'] = { kind: 'reading', metric: 'temperature' };

/** A rule as most of them start: ten minutes over the line, announced the way the account is, and repeated while it lasts. */
export const emptyDraft = (watch: RuleDraft['watch']): RuleDraft => ({
  name: '',
  watch,
  upper: '',
  lower: '',
  forMinutes: 10,
  severity: 'critical',
  tellBy: 'routing',
  email: '',
  url: '',
  method: 'POST',
  headers: '',
  triggeredPayload: '',
  resolvedPayload: '',
  reportErrors: true,
  tunnel: false,
  includeDetails: true,
  repeatMinutes: CRITICAL_REPEAT_SECONDS / 60,
});

const bound = (value: number | null): string => (value === null ? '' : String(value));

/** The rule as the sheet takes it back up. What a manager was not answered - a delivery of somebody else's - reads as routing. */
export const draftOf = (rule: AlarmRule): RuleDraft => {
  const custom = rule.delivery.mode === 'custom' ? rule.delivery.custom : null;
  const webhook = custom?.webhook ?? null;
  const band = rule.watch.kind === 'output_running' ? null : rule.watch;

  return {
    ...emptyDraft(DEFAULT_WATCH),
    name: rule.name,
    watch: rule.watch.kind === 'reading' ? { kind: 'reading', metric: rule.watch.metric } : { kind: rule.watch.kind, output: rule.watch.output },
    upper: bound(band?.upper ?? null),
    lower: bound(band?.lower ?? null),
    forMinutes: rule.forSeconds / 60,
    severity: rule.severity,
    tellBy: custom ? custom.channel : 'routing',
    email: custom?.channel === 'email' ? custom.target : '',
    url: custom?.channel === 'webhook' ? custom.target : '',
    method: webhook?.method ?? 'POST',
    headers: Object.entries(webhook?.headers ?? {})
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n'),
    triggeredPayload: webhook?.triggeredPayload ?? '',
    resolvedPayload: webhook?.resolvedPayload ?? '',
    reportErrors: webhook?.reportErrors ?? true,
    tunnel: webhook?.tunnel ?? false,
    includeDetails: custom?.includeDetails ?? true,
    repeatMinutes: rule.repeatSeconds / 60,
  };
};

const numberOrNull = (field: string): number | null => (field.trim() === '' || Number.isNaN(Number(field)) ? null : Number(field));

/**
 * A rule about a level with no level in it would never trip, and is refused
 * here before the server has to. An output watched for running at all and the
 * offline watch are not about a level, so neither is asked for one.
 */
export const wantsBound = (draft: RuleDraft): boolean => draft.watch.kind !== 'output_running' && !watchesOffline(draft.watch);

export const hasBound = (draft: RuleDraft): boolean => !wantsBound(draft) || numberOrNull(draft.upper) !== null || numberOrNull(draft.lower) !== null;

/**
 * Whether the two edges contradict each other: a rule fires above its upper edge or below its lower one, so a
 * lower edge at or over the upper fires at every value ("over 70, under 80"). Refused before the server has to.
 */
export const boundsContradict = (draft: RuleDraft): boolean => {
  const upper = numberOrNull(draft.upper);
  const lower = numberOrNull(draft.lower);
  return wantsBound(draft) && upper !== null && lower !== null && lower >= upper;
};

export const watchOf = (draft: RuleDraft): AlarmWatch => {
  if (draft.watch.kind === 'reading')
    return { kind: 'reading', metric: draft.watch.metric, upper: numberOrNull(draft.upper), lower: numberOrNull(draft.lower) };
  if (draft.watch.kind === 'output_level')
    return { kind: 'output_level', output: draft.watch.output, upper: numberOrNull(draft.upper), lower: numberOrNull(draft.lower) };

  return { kind: 'output_running', output: draft.watch.output };
};

const deliveryOf = (draft: RuleDraft): AlarmDelivery => {
  if (draft.tellBy === 'routing') return { mode: 'routing', custom: null };
  if (draft.tellBy === 'email')
    return { mode: 'custom', custom: { channel: 'email', target: draft.email.trim(), includeDetails: draft.includeDetails, webhook: null } };

  return {
    mode: 'custom',
    custom: {
      channel: 'webhook',
      target: draft.url.trim(),
      includeDetails: draft.includeDetails,
      webhook: {
        method: draft.method,
        headers: headersOf(draft.headers),
        triggeredPayload: draft.triggeredPayload,
        resolvedPayload: draft.resolvedPayload,
        reportErrors: draft.reportErrors,
        tunnel: draft.tunnel,
      },
    },
  };
};

const seconds = (minutes: number): number => Math.max(0, Math.round(minutes * 60));

/**
 * The body a new rule is created with. It starts enabled - a rule written and
 * switched off is two taps for one - and with no cooldown: what keeps a bad
 * hour from being a message a minute is that a rule says so once and then only
 * on the repeat it was given.
 *
 * That repeat goes out as the draft holds it, at every severity. Whether a
 * quieter rule repeats at all is decided where somebody decides it - in
 * `withSeverity`, which clears the repeat as the severity is lowered - and not
 * again here, where the draft has only been read back. A warning rule that
 * arrived carrying an interval, from the migration or from an older client,
 * has it drawn on its card and honoured by the engine, so saving that rule
 * with nothing changed must give it back unchanged rather than silence it.
 */
export const createBody = (draft: RuleDraft): AlarmRuleCreate => ({
  name: draft.name.trim(),
  watch: watchOf(draft),
  forSeconds: seconds(draft.forMinutes),
  severity: draft.severity,
  enabled: true,
  cooldownSeconds: 0,
  repeatSeconds: seconds(draft.repeatMinutes),
  delivery: deliveryOf(draft),
});

/** The same for a rule that exists: everything the sheet asks, and nothing it does not - whether it is on, and its cooldown, stay as they are. */
export const updateBody = (draft: RuleDraft): Omit<AlarmRuleCreate, 'enabled' | 'cooldownSeconds'> => {
  const { enabled: _enabled, cooldownSeconds: _cooldown, ...rest } = createBody(draft);
  return rest;
};
