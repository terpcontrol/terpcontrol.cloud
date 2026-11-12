import type { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Entry, SpaceTimeline } from '@fg2/shared-types/v1';
import { dayLines } from '@/screens/grow/diary/days';
import { DiaryLine } from '@/screens/grow/diary/DiaryLine';
import { readingNamesOf } from '@/ui/entries';
import { useKept } from '@/ui/kept';
import { Lines } from '@/ui/Lines';
import { useZone } from '@/ui/zone';
import { cursorStamp } from './labels';
import type { Shown } from './model';
import { at } from './window';
import styles from './Timeline.module.css';

/** How many lines stand in the card before the rest wait behind a tap: a month of a chatty tent holds hundreds. */
const SHOWN = 12;

interface DiaryCardProps {
  data: SpaceTimeline;
  shown: Pick<Shown, 'diary' | 'machine'>;
  now: DateTime;
  onCursor: (time: number) => void;
  /** How a line of the reader's own is put right; nothing for a reader who may not. */
  correct?: (entry: Entry) => (() => void) | undefined;
  /** Whether a line names who wrote it. */
  byline: boolean;
  /** Writes a note dated to the cursor, where the reader may: the instant in words, and the way to the sheet. */
  note: { at: string; write: () => void } | null;
}

/**
 * What was written in the window, as the diary tells it - a run of the same
 * device line folded, an alarm by its rule - oldest first, the way the curves
 * above run. A line's stamp sets the cursor on its moment; its words open its
 * correction, as everywhere a line is read.
 */
export function DiaryCard({ data, shown, now, onCursor, correct, byline, note }: DiaryCardProps) {
  const { t, i18n } = useTranslation();
  const zone = useZone();
  const [all, setAll] = useKept('timeline-lines', false);
  const window = { from: at(data.startsAt), to: at(data.endsAt) };
  const entries = data.events.filter(entry => (entry.source === 'human' ? shown.diary : shown.machine));
  const lines = dayLines(t, i18n, { entries, events: [], endsAt: data.endsAt }, zone).reverse();
  const listed = all ? lines : lines.slice(-SHOWN);

  return (
    <section className={styles.card} aria-labelledby="timeline-diary">
      <h2 id="timeline-diary" className={styles.cardTitle}>
        {t('timeline.diary.title')}
      </h2>
      {lines.length > listed.length ? (
        <button type="button" className={styles.more} onClick={() => setAll(true)}>
          {t('timeline.diary.all', { count: lines.length })}
        </button>
      ) : null}
      {lines.length === 0 ? (
        <p className={styles.none}>{t('timeline.diary.none')}</p>
      ) : (
        <Lines>
          {listed.map(line => {
            const entry = line.what.kind === 'entry' ? line.what.entry : null;
            return (
              <DiaryLine
                key={line.key}
                line={line}
                stamp={cursorStamp(at(line.at), window, 60, zone)}
                zone={zone}
                now={now}
                people={data.people}
                measurements={entry ? readingNamesOf(data.readingNames, entry.growId) : []}
                byline={byline}
                onOpen={entry ? (correct?.(entry) ?? null) : null}
                onStamp={() => onCursor(at(line.at))}
                stampDoes={t('timeline.diary.toMoment')}
              />
            );
          })}
        </Lines>
      )}
      {data.machineEvents.total > data.machineEvents.shown && shown.machine ? (
        <p className={styles.none}>{t('timeline.diary.capped', { shown: data.machineEvents.shown, total: data.machineEvents.total })}</p>
      ) : null}
      {note ? (
        <button type="button" className={styles.more} onClick={note.write}>
          {t('timeline.diary.note', { at: note.at })}
          {'\u00a0›'}
        </button>
      ) : null}
    </section>
  );
}
