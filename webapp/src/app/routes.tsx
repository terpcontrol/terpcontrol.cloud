import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './shell/AppShell';
import { RequireSession } from './RequireSession';
import { AddCamera } from '@/screens/camera/add/AddCamera';
import { Alerts } from '@/screens/Alerts';
import { CameraPage } from '@/screens/camera/CameraPage';
import { Charts } from '@/screens/charts/Charts';
import { Claim } from '@/screens/claim/Claim';
import { Devices } from '@/screens/devices/Devices';
import { GrowPage } from '@/screens/grow/GrowPage';
import { Home } from '@/screens/Home';
import { LogRoute } from '@/log/LogRoute';
import { Me } from '@/screens/Me';
import { Measurements } from '@/screens/grow/measurements/Measurements';
import { NewGrowRoute } from '@/screens/grow/new/NewGrowRoute';
import { NotFound } from '@/screens/NotFound';
import { PlantPage } from '@/screens/grow/plant/PlantPage';
import { Notifications } from '@/screens/notifications/Notifications';
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
 * Adding a device is a route of its own as well: it is four steps long, every
 * one of them writes as it is answered, and a link may land straight on it with
 * a claim code already in hand.
 *
 * `Log` is a route as well, so that a link and a notification can open the
 * sheet; it is not a screen of its own, and gives the address straight back to
 * the one it opened over. The new-grow sheet has an address for the same
 * reason, and stands over the home when it is followed cold. A camera is the
 * third page a row opens, beside the grow and the space, and adding one is a
 * page of its own above it: a static segment outranks the parameter beside it,
 * so `/cameras/add` is never read as a camera called "add".
 *
 * A grow has two pages below it rather than tabs: what it measures, and one of
 * its plants. Both are about something narrower than the grow and are reached
 * from it, and both keep their own address so that a plant can be linked to.
 * Their static segments outrank the grow's tab parameter beside them, so
 * `plants` is never read as a tab called "plants" once a plant follows it.
 *
 * Charts is a route rather than a tab for the same reason: it is opened from
 * the Timeline header and from a tent page, and carries the grow or the place
 * it is about in its query, so a link to a particular chart is a link somebody
 * can send.
 *
 * A space's tab may have a page of its own below it - the manual targets and
 * the alarm rules under Control - which is the third segment, so that a link
 * from an alert can open the rule it came from and a reload lands where it was.
 * The notification settings are the one page below Me.
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
      { path: 'charts', element: <Charts /> },
      { path: 'log', element: <LogRoute /> },
      { path: 'devices', element: <Devices /> },
      { path: 'claim', element: <Claim /> },
      { path: 'cameras/add', element: <AddCamera /> },
      { path: 'cameras/:cameraId', element: <CameraPage /> },
      { path: 'tasks', element: <Tasks /> },
      { path: 'me', element: <Me /> },
      { path: 'me/notifications', element: <Notifications /> },
      { path: 'alerts', element: <Alerts /> },
      { path: 'grows/new', element: <NewGrowRoute /> },
      { path: 'grows/:growId/measurements', element: <Measurements /> },
      { path: 'grows/:growId/plants/:plantId', element: <PlantPage /> },
      { path: 'grows/:growId/:tab?', element: <GrowPage /> },
      { path: 'spaces/:spaceId/:tab?/:sub?', element: <SpacePage /> },
      { path: 'index.html', element: <Navigate to="/" replace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
