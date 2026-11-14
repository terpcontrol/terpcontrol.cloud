import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { Entry } from '@fg2/shared-types/v1';
import { Facts } from '@/ui/Facts';
import { factsOf } from '@/ui/fact-text';
import { ANNOUNCER } from '@/ui/live-region';
import type { LogRequest, LogTarget, TileKind } from './log-context';
import { besideSheet, clearance, GAP, roomFor } from './toast-room';
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
  /** The control that was used when the line began (`lastUsed`): what the toast must not stand over. */
  answers: Element | null;
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

/** The room the page has under its end and the room the toasts ask; what a scroll has left of the first is taken back on the next. */
const room = { has: 0, wanted: 0 };
const keepRoom = (wanted = room.wanted) => {
  const page = document.documentElement;
  if (wanted === 0 && room.has === 0) return;
  room.wanted = wanted;
  room.has = roomFor(wanted, room.has, window.scrollY, page.scrollHeight - window.innerHeight);
  page.style.setProperty('--toast-room', `${room.has}px`);
  page.toggleAttribute('data-toast-room', room.has > 0);
  if (room.has > wanted) window.addEventListener('scroll', refit, { passive: true, once: true });
};
const refit = () => keepRoom();

/**
 * A toast never stands over the control it answers, whatever activated it and however many toasts stand: the page
 * keeps room under its end for the toasts' box (`Toasts.module.css`), and is moved until every control a standing
 * toast answers is clear of it. Asked again whenever a toast arrives or the box changes. What stands in a sheet or
 * does not scroll with the page - the bar, a toast - is left; with a sheet open the page under it does not move.
 */
const clearOf = (host: HTMLElement, lines: readonly LoggedLine[]) => {
  const atFoot = host.parentElement === document.body && !document.querySelector('[data-scrim]');
  keepRoom(atFoot ? host.offsetHeight + GAP : 0);
  if (!atFoot) return;
  const moves = lines.flatMap(({ answers }) =>
    answers?.isConnected && !answers.closest(`nav, .${styles.toasts}`) ? [answers.getBoundingClientRect()] : [],
  );
  const by = clearance(moves, host.getBoundingClientRect());
  if (by > 0) window.scrollBy({ top: by });
};

/** Where a Tab can land, in the order it would. */
const STOPS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const stopsIn = (root: ParentNode, outside?: Element): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(STOPS)].filter(
    one => !one.closest('[inert], [hidden], [aria-hidden="true"]') && (outside === undefined || !outside.contains(one)),
  );

/** The control a toast answers as the keyboard reaches it: a label's own field. */
const controlOf = (answers: Element | null | undefined): HTMLElement | null => {
  const control = answers instanceof HTMLLabelElement ? answers.control : answers;
  return control instanceof HTMLElement && control.isConnected ? control : null;
};

/**
 * A toast's actions are the next stops of the keyboard after the control it
 * answers, wherever the toast is drawn: Tab from the control lands on "Widerrufen",
 * Tab from the toast's last action goes on where it would have gone from the
 * control, and Shift+Tab walks the same way back. The portal stays at the end
 * of the page, which is where a toast has to stand to be seen, and the order
 * is the page's.
 *
 * What a toast answers is the control that was used (`lastUsed`); where that
 * has gone with the sheet it stood in, it is what had the focus once the toast
 * came - the control the sheet was opened from.
 */
const useTabOrder = (host: HTMLElement, lines: readonly LoggedLine[]) => {
  const anchors = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    const active = document.activeElement;
    const known = anchors.current;
    for (const key of known.keys()) if (!lines.some(line => line.key === key)) known.delete(key);
    for (const line of lines) {
      if (known.get(line.key)?.isConnected) continue;
      const anchor = controlOf(line.answers) ?? (active instanceof HTMLElement && active !== document.body && !host.contains(active) ? active : null);
      if (anchor) known.set(line.key, anchor);
    }
  }, [host, lines]);

  useEffect(() => {
    if (lines.length === 0) return undefined;
    const toastOf = (key: number) => host.querySelector<HTMLElement>(`[data-key="${key}"]`);
    const anchorOf = (key: number) => {
      const anchor = anchors.current.get(key);
      return anchor?.isConnected ? anchor : null;
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      const page = stopsIn(document, host);
      const move = (to: HTMLElement | undefined) => {
        if (!to) return;
        event.preventDefault();
        // Ahead of a sheet's own trap, which would take the focus back into its box.
        event.stopPropagation();
        to.focus();
      };

      // Newest first: two toasts answering one control are reached newest first.
      for (const line of [...lines].reverse()) {
        const toast = toastOf(line.key);
        const anchor = anchorOf(line.key);
        const stops = toast ? stopsIn(toast) : [];
        if (!toast || !anchor || stops.length === 0) continue;

        if (toast.contains(active)) {
          if (event.shiftKey && active === stops[0]) return move(anchor);
          if (!event.shiftKey && active === stops.at(-1)) return move(page[page.indexOf(anchor) + 1]);
          return;
        }
        if (!event.shiftKey && active === anchor) return move(stops[0]);
        if (event.shiftKey && page[page.indexOf(active) - 1] === anchor) return move(stops.at(-1));
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [host, lines]);

  /**
   * Back to the control a toast answers, where the focus stood in the toast: an undo or a toast that goes leaves it on
   * nothing otherwise. After an undo the control may be held disabled while the undo is written - an alarm's switch -,
   * and a browser drops the focus of a control it disables: it is handed back once the control takes it again.
   */
  return (key: number, undoing = false) => {
    const anchor = anchors.current.get(key);
    if (!anchor?.isConnected || !toastHolds(host, key)) return;
    anchor.focus();
    if (undoing) regains(anchor);
  };
};

/** How long a control the undo holds disabled is waited for: longer than any write is given. */
const REGAIN_MS = 30_000;

/** Gives the focus back to a control once it is enabled again, where nothing else has taken it meanwhile. */
const regains = (control: HTMLElement) => {
  const watch = new MutationObserver(() => {
    if (control.matches(':disabled')) return;
    watch.disconnect();
    if (document.activeElement === null || document.activeElement === document.body) control.focus();
  });
  watch.observe(control, { attributes: true, attributeFilter: ['disabled'] });
  window.setTimeout(() => watch.disconnect(), REGAIN_MS);
};

const toastHolds = (host: HTMLElement, key: number): boolean => {
  const active = document.activeElement;
  return active instanceof Node && (host.querySelector(`[data-key="${key}"]`)?.contains(active) ?? false);
};

export function Toasts({ lines, onUndo, onRetry, onDismiss, onDetails }: ToastsProps) {
  const shown = lines.length > 0;
  const host = useStanding(shown);
  const back = useTabOrder(host, lines);
  // Asked as the box is first seen - a toast arrived, or changed - and whenever it changes after.
  useEffect(() => {
    if (!shown) return keepRoom(0);
    const box = new ResizeObserver(() => clearOf(host, lines));
    box.observe(host);
    return () => box.disconnect();
  }, [shown, host, lines]);

  return createPortal(
    lines.map(line => (
      <Toast
        key={line.key}
        line={line}
        onUndo={one => {
          back(one.key, true);
          onUndo(one);
        }}
        onRetry={onRetry}
        onDismiss={onDismiss}
        onDetails={onDetails}
        onGoing={() => back(line.key)}
      />
    )),
    host,
  );
}

function Toast({ line, onUndo, onRetry, onDismiss, onDetails, onGoing }: Omit<ToastsProps, 'lines'> & { line: LoggedLine; onGoing: () => void }) {
  const { t } = useTranslation();
  // Read as it goes, while its buttons are still on the page.
  const going = useRef(onGoing);
  useLayoutEffect(() => {
    going.current = onGoing;
  });
  useLayoutEffect(() => () => going.current(), []);

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
      <div className={styles.toast} data-key={line.key} data-failed>
        <span className={styles.label}>
          {line.reason ?? t(line.failure === 'undo' ? 'log.undoFailed' : 'log.saveFailed')}
          {/* Try again sends only what is still missing, so the toast says how much that is. */}
          {line.failure === 'write' && line.progress && line.progress.done > 0 ? ` · ${t('log.uploaded', line.progress)}` : null}
        </span>
        <button type="button" className={styles.action} onClick={() => onRetry(line)}>
          {t('home.retry')}
        </button>
        <button type="button" className={styles.action} onClick={() => onDismiss(line.key)}>
          {t('log.dismiss')}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.toast} data-key={line.key}>
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
        <span className={styles.quiet}>{t('log.takingBack')}</span>
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
