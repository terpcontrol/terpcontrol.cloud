import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { TABS } from './tabs';
import styles from './TabBar.module.css';

/** The phone's navigation. Replaced by the rail from the tablet breakpoint up. */
export function TabBar() {
  const { t } = useTranslation();

  return (
    <nav className={styles.bar} aria-label={t('shell.navigation')}>
      {TABS.map(({ path, labelKey, Icon, raised }) => (
        <NavLink
          key={path}
          to={path}
          end={path === '/'}
          className={({ isActive }) => [styles.tab, raised ? styles.raised : '', isActive ? styles.active : ''].filter(Boolean).join(' ')}
        >
          <span className={styles.icon}>
            <Icon size={raised ? 26 : 22} strokeWidth={raised ? 2 : 1.75} aria-hidden />
          </span>
          <span className={styles.caption}>{t(labelKey)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
