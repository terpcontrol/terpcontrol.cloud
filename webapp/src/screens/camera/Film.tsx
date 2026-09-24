import { useTranslation } from 'react-i18next';
import type { Media } from '@fg2/shared-types/v1';
import { useMe } from '@/api/account';
import { useMedia } from '@/api/cameras';
import { mediaUrl, useSession } from '@/api/session';
import ui from '@/ui/ui.module.css';
import { DATED_CLOCK, DAY_IN_YEAR, zoned, zoneOf } from '@/ui/zone';
import { filmCauseOf } from './capture-failure';
import styles from './CameraPage.module.css';

/**
 * A film, from the moment it is asked for to the moment it plays.
 *
 * A render is minutes of ffmpeg and does not finish inside the request, so the
 * row says where the job has got to and nothing more until the file is there.
 * A render that failed says so and keeps the reason, rather than staying
 * "rendering" forever.
 *
 * The reason is read for what kind of failure it was and said in the language
 * the page is in. The server writes it in English - it is prose it chose, or a
 * paragraph of ffmpeg - and a German camera page was drawing "there are not
 * enough pictures in that span to make a film" as its one English line, under a
 * status that said "fehlgeschlagen" and beside a capture banner that has named
 * its own failures in German for as long as `capture-failure.ts` has existed.
 * The server's own words stay for whoever owns the camera, a tap below, exactly
 * as that banner keeps them: they are the only route from a render that broke
 * to the person who can do anything about it.
 */
export function Film({ mediaId, collapsed, mayOwn = false }: { mediaId: string; collapsed?: boolean; mayOwn?: boolean }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const me = useMe(false, user?.isDemo !== true);
  const media = useMedia(mediaId);

  if (!media.data) {
    return (
      <p className={ui.note} role="status">
        {media.isError ? t('camera.film.lost') : t('home.waiting')}
      </p>
    );
  }

  const film = media.data;
  const status = film.render?.status ?? 'ready';
  const source = status === 'ready' ? mediaUrl(film.id) : null;

  return (
    <div className={`${ui.card} ${styles.film}`}>
      <div className={styles.filmHead}>
        <span className={styles.filmTitle}>{spanLabel(film, zoneOf(me.data))}</span>
        <span className={`mono ${styles.filmStatus}`} data-status={status}>
          {t(`camera.film.${status}`)}
          {film.lengthSeconds ? ` · ${lengthLabel(film.lengthSeconds)}` : ''}
          {film.quality ? ` · ${film.quality.toUpperCase()}` : ''}
        </span>
        {source && collapsed ? (
          <a className={`mono ${styles.filmLink}`} href={source} target="_blank" rel="noreferrer">
            {t('camera.film.open')}
          </a>
        ) : null}
      </div>

      {status === 'queued' && !collapsed ? <p className={ui.note}>{t('camera.film.queuedNote')}</p> : null}

      {status === 'failed' ? (
        <>
          <p className={ui.problem} role="alert">
            {film.render?.error ? t(filmCauseOf(film.render.error)) : t('camera.film.failedPlain')}
          </p>
          {mayOwn && film.render?.error ? (
            <details className={styles.rawError}>
              <summary className="mono">{t('camera.film.whatItSaid')}</summary>
              <p className="mono">{film.render.error}</p>
            </details>
          ) : null}
        </>
      ) : null}

      {source && !collapsed ? <video className={styles.video} src={source} controls playsInline preload="metadata" /> : null}
    </div>
  );
}

/**
 * What the film is of: both ends of its span, in the account's own zone.
 *
 * Not the browser's. A film of a single day ending a minute before midnight is
 * drawn as running into the next one for a reader sitting east of the account
 * they are reading, which is the film saying it covers a day it holds no frame
 * of.
 *
 * The end is read as the last moment inside the span rather than as the first
 * moment outside it, because the two things that write `endsAt` disagree about
 * which they mean: the rolling builder stores the last frame it encoded, while
 * a film composed on request stores the exclusive end of the bucket it was
 * asked for. A one-tap "Today" therefore arrived as midnight to midnight and
 * was drawn "23 Sep -> 24 Sep", two dates for one day, directly above builder
 * films of the same length reading "18 Sep 00:00 -> 18 Sep 23:58". Taking the
 * millisecond off settles it here; no film has an end aligned to a whole second
 * but those, so no other row's clock time moves. The durable answer is for the
 * render job to write back the frame it actually finished on.
 *
 * The two formats are `ui/zone`'s and not this file's. Spelled out here they
 * reached for Luxon's other month token - the one that writes a month as it is
 * written inside a date rather than standing on its own, which `ui/zone` names
 * and forbids. English spells the two alike for all twelve months and German
 * for one of them, so a German reader was told "24 Sept." here and "19 Sep" on
 * the alerts inbox two taps away, about one September; and on this very page,
 * "19 Sept. 00:00 → 19 Sept. 02:28" sat directly under the camera's own last
 * still stamped "19 Sep 02:28".
 */
const spanLabel = (film: Media, zone: string | null): string => {
  const from = zoned(film.capturedAt, zone);
  const to = film.endsAt ? zoned(film.endsAt, zone).minus({ milliseconds: 1 }) : null;
  const format = from.hasSame(to ?? from, 'day') ? DATED_CLOCK : DAY_IN_YEAR;

  return to ? `${from.toFormat(format)} → ${to.toFormat(format)}` : from.toFormat(format);
};

/** "0:14": a film is always under an hour, and a grower reads it off a play button. */
const lengthLabel = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
