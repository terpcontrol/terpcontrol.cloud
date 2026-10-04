import { Leaf, Move, Pencil, Scissors, Split } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, Plant, Space } from '@fg2/shared-types/v1';
import ui from '@/ui/ui.module.css';
import { HarvestSheet } from './HarvestSheet';
import { MoveSheet } from './MoveSheet';
import { PhaseSheet } from './PhaseSheet';
import { RenameSheet } from './RenameSheet';
import { SplitSheet } from './SplitSheet';
import styles from './Lifecycle.module.css';

/**
 * The five things that happen to a grow rather than in it: it moves on a stage,
 * it moves house, some of it goes its own way, it comes down - and it is called
 * something.
 *
 * They sit on the grow page under the phase bar because that is where a grower
 * reads what the grow is doing, and each opens the sheet that also holds the
 * repairs for it - correcting a phase is part of entering one, and taking back
 * a move is part of making one. A session that may only look is offered none of
 * them: the server refuses every write it makes, and a button that would be
 * refused is not a button.
 *
 * The name is a repair of the same kind and belongs in the same row. It is last
 * because it is the smallest of them: it changes nothing the grow went through,
 * where the four before it all do.
 *
 * A grow that has ended takes nothing that happens after its end, so it is not
 * offered a split or a harvest. Phase and Move stay, because their sheets are
 * also where its record is repaired - a stage somebody forgot, a move dated
 * wrongly - and both keep their dates inside the grow.
 */
const SHEETS = ['phase', 'move', 'split', 'harvest', 'rename'] as const;
type LifecycleSheet = (typeof SHEETS)[number];

const FOR_AN_ENDED_GROW: readonly LifecycleSheet[] = ['phase', 'move', 'rename'];

const ICON = { phase: Leaf, move: Move, split: Split, harvest: Scissors, rename: Pencil };

export function GrowLifecycle({ grow, plants, spaces }: { grow: GrowListItem; plants: Plant[]; spaces: Space[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<LifecycleSheet | null>(null);
  const close = () => setOpen(null);

  return (
    <>
      <div className={styles.actions} role="group" aria-label={t('grow.lifecycle.actionsLabel')}>
        {SHEETS.filter(sheet => !grow.endedAt || FOR_AN_ENDED_GROW.includes(sheet)).map(sheet => {
          const Icon = ICON[sheet];
          return (
            <button key={sheet} type="button" className={`${ui.chip} ${styles.action}`} onClick={() => setOpen(sheet)}>
              <Icon size={13} strokeWidth={1.75} aria-hidden />
              {t(`grow.lifecycle.actions.${sheet}`)}
            </button>
          );
        })}
      </div>

      {open === 'phase' ? <PhaseSheet grow={grow} onClose={close} /> : null}
      {open === 'move' ? <MoveSheet grow={grow} plants={plants} spaces={spaces} onClose={close} /> : null}
      {open === 'split' ? <SplitSheet grow={grow} plants={plants} spaces={spaces} onClose={close} /> : null}
      {open === 'harvest' ? <HarvestSheet grow={grow} plants={plants} onClose={close} /> : null}
      {open === 'rename' ? <RenameSheet grow={grow} onClose={close} /> : null}
    </>
  );
}
