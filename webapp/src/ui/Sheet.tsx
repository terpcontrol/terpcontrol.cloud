import { ChevronLeft, X } from 'lucide-react';
import { useRef, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalFocus } from '@/ui/modal-focus';
import styles from './Sheet.module.css';

/**
 * The modal every screen asks its questions in: a sheet over the screen you
 * were on, so that a question asked or an entry logged never costs you the page
 * you were reading.
 *
 * On a phone it comes up from the bottom edge, within a thumb's reach, and its
 * handle pulls it away again; from the desktop breakpoint it is the same panel
 * in the middle of the window. Escape and the backdrop close it, and the focus
 * goes back where it came from. The page behind it does not scroll meanwhile
 * (`[data-scrim]` in global.css).
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
/** How far down the handle has to be pulled before letting go puts the sheet away. */
const PULL_AWAY = 80;

export function Sheet({
  title,
  note,
  aside,
  corner,
  children,
  actions,
  onBack,
  onClose,
}: {
  title: string;
  /** A line under the title that says what the sheet's answer is for. */
  note?: string;
  /** The line the board puts opposite the title, such as the grid a feed is dosed from. */
  aside?: ReactNode;
  /** A control in the top corner, beside the close: the moment a diary line is dated to. */
  corner?: ReactNode;
  children: ReactNode;
  /** What the sheet is for, kept on the bottom edge while the questions above it scroll. */
  actions?: ReactNode;
  /** The way back to what this sheet was chosen from, where it was: the tiles a diary line's detail was picked on. */
  onBack?: (() => void) | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panel = useModalFocus<HTMLDivElement>(onClose);
  // A tap on the backdrop closes on its release, once the browser has taken the
  // focus off the sheet: closed on the press, the focus handed back to what
  // opened the sheet was lost to the page again. A press that began inside the
  // sheet - a text selection let go outside it - closes nothing.
  const pressedBackdrop = useRef(false);
  const pulledFrom = useRef<number | null>(null);

  // The handle's parent is the sheet, which follows the pull and springs back where it is let go too early.
  const follow = (handle: HTMLElement, by: number) => handle.parentElement?.style.setProperty('transform', by > 0 ? `translateY(${by}px)` : '');
  const pull = (event: PointerEvent<HTMLElement>) => {
    if (pulledFrom.current !== null) follow(event.currentTarget, event.clientY - pulledFrom.current);
  };
  const release = (event: PointerEvent<HTMLElement>) => {
    if (pulledFrom.current === null) return;
    const pulled = event.clientY - pulledFrom.current;
    pulledFrom.current = null;
    follow(event.currentTarget, 0);
    if (pulled > PULL_AWAY) onClose();
  };

  return (
    <div
      className={styles.scrim}
      data-scrim
      onPointerDown={event => (pressedBackdrop.current = event.target === event.currentTarget)}
      onClick={event => pressedBackdrop.current && event.target === event.currentTarget && onClose()}
    >
      <div className={styles.sheet} ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <span
          className={styles.handle}
          aria-hidden
          onPointerDown={event => {
            pulledFrom.current = event.clientY;
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={pull}
          onPointerUp={release}
          onPointerCancel={release}
        >
          <span className={styles.grabber} />
        </span>
        <header className={styles.header}>
          {onBack ? (
            <button type="button" className={styles.back} onClick={onBack} aria-label={t('log.back')}>
              <ChevronLeft size={20} strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}
          <h2 className={styles.title}>
            {title}
            {note ? <span className={styles.note}>{note}</span> : null}
          </h2>
          {aside ? <span className={`mono ${styles.aside}`}>{aside}</span> : null}
          {corner}
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
