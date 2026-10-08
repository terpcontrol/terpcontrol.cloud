import { DateTime } from 'luxon';
import type { DeviceConfiguration } from '@fg2/shared-types/v1';
import { finiteOrNull, isSection, nestedAt } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { lightWindowOf, lightWindowTimes, roundTheClock } from '@fg2/shared-types/v1-schemas/day-night.js';
import type { ScheduleClock } from '@database/schemas/v1/devices.schema';

/**
 * The clock a device's schedule is kept on.
 *
 * The firmware keeps every time of day as seconds past midnight UTC - when the
 * light comes on and goes off, when a fan may add CO2 - and has no notion of a
 * zone. A grower sets "light on at 08:00" on the clock on their wall, and that
 * clock jumps twice a year: left alone, a schedule set in summer comes on at
 * 07:00 all winter. So the cloud remembers which clock the seconds were meant
 * on - the owner's zone, and that zone's UTC offset when they were written -
 * and when the owner's offset moves, by summer time or by the owner naming
 * another zone, it moves the seconds by the same amount and sends the document
 * again. The wall clock keeps saying 08:00; the firmware never learns why.
 *
 * Only a zone somebody picked is a clock. An account starts on UTC and every
 * account carried over from the old cloud was put on UTC too, though its owner
 * set the light by a German wall clock; the app replaces that UTC with the
 * zone of the first browser it is opened in. Reading that first zone as a move
 * would shift every migrated lamp by two hours on its owner's first visit, so
 * a schedule is only anchored once the zone is a chosen one, and anchoring
 * moves nothing.
 */

/**
 * Every time of day a device keeps, by where it keeps it: the controller's,
 * the fridge's and the socket hub's day and night, the stand-alone lamp's own
 * pair at the top of its document, and the window a fan adds CO2 in - and,
 * beside these, the windows of a smart socket's timer (`TIMER_WINDOWS`). They
 * move together, because a CO2 window left on UTC while the light it belongs
 * to moved would spend an hour of gas in the dark.
 */
const CLOCK_TIMES = ['daynight.day', 'daynight.night', 'day', 'night', 'co2inject.day', 'co2inject.night'];

/** Where a smart socket keeps its timer: a list of windows, each switched on at `ontime`. */
const TIMER_WINDOWS = 'timer.timeframes';

/** The clock a schedule written now is kept on, or null where the owner has never picked a zone. */
export const scheduleClockOf = (preferences: { timezone?: string; timezoneChosen?: boolean } | null | undefined, at: Date): ScheduleClock | null => {
  if (preferences?.timezoneChosen !== true || !preferences.timezone) return null;

  const there = DateTime.fromJSDate(at, { zone: preferences.timezone });
  return there.isValid ? { zone: preferences.timezone, offset: there.offset } : null;
};

export const sameClock = (one: ScheduleClock | null, other: ScheduleClock | null): boolean =>
  one === other || (one !== null && other !== null && one.zone === other.zone && one.offset === other.offset);

/**
 * How far the stored seconds move so that the wall clock reads the same on the
 * new clock: an hour forward when Berlin leaves summer time, because 08:00 is
 * then 07:00 UTC rather than 06:00. Nothing moves without a clock on both sides.
 */
export const driftBetween = (kept: ScheduleClock | null, now: ScheduleClock | null): number => (kept && now ? (kept.offset - now.offset) * 60 : 0);

const timeAt = (configuration: DeviceConfiguration | null, path: string): number | null => finiteOrNull(nestedAt(configuration, path));

const windowsOf = (configuration: DeviceConfiguration | null): unknown[] | null => {
  const windows = nestedAt(configuration, TIMER_WINDOWS);
  return Array.isArray(windows) ? windows : null;
};

const startOf = (window: unknown): number | null => (isSection(window) ? finiteOrNull(window.ontime) : null);

/** The times of day a document states, by their dotted path. A section of the same name - a controller's `day` targets - is not one. */
export const clockTimesOf = (configuration: DeviceConfiguration | null): Record<string, number> =>
  Object.fromEntries([
    ...CLOCK_TIMES.flatMap(path => {
      const seconds = timeAt(configuration, path);
      return seconds === null ? [] : [[path, seconds]];
    }),
    ...(windowsOf(configuration) ?? []).flatMap((window, index) => {
      const seconds = startOf(window);
      return seconds === null ? [] : [[`${TIMER_WINDOWS}.${index}.ontime`, seconds]];
    }),
  ]);

export const keepsTime = (configuration: DeviceConfiguration | null): boolean => Object.keys(clockTimesOf(configuration)).length > 0;

export const sameClockTimes = (one: DeviceConfiguration | null, other: DeviceConfiguration | null): boolean =>
  JSON.stringify(clockTimesOf(one)) === JSON.stringify(clockTimesOf(other));

/**
 * The document with every time of day moved by so many seconds, round the
 * clock where it must - 23:30 an hour later is 00:30 - and every other key, in
 * those sections too, as it was. Works on a whole document and on the fragment
 * a plan step carries alike.
 *
 * A fridge's or a controller's light window moves as the window it is: the
 * hour it comes on moves, and the two times are written again from that hour
 * and its length (`lightWindowTimes`). Moved one by one, 24 hours of light -
 * kept past any time of day - would be wrapped into a window, and a light
 * moved onto midnight UTC would lose its evening ramp.
 */
export const withClockTimesMoved = (configuration: DeviceConfiguration, seconds: number): DeviceConfiguration => {
  const moved = (value: number) => roundTheClock(value + seconds);
  const next: DeviceConfiguration = { ...configuration };
  const on = timeAt(configuration, 'daynight.day');
  const off = timeAt(configuration, 'daynight.night');
  const window = on !== null && off !== null ? lightWindowOf(on, off) : null;
  if (window) {
    next.daynight = {
      ...(configuration.daynight as Record<string, unknown>),
      ...lightWindowTimes({ lightsOn: window.lightsOn + seconds, lightHours: window.lightHours }),
    };
  }

  for (const path of CLOCK_TIMES) {
    const value = timeAt(configuration, path);
    const [first, second] = path.split('.');
    if (value === null || (window && first === 'daynight')) continue;

    if (second === undefined) next[first] = moved(value);
    else next[first] = { ...(next[first] as Record<string, unknown>), [second]: moved(value) };
  }

  const windows = windowsOf(configuration);
  if (windows) {
    const [section, list] = TIMER_WINDOWS.split('.');
    next[section] = {
      ...(next[section] as Record<string, unknown>),
      [list]: windows.map(window => {
        const start = startOf(window);
        return start === null ? window : { ...(window as Record<string, unknown>), ontime: moved(start) };
      }),
    };
  }

  return next;
};

/** The documents whose times of day were written on the same clock as a device's, and have to move with it. Provided by the grow plan. */
export interface ScheduleFollower {
  onScheduleMoved(deviceId: string, seconds: number): Promise<void>;
}

export const SCHEDULE_FOLLOWER = 'device-protocol:schedule-follower';
