import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Sheet.module.css';

/** Everything inside the panel that a Tab can land on, in the order it would. */
const STOPS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  // Held in a ref rather than depended on: the caller writes the handler inline,
  // so it is a new function on every render and the effect would run again with it.
  const close = useRef(onClose);

  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const before = document.activeElement;
    panel.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close.current();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;

      const stops = [...panel.current.querySelectorAll<HTMLElement>(STOPS)];
      const inside = document.activeElement instanceof Node && panel.current.contains(document.activeElement);
      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
      if (stops.length > 0 && inside && document.activeElement !== edge) return;

      event.preventDefault();
      const wrap = event.shiftKey ? stops[stops.length - 1] : stops[0];
      (wrap ?? panel.current).focus();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

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
