import type { DeviceConfiguration } from '@fg2/shared-types/v1';
import { MIN_COMPRESSOR_REST_SECONDS } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { DAY_SECONDS, lightWindowOf, lightWindowTimes } from '@fg2/shared-types/v1-schemas/day-night.js';

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
 *
 * Both keep their light schedule the way `day-night.ts` writes it: a light that
 * goes off at midnight UTC goes off a second before it, and 24 hours of light
 * are a day that never ends rather than one two seconds short of it - whoever
 * wrote the times, an older app or the device's own menu.
 */

/** Below this day humidity a fridge dehumidifies from the target itself, in short runs, judged on the long average. */
const DRY_FROM = 55;

/**
 * A humidifier socket switches on where the air is drier than its target by
 * `daynight.targetHumidityDiff` and off at the target. With this band it never
 * switches on - no reading lies a hundred points under a target - which is how
 * the server marks a humidifier rested while a device germinates: the firmware
 * has no switch for it, and in germination the band is read by the humidifier
 * alone, since nothing dehumidifies in the dark. Only `breed` keeps it; in every
 * other mode it would keep a controller's dehumidifier from ever switching on,
 * so there it is put back (`DeviceConfigurationService` puts back the band it
 * replaced).
 *
 * The band alone does not stop a humidifier that is already running, though.
 * The firmware switches with a hysteresis (`humidifierTarget` in `fridge.cpp`
 * and `controller.cpp`): once on, it stays on until the reading reaches the
 * target and reads no band at all. Resting is usually chosen exactly while it
 * runs - and germination often begins while it runs, the stage before having
 * held a wetter day - so the document the device is sent also aims the
 * humidifier at nothing (`onTheWire`).
 */
export const HUMIDIFIER_REST_BAND = 100;

/**
 * The night's humidity a resting humidifier is sent: no reading lies under it,
 * so a humidifier that is running stops at its next pass and one that is off
 * stays off. In germination the night's humidity is read by the humidifier
 * alone - the firmware holds no day there, and dries nothing - so nothing else
 * changes with it.
 */
export const HUMIDIFIER_REST_HUMIDITY = 0;

/** What the firmware switches by where its document states no band: what a band that was not kept goes back to. */
const FIRMWARE_HUMIDITY_BAND = 5;

/** Whether a document rests its humidifier: germinating, with the band nothing switches on at. */
export const restsHumidifier = (configuration: DeviceConfiguration | null): boolean =>
  configuration?.workmode === 'breed' && bandOf(configuration) === HUMIDIFIER_REST_BAND;

const bandOf = (configuration: DeviceConfiguration): unknown => {
  const daynight = configuration.daynight;
  return isSection(daynight) ? daynight.targetHumidityDiff : undefined;
};

const nightHumidityOf = (configuration: DeviceConfiguration): unknown => {
  const night = configuration.night;
  return isSection(night) ? night.humidity : undefined;
};

/**
 * The document as it goes to the device: the stored one, with a rested
 * humidifier aimed at nothing (`HUMIDIFIER_REST_HUMIDITY`). What the server
 * stores, serves and records keeps the night's humidity the grower set - the
 * one the humidifier holds again once it may - so the target that is nobody's
 * goes no further than the wire. `offTheWire` reads it back.
 *
 * The rest band stays beside it: outside germination the two together keep the
 * dehumidifier from switching on as well (a band of 100 over nothing), which
 * covers the moment between a device leaving germination by its own menu and
 * the server's answer to that.
 */
export const onTheWire = (configuration: DeviceConfiguration): DeviceConfiguration =>
  restsHumidifier(configuration) && typeof nightHumidityOf(configuration) === 'number'
    ? { ...configuration, night: { ...sectionOf(configuration, 'night'), humidity: HUMIDIFIER_REST_HUMIDITY } }
    : configuration;

/**
 * A document a device sent, with the night's humidity the server aimed a rested
 * humidifier at put back to the one it keeps (`onTheWire`), whatever mode the
 * device has moved to since: the device's own menu shows no night humidity in
 * germination, so a night humidity of nothing beside the rest band is the
 * server's, not the grower's. A document the server kept no night humidity in
 * is left as it came.
 */
export const offTheWire = (reported: DeviceConfiguration, stored: DeviceConfiguration | null): DeviceConfiguration => {
  const kept = stored ? nightHumidityOf(stored) : undefined;
  if (bandOf(reported) !== HUMIDIFIER_REST_BAND || nightHumidityOf(reported) !== HUMIDIFIER_REST_HUMIDITY || typeof kept !== 'number')
    return reported;
  return { ...reported, night: { ...sectionOf(reported, 'night'), humidity: kept } };
};

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
  const humidity = sectionOf(configuration, heldHalfOf(configuration))?.humidity;
  if (!daynight && !co2) return configuration;

  const next: DeviceConfiguration = { ...configuration };
  if (daynight) {
    const rest = daynight.minimalDehumidifierOffTime;
    next.daynight = {
      ...daynight,
      ...(typeof humidity === 'number' ? (humidity < DRY_FROM ? DRY_TUNING : HUMID_TUNING) : {}),
      // A humidifier rested for germination keeps its band; the tuning comes back with the mode after it.
      ...(restsHumidifier(configuration) ? { targetHumidityDiff: HUMIDIFIER_REST_BAND } : {}),
      linearChange: 1,
      ...(typeof rest === 'number' && rest < MIN_COMPRESSOR_REST_SECONDS ? { minimalDehumidifierOffTime: MIN_COMPRESSOR_REST_SECONDS } : {}),
    };
  }
  if (co2) next.co2 = { ...co2, sunsetOff: 1 };

  return next;
};

/**
 * The half whose humidity the dehumidifier is tuned from: the one the fridge
 * holds. That is the day's - except in drying, which holds the night's round
 * the clock, and with a light that never comes on, which is always night. A
 * drying room at 50 % was tuned for the 58 % its unused day still said.
 */
const heldHalfOf = (configuration: DeviceConfiguration): 'day' | 'night' => {
  const daynight = sectionOf(configuration, 'daynight');
  const dark = typeof daynight?.day === 'number' && daynight.day === daynight.night;
  return configuration.workmode === 'dry' || dark ? 'night' : 'day';
};

/**
 * The light schedule as `lightWindowTimes` writes it, where the times stated
 * would have the firmware do something other than they mean: off at midnight
 * UTC on the dot, or a day a second or two short of 24 hours. Every other pair
 * is kept to the second, so a document read and written back is the document
 * it was.
 */
export const withHeldWindow = (configuration: DeviceConfiguration): DeviceConfiguration => {
  const daynight = sectionOf(configuration, 'daynight');
  const { day, night } = daynight ?? {};
  if (!daynight || typeof day !== 'number' || typeof night !== 'number') return configuration;

  const window = lightWindowOf(day, night);
  const whole = window.lightHours === 24 && night < DAY_SECONDS;
  if (!whole && !(night === 0 && day !== 0)) return configuration;

  return { ...configuration, daynight: { ...daynight, ...lightWindowTimes(window) } };
};

const controller = (configuration: DeviceConfiguration): DeviceConfiguration => withHeldWindow(configuration);

/**
 * The band a humidifier was rested with, outside germination: it would keep a
 * controller's dehumidifier off for good - and a fridge's tuning, where the
 * humidity does not decide it. The server puts back the band it replaced on its
 * own writes; this is for the document that leaves germination without one -
 * the device's own menu - which goes back to the firmware's band.
 */
const withoutRestBand = (configuration: DeviceConfiguration): DeviceConfiguration => {
  if (configuration.workmode === 'breed' || bandOf(configuration) !== HUMIDIFIER_REST_BAND) return configuration;
  return { ...configuration, daynight: { ...sectionOf(configuration, 'daynight'), targetHumidityDiff: FIRMWARE_HUMIDITY_BAND } };
};

const RULES: Readonly<Record<string, (configuration: DeviceConfiguration) => DeviceConfiguration>> = {
  fridge: configuration => fridge(withoutRestBand(withHeldWindow(configuration))),
  controller: configuration => controller(withoutRestBand(configuration)),
};

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
