import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalFocus } from './modal-focus';
import { Photo } from './Photo';
import styles from './PictureViewer.module.css';

interface PictureViewerProps {
  /**
   * The addresses of the pictures that may be shown here, in the order the line
   * carries them - already resolved by the surface, because a public page and a
   * share link reach the bytes at addresses of their own and refuse the ones
   * outside their window.
   */
  pictures: string[];
  /** Which of them was opened. */
  from: number;
  onClose: () => void;
}

/**
 * Every picture of one diary line, one at a time.
 *
 * A row has space for four thumbnails and no more - one migrated phase line
 * carries seventeen - so the strip says how many more there are and this is
 * where they are. It is a dialog rather than a screen of its own because the
 * pictures hang on the line: a reader is in the middle of a week card, and a
 * route would cost them their place in it.
 *
 * What it steps through is what the surface handed over, which on a share link
 * narrowed to a few days is fewer pictures than the line carries. Stepping
 * over a refused picture is the same decision the strip makes by leaving its
 * frame out, rather than a blank frame and a number that skips.
 */
export function PictureViewer({ pictures, from, onClose }: PictureViewerProps) {
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

  const caption = t('home.entryPhotos.alt', { n: shown + 1, count: pictures.length });

  return (
    <div className={styles.scrim} onPointerDown={event => event.target === event.currentTarget && onClose()}>
      <div className={styles.viewer} ref={panel} role="dialog" aria-modal="true" aria-label={caption} tabIndex={-1}>
        <header className={styles.header}>
          <span className={`mono ${styles.counter}`}>{caption}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('log.close')}>
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>
        <Photo className={styles.frame} src={pictures[shown] ?? null} alt={caption} />
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
      </div>
    </div>
  );
}
