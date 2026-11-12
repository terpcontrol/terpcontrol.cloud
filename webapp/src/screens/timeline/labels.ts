import type { DateTime } from 'luxon';
import type { Translate } from '@/i18n/i18n';
import { durationLabel } from '@/ui/age';
import { DAY_MS, HOUR_MS } from '@/ui/days';
import { CLOCK, DATED_CLOCK, DATED_CLOCK_WITH_YEAR, DAY, DAY_IN_YEAR, zonedAt } from '@/ui/zone';
import type { Span } from './view';

/**
 * How Verlauf says when: the window between the arrows, the instant of the
 * cursor, a line's stamp and the two ends of the axis - each as short as the
 * width of the window lets it be and still say which moment it is.
 */

/** Up to this width a window is read by the clock; past it by its days. */
const BY_CLOCK = 36 * HOUR_MS;
const BY_WEEKDAY = 10 * DAY_MS;

/** The day an instant falls on: today, yesterday, the weekday within a week, else the date. `then` is the word inside a sentence. */
const dayWord = (t: Translate, time: number, now: DateTime, zone: string | null, then = false): string => {
  const day = zonedAt(time, zone);
  const today = zonedAt(now.toMillis(), zone).startOf('day');
  const back = Math.round(today.diff(day.startOf('day'), 'days').days);
  if (back === 0) return t(then ? 'timeline.day.todayThen' : 'timeline.day.today');
  if (back === 1) return t(then ? 'timeline.day.yesterdayThen' : 'timeline.day.yesterday');
  if (back > 1 && back < 7) return day.toFormat('cccc');
  return day.toFormat(day.year === today.year ? DAY_IN_YEAR : DAY);
};

/** "Gestern 14:30 bis jetzt", "Heute 03:00 bis 03:20", "5. Nov bis 12. Nov": the window, as the row between the arrows names it. */
export const windowLabel = (t: Translate, window: Span, live: boolean, now: DateTime, zone: string | null): string => {
  const clocked = window.to - window.from <= BY_CLOCK;
  const clock = (time: number) => zonedAt(time, zone).toFormat(CLOCK);
  const from = clocked ? `${dayWord(t, window.from, now, zone)} ${clock(window.from)}` : dayWord(t, window.from, now, zone);
  // The last instant inside the window names its day: a window that closes at midnight has not begun the next date.
  const sameDay = zonedAt(window.from, zone).hasSame(zonedAt(window.to - 1, zone), 'day');
  const to = live
    ? t('timeline.now')
    : clocked
      ? `${sameDay ? '' : `${dayWord(t, window.to - 1, now, zone, true)} `}${clock(window.to)}`
      : dayWord(t, window.to - 1, now, zone, true);

  return t('timeline.windowSpan', { from, to });
};

/** The instant of the cursor, to the second where the points are that fine. */
export const cursorStamp = (time: number, window: Span, stepSeconds: number, zone: string | null): string => {
  const span = window.to - window.from;
  const clock = stepSeconds > 0 && stepSeconds < 60 ? `${CLOCK}:ss` : CLOCK;
  const format = span <= DAY_MS + HOUR_MS ? clock : span <= BY_WEEKDAY ? `ccc ${clock}` : span <= 400 * DAY_MS ? DATED_CLOCK : DATED_CLOCK_WITH_YEAR;
  return zonedAt(time, zone).toFormat(format);
};

/** Both ends of the window as the axis writes them; one that ends now says so. */
export const axisEnds = (t: Translate, window: Span, live: boolean, zone: string | null): [string, string] => {
  const span = window.to - window.from;
  const format = span <= BY_CLOCK ? CLOCK : span <= BY_WEEKDAY ? 'ccc' : DAY_IN_YEAR;
  return [zonedAt(window.from, zone).toFormat(format), live ? t('timeline.now') : zonedAt(window.to, zone).toFormat(format)];
};

/** "ein Punkt alle 5 s": how far apart the points drawn are. */
export const stepWords = (t: Translate, stepSeconds: number): string => t('timeline.pointEvery', { step: durationLabel(stepSeconds) });
