import type { DateTime } from 'luxon';
import { serverNow } from '@/api/clock';
import { DAY_MS } from '@/ui/days';
import { readStored, writeStored } from '@/ui/stored';

/**
 * When this browser last drew Start from an answer, kept so that a Start that
 * cannot load says how old its picture of things is.
 */
const keyOf = (userId: string) => `terp.loaded.${userId}`;

export const noteLoaded = (userId: string | null, at: string): void => {
  if (userId) writeStored(keyOf(userId), at);
};

export const lastLoaded = (userId: string | null): string | null => (userId ? readStored(keyOf(userId)) : null);

const laterKey = (spaceId: string) => `terp.growLater.${spaceId}`;

/**
 * "Jetzt nicht" at the end of setting a device up puts the question off for a day, in this browser: the place's Start
 * it leads to does not ask it again at once.
 */
export const putGrowOff = (spaceId: string): void => writeStored(laterKey(spaceId), serverNow().toISO());

export const growPutOff = (spaceId: string, now: DateTime): boolean => {
  const at = readStored(laterKey(spaceId));
  return at !== null && now.toMillis() - Date.parse(at) < DAY_MS;
};
