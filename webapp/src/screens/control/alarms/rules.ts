import type {
  AlarmDelivery,
  AlarmOrigin,
  AlarmRule,
  AlarmRuleCreate,
  AlarmWatch,
  Device,
  Metric,
  NotificationChannel,
  NotificationRouting,
  OutputMetric,
  Severity,
  WebhookMethod,
} from '@fg2/shared-types/v1';
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

/**
 * Every output the contract names, for the chips of a new rule. Listed here as
 * a record rather than read off the contract's schema, because that module
 * carries zod and the development server would have to be told to bundle it;
 * the record's type is the enum, so an output added to the contract and not
 * here does not compile.
 */
const EVERY_OUTPUT: Record<OutputMetric, null> = {
  heater: null,
  dehumidifier: null,
  co2: null,
  light: null,
  fan: null,
  relais: null,
  fanInternal: null,
  fanExternal: null,
  fanBackwall: null,
};

export const OUTPUTS = Object.keys(EVERY_OUTPUT) as OutputMetric[];

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

/**
 * Which row of the routing grid a routed rule goes out on. An info rule is
 * written to the diary and never announced, so it has no row at all.
 */
export const categoryOf = (severity: Severity): 'alerts' | 'warnings' | null =>
  severity === 'critical' ? 'alerts' : severity === 'warning' ? 'warnings' : null;

export const routedChannels = (routing: NotificationRouting | undefined, severity: Severity): NotificationChannel[] => {
  const category = categoryOf(severity);
  const named = category ? (routing?.[category] ?? []) : [];

  return CHANNELS.filter(channel => named.includes(channel));
};

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

/** A rule as most of them start: ten minutes over the line, announced the way the account is. */
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
  repeatMinutes: 0,
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

/** A rule about a level with no level in it would never trip, and is refused here before the server has to. */
export const wantsBound = (draft: RuleDraft): boolean => draft.watch.kind !== 'output_running';

export const hasBound = (draft: RuleDraft): boolean => !wantsBound(draft) || numberOrNull(draft.upper) !== null || numberOrNull(draft.lower) !== null;

export const watchOf = (draft: RuleDraft): AlarmWatch => {
  if (draft.watch.kind === 'reading')
    return { kind: 'reading', metric: draft.watch.metric, upper: numberOrNull(draft.upper), lower: numberOrNull(draft.lower) };
  if (draft.watch.kind === 'output_level')
    return { kind: 'output_level', output: draft.watch.output, upper: numberOrNull(draft.upper), lower: numberOrNull(draft.lower) };

  return { kind: 'output_running', output: draft.watch.output };
};

/** "Name: value" lines back into a record. A line with no colon is not a header and is dropped rather than sent as one with no value. */
export const headersOf = (text: string): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return headers;
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
 * on the repeat it was given.
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
