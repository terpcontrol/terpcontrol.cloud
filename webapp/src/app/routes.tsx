import { createBrowserRouter, Navigate, Outlet, type RouteObject } from 'react-router';
import { AppShell } from './shell/AppShell';
import { LinkEnded, OldDevice, OldLogin, OpenDemo } from './OldAddresses';
import { RequireSession } from './RequireSession';
import { RouteError } from './RouteError';
import { Activate } from '@/screens/Activate';
import { AddCamera } from '@/screens/camera/add/AddCamera';
import { AdminOnly } from '@/screens/admin/AdminOnly';
import { Users as AdminUsers } from '@/screens/admin/Users';
import { Alerts } from '@/screens/Alerts';
import { CameraPage } from '@/screens/camera/CameraPage';
import { Charts } from '@/screens/charts/Charts';
import { Claim } from '@/screens/claim/Claim';
import { Demo } from '@/screens/admin/Demo';
import { DeviceDiagnosis } from '@/screens/admin/DeviceDiagnosis';
import { Devices } from '@/screens/devices/Devices';
import { FirmwareScreen } from '@/screens/admin/Firmware';
import { Fleet } from '@/screens/admin/Fleet';
import { GrowPage } from '@/screens/grow/GrowPage';
import { MyGrows } from '@/screens/grow/MyGrows';
import { Home } from '@/screens/Home';
import { JoinRoute } from '@/screens/join/JoinRoute';
import { LogRoute } from '@/log/LogRoute';
import { Me } from '@/screens/Me';
import { About } from '@/screens/me/about/About';
import { Account } from '@/screens/me/account/Account';
import { Appearance } from '@/screens/me/appearance/Appearance';
import { Privacy } from '@/screens/me/privacy/Privacy';
import { Premium } from '@/screens/me/premium/Premium';
import { Schemes } from '@/screens/me/schemes/Schemes';
import { Following } from '@/screens/me/sharing/Following';
import { PublicGrows } from '@/screens/me/sharing/PublicGrows';
import { ShareLinks } from '@/screens/me/sharing/ShareLinks';
import { Measurements } from '@/screens/grow/measurements/Measurements';
import { NewGrowRoute } from '@/screens/grow/new/NewGrowRoute';
import { NotFound } from '@/screens/NotFound';
import { PlantPage } from '@/screens/grow/plant/PlantPage';
import { ControlTab } from '@/screens/place/ControlTab';
import { OldPlaceLink } from '@/screens/place/OldPlaceLink';
import { PlaceMembers } from '@/screens/place/PlaceMembers';
import { PlacePage } from '@/screens/place/PlacePage';
import { Notifications } from '@/screens/notifications/Notifications';
import { PublicGrowRoute } from '@/screens/public/PublicGrowRoute';
import { PublicProfileRoute } from '@/screens/public/PublicProfileRoute';
import { Recover } from '@/screens/Recover';
import { SharedRoute } from '@/screens/public/SharedRoute';
import { SignIn } from '@/screens/SignIn';
import { PrivacyStatement } from '@/screens/PrivacyStatement';
import { SignUp } from '@/screens/SignUp';
import { Tasks } from '@/screens/Tasks';
import { Timeline } from '@/screens/Timeline';

/** Every screen behind the session, in the shell: the table a test can lay under the shell on its own. */
export const screens: RouteObject[] = [
  { index: true, element: <Home /> },
  { path: 'timeline', element: <Timeline /> },
  { path: 'control/:page?', element: <ControlTab /> },
  { path: 'charts', element: <Charts /> },
  { path: 'log', element: <LogRoute /> },
  { path: 'devices', element: <Devices /> },
  { path: 'claim', element: <Claim /> },
  { path: 'cameras/add', element: <AddCamera /> },
  { path: 'cameras/:cameraId', element: <CameraPage /> },
  { path: 'tasks', element: <Tasks /> },
  { path: 'me', element: <Me /> },
  { path: 'me/notifications', element: <Notifications /> },
  { path: 'me/privacy', element: <Privacy /> },
  { path: 'me/public', element: <PublicGrows /> },
  { path: 'me/following', element: <Following /> },
  { path: 'me/share-links', element: <ShareLinks /> },
  { path: 'me/premium', element: <Premium /> },
  { path: 'me/schemes', element: <Schemes /> },
  { path: 'me/appearance', element: <Appearance /> },
  { path: 'me/account', element: <Account /> },
  { path: 'me/about', element: <About /> },
  {
    path: 'admin',
    element: (
      <AdminOnly>
        <Outlet />
      </AdminOnly>
    ),
    children: [
      { path: 'fleet', element: <Fleet /> },
      { path: 'devices/:deviceId', element: <DeviceDiagnosis /> },
      { path: 'firmware', element: <FirmwareScreen /> },
      { path: 'users', element: <AdminUsers /> },
      { path: 'demo', element: <Demo /> },
    ],
  },
  { path: 'alerts', element: <Alerts /> },
  { path: 'grows', element: <MyGrows /> },
  { path: 'grows/new', element: <NewGrowRoute /> },
  // Where finished grows were listed before "My grows" held them all; bookmarks still point here.
  { path: 'grows/archive', element: <Navigate to="/grows" replace /> },
  { path: 'grows/:growId/measurements', element: <Measurements /> },
  { path: 'grows/:growId/plants/:plantId', element: <PlantPage /> },
  { path: 'grows/:growId/:tab?', element: <GrowPage /> },
  { path: 'spaces/:spaceId', element: <PlacePage /> },
  { path: 'spaces/:spaceId/members', element: <PlaceMembers /> },
  { path: 'spaces/:spaceId/:tab/:sub?', element: <OldPlaceLink /> },
  { path: 'index.html', element: <Navigate to="/" replace /> },
  // The old app's own pages, where bookmarks still point.
  { path: 'list', element: <Navigate to="/" replace /> },
  { path: 'account', element: <Navigate to="/me/account" replace /> },
  { path: 'shares', element: <Navigate to="/me/share-links" replace /> },
  { path: 'diagnostics', element: <Navigate to="/admin/fleet" replace /> },
  { path: '*', element: <NotFound /> },
];

/**
 * The sign-in and sign-up pages, recovery, activation, the public addresses and
 * the old app's addresses (`OldAddresses.tsx` sends them on) sit outside the
 * session gate rather than behind a check inside it, so a stranger who follows
 * a link never sees a frame of the sign-in page. `/@{handle}` is read by the
 * whole-segment `/:handle`, so it ranks below every named route.
 *
 * Inside the gate a static segment outranks the parameter beside it, so
 * `/cameras/add`, `/grows/new` and `plants/...` are never read as an id or a
 * tab, and the old app's bookmarks are sent on in the table above.
 *
 * The two pathless routes with only an error boundary are where a screen that
 * throws stops: the inner one replaces the screen while the shell around it
 * keeps working, the outer one catches what fails outside the shell.
 */
export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: '/sign-in', element: <SignIn /> },
      { path: '/sign-up', element: <SignUp /> },
      { path: '/privacy', element: <PrivacyStatement /> },
      { path: '/recover', element: <Recover /> },
      { path: '/recover/:token', element: <Recover /> },
      { path: '/activate', element: <Activate /> },
      { path: '/activate/:code', element: <Activate /> },
      { path: '/login', element: <OldLogin /> },
      { path: '/demo', element: <OpenDemo /> },
      { path: '/device/:deviceId/:page?', element: <OldDevice /> },
      { path: '/link-expired', element: <LinkEnded /> },
      { path: '/g/:slug', element: <PublicGrowRoute /> },
      { path: '/shared/:token', element: <SharedRoute /> },
      { path: '/join', element: <JoinRoute /> },
      { path: '/join/:code', element: <JoinRoute /> },
      { path: '/:handle', element: <PublicProfileRoute /> },
      {
        element: (
          <RequireSession>
            <AppShell />
          </RequireSession>
        ),
        children: [{ errorElement: <RouteError />, children: screens }],
      },
    ],
  },
]);
