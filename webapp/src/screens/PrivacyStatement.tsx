import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Logo } from '@/ui/Logo';
import ui from '@/ui/ui.module.css';
import styles from './SignIn.module.css';

/** The kinds of data the app keeps, each a line of the page. */
const KEPT = ['account', 'devices', 'diary', 'notifications', 'sharing', 'deleting'] as const;

/**
 * What the app keeps about the people who use it, which is what signing up
 * agrees to. An install that publishes a privacy statement of its own names it
 * at build time (`PRIVACY_URL`), and sign-up links there instead; without one,
 * this page is what the agreement is to - the software's own account of what
 * it stores, which is true of every install, and who answers for it.
 */
export function PrivacyStatement() {
  const { t } = useTranslation();

  return (
    <main className={styles.page}>
      <article className={styles.card}>
        <h1 className={styles.wordmark}>
          <Logo />
        </h1>
        <h2 className={styles.privacyTitle}>{t('privacyPage.title')}</h2>
        <p className={ui.note}>{t('privacyPage.intro')}</p>
        <ul className={styles.kept}>
          {KEPT.map(kind => (
            <li key={kind}>
              <strong>{t(`privacyPage.kept.${kind}.title`)}</strong> {t(`privacyPage.kept.${kind}.text`)}
            </li>
          ))}
        </ul>
        <p className={ui.note}>{t('privacyPage.operator')}</p>
        <p className={styles.links}>
          <Link to="/sign-up">{t('privacyPage.back')}</Link>
        </p>
      </article>
    </main>
  );
}
