import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
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

/** The phone's header: the wordmark with the freshness line, the alerts bell, and the avatar that opens Me. */
export function TopBar() {
  const { t } = useTranslation();
  const { user } = useSession();

  return (
    <header className={styles.bar}>
      <div className={styles.identity}>
        <div className={styles.wordmark}>Terp Control</div>
        <Freshness />
      </div>
      <Link to="/alerts" className={styles.action} aria-label={t('shell.alerts')}>
        <Bell size={20} strokeWidth={1.75} aria-hidden />
      </Link>
      <Link to="/me" className={styles.avatar} aria-label={t('shell.account')}>
        <span className="mono">{initials(user?.handle ?? '?')}</span>
      </Link>
    </header>
  );
}
