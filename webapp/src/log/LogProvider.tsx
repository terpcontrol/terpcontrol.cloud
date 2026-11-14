import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import type { Entry } from '@fg2/shared-types/v1';
import { completeTask, diaryChanged, takeEntryBack } from '@/api/entries';
import { ApiError } from '@/api/problem';
import { LogContext, type CompleteOptions, type LogOpening, type LogRequest, type LogTarget, type TileKind, type Told } from './log-context';
import { LogSheet } from './LogSheet';
import { EntryDetails } from './EntryDetails';
import { PhotoEntry } from './PhotoEntry';
import { lastUsed, withRoom } from './toast-room';
import { Toasts, type LoggedLine } from './Toasts';
import { undoneLabel } from './lines';
import { refusalText } from '@/ui/refusal';

/**
 * The sheet, the details behind it, and the lines on their way to the server.
 *
 * A tap is acknowledged before anything is sent, because that is the whole
 * point of the sheet: on a phone, in a tent, one tap. What is not pretended is
 * the saving - a line that never lands says so and offers itself again, and
 * Undo pressed while it is still in flight takes it back the moment it arrives.
 */

/** How long the toast offers Undo, as the board draws it. The server's own window is far longer. */
const UNDO_MS = 5000;

/** How long a toast that says what was done stays: it is a sentence to read, not a line to recognise. */
const TOLD_MS = 8000;

/**
 * How soon after a toast was raised the page may change under it and the toast go along: what a tap did and then
 * led to - a grow started and its page opened - is said on the page it led to.
 */
const LEADS_MS = 1500;

/** A toast as it is first shown: nothing failed, nothing taken back, no entry yet. */
const UNANSWERED = { failure: null, reason: null, undoing: false, entry: null, progress: null };

/** A toast that only says something - what was done, or that it was taken back - with nothing to offer by itself. */
const saying = (label: string) => ({
  ...UNANSWERED,
  raisedAt: Date.now(),
  label,
  state: 'saved' as const,
  details: null,
  undoable: false,
  undoUntil: Date.now() + TOLD_MS,
});

interface Details {
  kind: TileKind;
  target: LogTarget;
  entry: Entry | null;
  /** When a new line was said to have happened, on the sheet its kind was chosen on; null is now. */
  at: Date | null;
  /** The sheet the kind was chosen on, which the view leads back to; null for a view opened on its own. */
  from: LogOpening | null;
  /** The task the line closes, where a task's "Eintragen" opened it. */
  taskId?: string | null;
}

export function LogProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [opening, setOpening] = useState<LogOpening | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [lines, setLines] = useState<LoggedLine[]>([]);
  const takenBack = useRef(new Set<number>());
  /** The tasks whose tick is still on its way, so that one card writes one line. */
  const ticking = useRef(new Set<string>());
  const nextKey = useRef(1);
  // Where the sheet was pointed last time. It outlives the sheet, which is why it is not the sheet's.
  const [lastTarget, setLastTarget] = useState<string | null>(null);
  const { t, i18n } = useTranslation();

  const dismiss = useCallback((key: number) => setLines(current => current.filter(line => line.key !== key)), []);

  const change = useCallback((key: number, over: Partial<LoggedLine> | ((line: LoggedLine) => Partial<LoggedLine>)) => {
    setLines(current => current.map(line => (line.key === key ? { ...line, ...(typeof over === 'function' ? over(line) : over) } : line)));
  }, []);

  /**
   * Takes a line back - by its own way where it only told of something, else by deleting what it wrote - and answers
   * where the Undo stood with what holds again: in the teller's words, and of a written line that the diary no
   * longer has it. A refusal is said there too. A line still on its way has no id yet and is taken back the moment
   * the server answers with one.
   */
  const undo = useCallback(
    ({ key, entry, revert }: Pick<LoggedLine, 'key' | 'entry' | 'revert'>) => {
      if (!revert && !entry) {
        takenBack.current.add(key);
        return change(key, { undoing: true });
      }
      change(key, { state: 'saved', entry, undoing: true, undoUntil: null });
      void (revert?.() ?? takeEntryBack(entry!.id).then(() => diaryChanged(client))).then(
        () => {
          change(key, line => saying(undoneLabel(i18n.t, line.undone ?? i18n.t('log.gone'))));
          // What was said after it may have built on what is now taken back - a harvest of the plant whose adding
          // was undone: its toast goes, rather than offering to take back what no longer exists.
          setLines(current => current.filter(line => line.key <= key || line.state !== 'saved'));
        },
        error => change(key, { state: 'failed', failure: 'undo', undoing: false, reason: reasonOf(error) }),
      );
    },
    [change, client, i18n],
  );

  /** One attempt at one line. Undo pressed meanwhile is remembered here, so the line is taken back as soon as it exists. */
  const attempt = useCallback(
    (key: number, send: LogRequest['send'], changed?: LogRequest['changed']) => {
      void send((done, total) => change(key, { progress: total > 1 ? { done, total } : null })).then(
        entry => {
          if (takenBack.current.delete(key)) return undo({ key, entry, revert: null });
          change(key, { state: 'saved', entry, undoUntil: Date.now() + UNDO_MS });
          diaryChanged(client);
          changed?.(client);
        },
        // Nothing answered - the request never got out, which a browser reports as a TypeError: the line waits, and
        // says so, until the connection is back.
        error => {
          const waiting = error instanceof TypeError || navigator.onLine === false;
          change(key, { state: 'failed', failure: 'write', reason: waiting ? t('log.noConnection') : reasonOf(error), waiting });
        },
      );
    },
    [change, client, t, undo],
  );

  // A line written without a connection is sent by itself when the connection returns while the app is open.
  useEffect(() => {
    const resend = () => {
      for (const line of lines) {
        if (line.state !== 'failed' || !line.waiting) continue;
        change(line.key, { state: 'saving', failure: null, reason: null, waiting: false });
        attempt(line.key, line.send, line.changed);
      }
    };
    window.addEventListener('online', resend);
    return () => window.removeEventListener('online', resend);
  }, [attempt, change, lines]);

  const log = useCallback(
    (request: LogRequest) => {
      const key = nextKey.current++;
      const line: LoggedLine = {
        ...UNANSWERED,
        key,
        label: request.label,
        send: request.send,
        changed: request.changed,
        revert: null,
        undone: request.undone,
        answers: lastUsed(),
        details: request.details ?? null,
        state: 'saving',
        undoable: request.undoable ?? true,
        undoUntil: null,
        raisedAt: Date.now(),
      };
      setLines(current => withRoom(current, line));
      setOpening(null);
      setDetails(null);
      attempt(key, request.send, request.changed);
    },
    [attempt],
  );

  const retry = useCallback(
    (line: LoggedLine) => {
      // An undo that was refused is tried as it was asked, and shows that it is.
      if (line.failure === 'undo') return undo(line);
      change(line.key, { state: 'saving', failure: null, reason: null, waiting: false });
      attempt(line.key, line.send, line.changed);
    },
    [attempt, change, undo],
  );

  // A toast's Undo is about the page it was raised on, and does not ride along to another: what was said there goes
  // with it. A line still being written, or one that failed, stays until it has its answer.
  const { pathname } = useLocation();
  const shownOn = useRef(pathname);
  useEffect(() => {
    if (shownOn.current === pathname) return;
    shownOn.current = pathname;
    const lead = Date.now() - LEADS_MS;
    setLines(current => current.filter(line => line.state !== 'saved' || line.raisedAt > lead));
  }, [pathname]);

  const sheetOpen = opening !== null;
  const state = {
    openSheet: useCallback((next: LogOpening = {}) => {
      setDetails(null);
      setOpening(next);
    }, []),
    openDetails: useCallback(
      (kind: TileKind, target: LogTarget, entry: Entry | null = null, at: Date | null = null, taskId: string | null = null) => {
        // A new line whose kind was chosen on the sheet leads back to the sheet, pointed where it was.
        const from = sheetOpen && entry === null ? { growId: target.growId, spaceId: target.standsIn ?? target.spaceId } : null;
        setOpening(null);
        setDetails({ kind, target, entry, at, from, taskId });
      },
      [sheetOpen],
    ),
    log,
    complete: useCallback(
      (taskId: string, label: string, options: CompleteOptions = {}) => {
        // A card tapped twice is one instruction: the second tap comes before
        // the first has answered, which is the only moment the card is still
        // there to tap. The server refuses a second tick as well.
        if (ticking.current.has(taskId)) return;
        ticking.current.add(taskId);

        log({
          label,
          undoable: options.undoable,
          changed: options.changed,
          undone: t('log.reopened'),
          send: () => completeTask(taskId).finally(() => ticking.current.delete(taskId)),
        });
      },
      [log, t],
    ),
    tell: useCallback(({ label, from, ...back }: Told) => {
      const told = { ...saying(label), key: nextKey.current++, send: () => Promise.reject(new Error('nothing to send')), from, answers: lastUsed() };
      setLines(current =>
        withRoom(current, { ...told, revert: back.undo, undone: back.undo ? back.undone : undefined, undoable: back.undo !== null }),
      );
    }, []),
  };

  const close = () => setDetails(null);
  const back = details?.from
    ? () => {
        setOpening(details.from);
        setDetails(null);
      }
    : null;

  return (
    <LogContext value={state}>
      {children}
      {opening ? <LogSheet opening={opening} lastKey={lastTarget} onChosen={setLastTarget} onClose={() => setOpening(null)} /> : null}
      {details?.kind === 'photo' && !details.entry ? <PhotoEntry target={details.target} at={details.at} onBack={back} onClose={close} /> : null}
      {details && (details.kind !== 'photo' || details.entry) ? (
        <EntryDetails
          kind={details.kind}
          target={details.target}
          entry={details.entry}
          at={details.at}
          taskId={details.taskId}
          onBack={back}
          onClose={close}
        />
      ) : null}
      <Toasts lines={lines} onUndo={undo} onRetry={retry} onDismiss={dismiss} onDetails={openDetailsOf(setDetails)} />
    </LogContext>
  );
}

/** What the toast says instead of the generic line: a refusal's sentence written for the person; anything else has none. */
const reasonOf = (error: unknown): string | null => (error instanceof ApiError ? refusalText(error) : null);

/** The toast's Details: the line that was just written, opened in the tile it came from. */
const openDetailsOf = (setDetails: (details: Details) => void) => (line: LoggedLine) => {
  if (line.details) setDetails({ ...line.details, entry: line.entry, at: null, from: null });
};
