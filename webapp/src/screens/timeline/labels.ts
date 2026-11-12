import type { DateTime } from 'luxon';
import type { Translate } from '@/i18n/i18n';
import { DAY_MS, HOUR_MS } from '@/ui/days';
import { looseFigure } from '@/ui/figures';
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

/**
 * "Gestern 14:30 bis jetzt", "Heute 03:00 bis 03:20", "5. Nov bis 12. Nov": the window, as the row between the
 * arrows names it. A whole day of the calendar is that day and not its two midnights: "Gestern", "Mo, 11. Aug",
 * and today up to now "Heute bis jetzt".
 */
export const windowLabel = (t: Translate, window: Span, live: boolean, now: DateTime, zone: string | null): string => {
  const start = zonedAt(window.from, zone);
  const midnight = start.equals(start.startOf('day'));
  if (midnight && !live && start.plus({ days: 1 }).toMillis() === window.to) {
    const back = Math.round(zonedAt(now.toMillis(), zone).startOf('day').diff(start, 'days').days);
    return back === 0 || back === 1 ? dayWord(t, window.from, now, zone) : start.toFormat(`ccc, ${start.year === now.year ? DAY_IN_YEAR : DAY}`);
  }

  const clocked = window.to - window.from <= BY_CLOCK;
  const clock = (time: number) => zonedAt(time, zone).toFormat(CLOCK);
  const today = midnight && live && start.hasSame(zonedAt(now.toMillis(), zone), 'day');
  const from = clocked && !today ? `${dayWord(t, window.from, now, zone)} ${clock(window.from)}` : dayWord(t, window.from, now, zone);
  // The last instant inside the window names its day: a window that closes at midnight has not begun the next date.
  const sameDay = start.hasSame(zonedAt(window.to - 1, zone), 'day');
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

/** "Mittel 03:09–03:12": a point that is the mean of a window says so, and over which stretch. */
export const meanStamp = (t: Translate, middle: number, window: Span, stepSeconds: number, zone: string | null): string => {
  const [from, to] = [middle - stepSeconds * 500, middle + stepSeconds * 500];
  const sameDay = zonedAt(from, zone).hasSame(zonedAt(to, zone), 'day');
  const clock = stepSeconds % 60 === 0 ? CLOCK : `${CLOCK}:ss`;
  return t('timeline.meanOver', {
    from: cursorStamp(from, window, stepSeconds, zone),
    to: sameDay ? zonedAt(to, zone).toFormat(clock) : cursorStamp(to, window, stepSeconds, zone),
  });
};

/** Both ends of the window as the axis writes them; one that ends now says so. */
export const axisEnds = (t: Translate, window: Span, live: boolean, zone: string | null): [string, string] => {
  const span = window.to - window.from;
  const format = span <= BY_CLOCK ? CLOCK : span <= BY_WEEKDAY ? 'ccc' : DAY_IN_YEAR;
  return [zonedAt(window.from, zone).toFormat(format), live ? t('timeline.now') : zonedAt(window.to, zone).toFormat(format)];
};

/** "alle 3 Min", "alle 4,5 Std", "alle 2,3 Tage": how far apart the points drawn are, in the unit that fits. */
export const stepWords = (t: Translate, stepSeconds: number): string => {
  const [unit, size] =
    stepSeconds < 60
      ? (['s', 1] as const)
      : stepSeconds < 3600
        ? (['min', 60] as const)
        : stepSeconds < 86400
          ? (['h', 3600] as const)
          : (['d', 86400] as const);
  return t(`timeline.every.${unit}`, {
    count: Math.round((stepSeconds / size) * 10) / 10,
    n: looseFigure(Math.round((stepSeconds / size) * 10) / 10),
  });
};
