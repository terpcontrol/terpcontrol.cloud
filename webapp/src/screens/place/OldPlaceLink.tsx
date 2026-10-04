import { Navigate, useLocation, useParams } from 'react-router';
import { CONTROL_PAGES, controlPath, devicesPath, placePath, timelinePath, type ControlPage } from '@/app/places';

/**
 * The addresses a place had while it was a page with five tabs of its own, sent
 * on to where those things are now: its overview to the cockpit, its Timeline
 * and Control to the bar's tabs with the place named, its devices to the
 * account's list with the place's opened. Links in old mails, bookmarks and
 * pushes sent before the change keep landing on the place they were about, and
 * never on a page that no longer exists.
 *
 * What the old address asked for besides - the rule an alert links to - comes
 * along in the query.
 */
export function OldPlaceLink() {
  const { spaceId = '', tab, sub } = useParams();
  const { search } = useLocation();
  const asked = Object.fromEntries(new URLSearchParams(search));

  const to =
    tab === 'timeline'
      ? timelinePath(spaceId, asked.focus ?? null)
      : tab === 'control'
        ? controlPath(spaceId, CONTROL_PAGES.includes(sub as ControlPage) ? (sub as ControlPage) : null, asked)
        : tab === 'devices'
          ? devicesPath(spaceId)
          : placePath(spaceId);

  return <Navigate to={to} replace />;
}
