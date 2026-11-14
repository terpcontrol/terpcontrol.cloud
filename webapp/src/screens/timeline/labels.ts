import type { DateTime } from 'luxon';
import type { Translate } from '@/i18n/i18n';
import { DAY_MS, HOUR_MS } from '@/ui/days';
import { looseFigure } from '@/ui/figures';
import { CLOCK, DATED_CLOCK, DATED_CLOCK_WITH_YEAR, DAY, DAY_IN_YEAR, zonedAt } from '@/ui/zone';
import { BY_CLOCK, dayLabel } from '@/charts/ticks';
import type { Span } from './view';

/**
 * How Verlauf says when: the window between the arrows, the instant of the cursor, a line's stamp and the two ends of
 * the axis - each as short as the width of the window lets it be and still say which moment it is.
 */

const BY_WEEKDAY = 10 * DAY_MS;

/**
 * The day an instant falls on: today, yesterday, the weekday within a week, else the date - or the date always where
 * it is `dated`. `then` is the word inside a sentence.
 */
const dayWord = (t: Translate, time: number, now: DateTime, zone: string | null, then = false, dated = false): string => {
  const day = zonedAt(time, zone);
  const today = zonedAt(now.toMillis(), zone).startOf('day');
  const back = dated ? Infinity : Math.round(today.diff(day.startOf('day'), 'days').days);
  if (back === 0) return t(then ? 'timeline.day.todayThen' : 'timeline.day.today');
  if (back === 1) return t(then ? 'timeline.day.yesterdayThen' : 'timeline.day.yesterday');
  if (back > 1 && back < 7) return day.toFormat('cccc');
  return day.toFormat(day.year === today.year ? DAY_IN_YEAR : DAY);
};

/**
 * "Gestern 14:30 bis jetzt", "Heute 03:00 bis 03:20", "5. Nov bis 12. Nov": the window, as the row between the
 * arrows names it. A whole day of the calendar is that day and not its two midnights: "Gestern", "Mo, 11. Aug",
 * and today up to now "Heute bis jetzt". A link's window is `dated`, as the link's own head says it: it is read on
 * days its maker never saw, and "gestern" would move.
 */
export const windowLabel = (t: Translate, window: Span, live: boolean, now: DateTime, zone: string | null, dated = false): string => {
  const start = zonedAt(window.from, zone);
  const midnight = start.equals(start.startOf('day'));
  if (midnight && !live && start.plus({ days: 1 }).toMillis() === window.to) {
    const back = Math.round(zonedAt(now.toMillis(), zone).startOf('day').diff(start, 'days').days);
    return (back === 0 || back === 1) && !dated
      ? dayWord(t, window.from, now, zone)
      : start.toFormat(`ccc, ${start.year === now.year ? DAY_IN_YEAR : DAY}`);
  }

  const clocked = window.to - window.from <= BY_CLOCK;
  const clock = (time: number) => zonedAt(time, zone).toFormat(CLOCK);
  const today = midnight && live && start.hasSame(zonedAt(now.toMillis(), zone), 'day');
  const day = (time: number, then = false) => dayWord(t, time, now, zone, then, dated);
  const from = clocked && !today ? `${day(window.from)} ${clock(window.from)}` : day(window.from);
  // The last instant inside the window names its day: a window that closes at midnight has not begun the next date.
  const sameDay = start.hasSame(zonedAt(window.to - 1, zone), 'day');
  const to = live ? t('timeline.now') : clocked ? `${sameDay ? '' : `${day(window.to - 1, true)} `}${clock(window.to)}` : day(window.to - 1, true);

  return t('timeline.windowSpan', { from, to });
};

/** The instant of the cursor, to the second where the points are that fine. */
export const cursorStamp = (time: number, window: Span, stepSeconds: number, zone: string | null): string => {
  const span = window.to - window.from;
  const clock = stepSeconds > 0 && stepSeconds < 60 ? `${CLOCK}:ss` : CLOCK;
  const format = span <= DAY_MS + HOUR_MS ? clock : span <= BY_WEEKDAY ? `ccc ${clock}` : span <= 400 * DAY_MS ? DATED_CLOCK : DATED_CLOCK_WITH_YEAR;
  return zonedAt(time, zone).toFormat(format);
};

/**
 * "Mittel 03:09–03:12": a point that is the mean of a window says so, and over which stretch; one of a single sample
 * says the stretch alone. The last stretch is what the read's end left of its step, and never runs past the window;
 * a point that stands for what was heard of its window (`over`) - beside a silence - names that, and one that stands
 * on a single sample its instant.
 */
export const meanStamp = (
  t: Translate,
  middle: number,
  window: Span,
  stepSeconds: number,
  zone: string | null,
  mean = true,
  over: Span | null = null,
): string => {
  if (over && over.to - over.from < 1000) return cursorStamp(over.from, window, 1, zone);
  const step = stepSeconds * 1000;
  const to = over ? over.to : Math.min(window.to, middle + stepSeconds * 500);
  const from = over ? over.from : to === window.to && to % step !== 0 ? to - (to % step) : middle - step / 2;
  const sameDay = zonedAt(from, zone).hasSame(zonedAt(to, zone), 'day');
  // Seconds on both ends or on neither: where the stretch is whole minutes, its ends are.
  const fine = stepSeconds % 60 === 0 && to % 60_000 === 0 && from % 60_000 === 0 ? 60 : 1;
  const stretch = [
    cursorStamp(from, window, fine, zone),
    sameDay ? zonedAt(to, zone).toFormat(fine === 1 ? `${CLOCK}:ss` : CLOCK) : cursorStamp(to, window, fine, zone),
  ];
  return mean ? t('timeline.meanOver', { from: stretch[0], to: stretch[1] }) : stretch.join('–');
};

/** Both ends of the window as the axis writes them; one that ends now says so. */
export const axisEnds = (t: Translate, window: Span, live: boolean, zone: string | null): [string, string] => {
  const span = window.to - window.from;
  // By the clock up to a day and a half, past that as the lines between them name a day.
  const end = (time: number) => (span <= BY_CLOCK ? zonedAt(time, zone).toFormat(CLOCK) : dayLabel(zonedAt(time, zone), span, DAY_IN_YEAR));
  return [end(window.from), live ? t('timeline.now') : end(window.to)];
};

/** "alle 3 Min", "alle 4,5 Std", "alle 2,3 Tage": how far apart the points drawn are, in the unit that fits. */
export const stepWords = (t: Translate, stepSeconds: number): string => {
  // In seconds below two minutes, in whole minutes from there to the hour: "alle 90 s", "alle 3 Min".
  const [unit, size, tenths] =
    stepSeconds < 120
      ? (['s', 1, 1] as const)
      : stepSeconds < 3600
        ? (['min', 60, 1] as const)
        : stepSeconds < 86400
          ? (['h', 3600, 10] as const)
          : (['d', 86400, 10] as const);
  const count = Math.round((stepSeconds / size) * tenths) / tenths;
  return t(`timeline.every.${unit}`, { count, n: looseFigure(count) });
};
