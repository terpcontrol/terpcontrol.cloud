import { ChevronRight } from 'lucide-react';
import type { DateTime } from 'luxon';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceClaimCreate, DeviceClaimResult, SocketPage } from '@fg2/shared-types/v1';
import { claimCodeOf, useClaimDevice } from '@/api/claims';
import { ageLabel, deviceLiveness } from '@/ui/age';
import { canScan } from '@/ui/barcode';
import { Refused } from '@/ui/PageState';
import { QrScanner } from '@/ui/QrScanner';
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
 */
export function CodeStep({ initialCode, onClaimed }: { initialCode: string; onClaimed: (result: DeviceClaimResult) => void }) {
  const { t } = useTranslation();
  const claim = useClaimDevice();
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const form = useForm<DeviceClaimCreate>({ defaultValues: { code: initialCode } });

  // The refusal is the mutation's own and is drawn under the field, so a code
  // the server would not take leaves the form exactly as it was typed.
  const submit = form.handleSubmit(async body => {
    const code = claimCodeOf(body.code).trim();
    if (!code) return;
    try {
      onClaimed(await claim.mutateAsync({ code }));
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

      {scanNote ? <p className={ui.note}>{scanNote}</p> : null}
      <Refused error={claim.error} />

      <button type="submit" className={`${ui.button} ${ui.primary} ${styles.wide}`} disabled={claim.isPending}>
        {claim.isPending ? t('claim.code.claiming') : t('claim.code.claim')}
      </button>

      {scanning ? <QrScanner onCode={onCode} onClose={() => setScanning(false)} /> : null}
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
 */
export function ClaimedFacts({ device, sockets, now }: { device: Device; sockets: SocketPage | undefined; now: DateTime }) {
  const { t } = useTranslation();
  const seen = device.state.lastSeenAt;
  const version = device.state.hardware.firmware_version;

  if (!seen) return <span className={styles.waitingForIt}>{t('claim.code.neverHeard')}</span>;

  return (
    <>
      {t(`claim.code.${deviceLiveness(seen, now)}`, { age: ageLabel(seen, now) })}
      {version ? ` · ${t('claim.code.firmware', { version })}` : ''}
      {sockets ? ` · ${t('claim.code.sockets', { count: sockets.items.length })}` : ''}
      {` · ${t('claim.code.camera', { name: cameraName(device, t) })}`}
    </>
  );
}
