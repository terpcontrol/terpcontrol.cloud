import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Facts } from '@/ui/Facts';
import styles from './Claim.module.css';

/**
 * The head of every page of adding a device, which stands outside the app's
 * bar: the way out, what is being added and, once it is settled what will be
 * asked, how far along. The line is the page's heading on every one of them,
 * so the window is named alike from the code to the last question.
 */
export function FlowHead({ type, step, of, onClose }: { type: string | null; step?: number; of?: number; onClose: () => void }) {
  const { t } = useTranslation();
  // What is being added by the word for its type; "a device" before a code has said, and for a type without a word.
  const adding = t(`claim.adding.${type}`, { defaultValue: t('claim.title') });
  // The count stays on one line.
  const count = step && of ? t('claim.step', { step, of }).replaceAll(' ', ' ') : null;

  return (
    <header className={styles.flowHead}>
      <button type="button" className={styles.close} aria-label={t('claim.close')} onClick={onClose}>
        <X size={22} strokeWidth={2} aria-hidden />
      </button>
      <span className={styles.flowProgress}>
        <h1 className={styles.flowLine}>
          <Facts facts={[adding, count]} />
        </h1>
        {step && of ? (
          <span className={styles.flowBar} aria-hidden>
            <span style={{ width: `${Math.round((step / of) * 100)}%` }} />
          </span>
        ) : null}
      </span>
    </header>
  );
}
