import { useEffect, useRef } from 'react';
import type { Unsaved } from './LeaveGuard';

/**
 * Hands a panel's draft up to the `LeaveGuard` while there is something to
 * lose, so that leaving the page asks about it. Read through a ref, because the
 * draft a question saves is the one standing when it is answered and not when
 * it was first asked.
 */
export const useReportUnsaved = (report: (id: string, entry: Unsaved | null) => void, id: string, unsaved: boolean, entry: Unsaved): void => {
  const latest = useRef(entry);
  useEffect(() => {
    latest.current = entry;
  });
  useEffect(() => {
    if (!unsaved) return;
    report(id, { save: () => latest.current.save(), discard: () => latest.current.discard() });
    return () => report(id, null);
  }, [unsaved, id, report]);
};
