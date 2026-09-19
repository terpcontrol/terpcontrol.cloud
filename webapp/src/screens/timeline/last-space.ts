import { useEffect } from 'react';

/**
 * Which place the Timeline tab lands on. The tab is one of five and cannot ask
 * a question before it draws something, so it opens the place that was last
 * looked at - a preference of this browser, not a fact about the account, which
 * is why it lives here and not on the server.
 */
const KEY = 'terp.timeline.space';

export const lastSpace = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const rememberSpace = (spaceId: string) => {
  try {
    localStorage.setItem(KEY, spaceId);
  } catch {
    // Private mode: the tab then opens on whatever the home lists first, which is no worse.
  }
};

export const useRememberSpace = (spaceId: string) => {
  useEffect(() => {
    if (spaceId) rememberSpace(spaceId);
  }, [spaceId]);
};
