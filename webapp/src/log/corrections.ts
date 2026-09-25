import type { Entry } from '@fg2/shared-types/v1';
import { useSession } from '@/api/session';
import { enough, useMayWith } from '@/ui/session-access';
import { useLog, type LogTarget, type TileKind } from './log-context';

/**
 * Correcting a line that is already written.
 *
 * A figure read off a tape wrongly is read wrongly on the row that carries it
 * and nowhere else, so every surface that draws a diary has to be a way back
 * into the line it is drawing. The toast's Undo is a slip caught in five
 * seconds; this is somebody deciding days later that the pH was 6.1, and the
 * server has always allowed it - the screens simply had no way in except from a
 * plant's page, which a grow migrated from the old app has none of.
 *
 * The decision lives here rather than in each surface so that the four of them
 * cannot start disagreeing about who may correct what.
 */

/**
 * The kinds the details sheet holds. Stepping in is among them although its
 * toast has no Undo: the quiet it started cannot be called off, but the line is
 * an ordinary diary line afterwards, and the sheet that asked for it promised
 * that the line can be taken back.
 */
const CORRECTABLE: TileKind[] = ['water', 'feed', 'note', 'measurement', 'training', 'visit'];

/**
 * Which sheet this line would be corrected in, or null where it is not a
 * person's line to correct. What a device, the plan or an alarm recorded is not
 * ours to rewrite.
 */
export const correctableKind = (entry: Entry): TileKind | null =>
  entry.source === 'human' ? (CORRECTABLE.find(kind => kind === entry.kind) ?? null) : null;

/**
 * What the correction is about, taken from the line rather than from the screen
 * it was opened on: a line corrected from a tent's rail must not quietly move
 * onto that tent, and one corrected from a plant's page must not move onto that
 * plant.
 */
export const targetOf = (entry: Entry, label: string, dayNumber: number | null): LogTarget => ({
  key: `entry:${entry.id}`,
  label,
  growId: entry.growId,
  spaceId: entry.spaceId,
  plantIds: entry.plantIds,
  dayNumber,
  standsIn: entry.spaceId,
});

/** What the surface knows about the line that the line itself does not say. */
export interface LineOn {
  /** What the sheet and its toast call what the line is about: the grow's name, the tent's. */
  label: string;
  /** The grow's day the line falls on, where the surface counts in them. */
  dayNumber?: number | null;
  /** Who owns the thing being drawn, where the surface is of one thing; a tent's rail draws many and has none. */
  ownerId?: string | null;
  /** The place that decides what may be done here, which is the place the server decides by. */
  spaceId: string | null;
}

/**
 * The handler a diary row is given to open one of its lines, or nothing where
 * this session may not correct that one.
 *
 * Whose line it is decides who may open it: one's own needs `log` and anybody
 * else's needs `manage`, which is the rule the server writes down in one place
 * and these rows have to agree with - otherwise a member taps somebody else's
 * reading, fills the sheet in and is refused on save.
 *
 * It is a hook returning a function because a list is drawn in a loop and a
 * hook is not called in one.
 */
export const useCorrecting = (): ((entry: Entry, on: LineOn) => (() => void) | undefined) => {
  const { user } = useSession();
  const { openDetails } = useLog();
  const mayWith = useMayWith();

  return (entry, on) => {
    const kind = correctableKind(entry);
    if (kind === null) return undefined;

    const mine = user !== null && !user.isDemo && entry.authorId === user.id;
    if (!enough(mayWith({ ownerId: on.ownerId ?? null, spaceId: on.spaceId }), mine ? 'log' : 'manage')) return undefined;

    return () => openDetails(kind, targetOf(entry, on.label, on.dayNumber ?? null), entry);
  };
};
