import { DateTime } from 'luxon';
import type { MediaWindow } from '@fg2/shared-types/v1';

/**
 * Why a rolling film would hold no picture at all, as the key of the sentence
 * that says so, or null where it may. The camera page's one-tap buttons and the
 * composer's chips of the same name ask this one question, so the two cannot
 * offer different films under one word: the composer's Today used to queue a
 * render for a camera the button beside it had already said was dark.
 *
 * Each window is proved empty by its own arithmetic. The day holding now never
 * starts earlier than a day ago, so a newest picture older than that proves it
 * empty whatever zone anybody is in; the week the server picks when it is named
 * no instant is the complete one before the open one, which cannot begin
 * earlier than a fortnight ago. Both are the conservative half of the rule.
 */
export const emptyRolling = (window: MediaWindow, lastStillAt: string | null, now: DateTime): string | null => {
  const nothingSince = (days: number): boolean => lastStillAt === null || DateTime.fromISO(lastStillAt) < now.minus({ days });
  if (window === 'day') return nothingSince(1) ? 'camera.noPictureToFilm' : null;
  if (window === 'week') return nothingSince(14) ? 'camera.noPictureThatWeek' : null;
  return null;
};
