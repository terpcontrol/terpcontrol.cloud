import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Entry, GrowDayEvent, GrowReadingNames, Person } from '@fg2/shared-types/v1';
import { GROW } from '@/app/places';
import { useCorrecting } from '@/log/corrections';
import { dayLines } from '@/screens/grow/diary/days';
import { DiaryLine } from '@/screens/grow/diary/DiaryLine';
import { dayStamp } from '@/ui/age';
import { readingNamesOf } from '@/ui/entries';
import { Lines } from '@/ui/Lines';
import { useZone } from '@/ui/zone';
import styles from './Start.module.css';
import ui from '@/ui/ui.module.css';

/** How many of the newest lines Start names; the diary and Verlauf have the rest. */
const LATEST = 3;

/**
 * "Zuletzt": the tail of the diary - the newest lines as a day's card would
 * say them (`dayLines`), read by the same rules on the server: what a person
 * wrote, an alarm as its rule, a step of the plan, maintenance as one line.
 * A line somebody may correct opens its sheet. With a diary, the card leads to
 * all of it.
 */
export function Latest({
  entries,
  events,
  people,
  readingNames = [],
  on,
  diary,
  byline = true,
  now,
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
  now: DateTime;
}) {
  const { t, i18n } = useTranslation();
  const zone = useZone();
  const correcting = useCorrecting();
  const lines = dayLines(t, i18n, { entries, events, endsAt: now.toISO() ?? '' }, zone).slice(0, LATEST);
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
            />
          );
        })}
      </Lines>
      {diary ? (
        <Link to={GROW} className={styles.more}>
          {t('start.latest.diary')} ›
        </Link>
      ) : null}
    </section>
  );
}
