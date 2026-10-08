/**
 * The settings of a device's own configuration document that a person changes
 * one at a time, by type of device: what `PATCH /devices/{id}/configuration`
 * accepts and what the screens offering them draw their controls from.
 *
 * The document itself stays the firmware's (`DeviceConfiguration`), and the
 * targets keep their own page that writes it whole. Everything beyond the
 * targets - a work mode, a fan's strength, a ramp - is named here once, with
 * the range the server holds it to, so that the slider and the check cannot
 * disagree. A key the table does not name is not refused by the document: the
 * server merges a change into what the device runs and keeps every key it was
 * not asked about.
 *
 * `path` is the dotted place of the figure in the document. A switch is written
 * as 1 or 0, which is how the firmware reads every flag it has; a choice the
 * firmware keeps as a number is written as its code; a list of windows is
 * written whole. A field whose
 * `path` is null is decided by the server rather than written as given: the
 * work mode is one key the firmware reads, and which value it takes depends on
 * three things a person decides separately and on the phase the grow is in.
 *
 * One table per type, so that settings for different hardware are added in
 * different places. No schema, so a client imports it without pulling zod in.
 */

import type { z } from 'zod';
import type { timerWindow } from './devices.js';

export interface NumberField {
  kind: 'number';
  path: string;
  min: number;
  max: number;
  step: number;
}

export interface SwitchField {
  kind: 'switch';
  path: string | null;
}

export interface ChoiceField {
  kind: 'choice';
  path: string | null;
  options: readonly string[];
  /**
   * What each option is stored as, in the order of `options`, where the
   * firmware keeps a number for it: a fan's mode is 0 to 3 in its document and
   * a word everywhere else.
   */
  codes?: readonly number[];
}

/**
 * A list of daily windows, each switching on at a time of day for so many
 * minutes: a smart socket's timer. Set whole, because a window is only
 * meaningful beside the others, and kept as the firmware keeps it.
 */
export interface WindowsField {
  kind: 'windows';
  path: string;
  /** The most windows a document may carry; the firmware parses it in a buffer of a fixed size. */
  most: number;
  /** The longest a window may run, in minutes. */
  longest: number;
}

export type TimerWindow = z.infer<typeof timerWindow>;

export type ConfigurationField = NumberField | SwitchField | ChoiceField | WindowsField;

/** What a field is set to: a figure, on or off, one of its options, or a list of windows. */
export type FieldSetting = number | boolean | string | readonly TimerWindow[];

export type ConfigurationFields = Readonly<Record<string, ConfigurationField>>;

/**
 * What a fridge or a controller is set to do as a whole, in a person's words:
 * the standard climate control, temperature only (the firmware's `temp`), or
 * dark germination held at the night temperature (`breed`). This is what the
 * device keeps to come back to (`DeviceControl.mode`); drying lies over it.
 */
export const OPERATING_MODES = ['standard', 'greenhouse', 'germination'] as const;

export type OperatingMode = (typeof OPERATING_MODES)[number];

/**
 * The Betriebsart as a person picks and reads it: an operating mode, or drying
 * (the firmware's `dry`: no day and no night, no light and no CO2), which the
 * server keeps apart because the device goes back to its mode when it ends.
 * The one list every screen offers and names the modes from.
 */
export const WORK_MODES = [...OPERATING_MODES, 'drying'] as const;

export type WorkMode = (typeof WORK_MODES)[number];

/**
 * The work modes each type of device is offered, in the order they are shown.
 * A tent controller's firmware runs the greenhouse mode too, but there the
 * dehumidifier and exhaust sockets become the tent's cooling - wiring no tent
 * is set up for - so it keeps the standard, dark germination and drying, the
 * ones every grow passes through. A type not named here has no work mode.
 */
export const WORK_MODES_BY_TYPE: Readonly<Record<string, readonly WorkMode[]>> = {
  fridge: WORK_MODES,
  controller: ['standard', 'germination', 'drying'],
};

export const workModesOf = (type: string): readonly WorkMode[] => WORK_MODES_BY_TYPE[type] ?? [];

/** The work mode a device runs, read from what the server says it does: drying over the mode it goes back to. */
export const workModeOf = (control: { drying: boolean; mode: OperatingMode }): WorkMode => (control.drying ? 'drying' : control.mode);

/**
 * Whether the device regulates at all - off is the firmware's `workmode: off`,
 * which is also how a device leaves the factory - and whether it dries, the
 * firmware's `dry`: no day and no night, no light and no CO2. Both are said
 * here and decided by the server, which remembers what the device goes back to.
 * `mode` (below) offers drying among the work modes as well, so a person picks
 * it where the other modes are picked; `drying` stays to end a spell alone.
 */
const CONTROL: ConfigurationFields = { control: { kind: 'switch', path: null }, drying: { kind: 'switch', path: null } };

/**
 * What germination does about the humidity (`GerminationChoices`): whether the
 * "too humid" alarms go on warning and whether a humidifier socket goes on
 * holding the night's humidity while the device germinates. Kept by the server
 * beside the work mode rather than written as given, because the firmware has
 * no word for either: a humidifier that rests is a band the server writes.
 */
const GERMINATION: ConfigurationFields = {
  germinationWarnTooHumid: { kind: 'switch', path: null },
  germinationHumidifier: { kind: 'switch', path: null },
};

/** The least the compressor rests between two runs. Below this it is not protected, whatever an older app allowed. */
export const MIN_COMPRESSOR_REST_SECONDS = 240;

/**
 * How long the lamp takes to come up in the morning and go down in the
 * evening, in minutes: both firmwares that dim a lamp ramp it over this rather
 * than switching it hard.
 */
const RAMPS: ConfigurationFields = {
  sunrise: { kind: 'number', path: 'lights.sunrise', min: 0, max: 60, step: 1 },
  sunset: { kind: 'number', path: 'lights.sunset', min: 0, max: 60, step: 1 },
};

/**
 * Whether CO2 is dosed in the dark period too, not only while the light is on:
 * plants take up no CO2 at night, but roots in deep water culture do.
 */
const CO2_AT_NIGHT: ConfigurationFields = { co2Night: { kind: 'switch', path: 'co2.night' } };

const FRIDGE: ConfigurationFields = {
  ...CONTROL,
  ...GERMINATION,
  // The back-wall fan stands still while the compressor is off: the firmware's `full`.
  energySaving: { kind: 'switch', path: null },
  mode: { kind: 'choice', path: null, options: workModesOf('fridge') },
  compressorRest: { kind: 'number', path: 'daynight.minimalDehumidifierOffTime', min: MIN_COMPRESSOR_REST_SECONDS, max: 900, step: 30 },
  ...RAMPS,
  ...CO2_AT_NIGHT,
  // The lamp stays at its working brightness through a maintenance window at night too.
  maintenanceLight: { kind: 'switch', path: 'lights.maintenanceOn' },
  // Per cent. The clip fan may stand still; the inner fans keep a tenth, which is the least the firmware runs them at.
  clipFan: { kind: 'number', path: 'fans.external', min: 0, max: 100, step: 5 },
  innerFans: { kind: 'number', path: 'fans.internal', min: 10, max: 100, step: 5 },
};

const CONTROLLER: ConfigurationFields = { ...CONTROL, ...GERMINATION, mode: { kind: 'choice', path: null, options: workModesOf('controller') }, ...RAMPS, ...CO2_AT_NIGHT };

/** A time of day as the firmware keeps every one: seconds past midnight UTC. The app writes whole minutes. */
const TIME_OF_DAY = { kind: 'number', min: 0, max: 86399, step: 60 } as const;

/**
 * What a stand-alone smart socket switches by, in the firmware's words: the
 * sensor it carries (heating, cooling, humidifying, dehumidifying, dosing CO2),
 * its timer, or nothing at all.
 */
export const PLUG_MODES = ['off', 'heater', 'cooler', 'humidify', 'dehumidify', 'co2', 'timer'] as const;

export type PlugMode = (typeof PLUG_MODES)[number];

/** The modes that switch at two points of a reading, each by day and by night. */
export const PLUG_SWITCHING = ['heater', 'cooler', 'humidify', 'dehumidify'] as const;

export type PlugSwitching = (typeof PLUG_SWITCHING)[number];

/** The reading each switching mode follows, and the range its points are held to. */
export const SWITCH_POINT_RANGE: Readonly<Record<PlugSwitching, { min: number; max: number; step: number }>> = {
  heater: { min: 5, max: 40, step: 0.5 },
  cooler: { min: 5, max: 40, step: 0.5 },
  humidify: { min: 10, max: 90, step: 1 },
  dehumidify: { min: 10, max: 90, step: 1 },
};

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** The name of one switch point: `heaterDayOn` is the reading a heater switches on at by day. */
export const switchPointName = (mode: PlugSwitching, when: 'day' | 'night', edge: 'on' | 'off'): string => `${mode}${capital(when)}${capital(edge)}`;

const SWITCH_POINTS: ConfigurationFields = Object.fromEntries(
  PLUG_SWITCHING.flatMap(mode =>
    (['day', 'night'] as const).flatMap(when =>
      (['on', 'off'] as const).map(edge => [
        switchPointName(mode, when, edge),
        { kind: 'number', path: `${mode}.${when}.${edge}`, ...SWITCH_POINT_RANGE[mode] },
      ]),
    ),
  ),
);

/** Dosing CO2 the whole time below the switch-on point, or only in a window of every period. */
export const CO2_DOSINGS = ['const', 'periodic'] as const;

/** How many windows a smart socket's timer holds at most. */
export const MOST_TIMER_WINDOWS = 8;

const PLUG: ConfigurationFields = {
  plugMode: { kind: 'choice', path: 'workmode', options: PLUG_MODES },
  // Separate switch points by night, and the day they are told apart by.
  dayNight: { kind: 'switch', path: 'usedaynight' },
  dayFrom: { ...TIME_OF_DAY, path: 'daynight.day' },
  nightFrom: { ...TIME_OF_DAY, path: 'daynight.night' },
  ...SWITCH_POINTS,
  co2On: { kind: 'number', path: 'co2.on', min: 100, max: 10000, step: 10 },
  co2Off: { kind: 'number', path: 'co2.off', min: 100, max: 10000, step: 10 },
  co2Dosing: { kind: 'choice', path: 'co2.mode', options: CO2_DOSINGS },
  // Minutes; a period of nothing would have the firmware divide by zero.
  co2Every: { kind: 'number', path: 'co2.period', min: 1, max: 120, step: 1 },
  co2For: { kind: 'number', path: 'co2.duration', min: 1, max: 60, step: 1 },
  timerWindows: { kind: 'windows', path: 'timer.timeframes', most: MOST_TIMER_WINDOWS, longest: 24 * 60 },
  overheatOff: { kind: 'switch', path: 'limits.overtemperature.enabled' },
  overheatAt: { kind: 'number', path: 'limits.overtemperature.limit', min: 5, max: 50, step: 0.5 },
  overheatBack: { kind: 'number', path: 'limits.overtemperature.hysteresis', min: 0.5, max: 10, step: 0.5 },
  coldOff: { kind: 'switch', path: 'limits.undertemperature.enabled' },
  coldAt: { kind: 'number', path: 'limits.undertemperature.limit', min: 0, max: 40, step: 0.5 },
  coldBack: { kind: 'number', path: 'limits.undertemperature.hysteresis', min: 0.5, max: 10, step: 0.5 },
  leastTimes: { kind: 'switch', path: 'limits.time.enabled' },
  leastOnSeconds: { kind: 'number', path: 'limits.time.min_on', min: 0, max: 1800, step: 10 },
  leastOffSeconds: { kind: 'number', path: 'limits.time.min_off', min: 0, max: 1800, step: 10 },
};

/**
 * What an AIR fan's speed follows: nothing (a fixed speed by day and by
 * night), the temperature, the humidity, or whichever of the two is further
 * over its target. The firmware keeps them as 0 to 3.
 */
export const FAN_MODES = ['fixed', 'temperature', 'humidity', 'both'] as const;

export type FanMode = (typeof FAN_MODES)[number];

const SPEED = { kind: 'number', min: 0, max: 100, step: 1 } as const;

const FAN: ConfigurationFields = {
  fanMode: { kind: 'choice', path: 'mode', options: FAN_MODES, codes: [0, 1, 2, 3] },
  fixedDay: { ...SPEED, path: 'day.fixed_speed' },
  fixedNight: { ...SPEED, path: 'night.fixed_speed' },
  mostDay: { ...SPEED, path: 'day.max_speed' },
  mostNight: { ...SPEED, path: 'night.max_speed' },
  least: { ...SPEED, path: 'min_speed' },
};

/**
 * A stand-alone LIGHT keeps everything at the top of its document: when it
 * comes on and goes off, how bright it gets, how many minutes it fades in and
 * out, and the temperature it starts dimming at to protect itself.
 */
const LIGHT: ConfigurationFields = {
  lightsOn: { ...TIME_OF_DAY, path: 'day' },
  lightsOff: { ...TIME_OF_DAY, path: 'night' },
  brightness: { kind: 'number', path: 'limit', min: 0, max: 100, step: 1 },
  sunrise: { kind: 'number', path: 'sunrise', min: 0, max: 60, step: 1 },
  sunset: { kind: 'number', path: 'sunset', min: 0, max: 60, step: 1 },
  overheatAt: { kind: 'number', path: 'max_temperature', min: 5, max: 40, step: 1 },
};

export const CONFIGURATION_FIELDS: Readonly<Record<string, ConfigurationFields>> = {
  fridge: FRIDGE,
  controller: CONTROLLER,
  plug: PLUG,
  fan: FAN,
  light: LIGHT,
};

/** The fields a type of device offers; none for a type this table does not know. */
export const configurationFieldsOf = (type: string): ConfigurationFields => CONFIGURATION_FIELDS[type] ?? {};

/* ------------------------------------------------------- reading a document */

type Document = Readonly<Record<string, unknown>> | null | undefined;

/** Whether a value of a document is a section of it: an object of keys, not a list. */
export const isSection = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const sectionOf = (document: Document, key: string): Readonly<Record<string, unknown>> | null => {
  const value = document?.[key];
  return isSection(value) ? value : null;
};

export const finiteOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** A value of a document by its dotted path, nested as the firmware writes it, or undefined where the document does not reach it. */
export const nestedAt = (document: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => (isSection(node) ? node[key] : undefined), document);

/**
 * A value of a document by its dotted path, nested as the firmware writes it or
 * flat as an older client did. Both mean the same thing; the nested one is read
 * first, the server's and every screen's reading alike.
 */
export const valueAt = (document: Document, path: string): unknown => nestedAt(document, path) ?? document?.[path];

/** A figure of a document by its dotted path (`valueAt`), or null where it states none. */
export const figureAt = (document: Document, path: string): number | null => finiteOrNull(valueAt(document, path));

/* ------------------------------------------------- a socket's CO2 and a fan */

/**
 * The AIR fan a smart socket slows down while it doses CO2, and how far. The
 * socket keeps it under `fan` as a JSON string the firmware stores and never
 * reads, with `device_id` set to `none` where there is none; the fan is told
 * in a section of its own document, `co2inject`, which the server writes from
 * the socket's.
 */
export interface Co2Fan {
  fanId: string;
  /** Per cent: the most the fan runs at while the socket doses. */
  speed: number;
}

export const co2FanOf = (plug: Document): Co2Fan | null => {
  const raw = plug?.fan;
  if (typeof raw !== 'string' || raw === '') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    const fan = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    if (typeof fan.device_id !== 'string' || fan.device_id === '' || fan.device_id === 'none') return null;

    return { fanId: fan.device_id, speed: typeof fan.speed === 'number' ? fan.speed : 100 };
  } catch {
    return null;
  }
};

/** The socket's `fan` key for a coupling, or for none. */
export const co2FanKey = (coupling: Co2Fan | null): string =>
  JSON.stringify(coupling ? { device_id: coupling.fanId, speed: coupling.speed } : { device_id: 'none', speed: 100 });

/**
 * Whether the socket doses CO2 in windows of every period, which is the only
 * dosing a fan can be slowed for: the fan knows nothing of the socket and
 * simply runs slower in the same windows of the same period.
 */
export const dosesInWindows = (plug: Document): boolean => plug?.workmode === 'co2' && sectionOf(plug, 'co2')?.mode === 'periodic';

/**
 * The section a coupled fan is given: the socket's dosing windows, its day
 * and the speed to hold to - or an empty one, which is how a fan is told it is
 * slowed for nothing, while the socket does not dose in windows.
 */
export const co2InjectFor = (plugId: string, plug: Document, speed: number): Record<string, unknown> => {
  if (!dosesInWindows(plug)) return {};

  const co2 = sectionOf(plug, 'co2') ?? {};
  const daynight = sectionOf(plug, 'daynight') ?? {};
  return {
    device_id: plugId,
    speed,
    usedaynight: plug?.usedaynight === true || plug?.usedaynight === 1 ? 1 : 0,
    day: daynight.day,
    night: daynight.night,
    period: co2.period,
    duration: co2.duration,
  };
};

/** The smart socket a fan is slowed for, as the fan's own document names it. */
export const co2PlugOf = (fan: Document): string | null => {
  const id = sectionOf(fan, 'co2inject')?.device_id;
  return typeof id === 'string' && id !== '' ? id : null;
};

/**
 * The cloud's own settings of a device (`Device.settings`), which no firmware
 * reads: how much cooler than the air a leaf is taken to be where no leaf
 * sensor measures it, which is what VPD is worked out with, and the factor
 * that turns the light sensor's lux into PPFD. The ranges are what
 * `PATCH /devices/{id}` holds them to and what the screens offer; a figure
 * outside them is a typing slip rather than a lamp or a leaf.
 */
export const DEVICE_SETTING_RANGES = {
  vpdLeafOffsetDay: { min: -10, max: 5, step: 0.5 },
  vpdLeafOffsetNight: { min: -10, max: 5, step: 0.5 },
  ppfdLuxFactor: { min: 0.005, max: 0.05, step: 0.0001 },
} as const;
