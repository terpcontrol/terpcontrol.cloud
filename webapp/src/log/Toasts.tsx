import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Entry } from '@fg2/shared-types/v1';
import { Facts } from '@/ui/Facts';
import { factsOf } from '@/ui/fact-text';
import type { LogRequest, LogTarget, TileKind } from './log-context';
import styles from './Toasts.module.css';

/**
 * What was just written, for as long as it can still be taken back. The line
 * appears the moment a tile is tapped, before anything has been sent, so it is
 * also the place where a write that never landed is admitted to.
 *
 * There are never more than two (`toast-room.ts`), and none stands on a sheet's
 * buttons: while a sheet is open they stand above its button row.
 */

export interface LoggedLine {
  key: number;
  /** "Watered · Spring run · Day 34". */
  label: string;
  send: LogRequest['send'];
  /** What landing the line changed beyond the diary. */
  changed?: LogRequest['changed'];
  /** For a toast that tells of something already done: how it is taken back. Null for a line that was written. */
  revert: (() => Promise<unknown>) | null;
  /** The control a toast that tells of something came from, whose next toast takes its place. */
  from?: string;
  /** The line could not be sent because nothing answered: it is sent again by itself once the connection is back. */
  waiting?: boolean;
  details: { kind: TileKind; target: LogTarget } | null;
  state: 'saving' | 'saved' | 'failed';
  /** Which thing failed, so Try again knows what to try. */
  failure: 'write' | 'undo' | null;
  /** What the server said when it refused, in its own words; null where the failure has none. */
  reason: string | null;
  undoing: boolean;
  entry: Entry | null;
  /** Whether Undo is offered at all; a tick that set more than a diary line in motion is not taken back here. */
  undoable: boolean;
  /** When the Undo stops being offered and the toast goes away. */
  undoUntil: number | null;
  /** How far a line that takes a while has got - nine pictures off a phone are minutes, not a moment. */
  progress: { done: number; total: number } | null;
}

interface ToastsProps {
  lines: LoggedLine[];
  onUndo: (line: LoggedLine) => void;
  onRetry: (line: LoggedLine) => void;
  onDismiss: (key: number) => void;
  onDetails: (line: LoggedLine) => void;
}

/** The room a toast keeps above what it stands over. */
const GAP = 8;

/**
 * Where the toasts stand while a sheet is open: above its button row, and
 * above the sheet itself where it has none, so no toast lies on a control of
 * the sheet. It follows sheets opening and closing for as long as a toast is
 * shown, and is written straight onto the element - no render waits on it.
 */
const useOverSheet = (shown: boolean) => {
  const toasts = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = toasts.current;
    if (!shown || !element) return undefined;

    const place = () => {
      const sheet = [...document.querySelectorAll('[data-scrim] [role="dialog"]')].at(-1);
      const edge = sheet?.querySelector(':scope > footer') ?? sheet;
      // Never off the top of the window: a sheet that fills it keeps the toast inside the screen.
      const from = edge ? Math.min(window.innerHeight - edge.getBoundingClientRect().top + GAP, window.innerHeight - 96) : null;
      if (from === null) element.style.removeProperty('bottom');
      else element.style.setProperty('bottom', `${Math.round(from)}px`);
      element.toggleAttribute('data-over-sheet', from !== null);
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', place);
    // A sheet rises into its place: where its buttons stand is known once it has arrived.
    document.addEventListener('animationend', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('animationend', place, true);
    };
  }, [shown]);

  return toasts;
};

export function Toasts({ lines, onUndo, onRetry, onDismiss, onDetails }: ToastsProps) {
  const toasts = useOverSheet(lines.length > 0);
  if (lines.length === 0) return null;

  return (
    <div ref={toasts} className={styles.toasts} role="status" aria-live="polite">
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
    // A refusal's own sentence where it has one; the generic line is for a failure that has nothing to say.
    return (
      <div className={styles.toast} data-failed>
        <span className={styles.label}>
          {line.reason ?? t(line.failure === 'undo' ? 'log.undoFailed' : 'log.saveFailed')}
          {/* Try again sends only what is still missing, so the toast says how much that is. */}
          {line.failure === 'write' && line.progress && line.progress.done > 0 ? ` · ${t('log.uploaded', line.progress)}` : null}
        </span>
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
      {/* Set as facts, so no figure of the line stands on a row of its own without its unit. */}
      <Facts
        className={styles.label}
        facts={[
          ...factsOf(line.label),
          // A watering written by hand closes the watering task that was due, and says so.
          line.details && line.entry?.taskId ? t('log.taskClosed') : null,
          // Without it a long upload looks like a toast that forgot to go.
          line.state === 'saving' && line.progress && !line.undoing ? t('log.uploaded', line.progress) : null,
        ]}
      />
      {line.undoing ? (
        <span className={`mono ${styles.quiet}`}>{t('log.takingBack')}</span>
      ) : (
        <>
          {line.undoable ? (
            <button type="button" className={styles.action} onClick={() => onUndo(line)}>
              {t('log.undo')}
            </button>
          ) : null}
          {line.details && line.state === 'saved' ? (
            <>
              {line.undoable ? (
                <span className={styles.between} aria-hidden>
                  ·
                </span>
              ) : null}
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
