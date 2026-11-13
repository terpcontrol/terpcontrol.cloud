import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Media } from '@fg2/shared-types/v1';
import { filmStatus, useMedia } from '@/api/media';
import { mediaUrl } from '@/api/session';
import ui from '@/ui/ui.module.css';
import { DATED_CLOCK, DAY_IN_YEAR, useZone, zoned } from '@/ui/zone';
import { filmCauseOf } from './capture-failure';
import styles from './CameraPage.module.css';

/**
 * A film, from the moment it is asked for to the moment it plays.
 *
 * A render is minutes of ffmpeg and does not finish inside the request, so the
 * row says where the job has got to and nothing more until the file is there.
 * A render that failed says so and keeps the reason: the kind of failure in
 * the language of the page - the server writes it in English, as prose it
 * chose or a paragraph of ffmpeg - and the server's own words a tap below for
 * whoever owns the camera, as the box over the picture keeps them.
 */
export function Film({
  mediaId,
  collapsed,
  mayOwn = false,
  autoPlay = false,
}: {
  mediaId: string;
  collapsed?: boolean;
  mayOwn?: boolean;
  /** Drawn because somebody pressed play, so it plays. */
  autoPlay?: boolean;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const media = useMedia(mediaId);
  // A film plays where it is listed: opening the file in a tab of its own left the app, with the media token in its address.
  const [playing, setPlaying] = useState(false);

  if (!media.data) {
    return (
      <p className={ui.note} role="status">
        {media.isError ? t('camera.film.lost') : t('home.waiting')}
      </p>
    );
  }

  const film = media.data;
  const status = filmStatus(film);
  const source = status === 'ready' ? mediaUrl(film.id) : null;

  return (
    <div className={`${ui.card} ${styles.film}`}>
      <div className={styles.filmHead}>
        {/* Named after what it is a film of, with the span under it: two films
            of one day - the day's own and one composed in HD with the day
            counter on it - were two rows reading the same two clock times. */}
        <span className={styles.filmTitle}>
          {t(`camera.film.kind.${film.window ?? 'custom'}`)} · {spanLabel(film, zone)}
        </span>
        <span className={styles.filmStatus} data-status={status}>
          {t(`camera.film.${status}`)}
          {film.lengthSeconds ? ` · ${lengthLabel(film.lengthSeconds)}` : ''}
          {film.quality ? ` · ${film.quality.toUpperCase()}` : ''}
          {composedOf(film) ? ` · ${t('camera.film.overlaid')}` : ''}
        </span>
        {source && collapsed ? (
          <button type="button" className={styles.filmLink} aria-expanded={playing} onClick={() => setPlaying(on => !on)}>
            {t(playing ? 'camera.film.close' : 'camera.film.play')}
          </button>
        ) : null}
      </div>

      {status === 'queued' && !collapsed ? <p className={ui.note}>{t('camera.film.queuedNote')}</p> : null}

      {status === 'failed' ? (
        <>
          {/* A failure in the list is history - the reason it was not made then -
              and is told quietly; only the film just asked for speaks up. */}
          <p className={collapsed ? ui.note : ui.problem} role={collapsed ? undefined : 'alert'}>
            {film.render?.error ? t(filmCauseOf(film.render.error)) : t('camera.film.failedPlain')}
          </p>
          {mayOwn && film.render?.error ? <Raw summary={t('camera.film.whatItSaid')}>{film.render.error}</Raw> : null}
        </>
      ) : null}

      {source && (!collapsed || playing) ? (
        <video className={styles.video} src={source} controls playsInline preload="metadata" autoPlay={playing || autoPlay} />
      ) : null}
    </div>
  );
}

/**
 * What the film is of: both ends of its span, in the account's own zone - not
 * the browser's, or a film of one day runs into the next for a reader sitting
 * east of the account.
 *
 * The end is read as the last moment inside the span rather than the first
 * outside it, because the two things that write `endsAt` disagree: the
 * rolling builder stores the last frame it encoded, a film composed on
 * request the exclusive end of its bucket. Taking the millisecond off settles
 * it; no film's end is aligned to a whole second but those. The formats are
 * `ui/zone`'s, whose month token is the one every other screen writes.
 */
const spanLabel = (film: Media, zone: string | null): string => {
  const from = zoned(film.capturedAt, zone);
  const to = film.endsAt ? zoned(film.endsAt, zone).minus({ milliseconds: 1 }) : null;
  const format = from.hasSame(to ?? from, 'day') ? DATED_CLOCK : DAY_IN_YEAR;

  return to ? `${from.toFormat(format)} → ${to.toFormat(format)}` : from.toFormat(format);
};

/** Whether something was drawn over the frames - the day, the climate, what was written. */
const composedOf = (film: Media): boolean => {
  const overlays = film.render?.overlays;
  return overlays ? overlays.dayCounter || overlays.climate || overlays.entries : false;
};

/** "0:14": a film is always under an hour, and a grower reads it off a play button. */
const lengthLabel = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The server's own words about a failure, folded away: a paragraph of ffmpeg with an address in it, for whoever can fix the camera. */
export function Raw({ summary, children }: { summary: string; children: string }) {
  return (
    <details className={styles.raw}>
      <summary>{summary}</summary>
      <p>{children}</p>
    </details>
  );
}
