import { Leaf, Move, Scissors, Split } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem, Plant, Space } from '@fg2/shared-types/v1';
import ui from '@/ui/ui.module.css';
import { HarvestSheet } from './HarvestSheet';
import { MoveSheet } from './MoveSheet';
import { PhaseSheet } from './PhaseSheet';
import { SplitSheet } from './SplitSheet';
import styles from './Lifecycle.module.css';

/**
 * The four things that happen to a grow rather than in it: it moves on a stage,
 * it moves house, some of it goes its own way, and it comes down.
 *
 * They sit on the grow page under the phase bar because that is where a grower
 * reads what the grow is doing, and each opens the sheet that also holds the
 * repairs for it - correcting a phase is part of entering one, and taking back
 * a move is part of making one. A session that may only look is offered none of
 * them: the server refuses every write it makes, and a button that would be
 * refused is not a button.
 */
const SHEETS = ['phase', 'move', 'split', 'harvest'] as const;
type LifecycleSheet = (typeof SHEETS)[number];

const ICON = { phase: Leaf, move: Move, split: Split, harvest: Scissors };

export function GrowLifecycle({ grow, plants, spaces }: { grow: GrowListItem; plants: Plant[]; spaces: Space[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<LifecycleSheet | null>(null);
  const close = () => setOpen(null);

  return (
    <>
      <div className={styles.actions} role="group" aria-label={t('grow.lifecycle.actionsLabel')}>
        {SHEETS.map(sheet => {
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
    </>
  );
}
