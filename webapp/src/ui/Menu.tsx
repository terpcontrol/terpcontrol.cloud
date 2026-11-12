import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './Menu.module.css';

/**
 * What is done to a thing now and then rather than every day, behind the ⋯
 * beside its name - a button that says so in words on a desktop, where
 * `words` names it. The list closes on a choice, a tap elsewhere and Escape.
 * Its children are the buttons and links it offers.
 */
export function Menu({ label, words, children }: { label: string; words?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!frame.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className={styles.menu} ref={frame}>
      <button
        type="button"
        className={styles.button}
        data-words={words ? true : undefined}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={22} strokeWidth={2} aria-hidden />
        {words ? (
          <span className={styles.words} aria-hidden>
            {words}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className={styles.list} id={listId} onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A second line under a menu item: what it would change, or where it stands now. */
export function MenuLine({ children }: { children: ReactNode }) {
  return <span className={styles.line}>{children}</span>;
}
