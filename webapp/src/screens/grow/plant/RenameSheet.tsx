import { useTranslation } from 'react-i18next';
import type { Plant } from '@fg2/shared-types/v1';
import { useUpdatePlant } from '@/api/grows';
import { NameSheet } from '@/ui/NameSheet';

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

  return (
    <NameSheet
      title={t('grow.plant.renameTitle', { label: plant.label })}
      fields={{ label: { label: t('grow.plant.label'), value: plant.label }, strain: { label: t('grow.plant.strain'), value: plant.strain } }}
      error={rename.error}
      busy={rename.isPending}
      save={rename.isPending ? t('grow.plant.saving') : t('grow.plant.save')}
      onSave={body => rename.mutate({ plantId: plant.id, body }, { onSuccess: onClose })}
      onClose={onClose}
    />
  );
}
