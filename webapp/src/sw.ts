/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';
import { pathOf, payloadOf } from './screens/notifications/push-route';

/**
 * The service worker: what is kept for offline, and what a push says when it
 * arrives.
 *
 * The caching half is what the plugin used to generate on its own - the shell
 * and both catalogues precached, the drawings kept once they are looked at.
 * It is written out here because a generated worker has no ear for a push: the
 * browser hands a push to the worker and to nothing else, so a worker without
 * these two handlers is a subscription that shows nobody anything.
 */

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
registerRoute(({ url }) => url.pathname.startsWith('/assets/'), new StaleWhileRevalidate({ cacheName: 'assets' }));

self.addEventListener('push', event => {
  const payload = payloadOf(event.data);

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Terp Control', {
      body: payload.body,
      icon: '/assets/icons/icon-192.png',
      // One notification per thing: a repeat of the same alarm replaces the last one rather than stacking.
      tag: payload.subject?.id ?? undefined,
      data: { url: pathOf(payload) },
    }),
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | undefined)?.url ?? '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
      const open = clients.find(client => client.url.startsWith(self.location.origin));
      if (open) {
        await open.focus();
        await open.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    }),
  );
});
