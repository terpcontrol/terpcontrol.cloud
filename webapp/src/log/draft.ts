import type { Entry, GrowthStage } from '@fg2/shared-types/v1';
import type { LogTarget, TileKind } from './log-context';

/**
 * A line half written when a release takes the page over. A release reloads at once (Chris, 2026-10-09), and the app
 * looks for one whenever it comes back to the front - which is just when a half-written entry waits, after the camera
 * or a messenger. So the open sheet's draft is kept for this tab across the reload, and the sheet opens on it again.
 */
export interface Draft {
  kind: TileKind;
  target: LogTarget;
  /** The line being corrected; null for a new one. */
  entry: Entry | null;
  /** When the line was dated to; null is now. */
  at: string | null;
  taskId: string | null;
  litres: number | null;
  readings: Record<string, string>;
  shown: string[];
  text: string;
  plantIds: string[];
  stage: GrowthStage | null;
}

const KEY = 'terp.draft';

let reader: (() => Draft | null) | null = null;

/** The open sheet says how its draft is read, and takes that back as it closes. */
export const holdDraft = (read: () => Draft | null): (() => void) => {
  reader = read;
  return () => {
    if (reader === read) reader = null;
  };
};

/** Kept for this tab, before a release reloads it. Storage that is blocked keeps nothing, as before. */
export const keepDraft = (): void => {
  const draft = reader?.() ?? null;
  if (!draft) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Nowhere to keep it.
  }
};

/** The draft a reload kept, read without forgetting it: a page drawn twice reads it twice. */
export const keptDraft = (): Draft | null => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Draft | null;
  } catch {
    return null;
  }
};

/** Once the sheet stands open on it again, it is the sheet's. */
export const forgetDraft = (): void => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was kept.
  }
};
