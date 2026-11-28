import { useTranslation } from 'react-i18next';
import styles from './EarlierButton.module.css';
import ui from './ui.module.css';

/**
 * "Frühere Wochen": asks for the weeks before, and while it asks says so - in its words for a screen reader and with
 * a turning ring for the eye, because a few weeks can take a moment and a button that only changes its word reads as
 * one that did nothing. Not disabled while it asks: that would drop the focus, and the rescue's ring then read as a
 * button of its own. A second press meanwhile asks for nothing.
 */
export function EarlierButton({ pending, load }: { pending: boolean; load: () => void }) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={ui.button}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      onClick={() => pending || load()}
    >
      {pending ? <span className={styles.ring} aria-hidden /> : null}
      {pending ? t('home.waiting') : t('grow.earlierWeeks')}
    </button>
  );
}
