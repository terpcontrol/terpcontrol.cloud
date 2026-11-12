import { ChevronRight } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowDiaryDay, GrowDiaryWeek, GrowListItem } from '@fg2/shared-types/v1';
import { useGrowDiary } from '@/api/grows';
import { itemsOf } from '@/api/pages';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import { dayOf } from '@/ui/days';
import { LoadFailed, RefreshFailed, Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import { PictureShow } from '../pictures/PictureShow';
import { DayCard } from './DayCard';
import { OPEN_DAYS, hasFilm, hasSomething, picturesOfDay, stageOfWeek, writtenIn, type GrowPicture } from './days';
import { FilmCard } from './Film';
import styles from './Diary.module.css';

/** How many of the newest pictures a desktop draws beside the days. */
const RECENT_PICTURES = 6;

/**
 * The diary: a card for each of the newest days, and under them the days
 * before, folded into their weeks - a row that says what the week holds and
 * opens its days. A few weeks are read at a time; the earlier ones arrive
 * when asked for, because each costs the server a read of its time series.
 *
 * Today's card always stands, so a grower who has not written anything yet
 * sees where the day will be written. A day of the past with nothing to show
 * - no picture, no climate, no line - is left out rather than drawn empty.
 * On a desktop the newest pictures and the week's film stand beside the days.
 */
export function Diary({ grow, now, picturesTo }: { grow: GrowListItem; now: DateTime; picturesTo: string }) {
  const { t } = useTranslation();
  const zone = useZone();
  const diary = useGrowDiary(grow.id);
  const [viewing, setViewing] = useState<GrowPicture | null>(null);

  if (diary.isPending) {
    return (
      <div className={styles.days}>
        <Waiting lines={4} />
        <Waiting lines={3} />
      </div>
    );
  }
  if (!diary.data) return <LoadFailed retry={() => void diary.refetch()} />;

  const weeks = itemsOf(diary.data);
  const people = diary.data.pages.flatMap(page => page.people);
  const today = dayOf(now.toJSDate(), zone);
  const live = (day: GrowDiaryDay) => grow.endedAt === null && day.date === today;
  const days = weeks.flatMap(week => week.days).filter(day => live(day) || hasSomething(day));
  const open = days.slice(0, OPEN_DAYS);
  const pictures = days.flatMap(picturesOfDay);
  const film = weeks.find(hasFilm) ?? null;
  // The days before the open cards, week by week: a row is named by the days it covers and opens the ones that hold something.
  const oldestOpen = open.at(-1)?.dayNumber ?? Infinity;
  const folded = weeks
    .map(week => {
      const covered = week.days.filter(day => day.dayNumber < oldestOpen);
      return { week, covered, days: covered.filter(day => days.includes(day)) };
    })
    .filter(row => row.days.length > 0);
  // What "on target" counts as is explained once, on the newest day that states a share.
  const teacher = days.find(day => day.climate?.inBandFraction != null) ?? null;
  const card = (day: GrowDiaryDay) => (
    <DayCard
      key={day.date}
      day={day}
      grow={grow}
      people={people}
      today={today}
      now={now}
      live={live(day)}
      explain={day === teacher}
      onPicture={setViewing}
    />
  );

  return (
    <div className={styles.diary}>
      <div className={styles.days}>
        <RefreshFailed failedAt={diary.isError ? diary.dataUpdatedAt : null} now={now} />
        {days.length === 0 ? <p className={`${ui.cardDashed} ${ui.note}`}>{t('grow.diary.empty')}</p> : null}
        {open.map(card)}
        {folded.map(({ week, covered, days: inWeek }) => (
          <WeekRow key={week.weekNumber} week={week} days={inWeek} from={covered[0].dayNumber} to={covered[covered.length - 1].dayNumber}>
            {inWeek.map(card)}
          </WeekRow>
        ))}
        {diary.hasNextPage ? (
          <button type="button" className={ui.button} disabled={diary.isFetchingNextPage} onClick={() => void diary.fetchNextPage()}>
            {diary.isFetchingNextPage ? t('home.waiting') : t('grow.earlierWeeks')}
          </button>
        ) : null}
      </div>

      {pictures.length > 0 || film ? (
        <aside className={styles.aside}>
          {pictures.length > 0 ? (
            <section className={styles.recent} aria-labelledby="grow-recent-pictures">
              <div className={styles.recentHead}>
                <h2 id="grow-recent-pictures">{t('grow.diary.recentPictures')}</h2>
                <Link to={picturesTo} replace>
                  {t('grow.diary.allPictures')} ›
                </Link>
              </div>
              <div className={styles.recentGrid}>
                {pictures.slice(0, RECENT_PICTURES).map(picture => (
                  <button key={picture.mediaId} type="button" onClick={() => setViewing(picture)}>
                    <img
                      src={mediaUrl(picture.mediaId, THUMBNAIL_WIDTH.still) ?? ''}
                      alt={t(picture.entry ? 'grow.diary.photoAlt' : 'grow.diary.stillAlt', { day: picture.dayNumber })}
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {film ? <FilmCard week={film} /> : null}
        </aside>
      ) : null}

      {viewing ? <PictureShow grow={grow} pictures={pictures} opened={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}

/**
 * The days of a week that are not open as cards, as one row: which days,
 * which stage, and what they hold - pictures, lines somebody wrote, a film.
 * A tap opens the days under it.
 */
function WeekRow({ week, days, from, to, children }: { week: GrowDiaryWeek; days: GrowDiaryDay[]; from: number; to: number; children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pictures = days.reduce((sum, day) => sum + picturesOfDay(day).length, 0);
  const written = writtenIn(days);
  const holds = [
    pictures > 0 ? t('start.latest.pictures', { count: pictures }) : null,
    written > 0 ? t('grow.diary.written', { count: written }) : null,
    week.film ? t('grow.diary.weekFilm') : null,
  ].filter(Boolean);

  return (
    <section className={styles.week}>
      <button type="button" className={styles.row} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={styles.rowText}>
          {[from === to ? t('home.card.dayN', { day: from }) : t('grow.diary.days', { from, to }), stageOfWeek(t, week)].filter(Boolean).join(' · ')}
          {holds.length > 0 ? <span className={styles.rowLine}>{holds.join(' · ')}</span> : null}
        </span>
        <ChevronRight size={20} strokeWidth={2} className={styles.chevron} data-open={open || undefined} aria-hidden />
      </button>
      {open ? (
        <>
          {hasFilm(week) ? <FilmCard week={week} /> : null}
          {children}
        </>
      ) : null}
    </section>
  );
}
