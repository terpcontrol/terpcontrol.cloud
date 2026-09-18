import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './shell/AppShell';
import { RequireSession } from './RequireSession';
import { Alerts } from '@/screens/Alerts';
import { Devices } from '@/screens/Devices';
import { Home } from '@/screens/Home';
import { LogSheet } from '@/screens/LogSheet';
import { Me } from '@/screens/Me';
import { NotFound } from '@/screens/NotFound';
import { SignIn } from '@/screens/SignIn';
import { Tasks } from '@/screens/Tasks';
import { Timeline } from '@/screens/Timeline';

/**
 * The five tabs, the account page and the alerts behind the bell, and nothing else yet. Every screen below
 * the shell is behind a session; the sign-in page is the only route that is not.
 *
 * `Log` is a route as well as the raised button, so it can be linked to and so
 * a wide window can show it as a page rather than as a sheet.
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
      { path: 'log', element: <LogSheet /> },
      { path: 'devices', element: <Devices /> },
      { path: 'tasks', element: <Tasks /> },
      { path: 'me', element: <Me /> },
      { path: 'alerts', element: <Alerts /> },
      { path: 'index.html', element: <Navigate to="/" replace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
