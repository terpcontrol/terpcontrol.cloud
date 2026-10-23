import { matchRoutes } from 'react-router';
import { prefetchHome } from '@/api/home';
import { session } from '@/api/session';
import { router, SESSION_ROUTE } from './routes';

/**
 * Starts what a screen behind the session waits for, before the first render
 * rather than after it.
 *
 * Opened cold, the app used to take its steps one after the other: the
 * catalogues, a render, the session's refresh from `RequireSession`, another
 * render, and only then the home - which every screen in the shell reads, for
 * its navigation if not for itself, and which is the slowest answer the app
 * asks for. None of the three needs the others' answers, except the home the
 * session's token, so here they are set going side by side with the catalogues.
 *
 * Only where the address stands behind the session: the public pages decide
 * for themselves whether a stored session is any of their business, and a
 * stranger's link to a shared grow must not spend somebody's refresh token.
 *
 * The home is asked for only once the session is live. Asked with none, it
 * would fail, and a first read that failed is drawn as one even after the
 * session comes back.
 */
export const warmUp = (location: Pick<Location, 'pathname'>): void => {
  const behindSession = matchRoutes(router.routes, location.pathname)?.some(match => match.route.id === SESSION_ROUTE) ?? false;
  if (!behindSession) return;

  void session.restore().then(() => {
    if (session.snapshot().tokens) void prefetchHome();
  });
};
