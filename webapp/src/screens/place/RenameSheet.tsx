import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRenameSpace } from '@/api/claims';
import { useSpaces } from '@/api/spaces';
import { Sheet } from '@/ui/Sheet';
import { Refused } from '@/ui/PageState';
import { Block } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import styles from './RenameSheet.module.css';

/**
 * A new name for a place. The claim gives every place a first name - "Kühlschrank
 * 1", "Zelt 2" - and this is where it becomes the grower's own, since it is what
 * Start, the switcher on Verlauf and Steuerung, and every alert call it.
 *
 * Two places with one name are allowed and sometimes meant, and they are also
 * how somebody loses track of which tent an alert is about, so a clash is said
 * before the rename rather than refused after it.
 */
export function RenameSheet({ spaceId, name, onClose }: { spaceId: string; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const rename = useRenameSpace(spaceId);
  const spaces = useSpaces();
  const [typed, setTyped] = useState(name);
  const trimmed = typed.trim();
  const changed = trimmed !== '' && trimmed !== name;
  const taken = (spaces.data?.items ?? []).some(one => one.id !== spaceId && one.name.trim().toLowerCase() === trimmed.toLowerCase());

  const save = () => changed && rename.mutate({ name: trimmed }, { onSuccess: onClose });

  return (
    <Sheet title={t('place.rename.title', { name })} onClose={onClose}>
      <form
        className={styles.body}
        onSubmit={event => {
          event.preventDefault();
          save();
        }}
      >
        <Block label={t('place.rename.label')}>
          <div className={ui.fieldRow}>
            <input
              className={ui.input}
              value={typed}
              aria-label={t('place.rename.label')}
              autoComplete="off"
              // The sheet opens for this one field, so the keyboard comes up with it.
              autoFocus
              disabled={rename.isPending}
              onChange={event => setTyped(event.target.value)}
            />
            <button type="submit" className={ui.fieldAction} disabled={!changed || rename.isPending}>
              {rename.isPending ? t('place.rename.saving') : t('place.rename.save')}
            </button>
          </div>
          {taken ? <p className={ui.note}>{t('place.rename.taken')}</p> : null}
          <p className={ui.note}>{t('place.rename.note')}</p>
        </Block>
        <Refused error={rename.error} />
      </form>
    </Sheet>
  );
}
