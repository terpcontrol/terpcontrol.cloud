import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useShape } from '@/app/shell/shape';
import { useAccountMe, useMe } from '@/api/account';
import { useCameras } from '@/api/cameras';
import { APP_VERSION, BUILD_MODE } from '@/api/config';
import { useGrows, useMyGrows } from '@/api/grows';
import { useDiaryLayer } from '@/api/layers';
import { useSession } from '@/api/session';
import { ALL_GROWS } from '@/app/places';
import { initials } from '@/ui/handle';
import { useLeave } from '@/ui/leave';
import { ownsCamera } from '@/screens/devices/cameras';
import { useTheme } from '@/theme/theme-context';
import { Row, Rows } from '@/ui/Rows';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import { appearanceLine, growsLine, lineOnce, notificationsLine, premiumLine, privacyLine, publicLine, versionLine, type Read } from './me/doors';
import styles from './Me.module.css';

/**
 * Where the avatar leads: who is signed in, the way to every grow for whoever
 * keeps a diary, and a door to each of the things an account is made of. What
 * belongs to growing stands with the grows, under "Alle Grows".
 *
 * Every door says under its title what the page behind it currently holds,
 * read from the server and never guessed (`lineOnce`); one that is genuinely
 * empty says the empty thing rather than a nought.
 *
 * The demo has no account of its own, so the doors that need one are lines
 * saying that rather than links to a page the server would refuse.
 */
export function Me() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const { leaving, leave } = useLeave('/sign-in');
  const isDemo = user?.isDemo === true;

  return (
    <section className={styles.screen}>
      <h1>{t('me.title')}</h1>

      {isDemo ? <DemoDoors handle={user?.handle ?? '?'} /> : <AccountDoors handle={user?.handle ?? '?'} />}

      <Rows>
        <Row to="/me/appearance" title={t('me.appearance.title')} line={<AppearanceLine language={i18n.resolvedLanguage ?? i18n.language} />} />
        <Row to="/me/about" title={t('me.about.title')} line={versionLine(t, APP_VERSION, BUILD_MODE)} />
      </Rows>

      {user?.isAdmin ? <AdminDoors /> : null}

      <div className={styles.foot}>
        <button type="button" className={ui.button} disabled={leaving} onClick={() => void leave()}>
          {t('me.signOut')}
        </button>
      </div>
    </section>
  );
}

/** The four fleet screens, in the order the board puts them. */
const ADMIN_LINKS = [
  { path: '/admin/fleet', labelKey: 'admin.fleet.title' },
  { path: '/admin/firmware', labelKey: 'admin.firmware.title' },
  { path: '/admin/users', labelKey: 'admin.users.title' },
  { path: '/admin/demo', labelKey: 'admin.demo.title' },
] as const;

/** The fleet, for whoever runs this install: its doors are here and nowhere else, and no other account is shown the section. */
function AdminDoors() {
  const { t } = useTranslation();

  return (
    <section className={styles.admin} aria-label={t('admin.section')}>
      <span className="label">{t('admin.section')}</span>
      <Rows>
        {ADMIN_LINKS.map(({ path, labelKey }) => (
          <Row key={path} to={path} title={t(labelKey)} />
        ))}
      </Rows>
    </section>
  );
}

/** The header and the doors an account has, each read from what the server answers about it. */
function AccountDoors({ handle }: { handle: string }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const me = useMe();
  const grows = useGrows();
  const mine = useMyGrows();
  const cameras = useCameras();
  const { steering, cameras: cameraCount, ready } = useShape();
  const diary = useDiaryLayer();
  // Every grow is a door of the diary's, and stays one for whoever has a grow and has since turned the diary off.
  const hasGrows = diary || (mine.data?.items.length ?? 0) > 0;

  const line = (queries: Read[], text: () => string) => lineOnce(t, queries, text);

  return (
    <>
      <Identity handle={handle}>
        {line([me], () => [me.data!.email, t(me.data!.publicProfile ? 'me.identity.profileOn' : 'me.identity.profileOff')].join(' · '))}
      </Identity>

      {/* What the account has grown is its own content rather than a setting, so it stands apart from the doors below. */}
      {hasGrows ? <Row alone to={ALL_GROWS} title={t('grow.all.pill')} line={line([mine], () => growsLine(t, mine.data!.items))} /> : null}

      <Rows>
        {/* What reaches the grower when something goes wrong comes first: with one tent it is the door that matters. */}
        <Row to="/me/notifications" title={t('notifications.title')} line={line([me], () => notificationsLine(t, me.data!, now))} />
        {/* Premium is what a camera can do beyond its free tier, so it is a door only for an account that has one. */}
        {cameras.data && ownsCamera(cameras.data.items) ? (
          <Row
            to="/me/premium"
            title={t('me.premium.title')}
            line={line([cameras, me], () => premiumLine(t, cameras.data.items, now, me.data!.premium.enforced, zone))}
          />
        ) : null}
        <Row to="/me/privacy" title={t('me.privacy.title')} line={line([me], () => privacyLine(t, me.data!))} />
        <Row
          to="/me/public"
          title={t('me.public.title')}
          line={line([grows, me], () => publicLine(t, grows.data!.items, me.data!, window.location.host))}
        />
        {/* Without any hardware nothing on Start or in the bar leads to adding some; this is where it comes in. */}
        {ready && !steering && cameraCount === 0 ? (
          <Row to="/control" title={t('me.door.addDevice.title')} line={t('me.door.addDevice.line')} />
        ) : null}
        <Row to="/me/account" title={t('me.account.title')} line={t('me.door.account')} />
      </Rows>
    </>
  );
}

/** The same doors for the demo, none of them open: each says why in the words its page would use. */
function DemoDoors({ handle }: { handle: string }) {
  const { t } = useTranslation();

  return (
    <>
      <Identity handle={handle}>{t('me.demo')}</Identity>

      <Rows>
        <Row waits title={t('me.public.title')} line={t('me.demo')} />
        <Row waits title={t('me.premium.title')} line={t('me.demo')} />
        <Row waits title={t('notifications.title')} line={t('notifications.demo')} />
        <Row waits title={t('me.privacy.title')} line={t('me.privacy.demo')} />
        <Row waits title={t('me.account.title')} line={t('me.demo')} />
      </Rows>
    </>
  );
}

/**
 * The theme and the language are the browser's and known at once; the units
 * are the account's, so the line waits for the account rather than saying two
 * thirds of itself as if that were all. The demo has no units to wait for.
 */
function AppearanceLine({ language }: { language: string }) {
  const { t } = useTranslation();
  const { choice } = useTheme();
  const { user } = useSession();
  const hasAccount = user !== null && !user.isDemo;
  const me = useAccountMe();

  if (hasAccount) {
    if (me.isPending) return t('home.waiting');
    if (!me.data) return t('shell.loadFailed');
  }

  return appearanceLine(t, choice, me.data?.preferences.units ?? null, language);
}

/** The initials, the handle, and one mono line about the account under it. */
function Identity({ handle, children }: { handle: string; children: ReactNode }) {
  return (
    <header className={styles.identity}>
      <span className={`mono ${styles.avatar}`}>{initials(handle)}</span>
      <div className={styles.who}>
        <span className={`display ${styles.handle}`}>@{handle}</span>
        <span className={`mono ${styles.whoLine}`}>{children}</span>
      </div>
    </header>
  );
}
