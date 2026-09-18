import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Sheet.module.css';

/**
 * What logging happens in: a sheet over the screen you were on, so that a tap
 * on the raised button never costs you the page you were reading.
 *
 * On a phone it comes up from the bottom edge, within a thumb's reach; from the
 * desktop breakpoint it is the same panel in the middle of the window. Escape
 * and the backdrop close it, and the focus goes back where it came from.
 */
export function Sheet({
  title,
  aside,
  children,
  onClose,
}: {
  title: string;
  /** The line the board puts opposite the title, such as "long-press a tile for details". */
  aside?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const before = document.activeElement;
    panel.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      if (before instanceof HTMLElement) before.focus();
    };
  }, [onClose]);

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
        {children}
      </div>
    </div>
  );
}
