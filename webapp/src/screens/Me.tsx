import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useMe } from '@/api/account';
import { useCameras } from '@/api/cameras';
import { APP_VERSION, BUILD_MODE } from '@/api/config';
import { useGrows } from '@/api/grows';
import { useOwnSchemes, useSchemes } from '@/api/schemes';
import { session, useSession } from '@/api/session';
import { useFollows, useShareLinks } from '@/api/sharing';
import { initials } from '@/app/shell/tabs';
import { useTheme } from '@/theme/theme-context';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useZone } from '@/ui/zone';
import {
  appearanceLine,
  followingLine,
  notificationsLine,
  premiumLine,
  privacyLine,
  publicLine,
  schemesLine,
  shareLinksLine,
  versionLine,
} from './me/doors';
import styles from './Me.module.css';

/**
 * Where the avatar leads: who is signed in, and a door to each of the ten
 * things an account is made of.
 *
 * Every door says under its title what the page behind it currently holds,
 * read from the server and never guessed - how many grows are public, which
 * channels are on, what the shelf carries - so that the page is worth a look
 * even for somebody who opens none of them. A line whose answer has not
 * arrived says that it is loading, one whose read failed says so, and one
 * that is genuinely empty says the empty thing rather than a nought.
 *
 * The demo looks at somebody else's grow and has no account of its own, so
 * the doors that need one are lines saying that rather than links to a page
 * the server would refuse; the two that need none - the appearance, and what
 * this install is - stay open to it.
 */
export function Me() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const navigate = useNavigate();
  const isDemo = user?.isDemo === true;

  const signOut = async () => {
    await session.logOut();
    await navigate('/sign-in', { replace: true });
  };

  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>{t('me.title')}</h1>

      {isDemo ? <DemoDoors handle={user?.handle ?? '?'} /> : <AccountDoors handle={user?.handle ?? '?'} />}

      <div className={styles.doors}>
        <Door to="/me/appearance" title={t('me.appearance.title')} line={<AppearanceLine language={i18n.resolvedLanguage ?? i18n.language} />} />
        <Door to="/me/about" title={t('me.about.title')} line={versionLine(t, APP_VERSION, BUILD_MODE)} />
      </div>

      <div className={styles.foot}>
        <button type="button" className={ui.button} onClick={signOut}>
          {t('me.signOut')}
        </button>
      </div>
    </section>
  );
}

/** The header and the eight doors an account has, each read from what the server answers about it. */
function AccountDoors({ handle }: { handle: string }) {
  const { t } = useTranslation();
  const now = useNow();
  const zone = useZone();
  const me = useMe();
  const grows = useGrows();
  const follows = useFollows(true);
  const links = useShareLinks();
  const cameras = useCameras();
  const shipped = useSchemes();
  const own = useOwnSchemes();

  /**
   * One door's line, drawn only once every read it is worked out from has
   * answered. Eight reads fan out from this page and they land in whatever
   * order the connection gives them, so a line must name every query it reads
   * rather than the first of them: a gate that lists one of two is a promise
   * that the other has arrived, and a line that believes it takes the hub - and
   * with it the only way to privacy, the export and signing out - down to the
   * router's error screen on a phone. A read still outstanding says it is
   * loading and a read that failed says so, each under its own door, so one
   * answer missing costs its own line and nothing else.
   */
  const line = (queries: { data: unknown; isPending: boolean }[], text: () => string): string =>
    queries.every(query => query.data !== undefined) ? text() : queries.some(query => query.isPending) ? t('home.waiting') : t('shell.loadFailed');

  // Gated exactly as `line` gates, so that the two cannot disagree about whether this is safe to read.
  const premium =
    cameras.data !== undefined && me.data !== undefined ? premiumLine(t, cameras.data.items, now, me.data.premium.enforced, zone) : null;

  return (
    <>
      <Identity handle={handle}>
        {line([me], () => [me.data!.email, t(me.data!.publicProfile ? 'me.identity.profileOn' : 'me.identity.profileOff')].join(' · '))}
      </Identity>

      <div className={styles.doors}>
        <Door
          to="/me/public"
          title={t('me.public.title')}
          line={line([grows, me], () => publicLine(t, grows.data!.items, me.data!, window.location.host))}
        />
        <Door to="/me/following" title={t('me.following.title')} line={line([follows], () => followingLine(t, follows.data!.items.length))} />
        <Door to="/me/share-links" title={t('me.shareLinks.title')} line={line([links], () => shareLinksLine(t, links.data!.items, now))} />
        <Door to="/me/premium" title={t('me.premium.title')} line={line([cameras, me], () => premium!.text)} aside={premium?.aside ?? null} />
        <Door to="/me/notifications" title={t('notifications.title')} line={line([me], () => notificationsLine(t, me.data!, now))} />
        <Door to="/me/privacy" title={t('me.privacy.title')} line={line([me], () => privacyLine(t, me.data!))} />
        <Door
          to="/me/schemes"
          title={t('me.schemes.title')}
          line={line([grows, shipped, own], () => schemesLine(t, grows.data!.items, shipped.data!, own.data!.items))}
        />
        <Door to="/me/account" title={t('me.account.title')} line={t('me.door.account')} />
      </div>
    </>
  );
}

/** The same doors for the demo, none of them open: each says why in the words its page would use. */
function DemoDoors({ handle }: { handle: string }) {
  const { t } = useTranslation();

  return (
    <>
      <Identity handle={handle}>{t('me.demo')}</Identity>

      <div className={styles.doors}>
        <Closed title={t('me.public.title')} note={t('me.demo')} />
        <Closed title={t('me.following.title')} note={t('me.demo')} />
        <Closed title={t('me.shareLinks.title')} note={t('me.demo')} />
        <Closed title={t('me.premium.title')} note={t('me.demo')} />
        <Closed title={t('notifications.title')} note={t('notifications.demo')} />
        <Closed title={t('me.privacy.title')} note={t('me.privacy.demo')} />
        <Closed title={t('me.schemes.title')} note={t('me.demo')} />
        <Closed title={t('me.account.title')} note={t('me.demo')} />
      </div>
    </>
  );
}

/**
 * The theme and the language are the browser's and known at once; the units
 * are the account's and arrive with it, so the line waits for the account
 * like every other rather than saying half of itself first. A read that failed
 * says so instead of dropping the units quietly, because a line of two thirds
 * reads as a settled answer rather than as an answer that never came. The demo
 * has no units to wait for.
 */
function AppearanceLine({ language }: { language: string }) {
  const { t } = useTranslation();
  const { choice } = useTheme();
  const { user } = useSession();
  const hasAccount = user !== null && !user.isDemo;
  const me = useMe(false, hasAccount);

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

/** A door: the title, the mono line saying what is behind it, the state word the board sets at the right, and the chevron. */
function Door({ to, title, line, aside = null }: { to: string; title: string; line: ReactNode; aside?: string | null }) {
  return (
    <Link to={to} className={`${styles.row} ${styles.link}`}>
      <span className={styles.doorText}>
        <span className={styles.rowTitle}>{title}</span>
        <span className={`mono ${styles.doorLine}`}>{line}</span>
      </span>
      {aside ? <span className={`mono ${styles.aside}`}>{aside}</span> : null}
      <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
    </Link>
  );
}

/** A door that leads nowhere for this session, and says why under its title. */
function Closed({ title, note }: { title: string; note: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowTitle}>{title}</span>
      <p className={`${ui.note} ${styles.rowNote}`}>{note}</p>
    </div>
  );
}
