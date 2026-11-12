import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Facts } from '@/ui/Facts';
import styles from './Claim.module.css';

/**
 * The head of every page of adding a device, which stands outside the app's
 * bar: the way out, what is being added and, once a claim has said what will
 * be asked, how far along. `titled` makes the line the page's heading.
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
  step?: number;
  of?: number;
  titled?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const Line = titled ? 'h1' : 'span';
  // The line names the window, where a type's soft hyphen would be printed; the count stays on one line.
  const adding = device ? t('claim.adding', { device: device.replaceAll('\u00ad', '') }) : t('claim.title');
  const count = step && of ? t('claim.step', { step, of }).replaceAll(' ', '\u00a0') : null;

  return (
    <header className={styles.flowHead}>
      <button type="button" className={styles.close} aria-label={t('claim.close')} onClick={onClose}>
        <X size={22} strokeWidth={2} aria-hidden />
      </button>
      <span className={styles.flowProgress}>
        <Line className={styles.flowLine}>
          <Facts facts={[adding, count]} />
        </Line>
        {step && of ? (
          <span className={styles.flowBar} aria-hidden>
            <span style={{ width: `${Math.round((step / of) * 100)}%` }} />
          </span>
        ) : null}
      </span>
    </header>
  );
}
