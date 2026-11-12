import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './Claim.module.css';

/**
 * The head of every page of adding a device, which stands outside the app's
 * bar: the way out, what is being added and how far along it is. `titled`
 * makes the line the page's heading, on the pages whose questions are a list.
 */
export function FlowHead({
  device,
  step,
  of,
  titled = false,
  onClose,
}: {
  /** What is being added, by its type; null before a code has said. */
  device: string | null;
  step: number;
  of: number;
  titled?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const Line = titled ? 'h1' : 'span';

  return (
    <header className={styles.flowHead}>
      <button type="button" className={styles.close} aria-label={t('claim.close')} onClick={onClose}>
        <X size={22} strokeWidth={2} aria-hidden />
      </button>
      <span className={styles.flowProgress}>
        <Line className={styles.flowLine}>{device ? t('claim.step', { device, step, of }) : t('claim.stepUnknown', { step, of })}</Line>
        <span className={styles.flowBar} aria-hidden>
          <span style={{ width: `${Math.round((step / of) * 100)}%` }} />
        </span>
      </span>
    </header>
  );
}
