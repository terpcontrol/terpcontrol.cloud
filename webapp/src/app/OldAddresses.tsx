import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useDevices } from '@/api/devices';
import { session, useSession } from '@/api/session';
import { Door } from '@/screens/Recover';
import { Nothing } from '@/screens/public/Nothing';
import { PublicShell } from '@/screens/public/PublicShell';
import { Waiting } from '@/ui/PageState';
import ui from '@/ui/ui.module.css';
import styles from '@/screens/SignIn.module.css';
import { controlPath, devicesPath, placePath, timelinePath } from './places';
import { RequireSession } from './RequireSession';

/**
 * The addresses the old app answered, which are still out there: the website's
 * "Live-Demo" buttons, bookmarks, and the activation and recovery mails sent
 * before the move. Each is sent on to where the same thing is now, so a link
 * in somebody's hand does not end on a page saying nothing lives there.
 *
 * Shared links are the exception. The old app shared a device's page as
 * `/device/{id}/{page}?share={id}`, and those links were not carried over -
 * they were made for screens that no longer exist - so they get a page saying
 * so rather than a sign-in form the stranger holding one cannot get past.
 */

/** `/login`, with what the old mails put behind it: `?recovery=` and `?code=`. */
export function OldLogin() {
  const [params] = useSearchParams();
  const recovery = params.get('recovery');
  const code = params.get('code');

  if (recovery) return <Navigate to={`/recover/${encodeURIComponent(recovery)}`} replace />;
  if (code) return <Navigate to={`/activate/${encodeURIComponent(code)}`} replace />;

  return <Navigate to="/sign-in" replace />;
}

/**
 * `/demo`: the website's "Live-Demo", opened at once. Somebody already signed
 * in is simply let into the app, rather than signed out of their own account by
 * a link on a page about it.
 */
export function OpenDemo() {
  const { t } = useTranslation();
  const { user, restored } = useSession();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    void session.restore();
  }, []);

  useEffect(() => {
    if (!restored || user || tried.current) return;
    tried.current = true;
    session.openDemo().then(
      () => void navigate('/', { replace: true }),
      () => setFailed(true),
    );
  }, [restored, user, navigate]);

  if (user) return <Navigate to="/" replace />;

  return (
    <Door title={t('login.demo')}>
      <p className={styles.lead} role={failed ? 'alert' : 'status'}>
        {t(failed ? 'login.demoFailed' : 'demo.opening')}
      </p>
      {failed ? (
        <Link to="/sign-in" className={`${ui.button} ${styles.submit}`}>
          {t('login.backToLogin')}
        </Link>
      ) : null}
    </Door>
  );
}

/** What the old app's device pages are now, page by page. */
const OLD_DEVICE_PAGES: Record<string, (spaceId: string) => string> = {
  charts: spaceId => `/charts?space=${encodeURIComponent(spaceId)}`,
  diary: spaceId => timelinePath(spaceId),
  settings: spaceId => controlPath(spaceId),
  testmode: spaceId => devicesPath(spaceId),
};

/** `/device/{id}/{page}`, and the same with `?share=`, which has ended. */
export function OldDevice() {
  const [params] = useSearchParams();

  if (params.get('share')) return <LinkEnded />;

  return (
    <RequireSession>
      <OldDeviceLink />
    </RequireSession>
  );
}

function OldDeviceLink() {
  const { deviceId = '', page = '' } = useParams();
  const devices = useDevices();

  if (devices.isPending) return <Waiting lines={3} />;

  const spaceId = devices.data?.items.find(one => one.id === deviceId)?.spaceId ?? null;
  // A device the account cannot see, or one standing nowhere, has no page of a
  // place to land on; the list of devices is where it would be.
  if (!spaceId) return <Navigate to={devicesPath()} replace />;

  return <Navigate to={(OLD_DEVICE_PAGES[page] ?? placePath)(spaceId)} replace />;
}

/** A link shared from the old app, or its old "link expired" page. */
export function LinkEnded() {
  const { t } = useTranslation();

  return (
    <PublicShell title={t('oldLink.title')}>
      <Nothing titleKey="oldLink.title" bodyKey="oldLink.body" />
    </PublicShell>
  );
}
