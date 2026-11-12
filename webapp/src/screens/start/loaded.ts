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
