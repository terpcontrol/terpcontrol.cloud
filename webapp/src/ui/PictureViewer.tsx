import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalFocus } from './modal-focus';
import { Photo } from './Photo';
import ui from './ui.module.css';
import styles from './PictureViewer.module.css';

interface PictureViewerProps {
  /**
   * The addresses of the pictures that may be shown here, in the order the line
   * carries them - already resolved by the surface, because a public page and a
   * share link reach the bytes at addresses of their own and refuse the ones
   * outside their window.
   */
  pictures: string[];
  /** What each picture is shown under - its day, its date, what was written with it - where the surface knows. */
  captions?: string[];
  /** Which of them was opened. */
  from: number;
  /** What can be done with the picture on screen, by its place in `pictures`; drawn under it. */
  actions?: (shown: number) => ReactNode;
  onClose: () => void;
}

/**
 * Every picture of one diary line, one at a time.
 *
 * A line says how many pictures it carries - one migrated phase line carries
 * seventeen - and is the way to them; this is where they are. It is a dialog
 * rather than a screen of its own because the pictures hang on the line: a
 * reader is in the middle of a day's card, and a route would cost them their
 * place in it.
 *
 * What it steps through is what the surface handed over, which on a share
 * link narrowed to a few days is fewer pictures than the line carries.
 */
export function PictureViewer({ pictures, captions, from, actions, onClose }: PictureViewerProps) {
  const { t } = useTranslation();
  const panel = useModalFocus<HTMLDivElement>(onClose);
  const [shown, setShown] = useState(() => Math.min(Math.max(0, from), Math.max(0, pictures.length - 1)));

  // The arrows step as well as the buttons: a viewer opened from a keyboard is
  // stepped from one, and Escape is already the way out.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setShown(at => Math.min(pictures.length - 1, Math.max(0, at + (event.key === 'ArrowLeft' ? -1 : 1))));
    };
    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [pictures.length]);

  const counted = t('home.entryPhotos.alt', { n: shown + 1, count: pictures.length });
  // One picture has nothing to count and nowhere to step to.
  const caption = captions?.[shown] ? (pictures.length > 1 ? `${captions[shown]} · ${shown + 1}/${pictures.length}` : captions[shown]) : counted;

  return (
    <div className={styles.scrim} onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <div className={styles.viewer} ref={panel} role="dialog" aria-modal="true" aria-label={caption} tabIndex={-1}>
        <header className={styles.header}>
          <span className={styles.counter}>{caption}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('log.close')}>
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>
        <Photo className={styles.frame} src={pictures[shown] ?? null} alt={caption} />
        {actions ? <div className={styles.actions}>{actions(shown)}</div> : null}
        {pictures.length > 1 ? (
          <footer className={styles.steps}>
            <button
              type="button"
              className={styles.step}
              disabled={shown === 0}
              onClick={() => setShown(at => at - 1)}
              aria-label={t('home.entryPhotos.previous')}
            >
              <ChevronLeft size={20} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              type="button"
              className={styles.step}
              disabled={shown >= pictures.length - 1}
              onClick={() => setShown(at => at + 1)}
              aria-label={t('home.entryPhotos.next')}
            >
              <ChevronRight size={20} strokeWidth={1.75} aria-hidden />
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** How many pictures a strip draws before it says how many more there are: a line that carries seventeen stays a line. */
const STRIP_PICTURES = 4;

/**
 * The pictures of one line, small, where a surface shows them in the line
 * itself: a share link, which is the diary shown to somebody, and the sheet
 * that corrects a line. Each opens the viewer on itself, and "+13" on the
 * first the strip had no room for. They are numbered, because a screen reader
 * meeting four pictures in a row has no other way to tell one from the next.
 */
export function PictureStrip({ pictures, count = pictures.length, onOpen }: { pictures: string[]; count?: number; onOpen: (index: number) => void }) {
  const { t } = useTranslation();

  return (
    <span className={styles.strip}>
      {pictures.slice(0, STRIP_PICTURES).map((src, index) => (
        <button key={src} type="button" className={styles.small} onClick={() => onOpen(index)}>
          <Photo className={styles.smallFrame} src={src} alt={t('home.entryPhotos.alt', { n: index + 1, count })} />
        </button>
      ))}
      {pictures.length > STRIP_PICTURES ? (
        <button type="button" className={styles.rest} onClick={() => onOpen(STRIP_PICTURES)}>
          {`+${pictures.length - STRIP_PICTURES}`}
          <span className={ui.visuallyHidden}>{`, ${t('grow.diary.openPicture')}`}</span>
        </button>
      ) : null}
    </span>
  );
}
