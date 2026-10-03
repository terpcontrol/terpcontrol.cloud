import type { DeviceConfiguration, ProblemError } from '@fg2/shared-types/v1';
import { MOST_TIMER_WINDOWS } from '@fg2/shared-types/v1-schemas/configuration-fields.js';

/**
 * What each type's firmware reads out of its configuration document, place by
 * place, and what the server therefore holds a document to before it goes to a
 * device.
 *
 * The document is the firmware's, and the contract leaves it untyped
 * (`DeviceConfiguration`): a key this table does not name is kept as it came,
 * because a newer build may read it. But the keys a build does read are read
 * blind. `loadSettings` in every `src_hwtype/<type>/<type>.cpp` takes each one
 * with ArduinoJson's `as<float>()` or `as<uint32_t>()`, which turns anything it
 * cannot read as a number - an object, an array, a word - into 0 without a
 * word. A night temperature sent as `{"$numberInt": "24"}` (Extended JSON, as a
 * database tool writes it) reached the device as 0 °C, and the heater stopped.
 * So every figure a firmware reads as a number has to be one, every switch on
 * or off, every word a word, and every section a section.
 *
 * The ranges are the firmware's own: the range its menu offers where it has one
 * (`FloatInput` in the same files: 0-40 °C, 0-100 %, 0-60 minutes of ramp),
 * and what its type holds where it has none - an unsigned figure is never below
 * zero, and a time of day is unsigned seconds, which 24 hours of light write two
 * days on (`lightWindowTimes`). Where documents in the field carry more than a
 * menu offers, the range takes them in rather than lock their owners out of
 * every later save: a controller without a CO2 sensor writes a target of 0
 * itself, the old app offered CO2 up to 10,000 ppm and a dehumidifier band of
 * -10 to +10, and the server rests a humidifier with a band of 100. Every range
 * here takes in what `CONFIGURATION_FIELDS` lets a person set by name, which a
 * test holds it to.
 */

interface NumberFigure {
  kind: 'number';
  min: number;
  max: number;
}

/** On or off: the firmware reads a bool, or a float that counts above zero. */
interface FlagFigure {
  kind: 'flag';
}

/** A word: a work mode, a dosing mode, or a string the firmware keeps without reading it. */
interface WordFigure {
  kind: 'word';
}

/** A smart socket's timer: a list of windows, each a time of day and a length in minutes. */
interface WindowsFigure {
  kind: 'windows';
  most: number;
  ontime: NumberFigure;
  duration: NumberFigure;
}

export type DocumentFigure = NumberFigure | FlagFigure | WordFigure | WindowsFigure;

export type DocumentFigures = Readonly<Record<string, DocumentFigure>>;

const UINT32_MAX = 4_294_967_295;
const DAY_SECONDS = 24 * 60 * 60;

const number = (min: number, max: number): NumberFigure => ({ kind: 'number', min, max });
const FLAG: FlagFigure = { kind: 'flag' };
const WORD: WordFigure = { kind: 'word' };

/** A time of day as every firmware keeps one: unsigned seconds, which a day of light writes two days on. */
const TIME = number(0, UINT32_MAX);
const TEMPERATURE = number(0, 40);
const HUMIDITY = number(0, 100);
const PERCENT = number(0, 100);
const RAMP = number(0, 60);
/** Seconds the firmware counts in a day's terms: a dehumidifier run, the compressor's rest. */
const SECONDS = number(0, DAY_SECONDS);

/** What a fridge and a tent controller read under the same keys. */
const CLIMATE: DocumentFigures = {
  workmode: WORD,
  'daynight.day': TIME,
  'daynight.night': TIME,
  'daynight.maxDehumidifySeconds': SECONDS,
  // Points of humidity: the old app offered -10 to +10, the server rests a humidifier at 100.
  'daynight.targetHumidityDiff': number(-100, 100),
  'daynight.useLongHumidityAvg': FLAG,
  'daynight.minimalDehumidifierOffTime': SECONDS,
  // A controller without a sensor writes 0 itself; the old app offered up to 10,000.
  'co2.target': number(0, 10_000),
  'day.temperature': TEMPERATURE,
  'day.humidity': HUMIDITY,
  'night.temperature': TEMPERATURE,
  'night.humidity': HUMIDITY,
  'lights.sunrise': RAMP,
  'lights.sunset': RAMP,
  'lights.limit': PERCENT,
};

const FRIDGE: DocumentFigures = {
  ...CLIMATE,
  mqttcontrol: FLAG,
  'daynight.linearChange': FLAG,
  'co2.sunsetOff': FLAG,
  'lights.maintenanceOn': FLAG,
  'fans.external': PERCENT,
  'fans.internal': PERCENT,
};

const CONTROLLER: DocumentFigures = CLIMATE;

const SWITCH_TEMPERATURE = TEMPERATURE;

const PLUG: DocumentFigures = {
  mqttcontrol: FLAG,
  workmode: WORD,
  usedaynight: FLAG,
  'daynight.day': TIME,
  'daynight.night': TIME,
  'timer.timeframes': { kind: 'windows', most: MOST_TIMER_WINDOWS, ontime: number(0, DAY_SECONDS), duration: number(0, 24 * 60) },
  ...Object.fromEntries(
    (['heater', 'cooler', 'humidify', 'dehumidify'] as const).flatMap(mode =>
      ['day.on', 'day.off', 'night.on', 'night.off'].map(point => [
        `${mode}.${point}`,
        mode === 'heater' || mode === 'cooler' ? SWITCH_TEMPERATURE : HUMIDITY,
      ]),
    ),
  ),
  'co2.mode': WORD,
  // Minutes; the firmware divides by the period, so a period of nothing is none it can run.
  'co2.period': number(1, 120),
  'co2.duration': number(0, 60),
  'co2.on': number(0, 10_000),
  'co2.off': number(0, 10_000),
  'limits.overtemperature.enabled': FLAG,
  'limits.overtemperature.limit': number(0, 50),
  'limits.overtemperature.hysteresis': number(0, 10),
  'limits.undertemperature.enabled': FLAG,
  'limits.undertemperature.limit': TEMPERATURE,
  'limits.undertemperature.hysteresis': number(0, 10),
  'limits.time.enabled': FLAG,
  'limits.time.min_on': number(0, 1800),
  'limits.time.min_off': number(0, 1800),
  // The AIR fan the socket slows while it doses, as a JSON string the firmware keeps and never reads.
  fan: WORD,
};

const FAN: DocumentFigures = {
  mqttcontrol: FLAG,
  // Fixed, temperature, humidity or both: the firmware's 0 to 3.
  mode: number(0, 3),
  min_speed: PERCENT,
  'day.temperature': TEMPERATURE,
  'day.humidity': HUMIDITY,
  'day.fixed_speed': PERCENT,
  'day.max_speed': PERCENT,
  'night.temperature': TEMPERATURE,
  'night.humidity': HUMIDITY,
  'night.fixed_speed': PERCENT,
  'night.max_speed': PERCENT,
  // Written by the server from the socket's own document (`co2InjectFor`).
  'co2inject.device_id': WORD,
  'co2inject.speed': PERCENT,
  'co2inject.usedaynight': FLAG,
  'co2inject.day': TIME,
  'co2inject.night': TIME,
  'co2inject.period': number(0, UINT32_MAX),
  'co2inject.duration': number(0, UINT32_MAX),
};

const LIGHT: DocumentFigures = {
  mqttcontrol: FLAG,
  day: TIME,
  night: TIME,
  max_temperature: TEMPERATURE,
  limit: PERCENT,
  sunrise: RAMP,
  sunset: RAMP,
};

export const DOCUMENT_FIGURES: Readonly<Record<string, DocumentFigures>> = {
  fridge: FRIDGE,
  controller: CONTROLLER,
  plug: PLUG,
  fan: FAN,
  light: LIGHT,
};

/**
 * What a plan template is held to. A template is started on whatever holds a
 * climate - a fridge, a controller, an AIR fan - so a figure is held to what
 * any of them reads at its place, and is checked again against the device's own
 * when the plan is written for it.
 */
export const TEMPLATE_FIGURES: DocumentFigures = { ...FAN, ...CONTROLLER, ...FRIDGE };

/** The figures a type's firmware reads; none for a type this table does not know, whose document is kept as it comes. */
export const documentFiguresOf = (type: string): DocumentFigures => DOCUMENT_FIGURES[type] ?? {};

/* ----------------------------------------------------------------- reading */

const isSection = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The value at a dotted place, or undefined where the document does not reach it. */
const valueAt = (document: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => (isSection(node) ? node[key] : undefined), document);

/** The sections a table reads into, by their dotted places: `limits` and `limits.overtemperature` for a socket's. */
const sectionsOf = (figures: DocumentFigures): string[] => [
  ...new Set(
    Object.keys(figures).flatMap(path =>
      path
        .split('.')
        .slice(0, -1)
        .map((_, index, parts) => parts.slice(0, index + 1).join('.')),
    ),
  ),
];

type Fault = { code: 'invalid_type' | 'too_small' | 'too_big'; detail: string };

const windowFault = (window: unknown, figure: WindowsFigure): boolean =>
  !isSection(window) ||
  !isNumber(window.ontime) ||
  !isNumber(window.duration) ||
  window.ontime < figure.ontime.min ||
  window.ontime > figure.ontime.max ||
  window.duration < figure.duration.min ||
  window.duration > figure.duration.max;

/** Why a value does not fit where it stands, or null; `ranged` is whether its range is asked as well as its kind. */
const faultOf = (value: unknown, figure: DocumentFigure, type: string, ranged: boolean): Fault | null => {
  switch (figure.kind) {
    case 'number':
      if (!isNumber(value)) return { code: 'invalid_type', detail: `The ${type} reads this as a number.` };
      if (!ranged) return null;
      if (value < figure.min) return { code: 'too_small', detail: `The ${type} reads this as a number from ${figure.min} to ${figure.max}.` };
      if (value > figure.max) return { code: 'too_big', detail: `The ${type} reads this as a number from ${figure.min} to ${figure.max}.` };
      return null;
    case 'flag':
      return typeof value === 'boolean' || isNumber(value)
        ? null
        : { code: 'invalid_type', detail: `The ${type} reads this as on or off: true or false.` };
    case 'word':
      return typeof value === 'string' ? null : { code: 'invalid_type', detail: `The ${type} reads this as a word.` };
    case 'windows':
      if (!Array.isArray(value) || (ranged && value.length > figure.most)) {
        return { code: 'invalid_type', detail: `The ${type} reads this as a list of at most ${figure.most} windows.` };
      }
      return value.some(window =>
        ranged ? windowFault(window, figure) : !isSection(window) || !isNumber(window.ontime) || !isNumber(window.duration),
      )
        ? {
            code: 'invalid_type',
            detail: `The ${type} reads each window as a time of day from ${figure.ontime.min} to ${figure.ontime.max} seconds and a length from ${figure.duration.min} to ${figure.duration.max} minutes.`,
          }
        : null;
  }
};

/* ----------------------------------------------------------------- refusing */

/**
 * Every figure of a document a client sent that the device's firmware would
 * misread, or that lies outside the firmware's range, as the problem's errors:
 * `configuration.night.temperature`, under `field`. All of them at once, so a
 * client learns everything it has to correct in one answer.
 *
 * `stored` is what the device runs now. A figure sent as it is stored is not
 * the client's to answer for: the device's own menu or an older app put it
 * there, and a page that sends the document whole would otherwise be refused
 * for a figure its owner never touched and cannot reach. It is not held to its
 * range, and one the firmware would misread is put right on the way to the
 * device instead (`withFiguresHeld`).
 */
export const figureRefusals = (
  type: string,
  document: unknown,
  {
    field = 'configuration',
    stored = null,
    figures = documentFiguresOf(type),
  }: {
    field?: string;
    stored?: unknown;
    /** What the document is held to where it is not one type's: a plan template's (`TEMPLATE_FIGURES`). */
    figures?: DocumentFigures;
  } = {},
): ProblemError[] => {
  const errors: ProblemError[] = [];
  const name = (path: string) => (field ? `${field}.${path}` : path);

  if (!isSection(document)) return [{ field, code: 'invalid_type', detail: 'The settings of a device are an object.' }];

  const unchanged = (path: string, value: unknown): boolean => stored !== null && JSON.stringify(valueAt(stored, path)) === JSON.stringify(value);

  // A place under a section that is not one reads as nothing, so only the section itself is named.
  for (const section of sectionsOf(figures)) {
    const value = valueAt(document, section);
    if (value !== undefined && !isSection(value) && !unchanged(section, value)) {
      errors.push({ field: name(section), code: 'invalid_type', detail: `The ${type} reads this as a section of its settings: an object.` });
    }
  }

  for (const [path, figure] of Object.entries(figures)) {
    const value = valueAt(document, path);
    if (value === undefined || unchanged(path, value)) continue;
    const fault = faultOf(value, figure, type, true);
    if (fault) errors.push({ field: name(path), ...fault });
  }

  return errors;
};

/* ------------------------------------------------------------------ holding */

/** The same document with one place set to a value, or taken out; every section on the way kept as it was. */
const withValueAt = (document: Record<string, unknown>, [key, ...rest]: string[], value: unknown): Record<string, unknown> => {
  if (rest.length === 0) {
    const { [key]: _gone, ...others } = document;
    return value === undefined ? others : { ...others, [key]: value };
  }
  const inner = isSection(document[key]) ? document[key] : {};
  return { ...document, [key]: withValueAt(inner, rest, value) };
};

/**
 * A value as the firmware would read it, where it can be had without guessing:
 * a figure written as the digits of one - an older client's - is that figure.
 */
const readable = (value: unknown, figure: DocumentFigure): unknown => {
  if ((figure.kind === 'number' || figure.kind === 'flag') && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return value;
};

/**
 * A document on its way to a device, with every figure its firmware would
 * misread put right: a number written as digits becomes the number, and
 * anything else that is not what the firmware reads there - an object, a list,
 * a word where a figure belongs - is replaced by what `fallback` holds at the
 * same place where that fits, and otherwise taken out, so the firmware keeps
 * its own default rather than reading a zero. `dropped` names what was not kept
 * as it came. A section that is none is left as it is: the firmware reads
 * nothing out of it, which is what it reads where it is missing too.
 *
 * This is the last word before the wire for every way a document reaches a
 * device: a client's write is refused before it gets here (`figureRefusals`),
 * but a plan step stored before steps were checked, a document a device sent,
 * or one stored before any of this is put right here. Ranges are not asked:
 * what the device runs is the device's.
 */
export const withFiguresHeld = (
  type: string,
  document: DeviceConfiguration,
  fallback: DeviceConfiguration | null,
): { configuration: DeviceConfiguration; dropped: string[] } => {
  const figures = documentFiguresOf(type);
  let next: Record<string, unknown> = document;
  const dropped: string[] = [];

  for (const [path, figure] of Object.entries(figures)) {
    const value = valueAt(next, path);
    if (value === undefined) continue;
    const read = readable(value, figure);
    if (faultOf(read, figure, type, false) === null) {
      if (read !== value) next = withValueAt(next, path.split('.'), read);
      continue;
    }
    const kept = readable(valueAt(fallback, path), figure);
    next = withValueAt(next, path.split('.'), kept !== undefined && faultOf(kept, figure, type, false) === null ? kept : undefined);
    dropped.push(path);
  }

  return { configuration: dropped.length === 0 && next === document ? document : next, dropped };
};
