import type { DateTime } from 'luxon';
import type { Camera, GrowListItem, Media, TimelapseCreate } from '@fg2/shared-types/v1';
import { filmStatus } from '@/api/media';
import type { Translate } from '@/i18n/i18n';
import { instantOf } from '@/ui/age';
import { WEEKDAY_DAY, zoned } from '@/ui/zone';
import { emptyRolling } from './rolling';

/** The four films the page offers by name. */
export type Span = 'day' | 'week' | 'phase' | 'grow';

interface FilmSpan {
  span: Span;
  /** What making this film asks the server for. */
  body: TimelapseCreate;
  /** Why it cannot be asked for, or null when it can. */
  reason: string | null;
  /** Refused for want of Premium, which the page then leads to. */
  premium: boolean;
}

/** Where the phase being filmed began, which is the grow's own record and never a day counter read backwards. */
export const phaseStart = (grow: GrowListItem | null): string | null => grow?.phases.at(-1)?.startedAt ?? null;

/**
 * The end of the first whole week this camera took pictures in, on the
 * account's calendar - Monday to Sunday, as the server cuts it.
 */
const firstFullWeekEnd = (camera: Camera, zone: string | null): DateTime => {
  const paired = zoned(camera.createdAt, zone);
  const weekStart = paired.startOf('week');
  const first = paired.toMillis() === weekStart.toMillis() ? weekStart : weekStart.plus({ weeks: 1 });
  return first.plus({ weeks: 1 }).minus({ milliseconds: 1 });
};

/**
 * What each of the four films asks for, and why one cannot be asked for.
 *
 * The day's film is of the day the slider stands on (`dayAt`, an instant of
 * that day), else of today, with the instant the server works its bucket out
 * around. The week names no instant, which the route reads as the most recent
 * complete week: naming one films the week holding it, and for today that is
 * the week still open, with a few hours of stills in it. A phase and a whole
 * grow name both of their own ends, because where either began is the grow's
 * record; they are a diary's films, left out for somebody who keeps none and
 * has no grow here, and refused with the reason where a diary has no grow
 * standing here.
 *
 * A film of a camera that has taken nothing is refused here rather than
 * rendered and failed (`emptyRolling`), and the week of a camera paired since
 * the last complete week began is refused with the day its first one ends.
 */
export const filmSpans = (
  t: Translate,
  {
    camera,
    grow,
    now,
    growFilms,
    zone,
    dayAt,
  }: { camera: Camera; grow: GrowListItem | null; now: DateTime; growFilms: boolean; zone: string | null; dayAt: string | null },
): FilmSpan[] => {
  const free = camera.entitlement.tier === 'free';
  const noGrow = grow ? null : t('camera.noGrowHere');
  const empty = (window: 'day' | 'week'): string | null => {
    const reason = emptyRolling(window, camera.state.lastStillAt, now);
    return reason ? t(reason) : null;
  };
  const firstWeekEnds = firstFullWeekEnd(camera, zone);
  const nothingThatWeek =
    firstWeekEnds.toMillis() > now.toMillis() ? t('camera.firstWeekEnds', { date: firstWeekEnds.toFormat(WEEKDAY_DAY) }) : empty('week');

  const rolling: FilmSpan[] = [
    { span: 'day', body: { window: 'day', startsAt: dayAt ?? instantOf(now) }, reason: dayAt ? null : empty('day'), premium: false },
    { span: 'week', body: { window: 'week' }, reason: nothingThatWeek, premium: false },
  ];
  if (!growFilms) return rolling;

  return [
    ...rolling,
    { span: 'phase', body: { window: 'phase', startsAt: phaseStart(grow) ?? '', endsAt: instantOf(now) }, reason: noGrow, premium: false },
    {
      span: 'grow',
      body: { window: 'grow', startsAt: grow?.startedAt ?? '', endsAt: grow?.endedAt ?? instantOf(now), quality: 'hd' },
      reason: noGrow ?? (free ? t('camera.needsPremium') : null),
      premium: free && noGrow === null,
    },
  ];
};

/** Which span a film is of, as the two ends its row draws. */
const endsOf = (film: Media): string => `${film.capturedAt}|${film.endsAt ?? ''}`;

/**
 * The films of a camera, one verdict per span: where a span has a film that
 * plays, a failed attempt at the same span is left out. Two rows that name
 * the same span and disagree are what a reader cannot tell apart.
 */
export const filmsOfEachSpan = (films: Media[]): Media[] => {
  const played = new Set(films.filter(film => filmStatus(film) === 'ready').map(endsOf));

  return films.filter(film => filmStatus(film) !== 'failed' || !played.has(endsOf(film)));
};

/**
 * The film a span's button plays: the newest finished one of that kind - the
 * list comes newest first - and for a day the slider stands on, the film
 * whose span holds that day's picture.
 */
export const filmOf = (films: Media[], span: Span, dayAt: string | null): Media | null =>
  films.find(
    film =>
      film.window === span &&
      filmStatus(film) === 'ready' &&
      (span !== 'day' ||
        dayAt === null ||
        (Date.parse(film.capturedAt) <= Date.parse(dayAt) && (!film.endsAt || Date.parse(dayAt) <= Date.parse(film.endsAt)))),
  ) ?? null;

/** How far a film of a span still going may stop short of the newest picture and still be the one asked for, as the server reads it. */
const FRESH_FILM_MS = 10 * 60 * 1000;

/**
 * Where today's film stops short of the camera's newest picture - by more than the server reads as current -, the
 * instant it reaches to: a later tap films the rest. A film of today ends at its last frame, so a film made before a
 * gap in the pictures played "00:00 → 08:55" all afternoon with no way to the rest. Null where it reaches the newest
 * picture, and for any other day.
 */
export const filmReachesTo = (film: Media, camera: Camera, now: DateTime, zone: string | null): string | null => {
  const newest = camera.state.lastStillAt;
  if (film.window !== 'day' || !film.endsAt || !newest) return null;
  const today = (zone ? now.setZone(zone) : now).startOf('day');
  if (Date.parse(film.capturedAt) < today.toMillis() || Date.parse(film.endsAt) > now.toMillis()) return null;

  return Date.parse(newest) - Date.parse(film.endsAt) >= FRESH_FILM_MS ? film.endsAt : null;
};
