import { useTranslation } from 'react-i18next';
import type { Plant } from '@fg2/shared-types/v1';
import { useUpdatePlant } from '@/api/grows';
import { useAnswered } from '../told';
import { NameSheet } from '@/ui/NameSheet';

/**
 * What this plant is called, and what it is.
 *
 * Both are corrected rather than decided here: the label was invented by the
 * sheet that made the grow - "Amnesia 3" - and the strain was typed while eight
 * pots were being filled. Neither changes anything that was logged, which is
 * why this is the plant page's one write.
 */
export function RenameSheet({ growId, plant, others, onClose }: { growId: string; plant: Plant; others: readonly Plant[]; onClose: () => void }) {
  const { t } = useTranslation();
  const rename = useUpdatePlant(growId);
  const answer = useAnswered(rename, `plant-${plant.id}`);
  // What holds once a plant is called this: its name where that changed, and its strain where that did.
  const said = (was: Pick<Plant, 'label' | 'strain'>, now: Pick<Plant, 'label' | 'strain'>) =>
    [
      was.label === now.label ? now.label : t('place.edit.told.named', { was: was.label, name: now.label }),
      was.strain === now.strain ? null : t('grow.plant.told.strain', { strain: now.strain }),
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <NameSheet
      title={t('grow.plant.renameTitle', { label: plant.label })}
      fields={{ label: { label: t('grow.plant.label'), value: plant.label }, strain: { label: t('grow.plant.strain'), value: plant.strain } }}
      error={rename.error}
      busy={rename.isPending}
      save={rename.isPending ? t('grow.plant.saving') : t('grow.plant.save')}
      // Two plants of a grow under one name could not be told apart in a line of the diary, so a name taken is not saved.
      refused={body => (others.some(other => other.label === body.label) ? t('grow.plant.nameTaken', { name: body.label }) : null)}
      onSave={body =>
        answer(
          { plantId: plant.id, body },
          said(plant, body),
          { to: { plantId: plant.id, body: { label: plant.label, strain: plant.strain } }, undone: said(body, plant) },
          onClose,
        )
      }
      onClose={onClose}
    />
  );
}
