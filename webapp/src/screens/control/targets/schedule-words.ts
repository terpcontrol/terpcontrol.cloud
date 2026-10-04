import { decimalFigure } from '@/ui/figures';
import { lightsOffOf, wallClock, type LightSchedule } from './targets-draft';

/**
 * A light schedule in words, the same wherever one is named: the targets
 * page, the cockpit, a preset applied at setup or with a phase, a plan's step.
 *
 * Every place that sets light hours used to say only the hours - "Licht 18
 * Std" - while the hour the light comes on stayed the device's, so somebody
 * putting a new fridge on Veg was never told the lamp would now burn until two
 * in the morning. The window is said whole: when it comes on, when it goes
 * off, how long.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "12" or "12,5": a length of day the way a person says it, in the reader's own decimals. */
export const hoursWritten = (hours: number): string => {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : decimalFigure(rounded, 1);
};

export interface WindowWords {
  /** "08:00" on the account's wall clock. */
  on: string;
  off: string;
  /** "12" or "12,5". */
  hours: string;
  /** How long the night lasts, written the same way. */
  nightHours: string;
  /** No night at all: 24 hours of light. */
  always: boolean;
  /** No day at all: no hours of light. */
  never: boolean;
}

/** The window a schedule makes, on the account's wall clock (`offset` seconds ahead of UTC). */
export const windowWords = (schedule: LightSchedule, offset: number): WindowWords => ({
  on: wallClock(schedule.lightsOn, offset),
  off: wallClock(lightsOffOf(schedule), offset),
  hours: hoursWritten(schedule.lightHours),
  nightHours: hoursWritten(Math.max(0, 24 - schedule.lightHours)),
  always: schedule.lightHours >= 24,
  never: schedule.lightHours <= 0,
});

/**
 * "Licht an 08:00–20:00 · 12 Std", "Licht durchgehend an · 24 Std" or "Licht
 * durchgehend aus · 0 Std". A day-long light goes off a second before it comes
 * on, which is no time to name: "06:00–05:59" read as a lamp that went off.
 */
export const scheduleTitle = (t: Translate, schedule: LightSchedule, offset: number): string => {
  const words = windowWords(schedule, offset);
  if (words.always) return t('targets.plan.always');
  if (words.never) return t('targets.plan.never');
  return t('targets.plan.window', { on: words.on, off: words.off, hours: words.hours });
};

/** "08:00–20:00", or what stands for a window where there is none. */
export const windowSpan = (t: Translate, schedule: LightSchedule, offset: number): string => {
  const words = windowWords(schedule, offset);
  if (words.always) return t('targets.plan.alwaysShort');
  if (words.never) return t('targets.plan.neverShort');
  return `${words.on}–${words.off}`;
};
