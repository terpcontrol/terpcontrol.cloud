import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GrowListItem } from '@fg2/shared-types/v1';
import { useUpdateGrow } from '@/api/grows';
import { Sheet } from '@/log/Sheet';
import { Refused } from '@/ui/PageState';
import { Block } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import styles from './Lifecycle.module.css';

/**
 * What this grow is called.
 *
 * The name is offered at creation and was, until now, fixed there for good: a
 * strain typed wrong while eight pots were being filled, or the sheet's own
 * suggestion taken as it stood, then stayed on the home card, the grow header,
 * the report and the public diary for the rest of the run, removable only by
 * throwing the grow and its diary away. The route has always taken a new one -
 * it is the first thing `PATCH /grows/{id}` is documented as doing - and every
 * other named thing in the app is renamed, down to a firmware build.
 *
 * Renaming changes nothing that was recorded, which is why it sits among the
 * moves rather than behind a warning: the diary, the phases and the weeks are
 * about the plants and know nothing of the title over them. The public address
 * is the one thing it does not move, because the slug is fixed when the grow is
 * made, so a link somebody has already sent goes on working.
 */
export function RenameSheet({ grow, onClose }: { grow: GrowListItem; onClose: () => void }) {
  const { t } = useTranslation();
  const rename = useUpdateGrow(grow.id);
  const [name, setName] = useState(grow.name);

  const named = name.trim();

  return (
    <Sheet title={t('grow.rename.title', { name: grow.name })} onClose={onClose}>
      <div className={styles.body}>
        <Block label={t('grow.rename.name')}>
          <input
            className={ui.input}
            value={name}
            aria-label={t('grow.rename.name')}
            autoComplete="off"
            onChange={event => setName(event.target.value)}
          />
        </Block>

        <p className={styles.now}>{t('grow.rename.note')}</p>

        <Refused error={rename.error} />

        <button
          type="button"
          className={`${ui.button} ${ui.primary} ${styles.submit}`}
          disabled={rename.isPending || named === '' || named === grow.name}
          onClick={() => rename.mutate({ name: named }, { onSuccess: onClose })}
        >
          {rename.isPending ? t('grow.lifecycle.saving') : t('grow.rename.save')}
        </button>
      </div>
    </Sheet>
  );
}
