import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Entry, MeasurementDefinition, Person } from '@fg2/shared-types/v1';
import { useSession } from '@/api/session';
import { authorOf, headlineOf, KIND_ICON, readingFigure } from './entries';
import styles from './EntryRow.module.css';

interface EntryRowProps {
  entry: Entry;
  people: Person[];
  /** The grow's own measurements, which is where a reading's name and unit are; without them a reading shows its key. */
  measurements?: MeasurementDefinition[];
  /** Whether the stamp names the day as well as the hour; a week's rows need the day, today's do not. */
  withDay?: boolean;
  /**
   * Whether a line says who wrote it. A public diary has one author, named once
   * at the top of the page, and the people an answer names are not part of what
   * a stranger is given - so there its lines carry no name rather than a guess.
   */
  byline?: boolean;
}

/**
 * One line of a diary: when, what kind of thing, what it said and who said
 * it. It is the same row wherever a diary is shown, so a week card and a tent's
 * latest lines read alike.
 */
export function EntryRow({ entry, people, measurements = [], withDay = false, byline = true }: EntryRowProps) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const Icon = KIND_ICON[entry.kind];
  const at = DateTime.fromISO(entry.occurredAt);
  const readings = 'readings' in entry.values ? entry.values.readings : [];

  return (
    <li className={styles.row} data-severity={entry.severity ?? undefined}>
      <span className={`mono ${styles.stamp}`}>{at.toFormat(withDay ? 'ccc HH:mm' : 'HH:mm')}</span>
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
      </span>
    </li>
  );
}
