import { MoreHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { SpaceOverview } from '@fg2/shared-types/v1';
import { controlPath, membersPath } from '@/app/places';
import { useMe } from '@/api/account';
import { useDiaryLayer } from '@/api/layers';
import { useSession } from '@/api/session';
import { useMayInSpace, useMayManage } from '@/ui/session-access';
import { RenameSheet } from '../place/RenameSheet';
import { MoveHereSheet } from '../space/MoveHereSheet';
import styles from './Cockpit.module.css';

type Sheet = 'rename' | 'move';

/**
 * What is done to a place now and then rather than every day, behind the ⋯
 * beside its name: its name, who else is let in, a climate preset, and its
 * grow. None of it is a reading, so none of it takes room on the cockpit itself.
 *
 * Each item that changes more than its name says so on a line under it - and
 * starting a grow puts the place on the preset of the stage it starts in, and
 * for somebody who has never kept a diary it brings the diary in as well. The
 * climate preset is not a sheet of its own: it is the row of chips under the
 * targets on Steuerung, one list that moves the sliders and holds nothing
 * until it is saved, and this item opens it there. Everything that changes the place
 * needs the right to manage it; who is let in can be read by every member, who
 * may leave from there.
 */
export function PlaceMenu({ overview }: { overview: SpaceOverview }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const mayManage = useMayManage(overview.spaceId);
  const member = useMayInSpace(overview.spaceId) !== undefined;
  const diary = useDiaryLayer();
  const me = useMe(false, user !== null && user.isDemo !== true);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const listId = useId();
  // A place with nothing standing in it has no document a preset could be written into.
  const hasDevice = (overview.deviceIds?.length ?? 0) > 0;
  const grow = diary ? (overview.grows[0] ?? null) : null;
  const mayOwnGrow = mayManage && user !== null && user.isDemo !== true;
  // Somebody who said no to the diary is not offered a grow through the back door; the answer can be changed under Me.
  const mayStartGrow = mayManage && grow === null && (diary || (me.data !== undefined && me.data.preferences.diary !== 'off'));
  const growLine = [diary ? null : t('cockpit.menu.growTurnsOn'), hasDevice ? t('cockpit.menu.growWrites') : null].filter(Boolean).join(' · ');

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

  const choose = (next: Sheet) => {
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
          {mayManage ? (
            <button type="button" onClick={() => choose('rename')}>
              {t('cockpit.menu.rename')}
            </button>
          ) : null}
          {/* Who else is here is a member's question; support reading a customer's place is not one. */}
          {member ? (
            <Link to={membersPath(overview.spaceId)} onClick={() => setOpen(false)}>
              {t('cockpit.menu.members')}
            </Link>
          ) : null}
          {mayManage && hasDevice ? (
            <Link to={controlPath(overview.spaceId, null, {}, 'presets')} onClick={() => setOpen(false)}>
              {t('cockpit.menu.preset')} <span className={styles.menuLine}>{t('cockpit.menu.presetLine')}</span>
            </Link>
          ) : null}
          {/* Showing somebody the diary is a grow's, and was the seventh chip of the grow page, off the screen's edge. */}
          {grow && mayOwnGrow ? (
            <Link to={`/grows/${grow.growId}?share=1`} onClick={() => setOpen(false)}>
              {t('cockpit.menu.shareGrow')}
            </Link>
          ) : null}
          {grow ? (
            <Link to={`/grows/${grow.growId}`} onClick={() => setOpen(false)}>
              {t('cockpit.menu.openGrow')}{' '}
              <span className={styles.menuLine}>
                {grow.dayNumber !== null ? t('cockpit.menu.growDay', { name: grow.name, day: grow.dayNumber }) : grow.name}
              </span>
            </Link>
          ) : null}
          {mayStartGrow ? (
            <Link to={`/grows/new?space=${overview.spaceId}`} onClick={() => setOpen(false)}>
              {t('cockpit.menu.newGrow')}
              {growLine ? (
                <>
                  {' '}
                  <span className={styles.menuLine}>{growLine}</span>
                </>
              ) : null}
            </Link>
          ) : null}
          {mayManage && diary && grow === null ? (
            <button type="button" onClick={() => choose('move')}>
              {t('cockpit.menu.moveGrow')}
            </button>
          ) : null}
        </div>
      ) : null}
      {sheet === 'rename' ? <RenameSheet spaceId={overview.spaceId} name={overview.name} onClose={() => setSheet(null)} /> : null}
      {sheet === 'move' ? <MoveHereSheet spaceId={overview.spaceId} spaceName={overview.name} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
