import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, Space } from '@fg2/shared-types/v1';
import { useEndInvented, usePlaceDevice } from '@/api/claims';
import { useDevices } from '@/api/devices';
import { deviceTitle, typeName } from '@/ui/naming';
import { Refused } from '@/ui/PageState';
import { FlowHead } from './FlowHead';
import styles from './Claim.module.css';

/** The types that are a climate of their own: a second one is offered a place of its own first. */
const OWN_CLIMATE = ['controller', 'fridge'];

/**
 * "Wo hängt es?", asked once of a device that measures by itself, in an
 * account that already has a place: in the air of a place that exists - one
 * climate, one camera, one maintenance with what stands there - or at a new
 * place of its own. A fan, a socket or a lamp is offered the place that exists
 * first, a second controller or fridge module a new one.
 *
 * The claim has already made a place for the device, so "a new place" writes
 * nothing; an existing one moves the device there and ends the place the claim
 * made, which then held nothing.
 */
export function AirStep({
  device,
  space,
  places,
  invented,
  step,
  of,
  headingRef,
  onAnswered,
  makeNew,
  onBack,
  onLeave,
}: {
  device: Device;
  /** Where the device stands now. */
  space: Space | null;
  /** The places of the account's own it may hang in instead. */
  places: readonly Space[];
  /** The place this claim made, which goes when the device leaves it. */
  invented: string | null;
  step: number;
  of: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onAnswered: () => void;
  /** Makes a place of its own for a device that was sent to one that exists; nothing where it still stands in the one its claim made. */
  makeNew: () => Promise<void>;
  onBack: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const every = useDevices().data?.items;
  const place = usePlaceDevice(device.id);
  const end = useEndInvented();
  const [making, setMaking] = useState(false);
  const [refused, setRefused] = useState<unknown>(null);
  const busy = place.isPending || end.isPending || making;
  const newFirst = OWN_CLIMATE.includes(device.type);

  const into = async (to: Space) => {
    try {
      if (device.spaceId !== to.id) await place.mutateAsync(to.id);
      // Only while the device still stood in it: asked again later, the place its claim made has ended already.
      if (invented && device.spaceId === invented && invented !== to.id) await end.mutateAsync(invented);
      onAnswered();
    } catch {
      // Said under the choices, from the write that was refused.
    }
  };

  const existing = places.map((one, index) => {
    const there = (every ?? []).filter(other => other.spaceId === one.id && other.id !== device.id);
    return (
      <button
        key={one.id}
        type="button"
        className={styles.air}
        data-first={(!newFirst && index === 0) || undefined}
        aria-current={space?.id === one.id && invented !== one.id ? 'true' : undefined}
        disabled={busy}
        onClick={() => void into(one)}
      >
        <span className={styles.airTitle}>{t('claim.air.here', { name: one.name })}</span>
        <span className={styles.airNote}>
          {there.length > 0
            ? t('claim.air.hereNote', { devices: there.map(other => deviceTitle(other, t, every)).join(', ') })
            : t('claim.air.hereEmpty')}
        </span>
      </button>
    );
  });
  const fresh = (
    <button
      key="new"
      type="button"
      className={styles.air}
      data-first={newFirst || undefined}
      disabled={busy}
      onClick={() => {
        setMaking(true);
        setRefused(null);
        makeNew()
          .then(onAnswered, setRefused)
          .finally(() => setMaking(false));
      }}
    >
      <span className={styles.airTitle}>{t('claim.air.new')}</span>
      <span className={styles.airNote}>{t('claim.air.newNote')}</span>
    </button>
  );

  return (
    <section className={styles.screen}>
      <FlowHead device={typeName(device.type, t)} step={step} of={of} onClose={onLeave} />
      <h1 ref={headingRef} tabIndex={-1} className={styles.growTitle}>
        {t(`claim.air.title.${device.type}`, { defaultValue: t('claim.air.title.other') })}
      </h1>
      {newFirst ? [fresh, ...existing] : [...existing, fresh]}
      <Refused error={place.error ?? end.error ?? refused} />
      <button type="button" className={styles.growSkip} onClick={onBack}>
        {t('claim.air.back')}
      </button>
    </section>
  );
}
