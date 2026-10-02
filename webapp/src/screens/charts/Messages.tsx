import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WindowEntries } from '@/api/entries';
import { AXIS_GUTTER } from '@/charts/series';
import { foldRepeats } from '@/ui/entries';
import { EntryRow } from '@/ui/EntryRow';
import { Help } from '@/ui/Help';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { at, fractionOf } from '../timeline/window';
import { categoryOf, columnsOf, MESSAGE_CATEGORIES, nearestColumn, type MessageCategory } from './message-columns';
import styles from './Charts.module.css';

/**
 * What was written over the window, under the curves it happened beside: a
 * lane of columns, one per stretch of the window, as tall as the lines written
 * in it and coloured by the worst of them, and the lines themselves below.
 *
 * It is the old charts' log beside the graph. A column is tapped to read the
 * lines of its stretch alone - the cursor moves there too, so the curves above
 * are read at the same moment - and "all" lists the window again. Which kinds
 * of line are shown is a filter over four plain categories rather than the
 * keys a firmware writes: what the devices said, the alarms, the grow plan,
 * and what people wrote.
 */

/** How many rows are drawn before the rest is counted rather than listed. */
const SHOWN = 60;

export function Messages({
  read,
  from,
  to,
  cursor,
  onCursor,
}: {
  read: { data: WindowEntries | undefined; isPending: boolean; isError: boolean };
  from: number;
  to: number;
  cursor: number;
  onCursor: (time: number) => void;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const [hidden, setHidden] = useState<MessageCategory[]>([]);
  const [opened, setOpened] = useState<number | null>(null);

  const all = read.data?.items ?? [];
  const present = MESSAGE_CATEGORIES.filter(category => all.some(entry => categoryOf(entry) === category));
  const shown = all.filter(entry => !hidden.includes(categoryOf(entry)));
  const columns = columnsOf(shown, from, to);
  const tallest = Math.max(1, ...columns.map(column => column.entries.length));
  const picked = opened === null ? null : columns[opened];
  const listed = foldRepeats(picked ? picked.entries : shown);

  // The cursor goes to when the column's newest line was written, which is what the list under it then starts with.
  const choose = (index: number) => {
    const column = columns[index];
    if (!column || column.entries.length === 0) return;
    setOpened(opened === index ? null : index);
    onCursor(Math.max(...column.entries.map(entry => at(entry.occurredAt))));
  };

  const toggle = (category: MessageCategory) => {
    setOpened(null);
    setHidden(current => (current.includes(category) ? current.filter(one => one !== category) : [...current, category]));
  };

  return (
    <section
      className={`${ui.card} ${styles.card}`}
      style={{ '--gutter': `${AXIS_GUTTER}px`, '--gutter-right': `${AXIS_GUTTER}px` } as React.CSSProperties}
      aria-busy={read.isPending}
    >
      <header className={styles.cardHead}>
        <span className={styles.cardTitle}>
          {t('chartMessages.title')}
          <Help topic="chartMessages" />
        </span>
        <span className={styles.cardAbout}>· {t('chartMessages.count', { count: shown.length })}</span>
      </header>

      {present.length > 1 ? (
        <Choices label={t('chartMessages.filter')}>
          {present.map(category => (
            <Choice key={category} chosen={!hidden.includes(category)} onChoose={() => toggle(category)}>
              {t(`chartMessages.category.${category}`)}
            </Choice>
          ))}
        </Choices>
      ) : null}

      <div className={styles.lane} role="group" aria-label={t('chartMessages.lane')}>
        {/* A column is a few pixels wide on a phone, so a tap takes the nearest
            column with lines in it rather than the one under the finger. A key
            press on a column's button is that column. */}
        <div
          className={styles.columns}
          onClick={event => {
            const box = event.currentTarget.getBoundingClientRect();
            const index =
              event.detail === 0
                ? Number((event.target as HTMLElement).closest('button')?.dataset.column)
                : nearestColumn(columns, event.clientX - box.left, box.width);
            if (index !== null && Number.isInteger(index)) choose(index);
          }}
        >
          {columns.map((column, index) =>
            column.entries.length === 0 ? (
              <span key={index} className={styles.column} aria-hidden />
            ) : (
              <button
                key={index}
                type="button"
                className={styles.column}
                data-column={index}
                data-severity={column.severity ?? undefined}
                aria-pressed={opened === index}
                aria-label={t('chartMessages.column', { count: column.entries.length })}
              >
                <span style={{ height: `${(column.entries.length / tallest) * 100}%` }} />
              </button>
            ),
          )}
          <span className={styles.cursor} style={{ left: `${fractionOf(cursor, from, to) * 100}%` }} />
        </div>
      </div>

      {read.isError && !read.data ? (
        <p className={ui.problem}>{t('chartMessages.failed')}</p>
      ) : read.isPending ? null : listed.length === 0 ? (
        <p className={ui.note}>{t(all.length === 0 ? 'chartMessages.none' : 'chartMessages.noneShown')}</p>
      ) : (
        <div className={styles.messageList}>
          {picked ? (
            <button type="button" className={ui.chip} onClick={() => setOpened(null)}>
              {t('chartMessages.all')}
            </button>
          ) : null}
          {listed.slice(0, SHOWN).map(({ entry, count, since }) => (
            <EntryRow key={entry.id} entry={entry} people={[]} byline={false} now={now} brief repeats={count > 1 ? { count, since } : null} />
          ))}
          {listed.length > SHOWN || read.data?.more ? (
            <p className={ui.note}>{t('chartMessages.more', { count: Math.max(0, listed.length - SHOWN) })}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
