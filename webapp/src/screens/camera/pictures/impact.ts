import type { StillDeletionFilm } from '@fg2/shared-types/v1';
import type { Translate } from '@/i18n/i18n';
import { DATED_CLOCK, DAY_IN_YEAR, zoned } from '@/ui/zone';

/** What the question says: how many go, for good, and which films are made again without them or are gone. */
export function sayImpact(t: Translate, stills: number, films: StillDeletionFilm[], zone: string | null): string {
  const named = (list: StillDeletionFilm[]) => list.map(film => filmName(t, film, zone)).join(', ');
  const remade = films.filter(film => film.remade);
  const gone = films.filter(film => !film.remade);

  return [
    t('pictures.ask', { count: stills }),
    remade.length > 0 ? t('pictures.remade', { films: named(remade) }) : null,
    gone.length > 0 ? t('pictures.gone', { films: named(gone), count: gone.length }) : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** A film as the question names it: the day, the week or the month it shows, or what kind of film it is. */
const filmName = (t: Translate, film: StillDeletionFilm, zone: string | null): string => {
  const starts = zoned(film.startsAt, zone);
  if (film.window === 'day') return t('pictures.film.day', { day: starts.toFormat(DAY_IN_YEAR) });
  if (film.window === 'week') return t('pictures.film.week', { week: starts.weekNumber });
  if (film.window === 'month') return starts.toFormat('LLLL yyyy');

  return `${t(`camera.film.kind.${film.window}`)} (${starts.toFormat(DATED_CLOCK)})`;
};
