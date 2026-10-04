import { useTranslation } from 'react-i18next';
import ui from './ui.module.css';
import styles from './LaterRound.module.css';

/**
 * A tab whose content belongs to a later round says which one, rather than
 * showing an empty list or a spinner that never ends. `what` is the key of the
 * one line that says what will be here.
 */
export function LaterRound({ round, what }: { round: number; what: string }) {
  const { t } = useTranslation();

  return (
    <section className={`${ui.cardDashed} ${styles.later}`}>
      <span className="label">{t('later.round', { round })}</span>
      <p className={styles.what}>{t(what)}</p>
    </section>
  );
}
