import { Bell, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useNavigate } from 'react-router';
import { useSession } from '@/api/session';
import { TABS, initials } from './tabs';
import { Freshness } from './TopBar';
import styles from './Rail.module.css';

const LOG_KEY = 'l';

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** The desktop's navigation, down the left edge: the Log button with its key, the four tabs, alerts and the account. */
export function Rail() {
  const { t } = useTranslation();
  const { user } = useSession();
  const navigate = useNavigate();

  const log = TABS.find(tab => tab.raised);
  const tabs = TABS.filter(tab => !tab.raised);

  // The key the button advertises. A wide screen has a keyboard; a field keeps its letters.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== LOG_KEY || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (!window.matchMedia('(min-width: 900px)').matches) return;
      event.preventDefault();
      void navigate('/log');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const itemClass = ({ isActive }: { isActive: boolean }) => [styles.item, isActive ? styles.active : ''].filter(Boolean).join(' ');

  return (
    <nav className={styles.rail} aria-label={t('shell.navigation')}>
      <div className={styles.identity}>
        <div className={styles.wordmark}>Terp Control</div>
        <Freshness />
      </div>

      {log ? (
        <NavLink to={log.path} className={styles.log}>
          <log.Icon size={20} strokeWidth={2} aria-hidden />
          <span className={styles.logCaption}>{t(log.labelKey)}</span>
          <kbd className={`mono ${styles.key}`}>{LOG_KEY.toUpperCase()}</kbd>
        </NavLink>
      ) : null}

      {tabs.map(({ path, labelKey, Icon }) => (
        <NavLink key={path} to={path} end={path === '/'} className={itemClass}>
          <Icon size={18} strokeWidth={1.75} aria-hidden />
          <span>{t(labelKey)}</span>
        </NavLink>
      ))}

      <div className={styles.spacer} />

      <NavLink to="/alerts" className={itemClass}>
        <Bell size={18} strokeWidth={1.75} aria-hidden />
        <span>{t('shell.alerts')}</span>
      </NavLink>

      <NavLink to="/me" className={itemClass}>
        <span className={`mono ${styles.avatar}`}>{initials(user?.handle ?? '?')}</span>
        <span className={styles.account}>
          <span className={styles.handle}>{user?.handle ?? ''}</span>
          <span className={styles.accountNote}>{t('shell.accountNote')}</span>
        </span>
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
      </NavLink>
    </nav>
  );
}
