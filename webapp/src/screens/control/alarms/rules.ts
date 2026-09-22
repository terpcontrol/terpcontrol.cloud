import { headersOf } from '@/ui/headers';
import type {
  AlarmDelivery,
  AlarmOrigin,
  AlarmRule,
  AlarmRuleCreate,
  AlarmWatch,
  Device,
  Me,
  Metric,
  NotificationChannel,
  OutputMetric,
  Severity,
  WebhookMethod,
} from '@fg2/shared-types/v1';
import { alertCategory } from '@fg2/shared-types/v1-schemas/alert-routing.js';
import { UNIT, targetFigure } from '@/screens/home/units';

/**
 * What the alarm screen knows about a rule that the contract does not say in so
 * many words: which readings a device can be asked to watch, what a bound is
 * called in the unit its series carries, and how the sheet's answers become the
 * body the server takes. Pure, so a test can ask each question on its own.
 */

/** A rule watches a device that measures a climate; a plug, a fan and a lamp have none. */
export const hasRules = (device: Device): boolean => device.type === 'controller' || device.type === 'fridge';

/** The order the groups are drawn in: what the stage wrote, what the cloud keeps, what the firmware asked for, and what was written here. */
export const ORIGINS: AlarmOrigin[] = ['preset', 'always', 'device', 'human'];

export const groupRules = (rules: AlarmRule[]): { origin: AlarmOrigin; rules: AlarmRule[] }[] =>
  ORIGINS.map(origin => ({ origin, rules: rules.filter(rule => rule.origin === origin) })).filter(group => group.rules.length > 0);

/** The always-on watch: the health loop decides it, so it has no line to cross and cannot be pointed at anything else. */
export const watchesOffline = (watch: AlarmWatch | RuleDraft['watch']): boolean => watch.kind === 'reading' && watch.metric === 'offline';

/**
 * What a preset's rules are called, by what each watches. The catalogue has
 * one name per band rather than per preset, because a stage writes the same
 * four rules whichever preset it stands on.
 */
const PRESET_TITLE: Record<string, string> = {
  'temperature-upper': 'tooHot',
  'temperature-lower': 'tooCold',
  'humidity-upper': 'tooHumid',
  'co2-upper': 'co2High',
};

const presetTitle = (watch: AlarmWatch): string | null => {
  if (watch.kind !== 'reading') return null;
  const side = watch.upper !== null ? 'upper' : watch.lower !== null ? 'lower' : null;

  return side ? (PRESET_TITLE[`${watch.metric}-${side}`] ?? null) : null;
};

/**
 * What a rule is called on the card.
 *
 * A name the server wrote is English wherever it was written, so the two kinds
 * of rule nobody here named - the one the cloud keeps for every device and the
 * four a stage applies - are titled from what they watch instead, and read in
 * the language the page is in. A rule somebody wrote, by hand or through the
 * firmware, keeps the name it was given.
 */
export const ruleTitle = (t: Translate, rule: AlarmRule, device: Device): string => {
  if (rule.origin === 'always') return t('alarms.offlineRule', { device: t(`devices.type.${device.type}`, { defaultValue: device.type }) });
  if (rule.origin === 'preset') {
    const title = presetTitle(rule.watch);
    if (title) return t(`alarms.presetRule.${title}`);
  }

  return rule.name;
};

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

/**
 * The readings a device reports, from its own hardware report. Temperature,
 * humidity and VPD come with every controller and fridge module; the rest are
 * sensors that are fitted or not, and the device says which. `offline` is the
 * health loop's own and is never offered for a rule written here.
 */
export type Sensor = 'co2' | 'leaf' | 'light';

const SENSOR_OF: Partial<Record<Metric, Sensor>> = { co2: 'co2', leafTemperature: 'leaf', lux: 'light', ppfd: 'light' };

const HARDWARE_KEY: Record<Sensor, string> = { co2: 'co2', leaf: 'leaf_temp', light: 'ppfd' };

const isFitted = (device: Device, sensor: Sensor): boolean => device.state.hardware[HARDWARE_KEY[sensor]] === 'on';

/** The sensor a rule needs and the device does not have, or null where it reports what the rule watches. */
export const missingSensor = (watch: AlarmWatch, device: Device): Sensor | null => {
  if (watch.kind !== 'reading') return null;
  const sensor = SENSOR_OF[watch.metric];

  return sensor && !isFitted(device, sensor) ? sensor : null;
};

const OFFERED: Metric[] = ['temperature', 'humidity', 'vpd', 'co2', 'leafTemperature', 'lux', 'ppfd'];

export const readingsOf = (device: Device): Metric[] =>
  OFFERED.filter(metric => {
    const sensor = SENSOR_OF[metric];
    return sensor === undefined || isFitted(device, sensor);
  });

/**
 * The unit a bound is written in: the card's own for the readings it draws,
 * and for the rest what the series carries - the light dims in percent, every
 * other output is a fraction of the time it runs, and a fraction has no sign.
 */
const MORE_UNITS: Partial<Record<Metric, string>> = { leafTemperature: '°C', lux: 'lx', ppfd: 'µmol/m²/s' };

export const unitOf = (watch: AlarmWatch): string => {
  if (watch.kind === 'reading') return UNIT[watch.metric] ?? MORE_UNITS[watch.metric] ?? '';

  return watch.output === 'light' ? '%' : '';
};

const figureOf = (watch: AlarmWatch, value: number): string => (watch.kind === 'reading' ? targetFigure(value, watch.metric) : String(value));

/** "› 30 °C", "‹ 16 °C", both with a space between; an output watched for running has no bound and answers nothing. */
export const boundLabel = (watch: AlarmWatch): string => {
  if (watch.kind === 'output_running') return '';
  const unit = unitOf(watch);
  const one = (sign: string, value: number) => `${sign} ${figureOf(watch, value)}${unit ? ` ${unit}` : ''}`;

  return [watch.upper !== null ? one('›', watch.upper) : null, watch.lower !== null ? one('‹', watch.lower) : null].filter(Boolean).join(' ');
};

/** The order the channels are named in, whatever order the grid holds them in. */
const CHANNELS: NotificationChannel[] = ['push', 'telegram', 'email', 'webhook'];

/** What a screen says about a channel: its name, and whether the account has it to be reached on at all. */
export interface RoutedChannel {
  channel: NotificationChannel;
  configured: boolean;
}

/** A channel is configured when the account has given it something to deliver to; push, when some browser of it is subscribed. */
const isConfigured = (me: Me, channel: NotificationChannel): boolean =>
  channel === 'push' ? me.pushSubscribed : me.notifications.channels[channel] !== null;

/**
 * Where a routed rule of this severity goes, read off the account's own grid.
 * Which row that is belongs to the contract rather than to this screen, so the
 * server announcing and the screen saying so cannot drift apart.
 *
 * A row may name a channel the account cannot be reached on - push before any
 * browser has subscribed, e-mail before an address is confirmed - and that is
 * carried rather than hidden: saying "push" of a rule nothing would arrive from
 * is the one thing an alarm screen must not do.
 */
export const routedChannels = (me: Me | undefined, severity: Severity): RoutedChannel[] => {
  const category = alertCategory(severity);
  const named = me && category ? (me.notifications.routing[category] ?? []) : [];

  return CHANNELS.filter(channel => named.includes(channel)).map(channel => ({ channel, configured: me !== undefined && isConfigured(me, channel) }));
};

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "push + e-mail", with a channel the account has not set up marked as the dead end it is. */
export const channelsLabel = (t: Translate, channels: RoutedChannel[]): string =>
  channels
    .map(routed => {
      const name = t(`alarms.channel.${routed.channel}`);
      return routed.configured ? name : t('alarms.channelOff', { channel: name });
    })
    .join(' + ');

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
  tellBy: 'routing' | 'email' | 'webhook';
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
 * How often a critical rule says itself again while it lasts. The same half
 * hour the server writes into the rule the cloud keeps and into every critical
 * rule a stage applies: something that wakes somebody is worth hearing twice,
 * and anything quieter is said once and read when there is time.
 */
const CRITICAL_REPEAT_MINUTES = 30;

/**
 * The repeat a severity comes with. Changing the severity brings its repeat
 * with it, because the two are one decision - how bad is this, and how often
 * should it be said - and a critical rule that announces itself once and then
 * goes quiet is the one thing nobody asked for. A severity chosen again is not
 * a change, so a repeat typed by hand survives it.
 */
export const withSeverity = (draft: RuleDraft, severity: Severity): RuleDraft =>
  severity === draft.severity ? draft : { ...draft, severity, repeatMinutes: severity === 'critical' ? CRITICAL_REPEAT_MINUTES : 0 };

/** A rule as most of them start: ten minutes over the line, announced the way the account is, and repeated while it lasts. */
export const emptyDraft = (metric: Metric): RuleDraft => ({
  name: '',
  watch: { kind: 'reading', metric },
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
  repeatMinutes: CRITICAL_REPEAT_MINUTES,
});

const bound = (value: number | null): string => (value === null ? '' : String(value));

/** The rule as the sheet takes it back up. What a manager was not answered - a delivery of somebody else's - reads as routing. */
export const draftOf = (rule: AlarmRule): RuleDraft => {
  const custom = rule.delivery.mode === 'custom' ? rule.delivery.custom : null;
  const webhook = custom?.webhook ?? null;
  const band = rule.watch.kind === 'output_running' ? null : rule.watch;

  return {
    ...emptyDraft('temperature'),
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

export const watchOf = (draft: RuleDraft): AlarmWatch => {
  if (draft.watch.kind === 'reading')
    return { kind: 'reading', metric: draft.watch.metric, upper: numberOrNull(draft.upper), lower: numberOrNull(draft.lower) };
  if (draft.watch.kind === 'output_level')
    return { kind: 'output_level', output: draft.watch.output, upper: numberOrNull(draft.upper), lower: numberOrNull(draft.lower) };

  return { kind: 'output_running', output: draft.watch.output };
};

export const deliveryOf = (draft: RuleDraft): AlarmDelivery => {
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
 * on the repeat it was given. Only a critical rule carries a repeat at all, so
 * one saved at any other severity goes out with none whatever it used to hold.
 */
export const createBody = (draft: RuleDraft): AlarmRuleCreate => ({
  name: draft.name.trim(),
  watch: watchOf(draft),
  forSeconds: seconds(draft.forMinutes),
  severity: draft.severity,
  enabled: true,
  cooldownSeconds: 0,
  repeatSeconds: draft.severity === 'critical' ? seconds(draft.repeatMinutes) : 0,
  delivery: deliveryOf(draft),
});

/** The same for a rule that exists: everything the sheet asks, and nothing it does not - whether it is on, and its cooldown, stay as they are. */
export const updateBody = (draft: RuleDraft): Omit<AlarmRuleCreate, 'enabled' | 'cooldownSeconds'> => {
  const { enabled: _enabled, cooldownSeconds: _cooldown, ...rest } = createBody(draft);
  return rest;
};
