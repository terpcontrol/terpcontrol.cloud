import { Camera, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Entry, GrowCard, OverviewCamera } from '@fg2/shared-types/v1';
import { useLatestStills, useLatestStillTimes } from '@/api/cameras';
import { mediaUrl, THUMBNAIL_WIDTH } from '@/api/session';
import { GROW } from '@/app/places';
import { ageAttribute, sinceLabel, spokenAgo } from '@/ui/age';
import { useCameraCalled } from '@/ui/camera-name';
import { Facts } from '@/ui/Facts';
import { StillStamp } from '@/ui/StillStamp';
import { useNow } from '@/ui/useNow';
import { clock, useZone } from '@/ui/zone';
import { growDay, useGrowWords } from '@/screens/grow/progress';
import { shownStill } from './place';
import styles from './Start.module.css';

/**
 * The place as it looks, master's way: the camera's picture across the
 * column, its name and the picture's time on it, leading to the camera - and
 * under it, in the same card, the grow standing there, leading to Grow. The
 * picture is the newest one taken in the light ("Licht aus · Bild von …"
 * where the newest lit one stands in for a dark tent), and while nothing is
 * heard the last one there is, stepped back, dated as Steuerung dates it.
 */
export function Picture({
  camera,
  grow,
  entries,
  name,
  offline,
}: {
  camera: OverviewCamera;
  grow: GrowCard | null;
  /** The place's newest lines, which say what was last done for the grow. */
  entries: Entry[];
  /** The place's name, which the picture is described by. */
  name: string;
  offline: boolean;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const called = useCameraCalled();
  // While nothing is heard the card shows the last picture there is, not the newest taken in the light: one picture
  // carries one time.
  const still = offline ? null : shownStill(camera);
  // Before the first picture of the day the strip is empty, and the camera's newest frame is yesterday's.
  const newest = still === null && camera.lastStillAt ? [camera.cameraId] : [];
  const latest = useLatestStills(newest);
  const latestAt = useLatestStillTimes(newest);
  const mediaId = still?.mediaId ?? latest.get(camera.cameraId) ?? null;
  const src = mediaId ? mediaUrl(mediaId, THUMBNAIL_WIDTH.frame) : null;
  const takenAt = still?.capturedAt ?? latestAt.get(camera.cameraId) ?? camera.lastStillAt;
  const when = takenAt
    ? offline
      ? t('camera.picture.last', { time: sinceLabel(takenAt, now, zone) })
      : still?.dark
        ? t('camera.picture.lightOff', { time: sinceLabel(takenAt, now, zone) })
        : clock(takenAt, zone)
    : t('start.camera.none');

  return (
    <section className={styles.view} aria-label={called(camera.name)}>
      <Link to={`/cameras/${camera.cameraId}`} className={styles.picture} {...ageAttribute(offline ? 'offline' : 'live')}>
        {src ? (
          <img src={src} alt={t('home.card.stillAlt', { name })} />
        ) : (
          <Camera size={28} strokeWidth={1.5} className={styles.pictureEmpty} aria-hidden />
        )}
        {src && takenAt ? <StillStamp at={takenAt} className={styles.pictureStamp} /> : null}
        <span className={styles.pictureCaption}>
          <Camera size={16} strokeWidth={1.75} aria-hidden />
          <span className={styles.pictureWords}>{`${called(camera.name)} · ${when}`}</span>
          <ChevronRight size={18} strokeWidth={2} aria-hidden />
        </span>
      </Link>
      {grow ? <PictureGrow grow={grow} entries={entries} /> : null}
    </section>
  );
}

/**
 * The grow under the picture: its name, its strains and what was last done for
 * it ("Gedüngt vor 3 Tagen"), and its day, phase and week as the stage's pill.
 */
function PictureGrow({ grow, entries }: { grow: GrowCard; entries: Entry[] }) {
  const { t } = useTranslation();
  const now = useNow();
  const { phase, left } = useGrowWords(grow);
  const done = entries.find(entry => entry.growId === grow.growId && entry.source === 'human');

  return (
    <Link to={GROW} className={styles.pictureGrow}>
      <span className={styles.pictureGrowText}>
        <span className={styles.leadName}>{grow.name}</span>
        <Facts
          className={styles.leadLine}
          facts={[
            grow.strains.length > 0 ? grow.strains.join(', ') : null,
            done ? t('start.grow.last', { what: t(`home.entryKind.${done.kind}`), ago: spokenAgo(done.occurredAt, now) }) : null,
            left,
          ]}
        />
      </span>
      <span className={styles.stage}>{[growDay(t, grow), phase].filter(Boolean).join(' · ')}</span>
      <ChevronRight size={20} strokeWidth={2} className={styles.chevron} aria-hidden />
    </Link>
  );
}
