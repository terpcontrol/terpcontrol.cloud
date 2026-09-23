import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Entry, Person, ReadingName } from '@fg2/shared-types/v1';
import { mediaUrl, THUMBNAIL_WIDTH, useSession } from '@/api/session';
import { entryDetail } from '@/i18n/device-message';
import { authorOf, headlineOf, KIND_ICON, readingFigure } from './entries';
import { nowThere, useZone, zoned } from './zone';
import { Photo } from './Photo';
import { PictureViewer } from './PictureViewer';
import styles from './EntryRow.module.css';

/**
 * How a surface addresses a picture. A signed-in screen reaches the bytes with
 * the session's media token; a public page and a share link are served the same
 * pictures at addresses of their own, so the surface hands its own way in rather
 * than the row assuming a session it has not got. `Picture` from the public API
 * fits this shape.
 */
export type EntryPicture = (mediaId: string, width?: number) => string | null;

/**
 * How many pictures a line draws before it says how many more it carries. One
 * migrated phase line holds seventeen, which would otherwise be the whole card
 * the line was meant to be one row of.
 *
 * It is how many are drawn, not how many can be looked at: the thumbnails and
 * the "+13" beside them open a viewer over every picture the line carries, so
 * the cap is a decision about the height of a row and not about which of a
 * grower's pictures they are allowed to see again.
 */
const THUMBNAILS_PER_ROW = 4;

/**
 * How old a line has to be before its stamp names the date.
 *
 * A bare weekday is a name for the last six days and a lie afterwards, because
 * it comes round again: a line nine days old read "Mon", which a reader takes
 * for the day before yesterday, and one seven days old read "Wed", which is
 * today. Six calendar days back is the last day whose weekday is still its own.
 */
const WEEKDAY_DAYS = 6;

/**
 * The format a line's own age earns it: the hour for today, the weekday while
 * that weekday means one day, the date beyond it and the year beyond that. A
 * list of latest lines has no lower bound on age - a tent nobody has touched
 * since spring still shows its last eight - so the stamp says how far back the
 * reader is looking rather than leaving them to assume it is this week.
 *
 * Both instants have to be in the same zone before they are compared: Luxon
 * reads `hasSame` in the zone of the argument, and the day a line falls on is
 * the account's day. A line written just after midnight where the account is
 * otherwise kept its stamp on the browser's calendar and came out under
 * yesterday's weekday.
 */
const stampOf = (at: DateTime, now: DateTime): string => {
  if (at.hasSame(now, 'day')) return 'HH:mm';
  if (now.startOf('day').diff(at.startOf('day'), 'days').days < WEEKDAY_DAYS) return 'ccc HH:mm';

  return at.hasSame(now, 'year') ? 'd MMM HH:mm' : 'd MMM yyyy HH:mm';
};

interface EntryRowProps {
  entry: Entry;
  people: Person[];
  /** The grow's own measurements, which is where a reading's name and unit are; without them a reading shows its key. */
  measurements?: readonly ReadingName[];
  /** Whether the stamp names the day as well as the hour; a week's rows need the day, today's do not. */
  withDay?: boolean;
  /**
   * The moment the list is read at, for rows that sit under no heading naming
   * the week they are of. A tent's latest lines and a mark opened on the rail
   * reach as far back as the tent has been quiet, so there the stamp follows how
   * old each line is instead - see `stampOf`.
   */
  now?: DateTime;
  /**
   * Whether a line says who wrote it. A public diary has one author, named once
   * at the top of the page, and the people an answer names are not part of what
   * a stranger is given - so there its lines carry no name rather than a guess.
   */
  byline?: boolean;
  /** Where this surface's pictures live; the session's own by default. */
  picture?: EntryPicture;
  /**
   * The zone the stamp is read in, for a surface that is not the account's:
   * null leaves it on the browser's, which is what a public diary and a share
   * link get, because the zone the diary was written in is not in what a
   * stranger is answered. Left out, the line is stamped where the account is,
   * which is what every signed-in screen wants and what the rest of the app
   * already does.
   */
  zone?: string | null;
}

/**
 * One line of a diary: when, what kind of thing, what it said, who said it and
 * what they photographed. It is the same row wherever a diary is shown, so a
 * week card and a tent's latest lines read alike.
 *
 * The pictures hang on the line rather than on a screen of their own: 653 of
 * them came over with the old diaries, and until a row drew them the only place
 * in the app that read an entry's `mediaIds` was a plant's page, which a
 * migrated grow has none of.
 */
export function EntryRow({
  entry,
  people,
  measurements = [],
  withDay = false,
  now,
  byline = true,
  picture = (mediaId, width) => mediaUrl(mediaId, width),
  zone: given,
}: EntryRowProps) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const own = useZone();
  const zone = given === undefined ? own : given;
  const Icon = KIND_ICON[entry.kind];
  const at = zoned(entry.occurredAt, zone);
  const readings = 'readings' in entry.values ? entry.values.readings : [];
  const detail = entryDetail(i18n, entry);
  const [opened, setOpened] = useState<number | null>(null);
  /**
   * The pictures of this line this surface may actually show. A share link
   * narrowed to a few days refuses the ones taken outside it, picture by
   * picture, and the strip leaves their frames out - so the viewer steps over
   * the same ones rather than opening on a frame that cannot be filled.
   */
  const shown = entry.mediaIds.filter(mediaId => picture(mediaId, THUMBNAIL_WIDTH.strip) !== null);
  const frames = shown.map(mediaId => picture(mediaId, THUMBNAIL_WIDTH.frame) ?? '');

  return (
    <li className={styles.row} data-severity={entry.severity ?? undefined}>
      <span className={`mono ${styles.stamp}`}>{at.toFormat(now ? stampOf(at, nowThere(now, zone)) : withDay ? 'ccc HH:mm' : 'HH:mm')}</span>
      <span className={styles.kind} aria-label={t(`home.entryKind.${entry.kind}`)}>
        <Icon size={13} strokeWidth={1.75} aria-hidden />
      </span>
      <span className={styles.text}>
        {/* A device, the plan or an alarm is named by its mark; a person by name. */}
        {byline && entry.source === 'human' ? <span className={styles.author}>{authorOf(t, entry, people, user?.id)} </span> : null}
        {/* A person writes in lines, so the breaks they typed are kept rather than collapsed into one run-on sentence. */}
        <span className={styles.headline}>{headlineOf(t, i18n, entry)}</span>
        {readings.length > 0 ? (
          <span className={`mono ${styles.readings}`}>
            {readings.map(reading => {
              const definition = measurements.find(one => one.key === reading.key);
              return (
                <span key={`${reading.key}-${reading.plantId ?? ''}`}>
                  {' · '}
                  {definition?.name ?? reading.key} {readingFigure(reading.value)}
                  {definition?.unit ? ` ${definition.unit}` : ''}
                </span>
              );
            })}
          </span>
        ) : null}
        {/* What the machine's line said, under the kind of thing it was: the
            reading an alarm tripped on, the settings a save changed, the reason
            a device rebooted. */}
        {detail === null ? null : <span className={styles.detail}>{detail}</span>}
        {entry.mediaIds.length > 0 ? (
          <span className={styles.photos}>
            {/* Numbered, because a screen reader meeting four pictures in a row
                has no other way to tell one from the next. */}
            {entry.mediaIds.slice(0, THUMBNAILS_PER_ROW).map((mediaId, index) => {
              const src = picture(mediaId, THUMBNAIL_WIDTH.strip);
              const alt = t('home.entryPhotos.alt', { n: index + 1, count: entry.mediaIds.length });
              // A picture this surface may not show keeps the frame it has
              // always had, which the strip hides: there is nothing to open.
              if (src === null) return <Photo key={mediaId} className={styles.photo} src={null} alt={alt} />;

              return (
                <button key={mediaId} type="button" className={styles.openPhoto} onClick={() => setOpened(shown.indexOf(mediaId))}>
                  <Photo className={styles.photo} src={src} alt={alt} />
                </button>
              );
            })}
            {/* The count is of everything the line carries; what it opens on is
                the first picture past the four the row had room for. */}
            {entry.mediaIds.length > THUMBNAILS_PER_ROW ? (
              <button
                type="button"
                className={`mono ${styles.morePhotos}`}
                onClick={() => setOpened(Math.min(THUMBNAILS_PER_ROW, Math.max(0, shown.length - 1)))}
              >
                {t('home.entryPhotos.more', { count: entry.mediaIds.length - THUMBNAILS_PER_ROW })}
              </button>
            ) : null}
          </span>
        ) : null}
      </span>
      {opened === null || shown.length === 0 ? null : <PictureViewer pictures={frames} from={opened} onClose={() => setOpened(null)} />}
    </li>
  );
}
