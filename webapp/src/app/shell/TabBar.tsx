import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLog } from '@/log/log-context';
import { useOpeningUnderneath } from '@/log/underneath';
import { useIsOn, useTabs } from './tabs';
import styles from './TabBar.module.css';

/**
 * The phone's navigation. Replaced by the rail from the tablet breakpoint up.
 *
 * Every item is a page but Eintrag: logging happens over the screen you are
 * on, so the button does not take you anywhere. An account with nothing yet
 * would have Start alone, which is no choice: it gets no bar, and the logo
 * in the header leads to Start.
 */
export function TabBar() {
  const { t } = useTranslation();
  const { openSheet } = useLog();
  const underneath = useOpeningUnderneath();
  const tabs = useTabs();
  const isOn = useIsOn();

  if (tabs.length < 2) return null;

  return (
    <nav className={styles.bar} aria-label={t('shell.navigation')} data-print="omit">
      {tabs.map(tab =>
        tab.log ? (
          <button key={tab.path} type="button" className={`${styles.tab} ${styles.log}`} onClick={() => openSheet(underneath)}>
            <span className={styles.circle}>
              <tab.Icon size={24} strokeWidth={2.4} aria-hidden />
            </span>
            {t(tab.labelKey)}
          </button>
        ) : (
          <Link
            key={tab.path}
            to={tab.path}
            className={[styles.tab, isOn(tab) ? styles.active : ''].filter(Boolean).join(' ')}
            aria-current={isOn(tab) ? 'page' : undefined}
          >
            <tab.Icon size={22} strokeWidth={2} aria-hidden />
            {t(tab.labelKey)}
          </Link>
        ),
      )}
    </nav>
  );
}
