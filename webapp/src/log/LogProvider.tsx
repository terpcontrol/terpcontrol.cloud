import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { Entry } from '@fg2/shared-types/v1';
import { completeTask, diaryChanged, takeEntryBack } from '@/api/entries';
import { ApiError } from '@/api/problem';
import { LogContext, type CompleteOptions, type LogOpening, type LogRequest, type LogTarget, type TileKind } from './log-context';
import { LogSheet } from './LogSheet';
import { EntryDetails } from './EntryDetails';
import { PhotoEntry } from './PhotoEntry';
import { Toasts, type LoggedLine } from './Toasts';
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

interface Details {
  kind: TileKind;
  target: LogTarget;
  entry: Entry | null;
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

  const dismiss = useCallback((key: number) => setLines(current => current.filter(line => line.key !== key)), []);

  const change = useCallback((key: number, over: Partial<LoggedLine>) => {
    setLines(current => current.map(line => (line.key === key ? { ...line, ...over } : line)));
  }, []);

  const remove = useCallback(
    (key: number, entry: Entry) =>
      takeEntryBack(entry.id).then(
        () => {
          diaryChanged(client);
          dismiss(key);
        },
        error => change(key, { state: 'failed', failure: 'undo', entry, reason: reasonOf(error) }),
      ),
    [change, client, dismiss],
  );

  /** One attempt at one line. Undo pressed meanwhile is remembered here, so the line is taken back as soon as it exists. */
  const attempt = useCallback(
    (key: number, send: () => Promise<Entry>) => {
      void send().then(
        entry => {
          if (takenBack.current.delete(key)) return void remove(key, entry);
          change(key, { state: 'saved', entry, undoUntil: Date.now() + UNDO_MS });
          diaryChanged(client);
        },
        error => change(key, { state: 'failed', failure: 'write', reason: reasonOf(error) }),
      );
    },
    [change, client, remove],
  );

  const log = useCallback(
    (request: LogRequest) => {
      const key = nextKey.current++;
      const line: LoggedLine = {
        key,
        label: request.label,
        send: request.send,
        details: request.details ?? null,
        state: 'saving',
        failure: null,
        reason: null,
        undoing: false,
        entry: null,
        undoable: request.undoable ?? true,
        undoUntil: null,
      };
      setLines(current => [...current, line]);
      setOpening(null);
      setDetails(null);
      attempt(key, request.send);
    },
    [attempt],
  );

  const undo = useCallback(
    (line: LoggedLine) => {
      if (line.state === 'saving') {
        // It has no id yet. The line is taken back the moment the server answers with one.
        takenBack.current.add(line.key);
        change(line.key, { undoing: true });
      } else if (line.entry) {
        change(line.key, { undoing: true });
        void remove(line.key, line.entry);
      } else dismiss(line.key);
    },
    [change, dismiss, remove],
  );

  const retry = useCallback(
    (line: LoggedLine) => {
      change(line.key, { state: 'saving', failure: null, reason: null });
      if (line.failure === 'undo' && line.entry) void remove(line.key, line.entry);
      else attempt(line.key, line.send);
    },
    [attempt, change, remove],
  );

  const state = {
    openSheet: useCallback((next: LogOpening = {}) => {
      setDetails(null);
      setOpening(next);
    }, []),
    openDetails: useCallback((kind: TileKind, target: LogTarget, entry: Entry | null = null) => {
      setOpening(null);
      setDetails({ kind, target, entry });
    }, []),
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
          send: () => completeTask(taskId).finally(() => ticking.current.delete(taskId)),
        });
      },
      [log],
    ),
  };

  const close = () => setDetails(null);

  return (
    <LogContext value={state}>
      {children}
      {opening ? <LogSheet opening={opening} lastKey={lastTarget} onChosen={setLastTarget} onClose={() => setOpening(null)} /> : null}
      {details?.kind === 'photo' ? <PhotoEntry target={details.target} onClose={close} /> : null}
      {details && details.kind !== 'photo' ? (
        <EntryDetails kind={details.kind} target={details.target} entry={details.entry} onClose={close} />
      ) : null}
      <Toasts lines={lines} onUndo={undo} onRetry={retry} onDismiss={dismiss} onDetails={openDetailsOf(setDetails)} />
    </LogContext>
  );
}

/**
 * What the toast says instead of the generic line. A refusal carries a sentence
 * written for the person - which tent it was, which rule stood in the way - and
 * that is worth far more than "could not save"; anything else has nothing to say.
 */
const reasonOf = (error: unknown): string | null => (error instanceof ApiError ? refusalText(error) : null);

/** The toast's Details: the line that was just written, opened in the tile it came from. */
const openDetailsOf = (setDetails: (details: Details) => void) => (line: LoggedLine) => {
  if (line.details) setDetails({ ...line.details, entry: line.entry });
};
