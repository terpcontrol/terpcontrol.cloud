import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAccountMe } from '@/api/account';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import styles from './Start.module.css';

/** One way to begin, as a row: what it is, a line that says how, and where it leads. */
export function Door({
  to,
  onClick,
  title,
  note,
  first = false,
}: {
  to?: string;
  onClick?: () => void;
  title: string;
  note: string;
  first?: boolean;
}) {
  const inside: ReactNode = (
    <>
      <span className={styles.rowText}>
        {title}
        <span className={styles.rowNote}>{note}</span>
      </span>
      <ChevronRight size={22} strokeWidth={2} className={styles.chevron} aria-hidden />
    </>
  );

  return to ? (
    <Link to={to} className={`${styles.row} ${styles.door}`} data-first={first || undefined} onClick={onClick}>
      {inside}
    </Link>
  ) : (
    <button type="button" className={`${styles.row} ${styles.door}`} data-first={first || undefined} onClick={onClick}>
      {inside}
    </button>
  );
}

/**
 * What makes a place: a device that is added, a camera of its own, or a grow
 * that stands somewhere without either. A grow is offered to whoever has not
 * said no to the diary.
 */
export function PlaceDoors({ onChosen }: { onChosen?: () => void }) {
  const { t } = useTranslation();
  const me = useAccountMe();

  return (
    <>
      <Door to="/claim" title={t('home.addDevice.title')} note={t('start.empty.deviceNote')} first onClick={onChosen} />
      {me.data?.preferences.diary === 'off' ? null : (
        <Door to="/grows/new" title={t('start.empty.grow')} note={t('start.empty.growNote')} onClick={onChosen} />
      )}
    </>
  );
}

/** "+ Ort hinzufügen", which opens the ways to make one. `wide` is the button under a list of places. */
export function AddPlace({ wide = false }: { wide?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={wide ? styles.wide : styles.add} onClick={() => setOpen(true)}>
        + {t('start.addPlace')}
      </button>
      {open ? (
        <Sheet title={t('start.addPlace')} onClose={() => setOpen(false)}>
          <div className={`${ui.sheetBody} ${styles.doors}`}>
            <PlaceDoors onChosen={() => setOpen(false)} />
            <Door to="/cameras/add" title={t('start.empty.camera')} note={t('start.empty.cameraNote')} onClick={() => setOpen(false)} />
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
