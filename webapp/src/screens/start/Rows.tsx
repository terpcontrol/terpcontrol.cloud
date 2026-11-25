import { Camera, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Entry, GrowCard, OverviewCamera, ValueState } from '@fg2/shared-types/v1';
import { useLatestStills, useLatestStillTimes } from '@/api/cameras';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { ageAttribute, dayStamp, sinceLabel } from '@/ui/age';
import { useCameraCalled } from '@/ui/camera-name';
import { Facts } from '@/ui/Facts';
import { unbroken } from '@/ui/fact-text';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { Link } from 'react-router';
import { growDay, splitWords, useProgress } from '@/screens/grow/progress';
import { ownPhotoOf, shownStill } from './place';
import styles from './Start.module.css';

/**
 * A row of Start that leads on - to the camera, to the grow: a small picture
 * where there is one, a name, and one line under it. The picture is a
 * thumbnail beside the words, never the head of the page: the figures are read
 * first. `age` steps the picture back under a place nobody has heard from.
 */
function LeadRow({
  to,
  src,
  alt,
  empty = false,
  name,
  line,
  warns = false,
  age,
}: {
  to: string;
  /** The thumbnail; none where the row has no picture to show. */
  src?: string | null;
  alt?: string;
  /** A camera that has not delivered yet: its frame stands empty. */
  empty?: boolean;
  name: string;
  line: ReactNode;
  /** The line says the picture is old. */
  warns?: boolean;
  age?: ValueState;
}) {
  return (
    <Link to={to} className={styles.lead} {...(age ? ageAttribute(age) : {})}>
      {src ? (
        <img className={styles.thumb} src={src} alt={alt} />
      ) : empty ? (
        <span className={styles.thumb} data-empty>
          <Camera size={18} strokeWidth={1.75} aria-hidden />
        </span>
      ) : null}
      <span className={styles.leadText}>
        <span className={styles.leadName}>{name}</span>
        <span className={styles.leadLine} data-tone={warns ? 'warn' : undefined}>
          {line}
        </span>
      </span>
      <ChevronRight size={20} strokeWidth={2} className={styles.chevron} aria-hidden />
    </Link>
  );
}

/**
 * The camera of a place as a row: its newest picture taken in the light,
 * small, its name, and when the picture is from - "Licht aus · Bild von …"
 * where the newest lit one stands in for a dark tent, and "letztes Bild von …"
 * while nothing is heard, dated as Steuerung dates it, the picture stepped
 * back. It opens the camera's page.
 */
export function CameraRow({ camera, name, offline }: { camera: OverviewCamera; name: string; offline: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const called = useCameraCalled();
  // While nothing is heard the row shows the last picture there is, not the newest taken in the light: one picture
  // carries one time.
  const still = offline ? null : shownStill(camera);
  // Before the first picture of the day the strip is empty, and the camera's newest frame is yesterday's.
  const newest = still === null && camera.lastStillAt ? [camera.cameraId] : [];
  const latest = useLatestStills(newest);
  const latestAt = useLatestStillTimes(newest);
  const mediaId = still?.mediaId ?? latest.get(camera.cameraId) ?? null;
  const takenAt = still?.capturedAt ?? latestAt.get(camera.cameraId) ?? camera.lastStillAt;
  const time = takenAt ? sinceLabel(takenAt, now, zone) : null;

  return (
    <LeadRow
      to={`/cameras/${camera.cameraId}`}
      src={mediaId ? mediaUrl(mediaId, THUMBNAIL_WIDTH.still) : null}
      alt={t('home.card.stillAlt', { name })}
      empty={!mediaId}
      name={called(camera.name)}
      line={
        time
          ? unbroken(t(offline ? 'camera.picture.last' : still?.dark ? 'camera.picture.lightOff' : 'start.picture.takenAt', { time }))
          : t('start.camera.none')
      }
      warns={offline}
      age={offline ? 'offline' : 'live'}
    />
  );
}

/**
 * The grow as a row, leading to it: its name, and under it its day, its phase
 * and week - a split's stage by its plants, "Blüte · 1 von 2 Pflanzen" - and
 * what is left where a feeding scheme says how long it runs. A grow kept by
 * hand, which no camera watches, shows its newest photo beside it, and failing
 * that its cover.
 */
export function GrowRow({ grow, to, entries = null }: { grow: GrowCard; to: string; entries?: Entry[] | null }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const { user } = useSession();
  const { weeksLeft } = useProgress(grow);
  // A grow reopened after its last plant came down has no stage to be in: that it is cut is what is true of it.
  const cut = !!grow.plantCount && grow.standingCount === 0;
  const said = grow.stage ? t(`home.stage.${grow.stage}`) : t('home.card.noPhase');
  const split = splitWords(
    t,
    said,
    grow.stage,
    grow.stageGroups.map(group => ({ stage: group.stage, count: group.plantCount })),
  );
  const phase = cut
    ? t('start.allCut')
    : (split ?? (grow.stage && grow.stageWeek !== null ? [said, t('start.week', { week: grow.stageWeek })].join(' · ') : said));
  const photo = entries ? ownPhotoOf(entries, grow.growId) : null;
  const mediaId = entries ? (photo?.mediaIds[0] ?? grow.coverMediaId) : null;
  const taken = photo
    ? t(photo.authorId === user?.id ? 'start.picture.yours' : 'start.picture.photo', { day: dayStamp(photo.occurredAt, now, zone) })
    : null;

  return (
    <LeadRow
      to={to}
      src={mediaId ? mediaUrl(mediaId, THUMBNAIL_WIDTH.still) : null}
      alt={t('start.picture.photoAlt', { name: grow.name })}
      name={grow.name}
      line={<Facts facts={[growDay(t, grow), phase, weeksLeft && !cut ? t('start.harvestIn', { count: weeksLeft }) : null, taken]} />}
    />
  );
}
