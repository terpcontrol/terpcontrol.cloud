/**
 * What this browser keeps for itself in localStorage: a preference, a guess
 * for the first frame, an id to clean up later. Storage that is blocked - a
 * private window, a locked-down browser - throws on every call, and nothing
 * kept here is worth refusing a tap over: a read then answers null, which every
 * caller takes as its default, and a write is not kept.
 */
export const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** A value kept as JSON, or null where there is none or it does not parse. */
export const readStoredJson = <T>(key: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
};

/** Keeps a value, or forgets it where it is null. */
export const writeStored = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not kept: the next read answers the caller's default.
  }
};
