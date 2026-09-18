import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './shell/AppShell';
import { RequireSession } from './RequireSession';
import { Alerts } from '@/screens/Alerts';
import { Devices } from '@/screens/Devices';
import { GrowPage } from '@/screens/grow/GrowPage';
import { Home } from '@/screens/Home';
import { LogRoute } from '@/log/LogRoute';
import { Me } from '@/screens/Me';
import { NotFound } from '@/screens/NotFound';
import { SignIn } from '@/screens/SignIn';
import { SpacePage } from '@/screens/space/SpacePage';
import { Tasks } from '@/screens/Tasks';
import { Timeline } from '@/screens/Timeline';

/**
 * The five tabs, the account page, the alerts behind the bell, and the two
 * pages a home card opens: a grow and a space, each with its tab in the path so
 * a tab survives a reload. Every screen below the shell is behind a session;
 * the sign-in page is the only route that is not.
 *
 * `Log` is a route as well, so that a link and a notification can open the
 * sheet; it is not a screen of its own, and gives the address straight back to
 * the one it opened over.
 */
export const router = createBrowserRouter([
  { path: '/sign-in', element: <SignIn /> },
  {
    element: (
      <RequireSession>
        <AppShell />
      </RequireSession>
    ),
    children: [
      { index: true, element: <Home /> },
      { path: 'timeline', element: <Timeline /> },
      { path: 'log', element: <LogRoute /> },
      { path: 'devices', element: <Devices /> },
      { path: 'tasks', element: <Tasks /> },
      { path: 'me', element: <Me /> },
      { path: 'alerts', element: <Alerts /> },
      { path: 'grows/:growId/:tab?', element: <GrowPage /> },
      { path: 'spaces/:spaceId/:tab?', element: <SpacePage /> },
      { path: 'index.html', element: <Navigate to="/" replace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
