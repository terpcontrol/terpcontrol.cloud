import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowDiaryDay, Person } from '@fg2/shared-types/v1';
import { THUMBNAIL_WIDTH } from '@/api/session';
import { Facts } from '@/ui/Facts';
import { Term } from '@/ui/Help';
import { Lines } from '@/ui/Lines';
import { useKept } from '@/ui/kept';
import ui from '@/ui/ui.module.css';
import { clock } from '@/ui/zone';
import {
  alarmsIn,
  climateLine,
  dayLines,
  dayTitle,
  headPicture,
  picturesOfLine,
  shareOf,
  shownLines,
  type DiaryReader,
  type GrowPicture,
} from './days';
import { DiaryLine } from './DiaryLine';
import styles from './Diary.module.css';

/**
 * One day of the diary, which writes itself: the camera's picture of the day,
 * how the climate was and how much of the day it stood inside its targets,
 * then what happened - what somebody did, and what the devices did by
 * themselves, marked as that.
 *
 * A day nobody photographed has no picture and no frame for one: its words
 * take the card's width. A share is drawn only where the server states one.
 * A line somebody may correct opens its sheet, one that carries pictures
 * opens them from their count - or shows them, to a reader from outside -
 * and a stretch outside the targets leads to the curve of that moment, for a
 * reader the diary gives those ways to (`reader`). What a card folds away it
 * counts, and says how much of it was an alarm.
 */
export function DayCard({
  day,
  reader,
  people,
  today,
  now,
  live,
  explain = false,
  into,
  onPicture,
}: {
  day: GrowDiaryDay;
  reader: DiaryReader;
  people: Person[];
  /** Today's date on the grow's calendar, which decides what "Heute" is; null where the diary has no today. */
  today: string | null;
  now: DateTime;
  /** Whether this is the day still running: its picture is the place's newest, and leads to the camera. */
  live: boolean;
  /** The first card that states a share, which says once for all of them what "on target" counts as. */
  explain?: boolean;
  /** Handed the card of the day a link named, which is brought into view. */
  into?: (card: HTMLElement | null) => void;
  onPicture: (picture: GrowPicture) => void;
}) {
  const { t, i18n } = useTranslation();
  const { zone } = reader;
  const [all, setAll] = useKept(`day-${day.date}`, false);
  const title = dayTitle(t, day, today);
  const picture = headPicture(day);
  const src = picture ? reader.picture(picture.mediaId, THUMBNAIL_WIDTH.still) : null;
  const climate = climateLine(day);
  const share = shareOf(day);
  const lines = dayLines(t, i18n, day, zone);
  const shown = all ? lines : shownLines(lines);
  const folded = lines.filter(line => !shown.includes(line));
  const alt = picture ? t(picture.entry ? 'grow.diary.photoAlt' : 'grow.diary.stillAlt', { day: day.dayNumber }) : '';

  return (
    <article className={styles.day} aria-label={title} ref={into}>
      {picture && src ? (
        live && picture.cameraId && picture.entry === null && reader.cameras ? (
          <Link to={`/cameras/${picture.cameraId}`} className={styles.dayPicture}>
            <img className={ui.cover} src={src} alt={alt} loading="lazy" />
            <span className={ui.visuallyHidden}>{`, ${t('grow.diary.openCamera')}`}</span>
          </Link>
        ) : (
          <button type="button" className={styles.dayPicture} onClick={() => onPicture(picture)}>
            <img className={ui.cover} src={src} alt={alt} loading="lazy" />
            <span className={ui.visuallyHidden}>{`, ${t('grow.diary.openPicture')}`}</span>
          </button>
        )
      ) : null}
      <div className={styles.dayHead}>
        <h2 className={styles.dayTitle}>{title}</h2>
        {climate ? <DayClimate to={reader.curvesOf(day)}>{climate}</DayClimate> : null}
        {share ? (
          <span className={styles.dayShare} data-good={share.good || undefined}>
            <span className={styles.shareLong}>
              {explain ? (
                <Term topic="dayShare">{t('grow.diary.inTarget', { percent: share.percent })}</Term>
              ) : (
                t('grow.diary.inTarget', { percent: share.percent })
              )}
            </span>
            {/* One of the two is drawn: the whole sentence under a phone's title, the short one beside a desktop's. */}
            <span className={styles.shareShort}>{t('grow.diary.inTargetShort', { percent: share.percent })}</span>
          </span>
        ) : null}
      </div>
      {lines.length > 0 ? (
        <div className={styles.dayLines}>
          <Lines>
            {shown.map(line => {
              const entry = line.what.kind === 'entry' ? line.what.entry : null;
              // The pictures this reader is given: a link narrowed to a window refuses the ones outside it, one by one.
              const pictures = (entry ? picturesOfLine(day, entry) : []).filter(one => reader.picture(one.mediaId) !== null);
              return (
                <DiaryLine
                  key={line.key}
                  line={line}
                  stamp={clock(line.at, zone)}
                  zone={zone}
                  now={now}
                  people={people}
                  measurements={reader.readingNames}
                  byline={reader.byline}
                  to={line.what.kind === 'said' && (line.what.metric || line.what.moment) ? reader.curveOf(line.what.metric, line.at) : null}
                  onOpen={entry ? reader.correct(entry, day.dayNumber) : null}
                  plants={reader.plants}
                  onPictures={pictures.length > 0 ? index => onPicture(pictures[index]) : null}
                  thumbnails={reader.thumbnails ? pictures.map(one => reader.picture(one.mediaId, THUMBNAIL_WIDTH.still) ?? '') : undefined}
                />
              );
            })}
          </Lines>
          {folded.length > 0 ? (
            <button type="button" className={styles.more} onClick={() => setAll(true)}>
              <Facts
                facts={[
                  t('grow.moreEntries', { count: folded.length }),
                  alarmsIn(folded) > 0 ? t('grow.diary.alarmsAmong', { count: alarmsIn(folded) }) : null,
                ]}
              />
            </button>
          ) : null}
        </div>
      ) : live ? (
        <p className={styles.nothing}>{t('grow.diary.nothingYet')}</p>
      ) : null}
    </article>
  );
}

/** The day's climate in a line, which leads to that day's curves where the reader has them. */
function DayClimate({ to, children }: { to: string | null; children: string }) {
  const { t } = useTranslation();

  return to ? (
    <Link to={to} className={styles.dayClimate}>
      {children}
      <span aria-hidden>{'\u00a0›'}</span>
      <span className={ui.visuallyHidden}>{`, ${t('grow.diary.openCurves')}`}</span>
    </Link>
  ) : (
    <span className={styles.dayClimate}>{children}</span>
  );
}
