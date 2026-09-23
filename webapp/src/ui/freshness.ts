import { useEffect, useSyncExternalStore } from 'react';

/**
 * The line under the wordmark: how old what is on the screen is. A screen
 * reports the instant its data was last confirmed - a device's newest sample
 * once there are cards, the fetch that answered until then - and the shell
 * puts it into words. It is a module store rather than context so a screen
 * deep in the tree does not need a provider to reach it.
 */

let latest: string | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const read = () => latest;

const report = (at: string | null) => {
  if (at === latest) return;
  latest = at;
  for (const listener of listeners) listener();
};

export const useFreshness = (): string | null => useSyncExternalStore(subscribe, read, read);

/**
 * Reported while the screen is mounted; a screen with nothing to report leaves
 * the line blank. The instant is one the server stamped, or one this browser
 * noted restated on the server's clock with `fetchedAt`, because the line under
 * the wordmark ages it against the server's now like every other age.
 */
export const useReportFreshness = (at: string | null) => {
  useEffect(() => {
    report(at);
    return () => report(null);
  }, [at]);
};
