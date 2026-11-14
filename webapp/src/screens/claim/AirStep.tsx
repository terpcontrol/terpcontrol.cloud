import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, Space } from '@fg2/shared-types/v1';
import { OWN_CLIMATE_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useCamerasShape } from '@/api/cameras';
import { climateHeldBy } from '@/screens/control/lead';
import { inSentence } from '@/screens/space/members/people';
import { deviceTitle } from '@/ui/naming';
import { Refused } from '@/ui/PageState';
import { FlowHead } from './FlowHead';
import { hangWords } from './steps';
import styles from './Claim.module.css';
import ui from '@/ui/ui.module.css';

/**
 * "Wo hängt es?", asked once of a device that measures by itself, in an
 * account that already has a place: in the air of a place that exists - by
 * its name alone, what stands there under it - or at a new place of its own.
 *
 * What hanging there means is said by what the place has: its climate where a controller or fridge module holds
 * one, its maintenance, which the device shares, and its camera only where one looks in - "eine Kamera" stood under
 * a tent with none, "ein Klima" under a lamp alone. A place has one climate (Chris, 2026-11-14): a second controller
 * or fridge module is offered no place that holds one, and one sentence says why it stands in a place of its own.
 *
 * The device hangs somewhere before the question is put - a fan, a socket or
 * a lamp in the place listed first, where its claim put it, a second
 * controller or fridge module in the new place its claim made - so the page
 * shows that answer as the one that holds, and a flow left here leaves the
 * device where it reads. The head counts no steps: this answer decides them.
 */
export function AirStep({
  device,
  places,
  every,
  headingRef,
  hang,
  onBack,
  onLeave,
}: {
  device: Device;
  /** The account's own places it may hang in, as they are offered (`joinOrder`); the one it hangs in among them unless that is a new one. */
  places: readonly Space[];
  /** The account's devices, for what stands in each place. */
  every: Device[];
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Hangs the device in the place, or in a new one for null, and goes on; refused, it says why, and the same tap tries again. */
  hang: (to: Space | null) => Promise<void>;
  onBack: () => void;
  onLeave: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<unknown>(null);
  const ownClimate = OWN_CLIMATE_TYPES.includes(device.type);
  const holds = places.find(one => one.id === device.spaceId) ?? null;
  const cameras = useCamerasShape().data?.items ?? [];

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

  const held = places.filter(one => climateHeldBy(every, one.id, device) !== null);
  const existing = places
    .filter(one => !held.includes(one))
    .map(one => {
      const here = every.filter(other => other.spaceId === one.id && other.id !== device.id);
      // What holds the climate is named first: it is what the device joins.
      const there = [true, false].flatMap(climate => here.filter(other => OWN_CLIMATE_TYPES.includes(other.type) === climate));
      const devices = there.map(other => deviceTitle(other, t, there)).join(', ');
      const shares = `claim.air.${there.some(other => OWN_CLIMATE_TYPES.includes(other.type)) ? 'hereNote' : 'hereNoClimate'}`;
      const seen = cameras.some(camera => camera.spaceId === one.id);
      return answer(one, one.name, there.length > 0 ? t(seen ? shares : `${shares}NoCamera`, { devices }) : t('claim.air.hereEmpty'));
    });
  const fresh = answer(null, t('claim.air.new'), t(`claim.air.newNote.${ownClimate ? device.type : 'other'}`));

  return (
    <section className={`${ui.stack4} ${ui.page} ${styles.screen}`}>
      <FlowHead type={device.type} onClose={onLeave} />
      <h2 ref={headingRef} tabIndex={-1} className={styles.growTitle}>
        {hangWords(t, 'title', device.type)}
      </h2>
      {/* A second climate is a place of its own more often than not, so that answer stands first for it. */}
      {ownClimate ? [fresh, ...existing] : [...existing, fresh]}
      {held.length > 0 ? (
        <p className={ui.note}>
          {t('claim.air.oneClimate', {
            count: held.length,
            places: inSentence(
              held.map(one => one.name),
              i18n.language,
            ),
          })}
        </p>
      ) : null}
      <Refused error={refused} />
      <button type="button" className={styles.growSkip} onClick={onBack}>
        {t('claim.air.back')}
      </button>
    </section>
  );
}
