import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSession } from '@/api/session';
import ui from '@/ui/ui.module.css';
import { ADMIN_MIN_WIDTH, useWideWindow } from './wide-window';
import styles from './Admin.module.css';

/**
 * The door to the four fleet screens, which are for whoever runs this install
 * and for nobody else.
 *
 * Two things are refused here, and each of them is said rather than shown as an
 * empty page. An account that is not an administrator is told plainly that
 * these screens are not for it - the server would refuse every read behind them
 * anyway, and a screen that draws a spinner until that arrives teaches nothing.
 * A window too narrow for them is told the same way: the fleet table is a dozen
 * columns wide and the rollout controls state their figures beside each other,
 * so there is no phone layout of this and pretending otherwise would only make
 * an unreadable one.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const wide = useWideWindow();

  if (!user?.isAdmin) {
    return (
      <section className={styles.refusal}>
        <h1 className={styles.title}>{t('admin.refused.title')}</h1>
        <p className={ui.note}>{t('admin.refused.line')}</p>
        <Link className={ui.button} to="/">
          {t('admin.refused.home')}
        </Link>
      </section>
    );
  }

  if (!wide) {
    return (
      <section className={styles.refusal}>
        <h1 className={styles.title}>{t('admin.narrow.title')}</h1>
        {/* The width is the one the gate checks, so the sentence cannot drift from it. */}
        <p className={ui.note}>{t('admin.narrow.line', { width: ADMIN_MIN_WIDTH })}</p>
        <Link className={ui.button} to="/">
          {t('admin.refused.home')}
        </Link>
      </section>
    );
  }

  return <>{children}</>;
}
