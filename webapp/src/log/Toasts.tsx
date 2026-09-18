import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Entry } from '@fg2/shared-types/v1';
import type { LogTarget, TileKind } from './log-context';
import styles from './Toasts.module.css';

/**
 * What was just written, for as long as it can still be taken back.
 *
 * The line appears the moment a tile is tapped, before anything has been sent -
 * that is what makes the sheet quick - so it also has to be the place where a
 * write that never landed is admitted to, rather than a screen that quietly
 * shows one line fewer than the person wrote.
 */

export interface LoggedLine {
  key: number;
  /** "Watered · Spring run · Day 34". */
  label: string;
  send: () => Promise<Entry>;
  details: { kind: TileKind; target: LogTarget } | null;
  state: 'saving' | 'saved' | 'failed';
  /** Which thing failed, so Try again knows what to try. */
  failure: 'write' | 'undo' | null;
  undoing: boolean;
  entry: Entry | null;
  /** When the Undo stops being offered and the toast goes away. */
  undoUntil: number | null;
}

interface ToastsProps {
  lines: LoggedLine[];
  onUndo: (line: LoggedLine) => void;
  onRetry: (line: LoggedLine) => void;
  onDismiss: (key: number) => void;
  onDetails: (line: LoggedLine) => void;
}

export function Toasts({ lines, onUndo, onRetry, onDismiss, onDetails }: ToastsProps) {
  if (lines.length === 0) return null;

  return (
    <div className={styles.toasts} role="status" aria-live="polite">
      {lines.map(line => (
        <Toast key={line.key} line={line} onUndo={onUndo} onRetry={onRetry} onDismiss={onDismiss} onDetails={onDetails} />
      ))}
    </div>
  );
}

function Toast({ line, onUndo, onRetry, onDismiss, onDetails }: Omit<ToastsProps, 'lines'> & { line: LoggedLine }) {
  const { t } = useTranslation();

  // The window is the server's answer plus five seconds of it, so the toast
  // goes when the Undo it offers does - never before, never long after.
  useEffect(() => {
    if (line.undoUntil === null || line.undoing) return;
    const timer = setTimeout(() => onDismiss(line.key), Math.max(0, line.undoUntil - Date.now()));

    return () => clearTimeout(timer);
  }, [line.undoUntil, line.undoing, line.key, onDismiss]);

  if (line.state === 'failed') {
    return (
      <div className={styles.toast} data-failed>
        <span className={styles.label}>{t(line.failure === 'undo' ? 'log.undoFailed' : 'log.saveFailed')}</span>
        <button type="button" className={styles.action} onClick={() => onRetry(line)}>
          {t('log.tryAgain')}
        </button>
        <button type="button" className={styles.action} onClick={() => onDismiss(line.key)}>
          {t('log.dismiss')}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.toast}>
      <span className={styles.label}>{line.label}</span>
      {line.undoing ? (
        <span className={`mono ${styles.quiet}`}>{t('log.takingBack')}</span>
      ) : (
        <>
          <button type="button" className={styles.action} onClick={() => onUndo(line)}>
            {t('log.undo')}
          </button>
          {line.details && line.state === 'saved' ? (
            <>
              <span className={styles.between} aria-hidden>
                ·
              </span>
              <button type="button" className={styles.action} onClick={() => onDetails(line)}>
                {t('log.details')}
              </button>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
