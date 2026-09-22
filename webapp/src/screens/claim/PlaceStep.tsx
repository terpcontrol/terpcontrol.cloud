import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Space, SpaceKind } from '@fg2/shared-types/v1';
import { useArchiveSpace, usePlaceDevice, useRenameSpace } from '@/api/claims';
import { Refused } from '@/ui/PageState';
import { enough } from '@/ui/session-access';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import styles from './Claim.module.css';

/**
 * The kinds a place claimed this way can be.
 *
 * `balcony` is not among them: a balcony is where a grow stands without a
 * controller, and this step is only ever reached by a device that has just been
 * plugged in somewhere. Neither is `room`, which groups other places rather
 * than holding plants, so nothing can ever be grown in one - and this step is
 * the only place in the app where a kind is chosen, which would leave one wrong
 * tap permanent.
 */
const KINDS: SpaceKind[] = ['tent', 'fridge', 'other'];

/**
 * The second step: where the device stands.
 *
 * It answers that two ways, because a claim has to end in some space and the
 * one it invents is only a guess. Either the guess is the right place and what
 * it needs is a better name - the field renames that space rather than making a
 * second, which would leave the controller standing in one place while the grow
 * went into another - or the place already exists, and then the device moves
 * into it and the invented one is archived behind it. Without the second half,
 * hardware that landed in the wrong tent would stay there for good: nothing
 * else in the app moves a device.
 *
 * The field follows the stored name until somebody types in it, and follows it
 * again once a rename has gone through: the server's name is the one being
 * corrected, and it arrives a moment after this step opens.
 */
export function PlaceStep({
  space,
  places,
  deviceId,
  invented,
}: {
  space: Space | null;
  places: readonly Space[];
  deviceId: string | null;
  /** The space this claim made, which is the one that may be archived once the device has left it. */
  invented: string | null;
}) {
  const { t } = useTranslation();
  const rename = useRenameSpace(space?.id ?? null);
  const place = usePlaceDevice(deviceId);
  const archive = useArchiveSpace();
  const [typed, setTyped] = useState<string | null>(null);

  const name = typed ?? space?.name ?? '';
  const trimmed = name.trim();
  const changed = space !== null && trimmed !== '' && trimmed !== space.name;
  // Two places with one name are legal and sometimes meant, and they are also
  // how somebody loses track of which tent an alert is about, so the clash is
  // said before the rename rather than refused after it.
  const taken = trimmed !== '' && places.some(one => one.id !== space?.id && one.name.trim().toLowerCase() === trimmed.toLowerCase());
  // A room groups other places rather than holding anything, so a controller
  // never stands in one - and moving a device into a place is managing that
  // place, so a tent this account only writes lines in is not on offer either.
  const elsewhere = places.filter(one => one.id !== space?.id && one.kind !== 'room' && enough(one.youMay, 'manage'));
  const busy = place.isPending || archive.isPending;

  // The place the claim invented holds this device and nothing else, so once
  // the device has left it there is nothing in it to keep. An archive that is
  // refused is not worth stopping the move over: the device is where it belongs
  // either way, and an empty place is a tidiness problem.
  const moveTo = (spaceId: string) =>
    place.mutate(spaceId, {
      onSuccess: () => {
        setTyped(null);
        if (invented && invented !== spaceId) archive.mutate(invented);
      },
    });

  return (
    <>
      <div className={ui.fieldRow}>
        <input
          className={ui.input}
          value={name}
          aria-label={t('claim.place.field')}
          placeholder={t('claim.place.field')}
          autoComplete="off"
          disabled={space === null || busy}
          onChange={event => setTyped(event.target.value)}
        />
        <button
          type="button"
          className={ui.fieldAction}
          disabled={!changed || rename.isPending || busy}
          onClick={() => changed && rename.mutate({ name: trimmed }, { onSuccess: () => setTyped(null) })}
        >
          {rename.isPending ? t('claim.place.renaming') : t('claim.place.rename')}
        </button>
      </div>

      {taken ? <p className={ui.note}>{t('claim.place.nameTaken')}</p> : null}
      <p className={ui.note}>{t('claim.place.renamesThePlace')}</p>

      {elsewhere.length > 0 && deviceId ? (
        <>
          <Block label={t('claim.place.alreadyHave')}>
            <div className={styles.places}>
              <Choices label={t('claim.place.alreadyHave')}>
                {elsewhere.map(one => (
                  <Choice key={one.id} chosen={false} disabled={busy} onChoose={() => moveTo(one.id)}>
                    {one.name}
                  </Choice>
                ))}
              </Choices>
            </div>
          </Block>
          <Refused error={place.error} />
        </>
      ) : null}

      <Choices label={t('claim.place.kindLabel')}>
        {KINDS.map(kind => (
          <Choice
            key={kind}
            chosen={space?.kind === kind}
            disabled={space === null || rename.isPending || busy}
            onChoose={() => rename.mutate({ kind })}
          >
            {t(`claim.place.kind.${kind}`)}
          </Choice>
        ))}
      </Choices>

      <Refused error={rename.error} />
    </>
  );
}
