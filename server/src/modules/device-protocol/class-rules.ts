import type { DeviceConfiguration } from '@fg2/shared-types/v1';
import { MIN_COMPRESSOR_REST_SECONDS } from '@fg2/shared-types/v1-schemas/configuration-fields.js';

/**
 * What the server holds a type's document to, whoever wrote it: the cloud, a
 * plan step, or the device itself from its own menu.
 *
 * These are figures nobody sets any more. A fridge's dehumidifying is tuned
 * from the humidity it is asked to hold rather than by hand, its targets glide
 * from night to day with the light, it stops dosing CO2 while the light goes
 * down, and its compressor rests at least four minutes between two runs. Older
 * apps showed every one of them as a field, and documents carry whatever was
 * typed there; the firmware reads them on every load, so they are put right on
 * every write rather than once.
 *
 * A controller reads the same dehumidifier keys, and drives a room dehumidifier
 * on a socket with them rather than a compressor: it keeps whatever it has.
 */

/** Below this day humidity a fridge dehumidifies from the target itself, in short runs, judged on the long average. */
const DRY_FROM = 55;

const DRY_TUNING = { maxDehumidifySeconds: 900, targetHumidityDiff: 0, useLongHumidityAvg: 1 };
const HUMID_TUNING = { maxDehumidifySeconds: 2700, targetHumidityDiff: 5, useLongHumidityAvg: 0 };

/**
 * The figures the server writes itself, by their dotted names. They are left
 * out of the diary line that says what somebody changed, because nobody did.
 */
export const HIDDEN_FIGURES: ReadonlySet<string> = new Set([
  'daynight.maxDehumidifySeconds',
  'daynight.targetHumidityDiff',
  'daynight.useLongHumidityAvg',
  'daynight.linearChange',
  'co2.sunsetOff',
]);

const isSection = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const sectionOf = (configuration: DeviceConfiguration, key: string): Record<string, unknown> | null => {
  const value = configuration[key];
  return isSection(value) ? value : null;
};

/**
 * The fridge's document as the server keeps it. Only what the document already
 * has is held: a section it does not carry is not invented, because the
 * firmware reads a key it is sent over its own default and a document that
 * never stated a day humidity has nothing to tune from.
 */
const fridge = (configuration: DeviceConfiguration): DeviceConfiguration => {
  const daynight = sectionOf(configuration, 'daynight');
  const co2 = sectionOf(configuration, 'co2');
  const humidity = sectionOf(configuration, 'day')?.humidity;
  if (!daynight && !co2) return configuration;

  const next: DeviceConfiguration = { ...configuration };
  if (daynight) {
    const rest = daynight.minimalDehumidifierOffTime;
    next.daynight = {
      ...daynight,
      ...(typeof humidity === 'number' ? (humidity < DRY_FROM ? DRY_TUNING : HUMID_TUNING) : {}),
      linearChange: 1,
      ...(typeof rest === 'number' && rest < MIN_COMPRESSOR_REST_SECONDS ? { minimalDehumidifierOffTime: MIN_COMPRESSOR_REST_SECONDS } : {}),
    };
  }
  if (co2) next.co2 = { ...co2, sunsetOff: 1 };

  return next;
};

const RULES: Readonly<Record<string, (configuration: DeviceConfiguration) => DeviceConfiguration>> = { fridge };

/** The document as the server keeps it for this type; unchanged for a type it holds to nothing. */
export const heldTo = (type: string, configuration: DeviceConfiguration): DeviceConfiguration => RULES[type]?.(configuration) ?? configuration;

/** The figures of the fridge rules above that the server writes itself, by section; a clamped one is not among them. */
const SERVER_FIGURES: Readonly<Record<string, readonly string[]>> = {
  daynight: ['maxDehumidifySeconds', 'targetHumidityDiff', 'useLongHumidityAvg', 'linearChange'],
  co2: ['sunsetOff'],
};

/**
 * A plan step's settings without what the server now decides. A recipe written
 * by the old app carried its author's whole document, the work mode and the
 * dehumidifier tuning included, and a running plan re-sends its step every
 * hour - so a step that still says `small` would put the energy-saving switch
 * back each time. `fridge` is whether the step is written for a fridge, which a
 * template cannot say: one is started on either kind of hardware, and a
 * controller keeps its own tuning, so a template is cleared of it as well.
 */
export const stepSettingsHeld = (settings: DeviceConfiguration, fridge: boolean): DeviceConfiguration => {
  const next: DeviceConfiguration = { ...settings };
  if (next.workmode === 'small' || next.workmode === 'full') delete next.workmode;
  if (!fridge) return next;

  for (const [key, figures] of Object.entries(SERVER_FIGURES)) {
    const section = sectionOf(next, key);
    if (!section) continue;
    const kept = Object.fromEntries(Object.entries(section).filter(([figure]) => !figures.includes(figure)));
    if (key === 'daynight' && typeof kept.minimalDehumidifierOffTime === 'number' && kept.minimalDehumidifierOffTime < MIN_COMPRESSOR_REST_SECONDS) {
      kept.minimalDehumidifierOffTime = MIN_COMPRESSOR_REST_SECONDS;
    }
    if (Object.keys(kept).length > 0) next[key] = kept;
    else delete next[key];
  }

  return next;
};
