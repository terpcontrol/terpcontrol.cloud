import { ChevronRight } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceClaimCreate, DeviceClaimResult, SocketPage, Space } from '@fg2/shared-types/v1';
import { claimCodeOf, useClaimDevice } from '@/api/claims';
import { useDeviceFirmwares } from '@/api/devices';
import { ageLabel, deviceLiveness } from '@/ui/age';
import { canScan } from '@/ui/barcode';
import { Refused } from '@/ui/PageState';
import { QrScanner } from '@/ui/QrScanner';
import { Block, Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { cameraName, deviceName } from './steps';
import styles from './Claim.module.css';

/**
 * The first step: the code on the display, which is the whole proof that this
 * hardware is yours.
 *
 * The field is the same one the empty home offers, scanner and all, because a
 * grower arrives here either with the box in their hand or from that card with
 * the code already typed - and a second way of reading a code would be a second
 * answer to what a code looks like.
 *
 * Where the device goes is asked here rather than afterwards, because a claim
 * has to end in some place and the one it invents is a guess. An account whose
 * tents already exist says which of them the controller is standing in, and the
 * claim puts it there: nothing is created to be renamed, and the grow, the
 * cameras and the history that place already holds stay with the hardware that
 * reports into it.
 */
export function CodeStep({
  initialCode,
  places,
  onClaimed,
}: {
  initialCode: string;
  /** The places this account already has, which a claim may put the device into instead of making another. */
  places: readonly Space[];
  onClaimed: (result: DeviceClaimResult) => void;
}) {
  const { t } = useTranslation();
  const claim = useClaimDevice();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const form = useForm<DeviceClaimCreate>({ defaultValues: { code: initialCode } });
  // A room groups other places rather than holding anything, so a controller
  // never stands in one.
  const offered = places.filter(one => one.kind !== 'room');

  // The refusal is the mutation's own and is drawn under the field, so a code
  // the server would not take leaves the form exactly as it was typed.
  const submit = form.handleSubmit(async body => {
    const code = claimCodeOf(body.code).trim();
    if (!code) return;
    try {
      onClaimed(await claim.mutateAsync(spaceId === null ? { code } : { code, spaceId }));
    } catch {
      form.setFocus('code');
    }
  });

  const scan = () => {
    if (!canScan()) return setScanNote(t('claim.code.scanUnavailable'));
    setScanNote(null);
    setScanning(true);
  };

  const onCode = useCallback(
    (value: string) => {
      setScanning(false);
      form.setValue('code', claimCodeOf(value));
      void submit();
    },
    [form, submit],
  );
  const closeScanner = useCallback(() => setScanning(false), []);
  const onFailed = useCallback(() => {
    setScanning(false);
    setScanNote(t('claim.code.scanDenied'));
  }, [t]);

  return (
    <form
      className={styles.claimForm}
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
      noValidate
    >
      <div className={ui.fieldRow}>
        <input
          className={`mono ${ui.input}`}
          placeholder={t('claim.code.field')}
          aria-label={t('claim.code.field')}
          autoCapitalize="characters"
          autoComplete="off"
          enterKeyHint="go"
          spellCheck={false}
          disabled={claim.isPending}
          {...form.register('code', { required: true })}
        />
        <button type="button" className={ui.fieldAction} onClick={scan}>
          {t('claim.code.orScan')}
          <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {scanNote ? (
        <p className={ui.note} role="alert">
          {scanNote}
        </p>
      ) : null}

      {offered.length > 0 ? (
        <Block label={t('claim.code.whichPlace')}>
          <div className={styles.places}>
            <Choices label={t('claim.code.whichPlace')}>
              <Choice chosen={spaceId === null} disabled={claim.isPending} onChoose={() => setSpaceId(null)}>
                {t('claim.code.newPlace')}
              </Choice>
              {offered.map(place => (
                <Choice key={place.id} chosen={spaceId === place.id} disabled={claim.isPending} onChoose={() => setSpaceId(place.id)}>
                  {place.name}
                </Choice>
              ))}
            </Choices>
          </div>
        </Block>
      ) : null}

      <Refused error={claim.error} />

      <button type="submit" className={`${ui.button} ${ui.primary} ${styles.wide}`} disabled={claim.isPending}>
        {claim.isPending ? t('claim.code.claiming') : t('claim.code.claim')}
      </button>

      {scanning ? <QrScanner onCode={onCode} onClose={closeScanner} onFailed={onFailed} /> : null}
    </form>
  );
}

/** What the first step settled, in the device's own name and the tail of the id printed on it. */
export function ClaimedTitle({ device }: { device: Device }) {
  const { t } = useTranslation();

  return (
    <>
      <span className={styles.claimedMark}>{t('claim.code.claimed')}</span> · {deviceName(device, t)} ·{' '}
      <span className="mono">{device.id.slice(-4).toUpperCase()}</span>
    </>
  );
}

/**
 * What the device itself says it is: how long ago it spoke, the build it
 * reports, how many sockets it has found and whether a camera answers through
 * it.
 *
 * All four are the device's own words rather than anything this flow decided,
 * and a device that has never spoken says exactly that instead of showing a
 * line of dashes that could be read as zeroes.
 *
 * The build is named rather than identified. What the hardware reports is the
 * uuid its build container stamped it with, which is three lines of hex to a
 * grower and cannot be compared with anything; so the build list is what turns
 * it into "2.4.1", and a build nobody has named is left out of the line
 * altogether rather than printed as the uuid it is.
 */
export function ClaimedFacts({ device, sockets, now }: { device: Device; sockets: SocketPage | undefined; now: DateTime }) {
  const { t } = useTranslation();
  const firmwares = useDeviceFirmwares(device.id, device.state.firmwareId !== null);
  const seen = device.state.lastSeenAt;
  const build = firmwares.data?.items.find(one => one.id === device.state.firmwareId);

  if (!seen) return <span className={styles.waitingForIt}>{t('claim.code.neverHeard')}</span>;

  return (
    <>
      {t(`claim.code.${deviceLiveness(seen, now)}`, { age: ageLabel(seen, now) })}
      {build?.name ? ` · ${t('claim.code.firmware', { version: build.name })}` : ''}
      {sockets ? ` · ${t('claim.code.sockets', { count: sockets.items.length })}` : ''}
      {` · ${t('claim.code.camera', { name: cameraName(device, t) })}`}
    </>
  );
}
