import { Bell } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { bellOf, useOpenAlertCount } from '@/api/alerts';
import { useSession } from '@/api/session';
import { useLog, useMayLog } from '@/log/log-context';
import { useOpeningUnderneath } from '@/log/underneath';
import { Logo } from '@/ui/Logo';
import { TABS, initials } from './tabs';
import { Freshness } from './TopBar';
import styles from './Rail.module.css';

const LOG_KEY = 'l';

/** The four fleet screens, in the order the board puts them. They are the rail's alone; the phone's tab bar gains nothing. */
const ADMIN_LINKS = [
  { path: '/admin/fleet', labelKey: 'admin.fleet.title' },
  { path: '/admin/firmware', labelKey: 'admin.firmware.title' },
  { path: '/admin/users', labelKey: 'admin.users.title' },
  { path: '/admin/demo', labelKey: 'admin.demo.title' },
] as const;

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** The desktop's navigation, down the left edge: the Log button with its key, the four tabs, alerts and the account. */
export function Rail() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { openSheet } = useLog();
  const underneath = useOpeningUnderneath();
  const mayLog = useMayLog();
  const bell = bellOf(useOpenAlertCount());

  const log = mayLog ? TABS.find(tab => tab.raised) : undefined;
  const tabs = TABS.filter(tab => !tab.raised);

  // The key the button advertises. A wide screen has a keyboard; a field keeps its letters.
  useEffect(() => {
    if (!mayLog) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== LOG_KEY || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (!window.matchMedia('(min-width: 900px)').matches) return;
      event.preventDefault();
      openSheet(underneath);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mayLog, openSheet, underneath]);

  const itemClass = ({ isActive }: { isActive: boolean }) => [styles.item, isActive ? styles.active : ''].filter(Boolean).join(' ');

  return (
    <nav className={styles.rail} aria-label={t('shell.navigation')} data-print="omit">
      <div className={styles.inner}>
        <div className={styles.identity}>
          <div className={styles.wordmark}>
            <Logo />
          </div>
          <Freshness />
        </div>

        {log ? (
          <button type="button" className={styles.log} onClick={() => openSheet(underneath)}>
            <log.Icon size={20} strokeWidth={2} aria-hidden />
            <span className={styles.logCaption}>{t(log.labelKey)}</span>
            <kbd className={`mono ${styles.key}`}>{LOG_KEY.toUpperCase()}</kbd>
          </button>
        ) : null}

        {tabs.map(({ path, labelKey, Icon }) => (
          <NavLink key={path} to={path} end={path === '/'} className={itemClass}>
            <Icon size={18} strokeWidth={1.75} aria-hidden />
            <span>{t(labelKey)}</span>
          </NavLink>
        ))}

        <div className={styles.spacer} />

        {/* The fleet, for whoever runs this install. It is on the rail and
            nowhere else: there is no tab for it on a phone, because the screens
            behind it are tables that need a desktop and say so, and an account
            that is not an administrator is shown no section it cannot open. */}
        {user?.isAdmin ? (
          <div className={styles.section}>
            <span className={`label ${styles.sectionLabel}`}>{t('admin.section')}</span>
            {ADMIN_LINKS.map(({ path, labelKey }) => (
              <NavLink key={path} to={path} className={itemClass}>
                <span>{t(labelKey)}</span>
              </NavLink>
            ))}
          </div>
        ) : null}

        <NavLink to="/alerts" className={itemClass} aria-label={bell ? t(bell.key, { count: bell.count }) : t('shell.alerts')}>
          <Bell size={18} strokeWidth={1.75} aria-hidden />
          <span>{t('shell.alerts')}</span>
          {bell ? <span className={`mono ${styles.badge}`}>{bell.text}</span> : null}
        </NavLink>

        <NavLink to="/me" className={itemClass}>
          <span className={`mono ${styles.avatar}`}>{initials(user?.handle ?? '?')}</span>
          <span className={styles.account}>
            <span className={styles.handle}>{user?.handle ?? ''}</span>
            <span className={styles.accountNote}>{t('shell.accountNote')}</span>
          </span>
        </NavLink>
      </div>
    </nav>
  );
}
