import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { session, useSession } from '@/api/session';
import { initials } from '@/app/shell/tabs';
import { useTheme, type ThemeChoice } from '@/theme/theme-context';
import ui from '@/ui/ui.module.css';
import styles from './Me.module.css';

const CHOICES: ThemeChoice[] = ['system', 'light', 'dark'];

/**
 * Where the avatar leads. Only what already works is on it: who is signed in,
 * the theme, where notifications go, and the way out; the rest of the account
 * arrives with its slice.
 */
export function Me() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { choice, setChoice } = useTheme();
  const navigate = useNavigate();

  const signOut = async () => {
    await session.logOut();
    await navigate('/sign-in', { replace: true });
  };

  return (
    <section className={styles.screen}>
      <h1 className={styles.title}>{t('me.title')}</h1>

      <header className={styles.identity}>
        <span className={`mono ${styles.avatar}`}>{initials(user?.handle ?? '?')}</span>
        <span className={styles.handle}>@{user?.handle}</span>
      </header>

      <div className={styles.row}>
        <div className={styles.rowTitle}>{t('me.appearance')}</div>
        <div className={styles.rowBody}>
          <span className="label" id="theme-label">
            {t('me.theme.label')}
          </span>
          <div className={styles.segments} role="radiogroup" aria-labelledby="theme-label">
            {CHOICES.map(option => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={choice === option}
                className={`${ui.chip} ${styles.segment} ${choice === option ? styles.segmentActive : ''}`}
                onClick={() => setChoice(option)}
              >
                {t(`me.theme.${option}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Link to="/me/notifications" className={`${styles.row} ${styles.link}`}>
        <span className={styles.rowTitle}>{t('notifications.title')}</span>
        <ChevronRight size={18} strokeWidth={1.75} aria-hidden />
      </Link>

      <div className={styles.row}>
        <button type="button" className={ui.button} onClick={signOut}>
          {t('me.signOut')}
        </button>
      </div>
    </section>
  );
}
