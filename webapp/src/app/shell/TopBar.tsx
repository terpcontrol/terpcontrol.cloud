import { Bell, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Logo } from '@/ui/Logo';
import { useBell } from './bell';
import { PlaceChoice } from './PlaceChoice';
import styles from './TopBar.module.css';

/**
 * The phone's header: the logo, the chosen place on the pages that are about
 * it - where the logo gives way to its mark, so the name has the room - the
 * bell and the way to Ich. The bell carries a dot while something is open and
 * nothing at all while nothing is, so it reads as quiet rather than as a
 * zero; the link says the count, for anybody who cannot see the dot.
 */
export function TopBar() {
  const { t } = useTranslation();
  const bell = useBell();

  return (
    <header className={styles.bar} data-print="omit">
      <Link to="/" className={styles.wordmark}>
        <Logo />
      </Link>
      <PlaceChoice />
      <Link to="/alerts" className={styles.action} aria-label={bell ? t(bell.key, { count: bell.count }) : t('shell.alerts')}>
        <Bell size={22} strokeWidth={2} aria-hidden />
        {bell ? <span className={styles.dot} data-kind={bell.kind} aria-hidden /> : null}
      </Link>
      <Link to="/me" className={styles.action} aria-label={t('shell.account')}>
        <UserRound size={22} strokeWidth={2} aria-hidden />
      </Link>
    </header>
  );
}
