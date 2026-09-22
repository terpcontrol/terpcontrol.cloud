import { createContext, use } from 'react';
import type { Entry, HumanEntryKind } from '@fg2/shared-types/v1';
import { useSession } from '@/api/session';

/**
 * Logging, reachable from every screen: the raised button opens the sheet over
 * whatever you were looking at, a due card ticks itself off, and what was
 * written stays on screen long enough to be taken back.
 *
 * The state lives above the routes because none of it belongs to a screen - a
 * line written on the home is still being saved while the tent page is open.
 */

/** What a line is written against: a grow, the space it stands in, or single plants of it. */
export interface LogTarget {
  key: string;
  label: string;
  growId: string | null;
  spaceId: string | null;
  /** Empty is "whatever the target is"; one id is a single plant. */
  plantIds: string[];
  dayNumber: number | null;
  /**
   * The space this target is in right now. It is not what the line is written
   * against - a line about a grow stays about the grow when the grow moves -
   * but it is where the cameras are and which chip the sheet opens on.
   */
  standsIn: string | null;
}

/** The eight tiles. `phase` is the one that is not an entry of its own: it is written as a phase and shows up as one. */
export type TileKind = HumanEntryKind | 'phase';

/** Where the sheet opens: the screen it was opened from, or a link that names the place and the tile. */
export interface LogOpening {
  growId?: string | null;
  spaceId?: string | null;
  kind?: TileKind | null;
}

/** A line on its way to the server, and what a retry would send again. */
export interface LogRequest {
  /** What the toast says: "Watered · Spring run · Day 34". */
  label: string;
  send: () => Promise<Entry>;
  /** The tile whose details the toast offers afterwards; absent where there are none to offer. */
  details?: { kind: TileKind; target: LogTarget } | null;
  /**
   * Whether the toast may offer to take the line back, which is true of
   * everything a person writes by hand. It is false where deleting the diary
   * line would leave the rest of what the tick set in motion standing, and a
   * button that undoes half of something is worse than no button at all.
   */
  undoable?: boolean;
}

/** What a tick may still be taken back, for the ticks where taking it back would only be half of one. */
export interface CompleteOptions {
  undoable?: boolean;
}

export interface LogState {
  openSheet: (opening?: LogOpening) => void;
  openDetails: (kind: TileKind, target: LogTarget, entry?: Entry | null) => void;
  /** Write a line now: the sheet closes, the toast appears, and the request is somebody else's problem. */
  log: (request: LogRequest) => void;
  /** The Done on a due card, which writes the entry the task implies. */
  complete: (taskId: string, label: string, options?: CompleteOptions) => void;
}

export const LogContext = createContext<LogState | null>(null);

export function useLog(): LogState {
  const state = use(LogContext);
  if (!state) throw new Error('useLog outside LogProvider');
  return state;
}

/**
 * Whether this session may write at all. The demo is a tour of somebody else's
 * account - it reads everything and the server refuses every line - so the
 * button, the tile and the Done are not offered rather than offered and refused.
 */
export const useMayLog = (): boolean => {
  const { user } = useSession();

  return user !== null && !user.isDemo;
};
