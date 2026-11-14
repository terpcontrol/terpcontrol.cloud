import type { DateTime } from 'luxon';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Entry, Person, Plant, ReadingName } from '@fg2/shared-types/v1';
import { useSession } from '@/api/session';
import { entryDetail } from '@/i18n/device-message';
import { sinceLabel } from './age';
import { amountOf, authorOf, doneByOf, headlineOf, ownReading } from './entries';
import { factsOf, unbroken } from './fact-text';
import { Facts } from './Facts';
import { DATED_CLOCK, zoned } from './zone';
import { looseFigure } from './figures';
import ui from './ui.module.css';
import styles from './EntryWords.module.css';

/**
 * What a line of a diary says: who did what and how much of it, how often a
 * machine repeated it, the readings and what the machine went on to explain.
 * Every list of lines draws these words in a row of its own (`Line`,
 * `ui/Lines.tsx`), so a line reads the same wherever it is met, led by the
 * kind of line it is for whoever cannot see the list.
 */
export function EntryWords({
  entry,
  people,
  measurements = [],
  now,
  byline = true,
  zone,
  repeats = null,
  brief = false,
  pictures = false,
  plants = [],
  moment = instant => sinceOf(instant, now, zone),
}: {
  entry: Entry;
  people: Person[];
  /** The grow's own measurements, which is where a reading's name and unit are; without them a reading shows its key. */
  measurements?: readonly ReadingName[];
  /** The moment the list is read at, which says whether a folded run began today. */
  now?: DateTime;
  /**
   * Whether a line says who wrote it. A public diary has one author, named once
   * at the top of the page, and the people an answer names are not part of what
   * a stranger is given - so there its lines carry no name rather than a guess.
   */
  byline?: boolean;
  /** The zone the line's hours are said in; null is the browser's, which is what a reader from outside gets. */
  zone: string | null;
  /**
   * Identical machine lines before this one that a list folded into it (see
   * `foldRepeats`): how many there were in all, and when the first was written.
   */
  repeats?: { count: number; since: string; until?: string } | null;
  /**
   * The line without what the machine went on to explain, for a summary of the
   * last few things that happened rather than their record. An alarm keeps its
   * detail, which is the rule and the reading and the whole of what it says.
   */
  brief?: boolean;
  /** Whether the line counts the pictures it carries, "· 2 Bilder", one fact like the rest: where the list gives no way to them. */
  pictures?: boolean;
  /** The plants of the grow the line belongs to, where the surface is answered them: a line about some of them names those. */
  plants?: readonly Pick<Plant, 'id' | 'growId' | 'label'>[];
  /** How the list says a moment, where it has a form of its own: a folded run's other end is said in it. */
  moment?: (instant: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const readings = 'readings' in entry.values ? entry.values.readings : [];
  const detail = entryDetail(i18n, entry, { zone, at: entry.occurredAt });
  const byYou = entry.authorId === user?.id;
  const doneBy = byline && entry.source === 'human' ? doneByOf(t, i18n, entry, byYou) : null;
  const named = byline && entry.source === 'human' && (doneBy !== null || !byYou);
  const amount = amountOf(t, entry);
  const about = plantsOf(entry, plants);
  // The line as facts side by side: who did what, how much of it, how often, each reading. No line of it ends on
  // the dot between two, and no figure leaves its unit or its label.
  const facts: ReactNode[] = [
    // A device, the plan or an alarm is named by its mark; a person by name -
    // as the subject of what they did ("Du hast gegossen", "lea hat
    // gegossen"), or ahead of their own words as a speaker is ("lea: Untere
    // Blätter ausgelichtet"). Somebody's own words need no name: "du Untere
    // Blätter ausgelichtet" read as a sentence nobody would write.
    <span key="said">
      {named ? (
        <>
          <span className={styles.author}>{byYou ? t('home.author.youLead') : authorOf(t, entry, people, user?.id)}</span>
          {doneBy === null ? ': ' : ' '}
        </>
      ) : null}
      {/* A person writes in lines, so the breaks they typed are kept rather than collapsed into one run-on sentence. */}
      <span className={styles.headline}>{doneBy ?? headlineOf(t, i18n, entry)}</span>
    </span>,
    about,
    ...(amount ? factsOf(amount) : []).map(part => <span key={part}>{unbroken(part)}</span>),
    repeats && repeats.count > 1 ? (
      <span key="repeats">
        {/* A list that runs forwards stands a folded line at its first and says until when it went on. */}
        {repeats.until
          ? t('home.entryRepeatsUntil', { count: repeats.count, until: moment(repeats.until) })
          : t('home.entryRepeats', { count: repeats.count, since: moment(repeats.since) })}
      </span>
    ) : null,
    ...readings.map(reading => {
      const definition = measurements.find(one => one.key === reading.key) ?? ownReading(t, reading.key);
      return (
        <span key={`${reading.key}-${reading.plantId ?? ''}`} className={styles.readings}>
          {definition?.name ?? reading.key} {unbroken(`${looseFigure(reading.value)}${definition?.unit ? ` ${definition.unit}` : ''}`)}
        </span>
      );
    }),
    pictures && entry.mediaIds.length > 0 ? t('start.latest.pictures', { count: entry.mediaIds.length }) : null,
  ];

  return (
    <>
      {/* What kind of line it is, as words: no mark is drawn for it, and a screen reader is told all the same. */}
      <span className={ui.visuallyHidden}>{`${t(`home.entryKind.${entry.kind}`)}: `}</span>
      <Facts facts={facts} />
      {/* What the machine's line said, under the kind of thing it was: the
          reading an alarm tripped on, the settings a save changed, the reason
          a device rebooted. */}
      {detail === null || (brief && entry.kind !== 'alarm') ? null : <small className={styles.detail}>{detail}</small>}
    </>
  );
}

/**
 * Which plants a line is about, where it is about some of its grow's and not
 * all: "B2", "A1, C3". A grow of one plant has nothing to tell apart, and a
 * line about every plant is a line about the grow.
 */
const plantsOf = (entry: Pick<Entry, 'growId' | 'plantIds'>, plants: readonly Pick<Plant, 'id' | 'growId' | 'label'>[]): string | null => {
  const ofGrow = plants.filter(plant => plant.growId === entry.growId);
  const named = ofGrow.filter(plant => entry.plantIds.includes(plant.id));

  return named.length > 0 && named.length < ofGrow.length ? named.map(plant => plant.label).join(', ') : null;
};

/** When the first of a folded run was written: the hour where that was today, the date as well where it was not. */
const sinceOf = (since: string, now: DateTime | undefined, zone: string | null): string =>
  now ? sinceLabel(since, now, zone) : zoned(since, zone).toFormat(DATED_CLOCK);
