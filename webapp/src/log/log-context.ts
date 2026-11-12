import type { QueryClient } from '@tanstack/react-query';
import { createContext, use } from 'react';
import type { Entry, HumanEntryKind } from '@fg2/shared-types/v1';

/**
 * Logging, reachable from every screen: the Eintrag button opens the sheet over
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

/**
 * What a line can be. `phase` is the one that is not an entry of its own: it
 * is written as a phase and shows up as one. A `visit` is no tile - stepping
 * in is started as maintenance, from Start and from a device - but a line of
 * it written before is still corrected like the others.
 */
export type TileKind = HumanEntryKind | 'phase';

/** The seven tiles of the sheet, in the order they are drawn. */
export const TILE_KINDS: TileKind[] = ['water', 'feed', 'photo', 'note', 'measurement', 'training', 'phase'];

/** Where the sheet opens: the screen it was opened from, or a link that names the place and the tile. */
export interface LogOpening {
  growId?: string | null;
  spaceId?: string | null;
  kind?: TileKind | null;
  /**
   * The place was read off the page the sheet was opened over rather than
   * named by a link, so a miss - an ended grow's page, a tent the home does
   * not list - falls back to the chip chosen last time instead of refusing.
   */
  underneath?: boolean;
}

/** A line on its way to the server, and what a retry would send again. */
export interface LogRequest {
  /** What the toast says: "Watered · Spring run · Day 34". */
  label: string;
  /** `progress` is for a line that takes a while, the photo line's uploads: how many of how many are done. */
  send: (progress: (done: number, total: number) => void) => Promise<Entry>;
  /** The tile whose details the toast offers afterwards; absent where there are none to offer. */
  details?: { kind: TileKind; target: LogTarget } | null;
  /** What landing the line changed beyond the diary, read again with it. */
  changed?: (client: QueryClient) => void;
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
  /** What the tick changed beyond the diary - a plan it moved on - read again once it has landed. */
  changed?: (client: QueryClient) => void;
}

/** Something that was done already, said in the toast with the way to take it back. */
export interface Told {
  label: string;
  /** Takes it back; a refusal is said in the toast, which then offers to try again. */
  undo: () => Promise<unknown>;
}

interface LogState {
  openSheet: (opening?: LogOpening) => void;
  /** Opens one kind's view: on a line to correct, or on a new one dated to `at` where the sheet was told when. */
  openDetails: (kind: TileKind, target: LogTarget, entry?: Entry | null, at?: Date | null) => void;
  /** Write a line now: the sheet closes, the toast appears, and the request is somebody else's problem. */
  log: (request: LogRequest) => void;
  /** The Done on a due card, which writes the entry the task implies. */
  complete: (taskId: string, label: string, options?: CompleteOptions) => void;
  /** Says what a tap just did where the tap took its own button away - an offer declined - and offers to take it back. */
  tell: (told: Told) => void;
}

export const LogContext = createContext<LogState | null>(null);

export function useLog(): LogState {
  const state = use(LogContext);
  if (!state) throw new Error('useLog outside LogProvider');
  return state;
}
