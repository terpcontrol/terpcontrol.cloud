import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { GrowListItem, Plant, Space } from '@fg2/shared-types/v1';
import { useGrowDiary, useRemoveGrow } from '@/api/grows';
import { useWithdrawPhase } from '@/api/lifecycle';
import { ALL_GROWS } from '@/app/places';
import { useLog } from '@/log/log-context';
import { Asking } from '@/ui/Asking';
import { Menu } from '@/ui/Menu';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import ui from '@/ui/ui.module.css';
import { HarvestSheet } from './HarvestSheet';
import { MoveSheet } from './MoveSheet';
import { PhaseSheet } from './PhaseSheet';
import { RenameSheet } from './RenameSheet';
import { ShareSheet } from './ShareSheet';
import { SplitSheet } from './SplitSheet';
import styles from './GrowPage.module.css';

type GrowSheet = 'phase' | 'share' | 'move' | 'split' | 'harvest' | 'rename' | 'tips' | 'delete';

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
 * repaired. A grow started by mistake - nothing in its diary but the line of
 * its phase - is offered to its owner to delete.
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
  const [open, setOpen] = useState<GrowSheet | null>(sharing && mayOwn ? 'share' : null);
  const close = () => setOpen(null);
  const running = grow.endedAt === null;
  const tips = running ? (grow.summary.stage === 'curing' ? 'drying' : grow.summary.stage) : null;
  const deletable = useStartedByMistake(grow.id, mayOwn);
  const item = (sheet: GrowSheet, label: string, both = false) => (
    <button type="button" className={both ? styles.phoneOnly : undefined} onClick={() => setOpen(sheet)}>
      {label}
    </button>
  );

  return (
    <>
      {mayManage ? (
        <button type="button" className={`${ui.pill} ${styles.pill} ${styles.wideOnly}`} onClick={() => setOpen('phase')}>
          {t('grow.lifecycle.actions.phase')}
        </button>
      ) : null}
      {mayOwn ? (
        <button type="button" className={`${ui.pill} ${styles.pill} ${styles.wideOnly}`} onClick={() => setOpen('share')}>
          {t('sharing.share')}
        </button>
      ) : null}
      <Menu label={t('grow.menu.label', { name: grow.name })} words={t('grow.menu.more')}>
        {mayManage ? item('phase', t('grow.lifecycle.actions.phase'), true) : null}
        {mayOwn ? item('share', t('sharing.share'), true) : null}
        <Link to={`/grows/${grow.id}/measurements`}>{t('grow.measurements.title')}</Link>
        {mayManage ? item('move', t('grow.lifecycle.actions.move')) : null}
        {mayManage && running ? item('split', t('grow.lifecycle.actions.split')) : null}
        {mayManage && running ? item('harvest', t('grow.lifecycle.actions.harvest')) : null}
        {mayManage ? item('rename', t('grow.lifecycle.actions.rename')) : null}
        {tips ? item('tips', t('assistant.tipsTitle')) : null}
        {deletable ? item('delete', t('grow.lifecycle.actions.delete')) : null}
      </Menu>

      {open === 'phase' ? <PhaseSheet grow={grow} onClose={close} /> : null}
      {open === 'share' ? <ShareSheet grow={grow} onClose={close} /> : null}
      {open === 'move' ? <MoveSheet grow={grow} plants={plants} spaces={spaces} onClose={close} /> : null}
      {open === 'split' ? <SplitSheet grow={grow} plants={plants} spaces={spaces} onClose={close} /> : null}
      {open === 'harvest' ? <HarvestSheet grow={grow} plants={plants} onClose={close} /> : null}
      {open === 'rename' ? <RenameSheet grow={grow} onClose={close} /> : null}
      {open === 'delete' ? <DeleteSheet grow={grow} onClose={close} /> : null}
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

/**
 * Whether the grow holds nothing but the line its phase announced itself with: a grow started by mistake, from an
 * empty form, which is what may be deleted. Asked of its owner only, from the diary's own read - every page of it
 * there is, so a diary with weeks still to load is not judged.
 */
const useStartedByMistake = (growId: string, mayOwn: boolean): boolean => {
  const diary = useGrowDiary(mayOwn ? growId : null);
  const pages = diary.data?.pages ?? [];
  if (!mayOwn || pages.length === 0 || diary.hasNextPage) return false;

  const lines = [...pages.flatMap(page => page.items.flatMap(week => week.days.flatMap(day => day.entries))), ...(pages.at(-1)?.earlier ?? [])];
  return lines.every(line => line.kind === 'phase');
};

/**
 * Deleting a grow, asked first. Its phases are taken back before it goes, each with the diary line that announced
 * it - the server deletes a grow with its plants and share links and leaves its lines, and a line of a grow that is
 * gone would stand on its place's Start. No call brings a grow back, so the answer has no way back.
 */
function DeleteSheet({ grow, onClose }: { grow: GrowListItem; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tell } = useLog();
  const withdraw = useWithdrawPhase(grow.id);
  const remove = useRemoveGrow();
  const busy = withdraw.isPending || remove.isPending;

  const yes = async () => {
    try {
      for (const phase of [...grow.phases].reverse()) await withdraw.mutateAsync(phase.id);
      await remove.mutateAsync(grow.id);
    } catch {
      return; // Said under the question.
    }
    void navigate(ALL_GROWS, { replace: true });
    tell({ label: t('grow.told.deleted', { name: grow.name }), undo: null });
  };

  return (
    <Sheet title={t('grow.lifecycle.actions.delete')} onClose={onClose}>
      <div className={ui.sheetBody}>
        <Asking
          note={t('grow.lifecycle.delete.ask', { name: grow.name })}
          yes={t('grow.lifecycle.delete.yes')}
          danger
          busy={busy}
          onYes={() => void yes()}
          onCancel={onClose}
        >
          <Refused error={withdraw.error ?? remove.error} />
        </Asking>
      </div>
    </Sheet>
  );
}
