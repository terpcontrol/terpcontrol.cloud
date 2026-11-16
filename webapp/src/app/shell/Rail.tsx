import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink } from 'react-router';
import { useLog } from '@/log/log-context';
import { useOpeningUnderneath } from '@/log/underneath';
import { Logo } from '@/ui/Logo';
import { useBell } from './bell';
import { PlaceChoice } from './PlaceChoice';
import { useIsOn, useTabs } from './tabs';
import styles from './Rail.module.css';

const LOG_KEY = 'l';

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * The desktop's navigation, down the left edge: Start, then Grow, Verlauf and
 * Steuerung as one group headed by the place they are about where there is
 * one to choose, the green Eintrag button where the diary is kept, and
 * Meldungen and Ich at its foot.
 */
export function Rail() {
  const { t } = useTranslation();
  const { openSheet } = useLog();
  const underneath = useOpeningUnderneath();
  const bell = useBell();
  const all = useTabs();
  const isOn = useIsOn();

  const log = all.find(tab => tab.log);
  const logs = log !== undefined;
  const [start, ...about] = all.filter(tab => !tab.log);

  // A wide screen has a keyboard, and L opens the entry sheet from anywhere: a
  // field keeps its letters, and a sheet that is open is not covered by another.
  useEffect(() => {
    if (!logs) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== LOG_KEY || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (!window.matchMedia('(min-width: 900px)').matches || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      openSheet(underneath);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [logs, openSheet, underneath]);

  const footClass = ({ isActive }: { isActive: boolean }) => [styles.item, styles.foot, isActive ? styles.active : ''].filter(Boolean).join(' ');
  const item = (tab: (typeof all)[number]) => (
    <Link
      key={tab.path}
      to={tab.path}
      className={[styles.item, isOn(tab) ? styles.active : ''].filter(Boolean).join(' ')}
      aria-current={isOn(tab) ? 'page' : undefined}
    >
      <tab.Icon size={20} strokeWidth={2} aria-hidden />
      {t(tab.labelKey)}
    </Link>
  );

  return (
    <nav className={styles.rail} aria-label={t('shell.navigation')} data-print="omit">
      <div className={styles.inner}>
        <div className={styles.wordmark}>
          <Logo />
        </div>
        {item(start)}
        <div className={styles.about}>
          <PlaceChoice everywhere />
          {about.map(item)}
        </div>

        {log ? (
          <button type="button" className={styles.log} aria-keyshortcuts={LOG_KEY} onClick={() => openSheet(underneath)}>
            <span aria-hidden>+</span>
            {t(log.labelKey)}
          </button>
        ) : null}

        <div className={styles.spacer} />

        <NavLink to="/alerts" className={footClass} aria-label={bell ? t(bell.key, { count: bell.count }) : undefined}>
          <span className={styles.grow}>{t('shell.alerts')}</span>
          {bell ? (
            <span className={styles.count} data-kind={bell.kind}>
              {bell.text}
            </span>
          ) : null}
        </NavLink>
        <NavLink to="/me" className={footClass}>
          {t('shell.account')}
        </NavLink>
      </div>
    </nav>
  );
}
