import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { SpaceOverview } from '@fg2/shared-types/v1';
import { useDiaryLayer } from '@/api/layers';
import { useMayManage } from '@/ui/session-access';
import { MoveHereSheet } from '../space/MoveHereSheet';
import { PresetSheet } from '../space/PresetSheet';
import styles from './Cockpit.module.css';

/**
 * What is done to a place now and then rather than every day, behind the ⋯
 * beside its name: putting it on a climate preset, starting or moving in a
 * grow, and who else is let in. None of it is a reading, so none of it takes
 * room on the cockpit itself.
 *
 * The grow items are the diary's, and appear only for an account that keeps
 * one; everything that changes the place needs the right to manage it.
 */
export function PlaceMenu({ overview }: { overview: SpaceOverview }) {
  const { t } = useTranslation();
  const mayManage = useMayManage(overview.spaceId);
  const diary = useDiaryLayer();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<'preset' | 'move' | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const listId = useId();
  // A place with nothing standing in it has no document a preset could be written into.
  const hasDevice = (overview.deviceIds?.length ?? 0) > 0;

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

  const choose = (next: 'preset' | 'move') => {
    setOpen(false);
    setSheet(next);
  };

  return (
    <div className={styles.menu} ref={frame}>
      <button
        type="button"
        className={styles.menuButton}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t('cockpit.menu.label', { name: overview.name })}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={20} strokeWidth={1.75} aria-hidden />
      </button>
      {open ? (
        <div className={styles.menuList} id={listId}>
          {mayManage && hasDevice ? (
            <button type="button" onClick={() => choose('preset')}>
              {t('cockpit.menu.preset')}
            </button>
          ) : null}
          {mayManage && diary ? (
            <>
              <Link to={`/grows/new?space=${overview.spaceId}`} onClick={() => setOpen(false)}>
                {t('cockpit.menu.newGrow')}
              </Link>
              <button type="button" onClick={() => choose('move')}>
                {t('cockpit.menu.moveGrow')}
              </button>
            </>
          ) : null}
          <Link to={`/spaces/${overview.spaceId}/members`} onClick={() => setOpen(false)}>
            {t('cockpit.menu.members')}
          </Link>
        </div>
      ) : null}
      {sheet === 'preset' ? <PresetSheet overview={overview} onClose={() => setSheet(null)} /> : null}
      {sheet === 'move' ? <MoveHereSheet spaceId={overview.spaceId} spaceName={overview.name} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
