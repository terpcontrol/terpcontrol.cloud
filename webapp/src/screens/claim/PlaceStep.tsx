import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Space, SpaceKind } from '@fg2/shared-types/v1';
import { useRenameSpace } from '@/api/claims';
import { Refused } from '@/ui/PageState';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';

/**
 * The kinds a place claimed this way can be. `balcony` is not among them: a
 * balcony is where a grow stands without a controller, and this step is only
 * ever reached by a device that has just been plugged in somewhere.
 */
const KINDS: SpaceKind[] = ['tent', 'fridge', 'room', 'other'];

/**
 * The second step: what the device's place is called.
 *
 * The claim already made a space and named it after the hardware, so this
 * renames that one. Making a second would leave the controller standing in
 * "Terp Controller" while the grow went into "Tent 1", which is exactly the
 * split this whole flow exists to prevent - the space is what devices and grows
 * both attach to.
 *
 * The field follows the stored name until somebody types in it, and follows it
 * again once a rename has gone through: the server's name is the one being
 * corrected, and it arrives a moment after this step opens.
 */
export function PlaceStep({ space }: { space: Space | null }) {
  const { t } = useTranslation();
  const rename = useRenameSpace(space?.id ?? null);
  const [typed, setTyped] = useState<string | null>(null);

  const name = typed ?? space?.name ?? '';
  const trimmed = name.trim();
  const changed = space !== null && trimmed !== '' && trimmed !== space.name;

  return (
    <>
      <div className={ui.fieldRow}>
        <input
          className={ui.input}
          value={name}
          aria-label={t('claim.place.field')}
          placeholder={t('claim.place.field')}
          autoComplete="off"
          disabled={space === null}
          onChange={event => setTyped(event.target.value)}
        />
        <button
          type="button"
          className={ui.fieldAction}
          disabled={!changed || rename.isPending}
          onClick={() => changed && rename.mutate({ name: trimmed }, { onSuccess: () => setTyped(null) })}
        >
          {rename.isPending ? t('claim.place.renaming') : t('claim.place.rename')}
        </button>
      </div>

      <Choices label={t('claim.place.kindLabel')}>
        {KINDS.map(kind => (
          <Choice key={kind} chosen={space?.kind === kind} disabled={space === null || rename.isPending} onChoose={() => rename.mutate({ kind })}>
            {t(`claim.place.kind.${kind}`)}
          </Choice>
        ))}
      </Choices>

      <Refused error={rename.error} />
    </>
  );
}
