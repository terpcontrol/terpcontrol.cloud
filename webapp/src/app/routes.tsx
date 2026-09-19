import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './shell/AppShell';
import { RequireSession } from './RequireSession';
import { Alerts } from '@/screens/Alerts';
import { CameraPage } from '@/screens/camera/CameraPage';
import { Devices } from '@/screens/devices/Devices';
import { GrowPage } from '@/screens/grow/GrowPage';
import { Home } from '@/screens/Home';
import { LogRoute } from '@/log/LogRoute';
import { Me } from '@/screens/Me';
import { NotFound } from '@/screens/NotFound';
import { PublicGrowRoute } from '@/screens/public/PublicGrowRoute';
import { PublicProfileRoute } from '@/screens/public/PublicProfileRoute';
import { SharedRoute } from '@/screens/public/SharedRoute';
import { SignIn } from '@/screens/SignIn';
import { SpacePage } from '@/screens/space/SpacePage';
import { Tasks } from '@/screens/Tasks';
import { Timeline } from '@/screens/Timeline';

/**
 * The five tabs, the account page, the alerts behind the bell, and the two
 * pages a home card opens: a grow and a space, each with its tab in the path so
 * a tab survives a reload. Every screen below the shell is behind a session;
 * the sign-in page and the three public addresses are the routes that are not.
 *
 * The public three sit outside the session gate rather than behind a check
 * inside it, so a stranger who follows a link never meets the sign-in page and
 * never sees a frame of it either. `/@{handle}` is matched as a whole first
 * segment because React Router reads a parameter only where a colon follows a
 * slash - which is also why it ranks below every named route and cannot take
 * `/timeline` or `/me` from the shell.
 *
 * `Log` is a route as well, so that a link and a notification can open the
 * sheet; it is not a screen of its own, and gives the address straight back to
 * the one it opened over. A camera is the third page a row opens, beside the
 * grow and the space.
 */
export const router = createBrowserRouter([
  { path: '/sign-in', element: <SignIn /> },
  { path: '/g/:slug', element: <PublicGrowRoute /> },
  { path: '/shared/:token', element: <SharedRoute /> },
  { path: '/:handle', element: <PublicProfileRoute /> },
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
      { path: 'cameras/:cameraId', element: <CameraPage /> },
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
