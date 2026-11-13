import { ChevronRight } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { Entry, GrowDiaryDay, GrowDiaryWeek, GrowListItem, Person } from '@fg2/shared-types/v1';
import { useGrowDiary } from '@/api/grows';
import { itemsOf } from '@/api/pages';
import { THUMBNAIL_WIDTH, mediaUrl, useSession } from '@/api/session';
import { timelinePath } from '@/app/places';
import { useCorrecting } from '@/log/corrections';
import { EntryWords } from '@/ui/EntryWords';
import { Facts } from '@/ui/Facts';
import { MINUTE_MS } from '@/ui/days';
import { useKept, useKeptScroll } from '@/ui/kept';
import { Line, Lines } from '@/ui/Lines';
import { LoadFailed, NothingHere, RefreshFailed, Waiting } from '@/ui/PageState';
import { growStanding } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { DATED_CLOCK, useZone, zoned } from '@/ui/zone';
import { PictureShow } from '../pictures/PictureShow';
import { dayWindow } from '@/screens/timeline/view';
import { DayCard } from './DayCard';
import { OPEN_DAYS, hasFilm, hasSomething, picturesOfDay, placeAt, stageOfWeek, writtenIn, type DiaryReader, type GrowPicture } from './days';
import { FilmCard } from './Film';
import { dayNamed, useReadBackTo } from './read-back';
import styles from './Diary.module.css';

/** How many of the newest pictures a desktop draws beside the days. */
const RECENT_PICTURES = 6;

/**
 * A grow's diary on its own page: the days, read a few weeks at a time, and on
 * a desktop the newest pictures and the week's film beside them. The earlier
 * weeks arrive when asked for, because each costs the server a read of its
 * time series.
 *
 * Coming back from what a line opened finds the page as it was left: the weeks
 * opened, the pages loaded and how far it was scrolled. A link that names a
 * day (`?day=`, the camera's "Im Tagebuch zeigen") opens the diary on it.
 */
export function Diary({ grow, now, picturesTo }: { grow: GrowListItem; now: DateTime; picturesTo: string }) {
  const { t } = useTranslation();
  const zone = useZone();
  const diary = useGrowDiary(grow.id);
  const { user } = useSession();
  const correcting = useCorrecting();
  const [viewing, setViewing] = useState<GrowPicture | null>(null);
  const named = dayNamed(useSearchParams()[0]);
  useReadBackTo(diary, named);
  useKeptScroll(diary.data !== undefined);

  if (diary.isPending) {
    return (
      <div className={`${ui.stack3} ${styles.days}`}>
        <Waiting lines={4} />
        <Waiting lines={3} />
      </div>
    );
  }
  if (!diary.data) return <LoadFailed retry={() => void diary.refetch()} />;

  const weeks = itemsOf(diary.data);
  const reader: DiaryReader = {
    zone,
    readingNames: grow.measurements,
    picture: mediaUrl,
    cameras: true,
    // The demo is answered no authors, so its lines say what was done and name nobody.
    byline: user?.isDemo !== true,
    correct: (entry, dayNumber) => correcting(entry, { label: grow.name, dayNumber, ...growStanding(grow) }),
    curveOf: (metric, at) => {
      const spaceId = placeAt(grow, at);
      return spaceId ? timelinePath(spaceId, metric, at, grow.id) : null;
    },
    curvesOf: day => {
      const spaceId = placeAt(grow, day.startsAt);
      // A day that is over is that day as the diary cut it; the one still running is named to its own midnight,
      // which Verlauf shows up to now and follows - not up to the minute this diary was read.
      const over = Date.parse(day.endsAt) < now.toMillis() - MINUTE_MS;
      const named = over ? { from: day.startsAt, to: day.endsAt } : dayWindow(Date.parse(day.startsAt), grow.summary.zone);
      return spaceId ? timelinePath(spaceId, null, null, grow.id, named) : null;
    },
  };
  const pictures = weeks.flatMap(week => week.days).flatMap(picturesOfDay);
  const film = weeks.find(hasFilm) ?? null;

  return (
    <div className={`${ui.stack3} ${styles.diary}`}>
      <div className={`${ui.stack3} ${styles.days}`}>
        <RefreshFailed failedAt={diary.isError ? diary.dataUpdatedAt : null} now={now} />
        <Days
          weeks={weeks}
          earlier={diary.data.pages.at(-1)?.earlier ?? []}
          people={diary.data.pages.flatMap(page => page.people)}
          reader={reader}
          now={now}
          named={named}
          running={grow.endedAt === null}
          more={diary.hasNextPage ? { load: () => void diary.fetchNextPage(), pending: diary.isFetchingNextPage } : null}
          onPicture={setViewing}
        />
      </div>

      {pictures.length > 0 || film ? (
        <aside className={styles.aside}>
          {pictures.length > 0 ? (
            <section className={ui.panel} aria-labelledby="grow-recent-pictures">
              <div className={styles.recentHead}>
                <h2 id="grow-recent-pictures" className={ui.cardHeading}>
                  {t('grow.diary.recentPictures')}
                </h2>
                <Link to={picturesTo} replace>
                  {t('grow.diary.allPictures')}
                  {'\u00a0›'}
                </Link>
              </div>
              <div className={styles.recentGrid}>
                {pictures.slice(0, RECENT_PICTURES).map(picture => (
                  <button key={picture.mediaId} type="button" onClick={() => setViewing(picture)}>
                    <img
                      className={ui.cover}
                      src={mediaUrl(picture.mediaId, THUMBNAIL_WIDTH.still) ?? ''}
                      alt={t(picture.entry ? 'grow.diary.photoAlt' : 'grow.diary.stillAlt', { day: picture.dayNumber })}
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {film ? <FilmCard week={film} picture={mediaUrl} /> : null}
        </aside>
      ) : null}

      {viewing ? <PictureShow grow={grow} pictures={pictures} opened={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}

/**
 * The days of a diary, whoever reads it: a card for each of the newest days,
 * and under them the days before, folded into their weeks - a row that says
 * what the week holds and opens its days.
 *
 * The day still running always stands, so a grower who has not written
 * anything yet sees where the day will be written. A day of the past with
 * nothing to show - no picture, no climate, no line - is left out rather than
 * drawn empty. What was written for a moment before the grow began has no day,
 * and stands after the last of them.
 */
export function Days({
  weeks,
  earlier = [],
  people = [],
  reader,
  now,
  named = null,
  running,
  more,
  onPicture,
}: {
  weeks: GrowDiaryWeek[];
  earlier?: Entry[];
  people?: Person[];
  reader: DiaryReader;
  now: DateTime;
  /** The day a link named: its week stands open and its card is brought into view. */
  named?: number | null;
  /** Whether the newest day is today - the grow runs and the reader's window is open - or the last one there is to read. */
  running: boolean;
  /** The weeks before these, where there are any to ask for. */
  more: { load: () => void; pending: boolean } | null;
  onPicture: (picture: GrowPicture) => void;
}) {
  const { t } = useTranslation();
  // Today is the date the grow's own calendar is on, which is its owner's and not always the reader's.
  const today = running ? (weeks[0]?.days[0]?.date ?? null) : null;
  const live = (day: GrowDiaryDay) => day.date === today;
  const days = weeks.flatMap(week => week.days).filter(day => live(day) || hasSomething(day));
  const open = days.slice(0, OPEN_DAYS);
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
  // Brought into view once per history entry: coming back to the page finds it where it was scrolled to.
  const [arrived, setArrived] = useKept('arrived', false);
  const arrive = (card: HTMLElement | null) => {
    if (!card || arrived) return;
    card.scrollIntoView?.({ block: 'start' });
    setArrived(true);
  };
  const card = (day: GrowDiaryDay) => (
    <DayCard
      key={day.date}
      day={day}
      reader={reader}
      people={people}
      today={today}
      now={now}
      live={live(day)}
      explain={day === teacher}
      into={day.dayNumber === named ? arrive : undefined}
      onPicture={onPicture}
    />
  );

  return (
    <>
      {days.length === 0 && earlier.length === 0 ? <NothingHere>{t('grow.diary.empty')}</NothingHere> : null}
      {open.map(card)}
      {folded.map(({ week, covered, days: inWeek }) => (
        <WeekRow
          key={week.weekNumber}
          week={week}
          days={inWeek}
          from={covered[0].dayNumber}
          to={covered[covered.length - 1].dayNumber}
          picture={reader.picture}
          opened={inWeek.some(day => day.dayNumber === named)}
        >
          {inWeek.map(card)}
        </WeekRow>
      ))}
      {more ? (
        <button type="button" className={ui.button} disabled={more.pending} onClick={more.load}>
          {more.pending ? t('home.waiting') : t('grow.earlierWeeks')}
        </button>
      ) : null}
      {earlier.length > 0 ? (
        <article className={styles.day} aria-label={t('grow.diary.earlier')}>
          <div className={styles.dayHead}>
            <h2 className={styles.dayTitle}>{t('grow.diary.earlier')}</h2>
          </div>
          <div className={styles.dayLines}>
            <Lines>
              {earlier.map(entry => (
                <Line key={entry.id} stamp={zoned(entry.occurredAt, reader.zone).toFormat(DATED_CLOCK)} onOpen={reader.correct(entry, null)}>
                  <EntryWords
                    entry={entry}
                    people={people}
                    measurements={reader.readingNames}
                    now={now}
                    zone={reader.zone}
                    byline={reader.byline}
                    brief
                  />
                </Line>
              ))}
            </Lines>
          </div>
        </article>
      ) : null}
    </>
  );
}

/**
 * The days of a week that are not open as cards, as one row: which days,
 * which stage, and what they hold - pictures, lines somebody wrote, a film.
 * A tap opens the days under it.
 */
function WeekRow({
  week,
  days,
  from,
  to,
  picture,
  opened,
  children,
}: {
  week: GrowDiaryWeek;
  days: GrowDiaryDay[];
  from: number;
  to: number;
  picture: DiaryReader['picture'];
  /** Whether it stands open before anybody opened it: it holds the day a link named. */
  opened: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useKept(`week-${week.weekNumber}`, opened);
  const pictures = days.reduce((sum, day) => sum + picturesOfDay(day).length, 0);
  const written = writtenIn(days);
  const holds = [
    pictures > 0 ? t('start.latest.pictures', { count: pictures }) : null,
    written > 0 ? t('grow.diary.written', { count: written }) : null,
    week.film ? t('grow.diary.weekFilm') : null,
  ].filter(Boolean);

  return (
    <section className={`${ui.stack3} ${styles.week}`}>
      <button type="button" className={ui.rowCard} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={styles.rowText}>
          <Facts facts={[from === to ? t('home.card.dayN', { day: from }) : t('grow.diary.days', { from, to }), stageOfWeek(t, week)]} />
          {holds.length > 0 ? <Facts facts={holds} className={styles.rowLine} /> : null}
        </span>
        <ChevronRight size={20} strokeWidth={2} className={styles.chevron} data-open={open || undefined} aria-hidden />
      </button>
      {open ? (
        <>
          {hasFilm(week) ? <FilmCard week={week} picture={picture} /> : null}
          {children}
        </>
      ) : null}
    </section>
  );
}
