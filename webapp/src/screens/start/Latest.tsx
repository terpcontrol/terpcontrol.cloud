import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Entry, GrowReadingNames, Person } from '@fg2/shared-types/v1';
import { GROW } from '@/app/places';
import { useCorrecting } from '@/log/corrections';
import { dayStamp } from '@/ui/age';
import { foldRepeats, readingNamesOf, warningOf } from '@/ui/entries';
import { EntryWords } from '@/ui/EntryRow';
import { Line, Lines } from '@/ui/Lines';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import styles from './Start.module.css';

/** How many of the newest lines Start names; the diary and Verlauf have the rest. */
const LATEST = 3;

/**
 * "Zuletzt": the newest things that happened here, each in one plain line -
 * what a person wrote and what the devices did, a run of the same machine line
 * counted rather than stacked. Amber is kept for what needs a person
 * (`warningOf`). A line somebody may correct opens its sheet. With a diary,
 * the card leads to all of it.
 */
export function Latest({
  entries,
  people,
  readingNames = [],
  on,
  diary,
  byline = true,
  now,
}: {
  entries: Entry[];
  people: Person[];
  readingNames?: GrowReadingNames[];
  /** What the lines were written about, for the sheet that corrects one. */
  on: { label: string; spaceId: string | null; ownerId?: string | null };
  diary: boolean;
  /** Whether a line names who wrote it, which the demo's do not. */
  byline?: boolean;
  now: DateTime;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const correcting = useCorrecting();
  const folded = foldRepeats(entries).slice(0, LATEST);
  // A place where nothing has happened yet has no card saying so: the page under it is short enough.
  if (folded.length === 0) return null;

  return (
    <section className={styles.card} aria-labelledby="start-latest">
      <h2 className={styles.cardTitle} id="start-latest">
        {t('start.latest.title')}
      </h2>
      <Lines>
        {folded.map(({ entry, count, since }) => (
          <Line key={entry.id} stamp={dayStamp(entry.occurredAt, now, zone)} severity={warningOf(entry)} onOpen={correcting(entry, on)}>
            <span className={ui.visuallyHidden}>{`${t(`home.entryKind.${entry.kind}`)}: `}</span>
            <EntryWords
              entry={entry}
              people={people}
              measurements={readingNamesOf(readingNames, entry.growId)}
              now={now}
              zone={zone}
              byline={byline}
              repeats={{ count, since }}
              brief
            />
            {entry.mediaIds.length > 0 ? ` · ${t('start.latest.pictures', { count: entry.mediaIds.length })}` : null}
          </Line>
        ))}
      </Lines>
      {diary ? (
        <Link to={GROW} className={styles.more}>
          {t('start.latest.diary')} ›
        </Link>
      ) : null}
    </section>
  );
}
