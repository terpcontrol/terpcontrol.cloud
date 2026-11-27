import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem } from '@fg2/shared-types/v1';
import { useUpdateGrow } from '@/api/grows';
import { NameSheet } from '@/ui/NameSheet';
import { Block } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import styles from './Lifecycle.module.css';

/**
 * What this grow is called, and which kind of plant it is.
 *
 * The name is offered at creation and every other named thing in the app is
 * renamed, down to a firmware build: a strain typed wrong while eight pots
 * were being filled is put right here. Renaming changes nothing that was
 * recorded - the diary, the phases and the weeks are about the plants and know
 * nothing of the title over them - and the public address stays, because the
 * slug is fixed when the grow is made.
 *
 * The kind of plant is asked here and not when a grow is started: the form
 * that starts one asks only what cannot wait, and a grow is photoperiodic
 * until somebody says otherwise. A feeding scheme chosen afterwards follows it.
 */
export function RenameSheet({ grow, onClose }: { grow: GrowListItem; onClose: () => void }) {
  const { t } = useTranslation();
  const rename = useUpdateGrow(grow.id);
  const [type, setType] = useState(grow.type);

  return (
    <NameSheet
      title={t('grow.rename.title', { name: grow.name })}
      fields={{ name: { label: t('grow.rename.name'), value: grow.name } }}
      error={rename.error}
      busy={rename.isPending}
      save={rename.isPending ? t('grow.lifecycle.saving') : t('grow.rename.save')}
      ready={({ name }) => name !== '' && (name !== grow.name || type !== grow.type)}
      onSave={({ name }) => rename.mutate({ name, type }, { onSuccess: onClose })}
      onClose={onClose}
    >
      <Block label={t('grow.new.type')} help="autoflower">
        <div className={`${ui.segments} ${ui.segmentsFill} ${styles.kinds}`} role="group" aria-label={t('grow.new.type')}>
          {(['photoperiod', 'autoflower'] as const).map(one => (
            <button key={one} type="button" className={ui.segment} aria-pressed={type === one} onClick={() => setType(one)}>
              {t(one === 'autoflower' ? 'grow.new.autoflower' : 'grow.new.photoperiod')}
            </button>
          ))}
        </div>
      </Block>
    </NameSheet>
  );
}
