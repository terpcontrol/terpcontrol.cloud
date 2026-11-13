import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Entry, ValueState } from '@fg2/shared-types/v1';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { GROW } from '@/app/places';
import { growDay } from '@/screens/grow/progress';
import { ageAttribute, dayStamp } from '@/ui/age';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { ownPhotoOf } from './place';
import type { Reading } from './readings';
import styles from './Start.module.css';

/**
 * The picture a place or a grow is shown by, as the head of Start: what it
 * shows named on it top left, when it was taken top right, and - for a
 * camera's - the readings of the place in a bar along its foot. A tap on the
 * picture opens where it comes from; a tap on a reading opens that reading's
 * curve. Readings that are no longer live step back and `stand` says how old
 * they are; under a place nobody has heard from the picture steps back too.
 */
export function Picture({
  to,
  src,
  alt,
  opens,
  name = null,
  day = null,
  right,
  warns = false,
  readings = [],
  curveOf,
  age = 'live',
  stand = null,
  empty,
}: {
  to: string;
  src: string | null;
  alt: string;
  /** Where a tap leads, said after what the picture shows. */
  opens: string;
  /** What the picture shows, which gives way where the label has no room for all of it. */
  name?: string | null;
  /** The day of the grow, which the label always keeps. */
  day?: string | null;
  right: string | null;
  /** The right-hand words say the picture is old. */
  warns?: boolean;
  readings?: Reading[];
  /** The address of a reading's curve. */
  curveOf?: (reading: Reading) => string;
  age?: ValueState;
  stand?: string | null;
  /** What stands in place of a picture that has not been taken yet. */
  empty: string;
}) {
  const { t } = useTranslation();

  return (
    <div className={styles.picture} {...ageAttribute(age)}>
      <Link to={to} className={styles.pictureLink}>
        {src ? <img src={src} alt={alt} /> : <span className={styles.pictureEmpty}>{empty}</span>}
        <span className={ui.visuallyHidden}>{`, ${opens}`}</span>
      </Link>
      <span className={styles.chips}>
        {name || day ? (
          <span className={styles.chip} data-side="left">
            {name ? <span className={styles.chipName}>{name}</span> : null}
            {day ? <span className={styles.chipKept}>{name ? ` · ${day}` : day}</span> : null}
          </span>
        ) : null}
        {right ? (
          <span className={styles.chip} data-side="right" data-tone={warns ? 'warn' : undefined}>
            {right}
          </span>
        ) : null}
      </span>
      {readings.length > 0 ? (
        <span className={styles.pictureBar}>
          <span className={styles.pictureFigures}>
            {readings.map(reading => {
              const figure = (
                <>
                  <span className={styles.pictureValue} aria-hidden>
                    {reading.figure}
                  </span>
                  <span className={styles.pictureLabel} aria-hidden>
                    {reading.label}
                  </span>
                  {/* Said as one sentence that names the reading, with the verdict the picture has no room to draw. */}
                  <span className={ui.visuallyHidden}>
                    {[`${reading.label} ${reading.figure}`, reading.note, curveOf ? t('start.reading.open') : null].filter(Boolean).join(', ')}
                  </span>
                </>
              );
              return curveOf ? (
                <Link key={reading.key} to={curveOf(reading)} className={styles.pictureFigure}>
                  {figure}
                </Link>
              ) : (
                <span key={reading.key} className={styles.pictureFigure}>
                  {figure}
                </span>
              );
            })}
          </span>
          {stand ? <span className={styles.stand}>{stand}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A grow without a camera is shown by the newest photo written into its diary, and failing that by its cover; by
 * nothing where it has neither. `named` where no heading over the picture names the grow already.
 */
export function OwnPhoto({
  grow,
  entries,
  named = false,
}: {
  grow: { growId: string; name: string; dayNumber: number | null; coverMediaId: string | null };
  entries: Entry[];
  named?: boolean;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { user } = useSession();
  const photo = ownPhotoOf(entries, grow.growId);
  const mediaId = photo?.mediaIds[0] ?? grow.coverMediaId;
  if (!mediaId) return null;

  return (
    <Picture
      to={GROW}
      src={mediaUrl(mediaId, THUMBNAIL_WIDTH.frame)}
      alt={t('start.picture.photoAlt', { name: grow.name })}
      opens={t('start.picture.openGrow')}
      name={named ? grow.name : null}
      day={growDay(t, grow)}
      right={
        photo ? t(photo.authorId === user?.id ? 'start.picture.yours' : 'start.picture.photo', { day: dayStamp(photo.occurredAt, now, zone) }) : null
      }
      empty=""
    />
  );
}
