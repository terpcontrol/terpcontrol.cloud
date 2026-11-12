import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, Space } from '@fg2/shared-types/v1';
import { deviceTitle, typeName } from '@/ui/naming';
import { Refused } from '@/ui/PageState';
import { FlowHead } from './FlowHead';
import { hangWords, OWN_CLIMATE } from './steps';
import styles from './Claim.module.css';

/**
 * "Wo hängt es?", asked once of a device that measures by itself, in an
 * account that already has a place: in the air of a place that exists - one
 * climate, one camera, one maintenance with what stands there - or at a new
 * place of its own.
 *
 * The device hangs somewhere before the question is put - a fan, a socket or
 * a lamp in the place listed first, a second controller or fridge module in
 * the new place its claim made - so the page shows that answer as the one that
 * holds, and a flow left here leaves the device where it reads.
 */
export function AirStep({
  device,
  places,
  every,
  step,
  of,
  headingRef,
  hang,
  onBack,
  onLeave,
}: {
  device: Device;
  /** The places of the account's own it may hang in, the one it hangs in among them unless that is a new one. */
  places: readonly Space[];
  /** The account's devices, for what stands in each place. */
  every: Device[];
  step: number;
  of: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Hangs the device in the place, or in a new one for null, and goes on; refused, it says why. */
  hang: (to: Space | null) => Promise<void>;
  onBack: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<unknown>(null);
  const ownClimate = OWN_CLIMATE.includes(device.type);
  const holds = places.find(one => one.id === device.spaceId) ?? null;

  const answer = (to: Space | null, title: string, note: string) => (
    <button
      key={to?.id ?? 'new'}
      type="button"
      className={styles.air}
      aria-current={to === holds ? 'true' : undefined}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        setRefused(null);
        hang(to)
          .catch(setRefused)
          .finally(() => setBusy(false));
      }}
    >
      <span className={styles.airTitle}>{title}</span>
      <span className={styles.airNote}>{note}</span>
    </button>
  );

  const existing = places.map(one => {
    const there = every.filter(other => other.spaceId === one.id && other.id !== device.id);
    return answer(
      one,
      t('claim.air.here', { name: one.name }),
      there.length > 0 ? t('claim.air.hereNote', { devices: there.map(other => deviceTitle(other, t, every)).join(', ') }) : t('claim.air.hereEmpty'),
    );
  });
  const fresh = answer(null, t('claim.air.new'), t(`claim.air.newNote.${ownClimate ? device.type : 'other'}`));

  return (
    <section className={styles.screen}>
      <FlowHead device={typeName(device.type, t)} step={step} of={of} onClose={onLeave} />
      <h1 ref={headingRef} tabIndex={-1} className={styles.growTitle}>
        {hangWords(t, 'title', device.type)}
      </h1>
      {/* A second climate is a place of its own more often than not, so that answer stands first for it. */}
      {ownClimate ? [fresh, ...existing] : [...existing, fresh]}
      <Refused error={refused} />
      <button type="button" className={styles.growSkip} onClick={onBack}>
        {t('claim.air.back')}
      </button>
    </section>
  );
}
