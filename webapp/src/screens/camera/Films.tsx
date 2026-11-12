import type { DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Camera, GrowListItem, Me, Media, TimelapseCreate } from '@fg2/shared-types/v1';
import { useTimelapses } from '@/api/cameras';
import { itemsOf } from '@/api/pages';
import { rowReaches } from '@/screens/notifications/reach';
import { Help } from '@/ui/Help';
import { useKept } from '@/ui/kept';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import { DATED_CLOCK, zoned } from '@/ui/zone';
import { Film } from './Film';
import { filmOf, filmSpans, filmsOfEachSpan, phaseStart, type Span } from './film-spans';
import styles from './CameraPage.module.css';

/**
 * The films of a camera, by name: the day's, the week's, the phase's and the
 * whole grow's. A chip chooses which, and the one button under them plays the
 * newest film of that kind where it stands - or, for whoever may steer the
 * place, makes it where there is none yet, and then says where the render has
 * got to. A film that cannot be made stays a chip and says why once chosen.
 *
 * Somebody who may only look is offered the kinds there is a film of and
 * nothing to make. `beside` is the page's second button, `below` what that
 * button last answered: the two share a row and its receipt.
 */
export function Films({
  camera,
  grow,
  growFilms,
  films,
  now,
  zone,
  dayAt,
  mayManage,
  mayOwn,
  ask,
  beside,
  below,
}: {
  camera: Camera;
  /** The grow whose phase and whole the last two films are of. */
  grow: GrowListItem | null;
  /** Whether those two are offered at all: they are the diary's, and are left out without it where no grow is here either. */
  growFilms: boolean;
  /** The camera's films, newest first, one verdict per span. */
  films: Media[];
  now: DateTime;
  zone: string | null;
  /** The picture of the day the slider stands on, where it is not today: the day's film is that day's. */
  dayAt: string | null;
  mayManage: boolean;
  mayOwn: boolean;
  /** Making a film, and the one last asked for, whose render the page follows. */
  ask: { make: (body: TimelapseCreate) => void; pending: boolean; error: unknown; job: Media | null };
  beside: ReactNode;
  below: ReactNode;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useKept<Span>('span', 'day');
  const [playing, setPlaying] = useState<string | null>(null);

  const at = (span: Span) => (span === 'day' ? dayAt : null);
  const offered = filmSpans(t, { camera, grow, now, growFilms, zone, dayAt }).filter(
    one => mayManage || filmOf(films, one.span, at(one.span)) !== null,
  );
  const span = offered.find(one => one.span === chosen) ?? offered[0] ?? null;
  const film = span ? filmOf(films, span.span, at(span.span)) : null;
  const shown = film !== null && playing === film.id;
  // Where the camera is younger than the phase or the grow it would film, those films begin where its pictures do.
  const begun = phaseStart(grow) ?? grow?.startedAt ?? null;
  const younger = span !== null && (span.span === 'phase' || span.span === 'grow') && begun !== null && camera.createdAt > begun;

  return (
    <section className={styles.films} aria-label={t('camera.timelapses')}>
      {offered.length > 0 ? (
        <div className={`${ui.scrollRow} ${styles.spans}`} role="group" aria-label={t('camera.film.which')}>
          {offered.map(one => (
            <button
              key={one.span}
              type="button"
              className={ui.chip}
              aria-pressed={one.span === span?.span}
              onClick={event => {
                // The row scrolls sideways on a phone: the chip chosen comes in from the edge that cut it.
                event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
                setChosen(one.span);
              }}
            >
              {t(`camera.span.${one.span}`)}
              {one.span === 'grow' && camera.entitlement.tier === 'free' ? <span className={styles.premium}>{t('camera.premium')}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {film || beside || (span && mayManage && span.reason === null) ? (
        <div className={styles.actions}>
          {film ? (
            <button type="button" className={`${ui.button} ${ui.primary}`} aria-expanded={shown} onClick={() => setPlaying(shown ? null : film.id)}>
              {t(shown ? 'camera.film.close' : 'camera.film.playIt')}
            </button>
          ) : span && mayManage && span.reason === null ? (
            <button type="button" className={`${ui.button} ${ui.primary}`} disabled={ask.pending} onClick={() => ask.make(span.body)}>
              {t(ask.pending ? 'camera.film.asking' : 'camera.film.make')}
            </button>
          ) : null}
          {beside}
        </div>
      ) : null}
      {below}

      {span?.reason && !film ? <p className={ui.note}>{span.reason}</p> : null}
      {span?.premium && !film ? (
        <Link to="/me/premium" className={`mono ${styles.textLink}`}>
          {t('camera.seePremium')} ›
        </Link>
      ) : null}
      {younger && mayManage ? (
        <p className={ui.note}>{t('camera.picturesSince', { date: zoned(camera.createdAt, zone).toFormat(DATED_CLOCK) })}</p>
      ) : null}
      <Refused error={ask.error} fallback={t('camera.askFailed')} />
      {film && shown ? <Film mediaId={film.id} mayOwn={mayOwn} autoPlay /> : null}
      {ask.job && ask.job.id !== film?.id ? <Film mediaId={ask.job.id} mayOwn={mayOwn} /> : null}
      {offered.length === 0 ? <p className={ui.note}>{t('camera.noFilms')}</p> : null}
    </section>
  );
}

/**
 * Every film the camera has, newest first, each played where it is listed;
 * "Frühere Filme" follows the cursor for those before. The week's film can
 * come by itself every Monday, which is said here, where films are.
 */
export function FilmsSheet({ camera, me, mayOwn, onClose }: { camera: Camera; me: Me | undefined; mayOwn: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const films = useTimelapses(camera.id);
  const made = filmsOfEachSpan(itemsOf(films.data));

  return (
    <Sheet title={t('camera.allFilms')} corner={<Help topic="timelapses" />} onClose={onClose}>
      <div className={styles.sheet}>
        <ul className={ui.group} aria-label={t('camera.allFilms')}>
          {made.map(film => (
            <li key={film.id}>
              <Film mediaId={film.id} mayOwn={mayOwn} collapsed />
            </li>
          ))}
        </ul>
        {films.hasNextPage ? (
          <button type="button" className={ui.button} disabled={films.isFetchingNextPage} onClick={() => void films.fetchNextPage()}>
            {films.isFetchingNextPage ? t('home.waiting') : t('camera.earlierFilms')}
          </button>
        ) : null}
        {mayOwn && me?.notifications && !rowReaches(me, 'weekly_timelapse') ? (
          <Link to="/me/notifications" className={`mono ${styles.textLink}`}>
            {t('camera.weekFilmByMail')} ›
          </Link>
        ) : null}
      </div>
    </Sheet>
  );
}
