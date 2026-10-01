import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLog } from '@/log/log-context';
import { useOpeningUnderneath } from '@/log/underneath';
import { useIsOn, useTabs } from './tabs';
import styles from './TabBar.module.css';

/**
 * The phone's navigation. Replaced by the rail from the tablet breakpoint up.
 *
 * Every tab is a place but the raised one: logging happens over the screen you
 * are on, so the button does not take you anywhere.
 */
export function TabBar() {
  const { t } = useTranslation();
  const { openSheet } = useLog();
  const underneath = useOpeningUnderneath();
  const tabs = useTabs();
  const isOn = useIsOn();

  return (
    <nav className={styles.bar} aria-label={t('shell.navigation')} data-print="omit">
      {tabs.map(tab =>
        tab.raised ? (
          <button key={tab.path} type="button" className={`${styles.tab} ${styles.raised}`} onClick={() => openSheet(underneath)}>
            <span className={styles.icon}>
              <tab.Icon size={26} strokeWidth={2} aria-hidden />
            </span>
            <span className={styles.caption}>{t(tab.labelKey)}</span>
          </button>
        ) : (
          <Link
            key={tab.path}
            to={tab.path}
            className={[styles.tab, isOn(tab) ? styles.active : ''].filter(Boolean).join(' ')}
            aria-current={isOn(tab) ? 'page' : undefined}
          >
            <span className={styles.icon}>
              <tab.Icon size={22} strokeWidth={1.75} aria-hidden />
            </span>
            <span className={styles.caption}>{t(tab.labelKey)}</span>
          </Link>
        ),
      )}
    </nav>
  );
}
