import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem } from '@fg2/shared-types/v1';
import { useUpdateGrow } from '@/api/grows';
import { Sheet } from '@/ui/Sheet';
import { Refused } from '@/ui/PageState';
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
  const [name, setName] = useState(grow.name);
  const [type, setType] = useState(grow.type);

  const named = name.trim();

  return (
    <Sheet title={t('grow.rename.title', { name: grow.name })} onClose={onClose}>
      <div className={ui.sheetBody}>
        <Block label={t('grow.rename.name')}>
          <input
            className={ui.input}
            value={name}
            aria-label={t('grow.rename.name')}
            autoComplete="off"
            onChange={event => setName(event.target.value)}
          />
        </Block>

        <Block label={t('grow.new.type')} help="autoflower">
          <div className={`${ui.segments} ${ui.segmentsFill} ${styles.kinds}`} role="group" aria-label={t('grow.new.type')}>
            {(['photoperiod', 'autoflower'] as const).map(one => (
              <button key={one} type="button" className={ui.segment} aria-pressed={type === one} onClick={() => setType(one)}>
                {t(one === 'autoflower' ? 'grow.new.autoflower' : 'grow.new.photoperiod')}
              </button>
            ))}
          </div>
        </Block>

        <Refused error={rename.error} />

        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.submit}`}
          disabled={rename.isPending || named === '' || (named === grow.name && type === grow.type)}
          onClick={() => rename.mutate({ name: named, type }, { onSuccess: onClose })}
        >
          {rename.isPending ? t('grow.lifecycle.saving') : t('grow.rename.save')}
        </button>
      </div>
    </Sheet>
  );
}
