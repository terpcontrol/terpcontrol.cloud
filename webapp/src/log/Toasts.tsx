import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Entry } from '@fg2/shared-types/v1';
import { Facts } from '@/ui/Facts';
import { factsOf } from '@/ui/fact-text';
import { ANNOUNCER } from '@/ui/live-region';
import type { LogRequest, LogTarget, TileKind } from './log-context';
import { besideSheet } from './toast-room';
import styles from './Toasts.module.css';

/**
 * What was just written, for as long as it can still be taken back. The line
 * appears the moment a tile is tapped, before anything has been sent, so it is
 * also the place where a write that never landed is admitted to.
 *
 * There are never more than two, and none lies on an open sheet (`toast-room.ts`).
 * The newest stands at the edge the stack hangs on - over the bar, at the
 * window's foot, against a sheet's box - so none moves when another's time is up.
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
  /** What holds again once it is taken back, in the teller's words. */
  undone?: string;
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

/** The element the toasts are drawn into: a live region a sheet must not silence, so what was written is said while one is open. */
const hostOf = (): HTMLElement => {
  const host = document.createElement('div');
  host.className = styles.toasts;
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  host.setAttribute(ANNOUNCER, '');
  return host;
};

/** The top sheet's box as it stands without toasts in its foot: their room is its body's again, as far as the body has more to show. */
const boxOf = (sheet: HTMLElement, foot: HTMLElement): { top: number; bottom: number } => {
  const body = foot.previousElementSibling;
  const grown = Math.max(0, foot.offsetHeight - (body ? body.scrollHeight - body.clientHeight : 0));
  const top = sheet.offsetTop + (getComputedStyle(sheet.parentElement!).alignItems === 'center' ? grown / 2 : grown);

  return { top, bottom: top + sheet.offsetHeight - grown };
};

/**
 * Puts the toasts where they stand now and answers the sheet they stand by:
 * at the page's foot, or beside an open sheet's box, or in its foot
 * (`besideSheet`). A sheet is measured where it comes to rest, not where its
 * rise or a pull has it.
 */
const stand = (host: HTMLElement): HTMLElement | null => {
  if (!host.isConnected) document.body.append(host);
  const sheet = [...document.querySelectorAll<HTMLElement>('[data-scrim] [role="dialog"]')].at(-1) ?? null;
  const foot = sheet?.querySelector<HTMLElement>(':scope > [data-toasts]') ?? null;
  const where =
    sheet && foot
      ? besideSheet(boxOf(sheet, foot), host.offsetHeight, window.innerHeight, parseFloat(getComputedStyle(sheet.parentElement!).paddingTop) || 0)
      : null;
  const home = where === 'foot' ? foot! : document.body;

  if (host.parentElement !== home) home.append(host);
  host.toggleAttribute('data-in-sheet', where === 'foot');
  host.style.cssText =
    !where || where === 'foot'
      ? ''
      : 'top' in where
        ? `top: ${where.top}px; bottom: auto; flex-direction: column-reverse`
        : `bottom: ${where.bottom}px`;
  return sheet;
};

/** Follows sheets opening, closing and changing their box for as long as a toast is shown; no render waits on it. */
const useStanding = (shown: boolean): HTMLElement => {
  const [host] = useState(hostOf);

  useLayoutEffect(() => {
    if (!shown) return undefined;

    let beside: HTMLElement | null = null;
    const box = new ResizeObserver(() => stand(host));
    const place = () => {
      const sheet = stand(host);
      if (sheet === beside) return;
      box.disconnect();
      if (sheet) box.observe(sheet);
      beside = sheet;
    };
    place();
    const page = new MutationObserver(place);
    page.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', place);
    return () => {
      page.disconnect();
      box.disconnect();
      window.removeEventListener('resize', place);
      host.remove();
    };
  }, [shown, host]);

  return host;
};

export function Toasts({ lines, onUndo, onRetry, onDismiss, onDetails }: ToastsProps) {
  return createPortal(
    lines.map(line => <Toast key={line.key} line={line} onUndo={onUndo} onRetry={onRetry} onDismiss={onDismiss} onDetails={onDetails} />),
    useStanding(lines.length > 0),
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
