import type { DeviceConfiguration } from '@fg2/shared-types/v1';
import { lightWindowOf } from '@fg2/shared-types/v1-schemas/day-night.js';

/**
 * The targets a mode does not hold, kept as they were when somebody saves the
 * targets in it.
 *
 * A fridge drying holds the night's temperature and humidity and nothing else;
 * germinating, the night's temperature alone; in the greenhouse mode no
 * humidity; with 24 hours of light no night, and with none no day. The figures
 * a mode leaves alone are not lost: they are what the device holds again the
 * moment the mode ends, or the light schedule changes back. A page that shows
 * only what is held still sends a whole document, and whatever it put in the
 * rest - the day as the night, say, so the document read as what was held -
 * used to land there: going back from germination found the day at the
 * germination temperature, and back from 24 hours found the night at the day's.
 *
 * So a save of the targets that leaves the device in such a mode keeps the
 * stored figures the mode does not use. A save that ends the mode - drying
 * stopped, a photoperiod set again - writes them as sent, and every other kind
 * of write (a preset, a phase, a plan step, a setting by name) writes what it
 * names: those bring a climate of their own. Germination keeps them from the
 * save that begins it, too: it puts aside only the night it writes over, so a
 * day sent with it would be the day the device wakes up to afterwards. The
 * night's humidity is germination's own where a humidifier holds it and the
 * save shows it - the one humidity a germinating device goes by - and is then
 * written as sent.
 */

/**
 * The figures each mode leaves alone, by their paths in the document. The light
 * schedule is not among them: it does nothing in the dark either, but a page
 * sends the hours it shows, and a schedule somebody moves for the time after
 * drying is theirs to move.
 */
const IDLE_IN_MODE: Readonly<Record<string, readonly string[]>> = {
  dry: ['day.temperature', 'day.humidity', 'co2.target', 'lights.limit'],
  breed: ['day.temperature', 'day.humidity', 'night.humidity', 'co2.target', 'lights.limit'],
  temp: ['day.humidity', 'night.humidity'],
};

const IDLE_ALWAYS_DAY = ['night.temperature', 'night.humidity'];
const IDLE_ALWAYS_NIGHT = ['day.temperature', 'day.humidity', 'co2.target', 'lights.limit'];

const isSection = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const valueAt = (document: DeviceConfiguration | null, path: string): unknown => {
  const [section, key] = path.split('.');
  const nested = document?.[section];
  return isSection(nested) ? nested[key] : undefined;
};

const numberAt = (document: DeviceConfiguration | null, path: string): number | null => {
  const value = valueAt(document, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** The light hours a document's schedule makes, or null where it states none. */
const hoursOf = (document: DeviceConfiguration | null): number | null => {
  const day = numberAt(document, 'daynight.day');
  const night = numberAt(document, 'daynight.night');
  return day === null || night === null ? null : lightWindowOf(day, night).lightHours;
};

/**
 * `asked` with the figures its mode leaves alone put back to what `before`
 * stored. `workmode` is the mode the write leaves the device in, as the server
 * decided it; `before`'s is the one it was in. `humidified` is whether a
 * humidifier holds the night's humidity in germination and the save sets it.
 */
export const withIdleFiguresKept = (
  before: DeviceConfiguration | null,
  asked: DeviceConfiguration,
  workmode: string | null,
  humidified = false,
): DeviceConfiguration => {
  const stays = (mode: string) => workmode === mode && (before?.workmode === mode || mode === 'breed');
  const hours = hoursOf(asked);
  const idle = new Set<string>([
    ...Object.entries(IDLE_IN_MODE).flatMap(([mode, paths]) => (stays(mode) ? paths : [])),
    ...(hours === 24 ? IDLE_ALWAYS_DAY : hours === 0 ? IDLE_ALWAYS_NIGHT : []),
  ]);
  if (humidified && workmode === 'breed') idle.delete('night.humidity');

  const next: DeviceConfiguration = { ...asked };
  for (const path of idle) {
    const kept = valueAt(before, path);
    if (kept === undefined) continue;

    const [section, key] = path.split('.');
    next[section] = { ...(isSection(next[section]) ? next[section] : {}), [key]: kept };
  }

  return next;
};
