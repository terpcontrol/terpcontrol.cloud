import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { GrowDiaryWeek, GrowListItem } from '@fg2/shared-types/v1';
import { useCamerasShape } from '@/api/cameras';
import { useGrowDiary } from '@/api/grows';
import { itemsOf } from '@/api/pages';
import { THUMBNAIL_WIDTH, mediaUrl, useSession } from '@/api/session';
import { useLog } from '@/log/log-context';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import { enough, growStanding, standsIn, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { hasFilm, picturesOfDay, sourceOf, stageOfWeek, type GrowPicture } from '../diary/days';
import { FilmCard } from '../diary/Film';
import { PictureShow } from './PictureShow';
import styles from './Pictures.module.css';

const WHICH = ['all', 'photos', 'camera'] as const;
type Which = (typeof WHICH)[number];

/** A camera's picture stays the camera's when somebody makes a diary line of it; a photo is what a phone took. */
const shownBy: Record<Which, (picture: GrowPicture) => boolean> = {
  all: () => true,
  photos: picture => picture.cameraId === null,
  camera: picture => picture.cameraId !== null,
};

const whichOf = (asked: string | null): Which => WHICH.find(one => one === asked) ?? 'all';

/**
 * The pictures of a grow: the newest week film on top, then week by week the
 * camera's picture of each day and what was written into the diary, each
 * named by its day or as somebody's own. They are the diary's days read for
 * their pictures, so the weeks before arrive the way the diary's do.
 */
export function Pictures({ grow, now }: { grow: GrowListItem; now: DateTime }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { openDetails } = useLog();
  const diary = useGrowDiary(grow.id);
  const cameras = useCamerasShape();
  // Which pictures are shown is part of the address, so a reload and a link keep it.
  const [params, setParams] = useSearchParams();
  const asked = whichOf(params.get('show'));
  const [viewing, setViewing] = useState<GrowPicture | null>(null);
  const mayLog = enough(useMayWith()(growStanding(grow)), 'log') && grow.endedAt === null;

  if (diary.isPending) return <Waiting lines={4} />;
  if (!diary.data) return <LoadFailed retry={() => void diary.refetch()} />;

  const weeks = itemsOf(diary.data);
  const film = weeks.find(hasFilm) ?? null;
  const all = weeks.flatMap(week => week.days).flatMap(picturesOfDay);
  // "Kamera" is a choice only where a camera watches the grow or once did.
  const watched =
    all.some(shownBy.camera) ||
    (cameras.data?.items ?? []).some(camera => grow.summary.locations.some(location => location.spaceId === camera.spaceId));
  const offered = WHICH.filter(one => one !== 'camera' || watched);
  const which = offered.includes(asked) ? asked : 'all';
  const byWeek = weeks
    .map(week => ({ week, pictures: week.days.flatMap(picturesOfDay).filter(shownBy[which]) }))
    .filter(row => row.pictures.length > 0);
  const pictures = byWeek.flatMap(row => row.pictures);
  // The newest week of a grow still running is the one it is in: "this week, from day 29".
  const running = grow.endedAt === null ? (weeks[0]?.weekNumber ?? null) : null;
  const heading = (week: GrowDiaryWeek): string =>
    week.weekNumber === running
      ? t('grow.pictures.thisWeek', { day: week.dayFrom })
      : [stageOfWeek(t, week), t('grow.diary.days', { from: week.dayFrom, to: week.dayTo })].filter(Boolean).join(' · ');

  return (
    <div className={styles.pictures}>
      <RefreshFailed failedAt={diary.isError ? diary.dataUpdatedAt : null} now={now} />
      <div className={styles.which} role="group" aria-label={t('grow.pictures.whichLabel')}>
        {offered.map(one => (
          <button
            key={one}
            type="button"
            aria-pressed={which === one}
            onClick={() => setParams(one === 'all' ? {} : { show: one }, { replace: true })}
          >
            {t(`grow.pictures.which.${one}`)}
          </button>
        ))}
      </div>

      {film && which !== 'photos' && byWeek.length > 0 ? <FilmCard week={film} picture={mediaUrl} /> : null}

      {/* Weeks without a picture are not the whole grow without one, while earlier weeks are still to be asked for. */}
      {byWeek.length === 0 ? (
        <p className={`${ui.cardDashed} ${ui.note}`}>{t(diary.hasNextPage ? 'grow.pictures.noneInWeeks' : `grow.pictures.none.${which}`)}</p>
      ) : null}
      {byWeek.map(({ week, pictures: inWeek }) => (
        <section key={week.weekNumber} className={styles.week} aria-labelledby={`grow-pictures-${week.weekNumber}`}>
          <h2 id={`grow-pictures-${week.weekNumber}`}>{heading(week)}</h2>
          <ul className={styles.grid}>
            {inWeek.map(picture => (
              <li key={picture.mediaId}>
                <button type="button" onClick={() => setViewing(picture)}>
                  <img
                    src={mediaUrl(picture.mediaId, THUMBNAIL_WIDTH.still) ?? ''}
                    alt={t(picture.entry ? 'grow.diary.photoAlt' : 'grow.diary.stillAlt', { day: picture.dayNumber })}
                    loading="lazy"
                  />
                  <span className={styles.badge}>
                    {picture.cameraId === null ? sourceOf(t, picture, user?.id ?? null) : t('home.card.dayN', { day: picture.dayNumber })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {diary.hasNextPage ? (
        <button type="button" className={ui.button} disabled={diary.isFetchingNextPage} onClick={() => void diary.fetchNextPage()}>
          {diary.isFetchingNextPage ? t('home.waiting') : t('grow.earlierWeeks')}
        </button>
      ) : null}

      {mayLog ? (
        <button
          type="button"
          className={styles.add}
          onClick={() =>
            openDetails('photo', {
              key: `grow:${grow.id}`,
              label: grow.name,
              growId: grow.id,
              spaceId: null,
              plantIds: [],
              dayNumber: grow.summary.dayNumber,
              standsIn: standsIn(grow),
            })
          }
        >
          + {t('grow.pictures.add')}
        </button>
      ) : null}

      {viewing ? <PictureShow grow={grow} pictures={pictures} opened={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}
