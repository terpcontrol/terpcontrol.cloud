import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Advanced.module.css';

/**
 * "Erweitert": what almost nobody changes, folded under its label wherever a
 * form has such a part. What stands in it is drawn only while it is open, so
 * a field nobody sees is never the one a save trips over; `open` is how it
 * stands at first, for a form whose folded part already holds something.
 */
export function AdvancedFold({ open: atFirst = false, children }: { open?: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(atFirst);

  return (
    <details className={styles.section} open={open}>
      <summary
        className="label"
        onClick={event => {
          event.preventDefault();
          setOpen(!open);
        }}
      >
        {t('advanced.title')}
      </summary>
      {open ? <div className={styles.items}>{children}</div> : null}
    </details>
  );
}
