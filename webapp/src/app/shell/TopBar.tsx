import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { bellOf, useOpenAlertCount } from '@/api/alerts';
import { useSession } from '@/api/session';
import { ageLabel } from '@/ui/age';
import { useFreshness } from '@/ui/freshness';
import { useNow } from '@/ui/useNow';
import { initials } from './tabs';
import styles from './TopBar.module.css';

/** "updated 20 s ago", or nothing while the screen has nothing that ages. */
export function Freshness({ className }: { className?: string }) {
  const { t } = useTranslation();
  const at = useFreshness();
  const now = useNow();
  return (
    <div className={`mono ${styles.freshness} ${className ?? ''}`} aria-live="off">
      {at ? t('shell.updated', { age: ageLabel(at, now) }) : ''}
    </div>
  );
}

/**
 * The phone's header: the wordmark with the freshness line, the alerts bell,
 * and the avatar that opens Me. The bell carries the open count, or nothing at
 * all when none is open, so it reads as quiet rather than as a zero; the link
 * says the count too, for anybody who cannot see the badge.
 */
export function TopBar() {
  const { t } = useTranslation();
  const { user } = useSession();
  const bell = bellOf(useOpenAlertCount());

  return (
    <header className={styles.bar}>
      <div className={styles.identity}>
        <div className={styles.wordmark}>Terp Control</div>
        <Freshness />
      </div>
      <Link to="/alerts" className={styles.action} aria-label={bell ? t(bell.key, { count: bell.count }) : t('shell.alerts')}>
        <Bell size={20} strokeWidth={1.75} aria-hidden />
        {bell ? <span className={`mono ${styles.badge}`}>{bell.text}</span> : null}
      </Link>
      <Link to="/me" className={styles.avatar} aria-label={t('shell.account')}>
        <span className="mono">{initials(user?.handle ?? '?')}</span>
      </Link>
    </header>
  );
}
