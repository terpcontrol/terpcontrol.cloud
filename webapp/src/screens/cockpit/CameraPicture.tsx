import { Camera, ChevronRight } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { OverviewCamera, SpaceOverview } from '@fg2/shared-types/v1';
import { useLatestStills } from '@/api/cameras';
import { FROM_PLACE } from '@/app/places';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import { ageLabel } from '@/ui/age';
import { useCameraCalled } from '@/ui/camera-name';
import { clock, useZone } from '@/ui/zone';
import { shownStill } from './place';
import styles from './Cockpit.module.css';

/**
 * The picture of the place, a tap from the camera's page - on its own, or
 * heading the grow block where a diary is kept. Before the first picture of
 * the day the strip is empty, and the camera's newest frame is yesterday's.
 */
export function CameraPicture({
  overview,
  camera,
  now,
  label,
}: {
  overview: SpaceOverview;
  camera: OverviewCamera;
  now: DateTime;
  /** What stands on the picture, such as the grow's day and phase. */
  label?: string | null;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const called = useCameraCalled();
  const still = shownStill(camera);
  const latest = useLatestStills(still === null && camera.lastStillAt ? [camera.cameraId] : []);
  const mediaId = still?.mediaId ?? latest.get(camera.cameraId) ?? null;
  const src = mediaId ? mediaUrl(mediaId, THUMBNAIL_WIDTH.frame) : null;
  const takenAt = still?.capturedAt ?? camera.lastStillAt;
  const caption = takenAt
    ? still?.dark
      ? t('cockpit.camera.lightOff', { name: called(camera.name), time: clock(takenAt, zone) })
      : t('cockpit.camera.caption', { name: called(camera.name), time: clock(takenAt, zone), age: ageLabel(takenAt, now) })
    : called(camera.name);

  return (
    <Link to={`/cameras/${camera.cameraId}`} state={FROM_PLACE} className={styles.camera} aria-label={t('cockpit.camera.open')}>
      {src ? (
        <img src={src} alt={t('home.card.stillAlt', { name: overview.name })} loading="lazy" />
      ) : (
        <span className={styles.cameraEmpty}>{t('cockpit.camera.none')}</span>
      )}
      {label ? <span className={`figure ${styles.cameraLabel}`}>{label}</span> : null}
      <span className={`mono ${styles.cameraCaption}`}>
        <Camera size={14} strokeWidth={1.75} aria-hidden />
        <span>{caption}</span>
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
      </span>
    </Link>
  );
}
