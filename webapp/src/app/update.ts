/**
 * A new release, taken up by the open page.
 *
 * The service worker of a new release activates at once and claims every open
 * window (`src/sw.ts`). The page still runs the code it loaded, against a
 * worker that now answers with the new release's files - so it reloads once,
 * as soon as it is handed to the new worker. A page that had no worker yet - the
 * very first visit - is handed one too, and has nothing old to throw away.
 *
 * The browser looks for a new worker on a navigation, and an app that never
 * navigates - one left open on a tablet beside the tent, an installed app sent
 * to the background - would never look. So it also looks whenever the app is
 * brought back to the front.
 */
export const followReleases = (): void => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const worker = navigator.serviceWorker;

  // Kept here rather than read when the event fires: by then the new worker is already the controller. A page
  // first claimed on its first visit still reloads for the release after.
  let controlled = worker.controller !== null;
  let reloading = false;
  worker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // Offline, the look fails; the next time the app comes to the front it looks again.
    worker
      .getRegistration()
      .then(registration => registration?.update())
      .catch(() => undefined);
  });
};
