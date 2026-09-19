import { useTranslation } from 'react-i18next';
import styles from './Public.module.css';

/**
 * What an address that leads nowhere says, and all it says.
 *
 * The server answers the same 404 for a diary that was never public, a profile
 * nobody published and a link that was revoked, expired or made up - which is
 * the point: a page that said "this link has been revoked" would confirm that
 * somebody once made one and that it pointed somewhere. So the words here are
 * about the address and never about what might have been behind it.
 */
export function Nothing({ titleKey, bodyKey }: { titleKey: string; bodyKey: string }) {
  const { t } = useTranslation();

  return (
    <section className={styles.nothing}>
      <h1 className={styles.nothingTitle}>{t(titleKey)}</h1>
      <p className={styles.nothingBody}>{t(bodyKey)}</p>
    </section>
  );
}
