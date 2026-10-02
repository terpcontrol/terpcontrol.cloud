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
import { GrowArchive } from '@/screens/grow/Archive';
import { GrowPage } from '@/screens/grow/GrowPage';
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
  { path: 'grows/new', element: <NewGrowRoute /> },
  { path: 'grows/archive', element: <GrowArchive /> },
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
 * The tabs of the bar, the account page, the alerts behind the bell, and the
 * two pages a card opens: a grow, with its tab in the path so a tab survives a
 * reload, and a place. Every screen below the shell is behind a session;
 * the sign-in and sign-up pages and the public addresses are the routes that
 * are not.
 *
 * Recovering a password and activating an account are outside it too, since
 * both happen before there is a session, and so are the addresses the old app
 * answered - its sign-in with the codes its mails carried, its demo, a
 * device's pages - which `OldAddresses.tsx` sends on to where those things are
 * now; the old app's bookmarks inside the session are sent on in the table
 * above.
 *
 * The public ones sit outside the session gate rather than behind a check
 * inside it, so a stranger who follows a link never meets the sign-in page and
 * never sees a frame of it either. An invitation is one of them for that
 * reason above all: it is sent to somebody who has no account yet, and a
 * sign-in form with no explanation in front of it is where they stop - which
 * is also why the sign-up page exists, and why the invitation is what sends
 * somebody to it. `/join` without a code is where a code that was read aloud
 * is typed. `/@{handle}` is matched as a whole first
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
 * A grow that has ended is not on the home, which draws the places and what
 * stands in them today, so the diaries that are over have an address of their
 * own: `/grows/archive`, reached from under the home's cards. It is a static
 * segment beside the grow parameter and therefore outranks it, exactly as
 * `/grows/new` does, so it is never read as a grow called "archive".
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
 * A place has one page, its cockpit, and one page below it: who else is let
 * in. Verlauf and Steuerung are tabs of the bar about one place at a time, and
 * carry it in the query; Steuerung's own pages - the targets, the alarm rules,
 * the plan - are a segment of its path, so that a link from an alert opens the
 * rule it came from and a reload lands where it was. The addresses a place had
 * while it was a page of five tabs are sent on to where those things are now.
 * Me is a page of doors rather than a screen of settings, so each of them is a
 * route below it: what is public, what is followed, the links that were sent
 * out, Premium, the feeding schemes, the appearance, the account itself and
 * what this install is. The fleet is the one part of the app that is not for
 * growers: it sits under `/admin`, is reached from the desktop rail alone, and
 * the four screens share one guarded parent - so the guard is stated once, and
 * an account that may not read them, or a window too narrow to draw them, is
 * answered with the sentence that says which of the two it is rather than with
 * an empty page.
 *
 * Two of the routes below carry nothing but an error boundary, and they are
 * where a screen that throws stops. The inner one stands between the shell and
 * the screens, so a screen that fails is replaced while the tabs, the bell and
 * the log button around it keep working - which is most of what "a way back"
 * means on a phone. The outer one is under everything, including the sign-in
 * page, the public addresses and the shell itself, because a failure there has
 * no tabs to fall back on. Neither has a path of its own, so neither changes
 * which address matches what.
 */
export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { path: '/sign-in', element: <SignIn /> },
      { path: '/sign-up', element: <SignUp /> },
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
