import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Entry, GrowReadingNames, Person } from '@fg2/shared-types/v1';
import { GROW } from '@/app/places';
import { useCorrecting } from '@/log/corrections';
import { dayStamp } from '@/ui/age';
import { foldRepeats, readingNamesOf } from '@/ui/entries';
import { EntryWords } from '@/ui/EntryRow';
import ui from '@/ui/ui.module.css';
import { useZone } from '@/ui/zone';
import styles from './Start.module.css';

/** How many of the newest lines Start names; the diary and Verlauf have the rest. */
const LATEST = 3;

/**
 * "Zuletzt": the newest things that happened here, each in one plain line -
 * what a person wrote and what the devices did, a run of the same machine line
 * counted rather than stacked. A line somebody may correct opens its sheet.
 * With a diary, the card leads to all of it.
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

  return (
    <section className={styles.card} aria-labelledby="start-latest">
      <h2 className={styles.cardTitle} id="start-latest">
        {t('start.latest.title')}
      </h2>
      {folded.length === 0 ? (
        <p className={styles.cardText}>{t('start.latest.none')}</p>
      ) : (
        <ul className={styles.lines}>
          {folded.map(({ entry, count, since }) => {
            const open = correcting(entry, on);
            const words = (
              <>
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
              </>
            );
            return (
              <li key={entry.id} className={styles.line} data-severity={entry.severity ?? undefined}>
                <span className={styles.stamp}>{dayStamp(entry.occurredAt, now, zone)}</span>
                {open ? (
                  <button type="button" className={styles.lineText} title={t('grow.correctLine')} onClick={open}>
                    {words}
                    <span className={ui.visuallyHidden}>{`, ${t('grow.correctLine')}`}</span>
                  </button>
                ) : (
                  <span className={styles.lineText}>{words}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {diary ? (
        <Link to={GROW} className={styles.more}>
          {t('start.latest.diary')} ›
        </Link>
      ) : null}
    </section>
  );
}
