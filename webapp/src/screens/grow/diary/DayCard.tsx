import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GrowDiaryDay, GrowListItem, Person } from '@fg2/shared-types/v1';
import { timelinePath } from '@/app/places';
import { THUMBNAIL_WIDTH, mediaUrl, useSession } from '@/api/session';
import { useCorrecting } from '@/log/corrections';
import { EntryWords } from '@/ui/EntryRow';
import { Term } from '@/ui/Help';
import { Line, Lines } from '@/ui/Lines';
import { growStanding } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { clock, useZone } from '@/ui/zone';
import { LINES_SHOWN, climateLine, dayLines, dayTitle, headPicture, picturesOfLine, placeAt, shareOf, type GrowPicture } from './days';
import styles from './Diary.module.css';

/**
 * One day of the diary, which writes itself: the camera's picture of the day,
 * how the climate was and how much of the day it stood inside its targets,
 * then what happened - what somebody wrote, and what the devices did by
 * themselves, marked as that.
 *
 * A day nobody photographed has no picture and no frame for one: its words
 * take the card's width. A share is drawn only where the server states one.
 * A line somebody may correct opens its sheet, one that carries pictures
 * opens them, and a stretch outside the targets leads to the curve of that
 * moment.
 */
export function DayCard({
  day,
  grow,
  people,
  today,
  now,
  live,
  explain = false,
  onPicture,
}: {
  day: GrowDiaryDay;
  grow: GrowListItem;
  people: Person[];
  /** Today's date on the reader's calendar, which decides what "Heute" is. */
  today: string;
  now: DateTime;
  /** Whether this is the day still running: its picture is the place's newest, and leads to the camera. */
  live: boolean;
  /** The first card that states a share, which says once for all of them what "on target" counts as. */
  explain?: boolean;
  onPicture: (picture: GrowPicture) => void;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const { user } = useSession();
  const correcting = useCorrecting();
  const [all, setAll] = useState(false);
  const title = dayTitle(t, day, today);
  const picture = headPicture(day);
  const src = picture ? mediaUrl(picture.mediaId, THUMBNAIL_WIDTH.still) : null;
  const climate = climateLine(day);
  const share = shareOf(day);
  const lines = dayLines(t, day);
  const shown = all ? lines : lines.slice(0, LINES_SHOWN);
  const alt = picture ? t(picture.entry ? 'grow.diary.photoAlt' : 'grow.diary.stillAlt', { day: day.dayNumber }) : '';

  return (
    <article className={styles.day} aria-label={title}>
      {picture && src ? (
        live && picture.cameraId && picture.entry === null ? (
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
                <Term topic="band">{t('grow.diary.inTarget', { percent: share.percent })}</Term>
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
              const mark = line.byItself ? t('grow.diary.byItself') : null;
              const stamp = clock(line.at, zone);
              if ('event' in line) {
                const spaceId = line.metric ? placeAt(grow, line.at) : null;
                return (
                  <Line key={line.key} stamp={stamp} mark={mark} to={spaceId && line.metric ? timelinePath(spaceId, line.metric, line.at) : null}>
                    {line.words}
                  </Line>
                );
              }

              const { entry } = line;
              const pictures = picturesOfLine(day, entry);
              const correct = correcting(entry, { label: grow.name, dayNumber: day.dayNumber, ...growStanding(grow) });
              return (
                <Line
                  key={line.key}
                  stamp={stamp}
                  mark={mark}
                  // Amber is for what needs a person: an alarm raised, not a restart or a step of the plan.
                  severity={entry.kind === 'alarm' && entry.severity !== 'info' ? entry.severity : null}
                  onOpen={correct ?? (pictures[0] ? () => onPicture(pictures[0]) : null)}
                  opens={correct ? undefined : t('grow.diary.openPicture')}
                >
                  <span className={ui.visuallyHidden}>{`${t(`home.entryKind.${entry.kind}`)}: `}</span>
                  <EntryWords
                    entry={entry}
                    people={people}
                    measurements={grow.measurements}
                    now={now}
                    zone={zone}
                    // The demo is answered no authors, so its lines say what was done and name nobody.
                    byline={user?.isDemo !== true}
                    repeats={line}
                    brief
                  />
                  {entry.mediaIds.length > 0 ? ` · ${t('start.latest.pictures', { count: entry.mediaIds.length })}` : null}
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
