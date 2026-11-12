import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { leadingBackTo } from '@/app/places';
import type { GrowListItem, Plant, Space } from '@fg2/shared-types/v1';
import { Menu } from '@/ui/Menu';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import { HarvestSheet } from './HarvestSheet';
import { MoveSheet } from './MoveSheet';
import { PhaseSheet } from './PhaseSheet';
import { RenameSheet } from './RenameSheet';
import { ShareSheet } from './ShareSheet';
import { SplitSheet } from './SplitSheet';
import styles from './GrowPage.module.css';

type GrowSheet = 'phase' | 'share' | 'move' | 'split' | 'harvest' | 'rename' | 'tips';

/** The stages' tips, four each; curing is where the drying tips end, in the jar. */
const TIP_NUMBERS = [1, 2, 3, 4];

/**
 * What happens to a grow rather than in it, behind the ⋯ beside its name: it
 * moves on a stage, its diary is shared, it moves house, some of it goes its
 * own way, it comes down, and it is called something - each a sheet that also
 * holds the repairs of its own record. Beside them what the grow measures,
 * and four tips for the stage it is in.
 *
 * On a desktop the two used most, the phase and sharing, stand as buttons of
 * their own and the menu holds the rest. A session that may only look is
 * offered none of what changes the grow - the server would refuse each of
 * them - and sharing a diary is its owner's alone. A grow that has ended takes
 * nothing that happens after its end, so it is offered neither a split nor a
 * harvest; phase and move stay, because their sheets are where its record is
 * repaired.
 */
export function GrowMenu({
  grow,
  plants,
  spaces,
  mayManage,
  mayOwn,
  sharing = false,
}: {
  grow: GrowListItem;
  plants: Plant[];
  spaces: Space[];
  mayManage: boolean;
  mayOwn: boolean;
  /** Whether the page was opened on the share sheet, as a place's "Grow teilen" does. */
  sharing?: boolean;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = useState<GrowSheet | null>(sharing && mayOwn ? 'share' : null);
  const close = () => setOpen(null);
  const running = grow.endedAt === null;
  const tips = running ? (grow.summary.stage === 'curing' ? 'drying' : grow.summary.stage) : null;
  const item = (sheet: GrowSheet, label: string, both = false) => (
    <button type="button" className={both ? styles.phoneOnly : undefined} onClick={() => setOpen(sheet)}>
      {label}
    </button>
  );

  return (
    <>
      {mayManage ? (
        <button type="button" className={`${styles.pill} ${styles.wideOnly}`} onClick={() => setOpen('phase')}>
          {t('grow.lifecycle.actions.phase')}
        </button>
      ) : null}
      {mayOwn ? (
        <button type="button" className={`${styles.pill} ${styles.wideOnly}`} onClick={() => setOpen('share')}>
          {t('sharing.share')}
        </button>
      ) : null}
      <Menu label={t('grow.menu.label', { name: grow.name })} words={t('grow.menu.more')}>
        {mayManage ? item('phase', t('grow.lifecycle.actions.phase'), true) : null}
        {mayOwn ? item('share', t('sharing.share'), true) : null}
        <Link to={`/grows/${grow.id}/measurements`} state={leadingBackTo(pathname)}>
          {t('grow.measurements.title')}
        </Link>
        {mayManage ? item('move', t('grow.lifecycle.actions.move')) : null}
        {mayManage && running ? item('split', t('grow.lifecycle.actions.split')) : null}
        {mayManage && running ? item('harvest', t('grow.lifecycle.actions.harvest')) : null}
        {mayManage ? item('rename', t('grow.lifecycle.actions.rename')) : null}
        {tips ? item('tips', t('assistant.tipsTitle')) : null}
      </Menu>

      {open === 'phase' ? <PhaseSheet grow={grow} onClose={close} /> : null}
      {open === 'share' ? <ShareSheet grow={grow} onClose={close} /> : null}
      {open === 'move' ? <MoveSheet grow={grow} plants={plants} spaces={spaces} onClose={close} /> : null}
      {open === 'split' ? <SplitSheet grow={grow} plants={plants} spaces={spaces} onClose={close} /> : null}
      {open === 'harvest' ? <HarvestSheet grow={grow} plants={plants} onClose={close} /> : null}
      {open === 'rename' ? <RenameSheet grow={grow} onClose={close} /> : null}
      {open === 'tips' && tips ? (
        <Sheet title={t('assistant.tipsTitle')} onClose={close}>
          <ul className={`${ui.sheetBody} ${styles.tips}`}>
            {TIP_NUMBERS.map(number => (
              <li key={number}>{t(`assistant.tips.${tips}.${number}`)}</li>
            ))}
          </ul>
        </Sheet>
      ) : null}
    </>
  );
}
