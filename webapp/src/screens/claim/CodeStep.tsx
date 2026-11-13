import { ChevronRight } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Device, DeviceClaimCreate, DeviceClaimResult, SocketPage, Space } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { claimCodeOf, useClaimDevice } from '@/api/claims';
import { useDeviceFirmwares } from '@/api/devices';
import { ageLabel, deviceLiveness } from '@/ui/age';
import { useQrScan } from '@/ui/barcode';
import { Facts } from '@/ui/Facts';
import { Refused } from '@/ui/PageState';
import { QrScanner } from '@/ui/QrScanner';
import ui from '@/ui/ui.module.css';
import { LegacyMove } from './LegacyMove';
import { pairsACam } from '@/screens/camera/add/pairers';
import { buildLabel, deviceName } from '@/ui/naming';
import { cameraName } from './steps';
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
 * Where the device hangs is not asked here: what kind of device it is is only
 * known once its code has been read, and the question depends on it (`AirStep`).
 * The claim says it all the same (`where`), so the device stands there in the
 * one write: the place the flow was opened from - "Gerät hinzufügen" behind a
 * place's ⋯ - or the one a device without a climate of its own joins.
 */
export function CodeStep({
  initialCode,
  into,
  where,
  onClaimed,
}: {
  initialCode: string;
  /** The place the flow was opened from, which is said under the field. */
  into: Space | null;
  /** What the claim carries about the place, read when the code is sent. */
  where: () => Promise<Pick<DeviceClaimCreate, 'spaceId' | 'joinSpaceId' | 'spaceNames'>>;
  /** What follows a claim - where the device hangs, what will be asked - which the form waits for as it waits for the claim. */
  onClaimed: (result: DeviceClaimResult) => Promise<void>;
}) {
  const { t } = useTranslation();
  const claim = useClaimDevice();
  const form = useForm<DeviceClaimCreate>({ defaultValues: { code: initialCode } });

  /** What kept the claim from being sent at all: the places could not be read. */
  const [unsent, setUnsent] = useState<unknown>(null);

  const busy = form.formState.isSubmitting;

  // The refusal is the mutation's own and is drawn under the field, so a code
  // the server would not take leaves the form exactly as it was typed; what
  // went wrong before the claim was sent is said in the same place.
  const submit = form.handleSubmit(async body => {
    const code = claimCodeOf(body.code).trim();
    if (!code) return;
    setUnsent(null);
    const result = await where().then(
      place => claim.mutateAsync({ code, ...place }).catch(() => null),
      (failed: unknown) => (setUnsent(failed), null),
    );
    if (result) await onClaimed(result);
    else form.setFocus('code');
  });

  const { scan, note, scanner } = useQrScan(
    useCallback(
      (value: string) => {
        form.setValue('code', claimCodeOf(value));
        void submit();
      },
      [form, submit],
    ),
  );

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
          disabled={busy}
          {...form.register('code', { required: true })}
        />
        <button type="button" className={ui.fieldAction} onClick={scan}>
          {t('home.addDevice.orScan')}
          <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {note ? (
        <p className={ui.note} role="alert">
          {note}
        </p>
      ) : null}

      {into ? <p className={ui.note}>{t('claim.code.into', { name: into.name })}</p> : null}

      <Refused error={unsent ?? claim.error} />

      <button type="submit" className={`${ui.button} ${ui.primary} ${styles.wide}`} disabled={busy}>
        {busy ? t('claim.code.claiming') : t('claim.code.claim')}
      </button>

      {/* A camera of its own - an RTSP stream - has no claim code, so it has its own way in. */}
      <Link to="/cameras/add" className={`${ui.headLink} ${styles.aside}`}>
        {t('claim.code.rtsp')} ›
      </Link>

      <LegacyMove />

      {scanner ? <QrScanner {...scanner} /> : null}
    </form>
  );
}

/** What the first step settled, in the device's own name: the two break between them, never after the dot. */
export function ClaimedTitle({ device }: { device: Device }) {
  const { t } = useTranslation();

  return <Facts facts={[<span className={styles.claimedMark}>{t('claim.code.claimed')}</span>, deviceName(device, t)]} />;
}

/**
 * What the device itself says it is: how long ago it spoke, the build it
 * reports, how many sockets it has found and whether a camera answers through
 * it - its own words rather than anything this flow decided. A device that
 * has never spoken says exactly that instead of a line of dashes that could
 * be read as zeroes.
 *
 * The build is named rather than identified: the hardware reports the uuid of
 * its build, which the build list turns into something readable, and a build
 * with nothing readable about it is left out rather than printed as a uuid.
 */
export function ClaimedFacts({ device, sockets, now }: { device: Device; sockets: SocketPage | undefined; now: DateTime }) {
  const { t } = useTranslation();
  const firmwares = useDeviceFirmwares(device.id, device.state.firmwareId !== null);
  const seen = device.state.lastSeenAt;
  const label = buildLabel(firmwares.data?.items.find(one => one.id === device.state.firmwareId));

  if (!seen) return t('claim.code.neverHeard');

  return (
    <>
      {t(`claim.code.${deviceLiveness(seen, now)}`, { age: ageLabel(seen, now) })}
      {label ? ` · ${t('claim.code.firmware', { version: label })}` : ''}
      {/* What hangs on it, for the hardware that can have it: a plug pairs no sockets, a light no cam either. */}
      {sockets && SOCKET_HOST_TYPES.includes(device.type) ? ` · ${t('claim.code.sockets', { count: sockets.items.length })}` : ''}
      {pairsACam(device) ? ` · ${t('claim.code.camera', { name: cameraName(device, t) })}` : ''}
    </>
  );
}
