import type { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Entry, GrowDayEvent, GrowReadingNames, Person, PlantLabel } from '@fg2/shared-types/v1';
import { THUMBNAIL_WIDTH, mediaUrl } from '@/api/session';
import { GROW } from '@/app/places';
import { useCorrecting } from '@/log/corrections';
import { notTaken } from '@/screens/control/rows';
import { dayLines, onTheirDay } from '@/screens/grow/diary/days';
import { DiaryLine } from '@/screens/grow/diary/DiaryLine';
import { dayStamp } from '@/ui/age';
import { readingNamesOf } from '@/ui/entries';
import { Lines } from '@/ui/Lines';
import { PictureViewer } from '@/ui/PictureViewer';
import { useZone } from '@/ui/zone';
import styles from './Start.module.css';
import ui from '@/ui/ui.module.css';

/** How many of the newest lines Start names; the diary and Verlauf have the rest. */
const LATEST = 3;

/**
 * "Zuletzt": the tail of the diary - the newest lines as a day's card would
 * say them (`dayLines`), read by the same rules on the server: what a person
 * wrote, an alarm as its rule, a step of the plan, maintenance as one line.
 * A line somebody may correct opens its sheet, one that carries pictures
 * opens them from their count, and one about some of a grow's plants names
 * them. With a diary, the card leads to all of it.
 */
export function Latest({
  entries,
  events,
  people,
  readingNames = [],
  on,
  diary,
  byline = true,
  plants,
  now,
  offStored = null,
}: {
  entries: Entry[];
  events: GrowDayEvent[];
  people: Person[];
  readingNames?: GrowReadingNames[];
  /** What the lines were written about, for the sheet that corrects one. */
  on: { label: string; spaceId: string | null; ownerId?: string | null };
  diary: boolean;
  /** Whether a line names who wrote it, which the demo's do not. */
  byline?: boolean;
  /** The plants of the grows standing here, so a line about some of them names those. */
  plants: readonly PlantLabel[];
  now: DateTime;
  /** Since when a switch-off is stored that the silent device has not been handed: regulation off is then not said as fact. */
  offStored?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const zone = useZone();
  const correcting = useCorrecting();
  const stored = offStored ? notTaken(t, t('control.state.off'), offStored, now, zone) : null;
  const open = events.find(event => event.kind === 'controlOff' && event.endedAt === null);
  const lines = dayLines(t, i18n, { entries: onTheirDay(i18n, entries, zone), events, endsAt: now.toISO() ?? '' }, zone)
    .slice(0, LATEST)
    .map(line =>
      stored && open && line.key === `controlOff-${open.at}` ? { ...line, what: { kind: 'said' as const, words: stored, metric: null } } : line,
    );
  const [viewing, setViewing] = useState<{ pictures: string[]; from: number } | null>(null);
  // A place where nothing has happened yet has no card saying so: the page under it is short enough.
  if (lines.length === 0) return null;

  return (
    <section className={`${ui.panel} ${styles.card}`} aria-labelledby="start-latest">
      <h2 className={`${ui.cardHeading} ${styles.cardTitle}`} id="start-latest">
        {t('start.latest.title')}
      </h2>
      <Lines>
        {lines.map(line => {
          const entry = line.what.kind === 'entry' ? line.what.entry : null;
          return (
            <DiaryLine
              key={line.key}
              line={line}
              stamp={dayStamp(line.at, now, zone)}
              zone={zone}
              now={now}
              people={people}
              measurements={entry ? readingNamesOf(readingNames, entry.growId) : []}
              byline={byline}
              onOpen={entry ? correcting(entry, on) : null}
              plants={plants}
              onPictures={from =>
                setViewing({ pictures: (entry?.mediaIds ?? []).flatMap(mediaId => mediaUrl(mediaId, THUMBNAIL_WIDTH.frame) ?? []), from })
              }
            />
          );
        })}
      </Lines>
      {diary ? (
        <Link to={GROW} className={styles.more}>
          {t('start.latest.diary')} ›
        </Link>
      ) : null}
      {viewing ? <PictureViewer pictures={viewing.pictures} from={viewing.from} onClose={() => setViewing(null)} /> : null}
    </section>
  );
}
