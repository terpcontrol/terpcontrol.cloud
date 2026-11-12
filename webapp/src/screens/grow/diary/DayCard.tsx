import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Entry, GrowDiaryDay, Person } from '@fg2/shared-types/v1';
import { THUMBNAIL_WIDTH } from '@/api/session';
import { warningOf } from '@/ui/entries';
import { EntryWords } from '@/ui/EntryRow';
import { Facts } from '@/ui/Facts';
import { Term } from '@/ui/Help';
import { sinceLabel } from '@/ui/age';
import { Line, Lines } from '@/ui/Lines';
import { useKept } from '@/ui/kept';
import ui from '@/ui/ui.module.css';
import { clock } from '@/ui/zone';
import { climateLine, dayLines, dayTitle, headPicture, picturesOfLine, shareOf, shownLines, type DiaryReader, type GrowPicture } from './days';
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
 * opens them, and a stretch outside the targets leads to the curve of that
 * moment - for a reader the diary gives those ways to (`reader`).
 */
export function DayCard({
  day,
  reader,
  people,
  today,
  now,
  live,
  explain = false,
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
  const alt = picture ? t(picture.entry ? 'grow.diary.photoAlt' : 'grow.diary.stillAlt', { day: day.dayNumber }) : '';
  const byItself = t('grow.diary.byItself');

  return (
    <article className={styles.day} aria-label={title}>
      {picture && src ? (
        live && picture.cameraId && picture.entry === null && reader.cameras ? (
          <Link to={`/cameras/${picture.cameraId}`} className={styles.dayPicture}>
            <img src={src} alt={alt} loading="lazy" />
            <span className={ui.visuallyHidden}>{`, ${t('grow.diary.openCamera')}`}</span>
          </Link>
        ) : (
          <button type="button" className={styles.dayPicture} onClick={() => onPicture(picture)}>
            <img src={src} alt={alt} loading="lazy" />
            <span className={ui.visuallyHidden}>{`, ${t('grow.diary.openPicture')}`}</span>
          </button>
        )
      ) : null}
      <div className={styles.dayHead}>
        <h2 className={styles.dayTitle}>{title}</h2>
        {climate ? <span className={styles.dayClimate}>{climate}</span> : null}
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
              const mark = line.own ? null : byItself;
              const stamp = clock(line.at, zone);
              const { what } = line;
              if (what.kind === 'said') {
                return (
                  <Line key={line.key} stamp={stamp} mark={mark} to={what.metric ? reader.curveOf(what.metric, line.at) : null}>
                    {what.words}
                  </Line>
                );
              }
              if (what.kind === 'alarm') {
                return (
                  <Line key={line.key} stamp={stamp} mark={mark} severity={what.over ? null : warningOf(what.entry)}>
                    <span className={ui.visuallyHidden}>{`${t('home.entryKind.alarm')}: `}</span>
                    <Facts
                      facts={[
                        what.rule,
                        what.count > 1 ? t('home.entryRepeats', { count: what.count, since: sinceLabel(what.since, now, zone) }) : null,
                        what.over ? t('grow.diary.alarmOver') : null,
                      ]}
                    />
                    {what.limit ? <small>{what.limit}</small> : null}
                  </Line>
                );
              }

              const { entry } = what;
              const pictures = picturesOfLine(day, entry);
              const correct = reader.correct(entry, day.dayNumber);
              return (
                <Line
                  key={line.key}
                  stamp={stamp}
                  mark={mark}
                  severity={warningOf(entry)}
                  onOpen={correct ?? (pictures[0] ? () => onPicture(pictures[0]) : null)}
                  opens={correct ? undefined : t('grow.diary.openPicture')}
                >
                  <span className={ui.visuallyHidden}>{`${t(`home.entryKind.${entry.kind}`)}: `}</span>
                  <EntryWords
                    entry={entry}
                    people={people}
                    measurements={reader.readingNames}
                    now={now}
                    zone={zone}
                    byline={reader.byline}
                    repeats={what}
                    brief
                  />
                  {pictureCount(entry, t)}
                </Line>
              );
            })}
          </Lines>
          {lines.length > shown.length ? (
            <button type="button" className={styles.more} onClick={() => setAll(true)}>
              {t('grow.moreEntries', { count: lines.length - shown.length })}
            </button>
          ) : null}
        </div>
      ) : live ? (
        <p className={styles.nothing}>{t('grow.diary.nothingYet')}</p>
      ) : null}
    </article>
  );
}

/** "· 2 Bilder" behind a line that carries pictures. */
const pictureCount = (entry: Entry, t: ReturnType<typeof useTranslation>['t']): string | null =>
  entry.mediaIds.length > 0 ? ` · ${t('start.latest.pictures', { count: entry.mediaIds.length })}` : null;
