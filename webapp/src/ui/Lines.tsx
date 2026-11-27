import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Entry } from '@fg2/shared-types/v1';
import { PictureStrip } from './PictureViewer';
import styles from './Lines.module.css';
import ui from './ui.module.css';

/**
 * Lines of a diary in summary: when in one column as wide as its longest
 * stamp, what happened beside it. Start's last lines and a day of the diary
 * are both this list.
 */
export function Lines({ children }: { children: ReactNode }) {
  return <ul className={styles.lines}>{children}</ul>;
}

/**
 * One line: its stamp, its words, and at its end what marks it - that a
 * device did it by itself. The words are the way into the line where the
 * surface offers one: a sheet that corrects it (`onOpen`, named by `opens`),
 * or the page it leads to (`to`). The pictures a line carries have a way of
 * their own beside the words: their count, which opens them, or - for a
 * reader of a share link, who is shown the diary rather than working in it -
 * the pictures themselves under the words.
 */
export function Line({
  stamp,
  children,
  mark = null,
  severity = null,
  onOpen,
  opens,
  to,
  onStamp,
  stampDoes,
  pictures = null,
}: {
  stamp: string;
  children: ReactNode;
  mark?: string | null;
  severity?: Entry['severity'];
  onOpen?: (() => void) | null;
  /** What opening the line does, for the tooltip and a screen reader; correcting it where nothing else is said. */
  opens?: string;
  to?: string | null;
  /** What a tap on the stamp does, and what that is called: Verlauf sets its cursor on the line's moment. */
  onStamp?: (() => void) | null;
  stampDoes?: string;
  /** How many pictures the line carries and what opens one of them; `thumbnails` are their addresses where they are drawn in the line. */
  pictures?: { count: number; onOpen: (index: number) => void; thumbnails?: string[] } | null;
}) {
  const { t } = useTranslation();
  const does = opens ?? t('grow.correctLine');

  return (
    <li className={styles.line} data-severity={severity ?? undefined} data-marked={mark ? true : undefined}>
      {onStamp ? (
        <button type="button" className={styles.stamp} title={stampDoes} onClick={onStamp}>
          {stamp}
          {stampDoes ? <span className={ui.visuallyHidden}>{`, ${stampDoes}`}</span> : null}
        </button>
      ) : (
        <span className={styles.stamp}>{stamp}</span>
      )}
      {/* The mark stands in the line's own row, so it takes room only where there is one. */}
      <span className={styles.body}>
        {to ? (
          <Link to={to} className={styles.text}>
            {children}
            {/* Bound to the last word: the sign that the line leads somewhere never stands alone on a line. */}
            <span aria-hidden>{'\u00a0›'}</span>
          </Link>
        ) : onOpen ? (
          <button type="button" className={styles.text} title={does} onClick={onOpen}>
            {children}
            <span className={ui.visuallyHidden}>{`, ${does}`}</span>
          </button>
        ) : (
          <span className={styles.text}>{children}</span>
        )}
        {pictures && !pictures.thumbnails ? (
          <button type="button" className={styles.pictures} title={t('grow.diary.openPicture')} onClick={() => pictures.onOpen(0)}>
            {t('start.latest.pictures', { count: pictures.count })}
            <span className={ui.visuallyHidden}>{`, ${t('grow.diary.openPicture')}`}</span>
          </button>
        ) : null}
        {mark ? <span className={styles.mark}>{mark}</span> : null}
        {pictures?.thumbnails ? <PictureStrip pictures={pictures.thumbnails} count={pictures.count} onOpen={pictures.onOpen} /> : null}
      </span>
    </li>
  );
}
