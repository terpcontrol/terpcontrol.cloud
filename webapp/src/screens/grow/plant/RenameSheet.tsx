import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Plant } from '@fg2/shared-types/v1';
import { useUpdatePlant } from '@/api/grows';
import { Sheet } from '@/log/Sheet';
import { Refused } from '@/ui/PageState';
import { Block } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import styles from './Plant.module.css';

/**
 * What this plant is called, and what it is.
 *
 * Both are corrected rather than decided here: the label was invented by the
 * sheet that made the grow - "Amnesia 3" - and the strain was typed while eight
 * pots were being filled. Neither changes anything that was logged, which is
 * why this is the plant page's one write.
 */
export function RenameSheet({ growId, plant, onClose }: { growId: string; plant: Plant; onClose: () => void }) {
  const { t } = useTranslation();
  const rename = useUpdatePlant(growId);
  const [label, setLabel] = useState(plant.label);
  const [strain, setStrain] = useState(plant.strain);

  const save = () => rename.mutate({ plantId: plant.id, body: { label: label.trim(), strain: strain.trim() } }, { onSuccess: onClose });

  return (
    <Sheet title={t('grow.plant.renameTitle', { label: plant.label })} onClose={onClose}>
      <div className={styles.sheetBody}>
        <Block label={t('grow.plant.label')}>
          <input
            className={ui.input}
            value={label}
            aria-label={t('grow.plant.label')}
            autoComplete="off"
            onChange={event => setLabel(event.target.value)}
          />
        </Block>
        <Block label={t('grow.plant.strain')}>
          <input
            className={ui.input}
            value={strain}
            aria-label={t('grow.plant.strain')}
            autoComplete="off"
            onChange={event => setStrain(event.target.value)}
          />
        </Block>

        <Refused error={rename.error} />

        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.submit}`}
          disabled={rename.isPending || label.trim() === '' || strain.trim() === ''}
          onClick={save}
        >
          {rename.isPending ? t('grow.plant.saving') : t('grow.plant.save')}
        </button>
      </div>
    </Sheet>
  );
}
