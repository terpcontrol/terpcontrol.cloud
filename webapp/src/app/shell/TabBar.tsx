import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { useLog, useMayLog } from '@/log/log-context';
import { TABS } from './tabs';
import styles from './TabBar.module.css';

/**
 * The phone's navigation. Replaced by the rail from the tablet breakpoint up.
 *
 * Four of the five are places; the raised one is not. Logging happens over the
 * screen you are on, so the button does not take you anywhere - and a session
 * that may not write is not offered it, which leaves the four places.
 */
export function TabBar() {
  const { t } = useTranslation();
  const { openSheet } = useLog();
  const mayLog = useMayLog();

  return (
    <nav className={styles.bar} aria-label={t('shell.navigation')} data-print="omit">
      {TABS.filter(tab => mayLog || !tab.raised).map(({ path, labelKey, Icon, raised }) =>
        raised ? (
          <button key={path} type="button" className={`${styles.tab} ${styles.raised}`} onClick={() => openSheet()}>
            <span className={styles.icon}>
              <Icon size={26} strokeWidth={2} aria-hidden />
            </span>
            <span className={styles.caption}>{t(labelKey)}</span>
          </button>
        ) : (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) => [styles.tab, isActive ? styles.active : ''].filter(Boolean).join(' ')}
          >
            <span className={styles.icon}>
              <Icon size={22} strokeWidth={1.75} aria-hidden />
            </span>
            <span className={styles.caption}>{t(labelKey)}</span>
          </NavLink>
        ),
      )}
    </nav>
  );
}
