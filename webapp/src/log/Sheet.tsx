import { X } from 'lucide-react';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalFocus } from '@/ui/modal-focus';
import styles from './Sheet.module.css';

/**
 * What logging happens in: a sheet over the screen you were on, so that a tap
 * on the raised button never costs you the page you were reading.
 *
 * On a phone it comes up from the bottom edge, within a thumb's reach; from the
 * desktop breakpoint it is the same panel in the middle of the window. Escape
 * and the backdrop close it, and the focus goes back where it came from.
 *
 * While it is open the focus stays inside it: it is a modal, so Tab off either
 * end comes round to the other, and nothing behind the scrim can be reached by
 * keyboard while it cannot be reached by pointer. The focus is placed once, on
 * opening, and never again - a screen that re-renders on a clock would
 * otherwise take the cursor out of the field being typed in every few seconds.
 *
 * The panel never grows past the window, so what does not fit scrolls. Only
 * the questions scroll, though: the title stays where it was read and a sheet
 * that hands its actions over keeps them on the bottom edge, because a sheet
 * long enough to scroll is exactly the one whose Save would otherwise sit
 * below the fold with nothing on screen to say it was there.
 */
export function Sheet({
  title,
  aside,
  children,
  actions,
  onClose,
}: {
  title: string;
  /** The line the board puts opposite the title, such as "long-press a tile for details". */
  aside?: ReactNode;
  children: ReactNode;
  /** What the sheet is for, kept on the bottom edge while the questions above it scroll. */
  actions?: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panel = useModalFocus<HTMLDivElement>(onClose);

  return (
    <div className={styles.scrim} onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <div className={styles.sheet} ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <span className={styles.grabber} aria-hidden />
        <header className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          {aside ? <span className={`mono ${styles.aside}`}>{aside}</span> : null}
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('log.close')}>
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {actions ? <footer className={styles.actions}>{actions}</footer> : null}
      </div>
    </div>
  );
}
