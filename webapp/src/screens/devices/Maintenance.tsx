import { RotateCcw } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useDevicesCommand } from '@/api/commands';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import { parkedQuiet, VISIT_MINUTES } from '@/ui/maintenance';
import { Answered, SheetAnswer } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { clock, useZone } from '@/ui/zone';
import styles from './Maintenance.module.css';

/**
 * The two things a grower does to the hardware itself: a window of maintenance
 * and a restart. Both reach real hardware. Maintenance is `MaintenanceControl`:
 * one tap for a quarter of an hour, ended and extended at the same spot - on
 * Start for the place, on a device's card under Steuerung and on its own page
 * for that device. A restart is asked first, and the question turns into the
 * receipt once it has been answered.
 *
 * Maintenance is sent as the device command and not written as a diary line:
 * it is the same window on the same hardware, but a grower who keeps no diary
 * should not find one started by pressing a button about the tent.
 */

/**
 * Maintenance as one control, for whoever is about to open the tent: one tap
 * on "Wartung · 15 Min" starts a quarter of an hour - no sheet and nothing to
 * read first, because the hand that taps it is already on the zip. While the
 * window stands the same spot says until when and carries the two things left
 * to decide, ending it and another quarter of an hour.
 *
 * It is sent to every device it is given: the place's on Start, the one a
 * card is about under Steuerung. What it says after a tap is what came back -
 * a device that was not there to hear it is named, and a refusal is drawn.
 * `disabled` is a device known to be offline.
 */
export function MaintenanceControl({ devices, now, id, disabled = false }: { devices: Device[]; now: DateTime; id?: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const zone = useZone();
  const send = useDevicesCommand();
  const at = DateTime.max(now, serverNow());
  const running = parkedQuiet(devices, at);
  const ids = devices.map(device => device.id);
  const asked = send.variables?.command.kind === 'maintenance' ? send.variables.command.forSeconds : null;
  const unheard = asked !== null && asked > 0 && (send.data ?? []).some(receipt => !receipt.deviceOnline);

  const hold = (forSeconds: number) => send.mutate({ deviceIds: ids, command: { kind: 'maintenance', forSeconds } });
  // A device nobody hears takes no window: the buttons stay in reach of the focus and send nothing, and whoever draws them says why.
  const ask = (forSeconds: number) => (disabled ? undefined : hold(forSeconds));
  const left = running ? Math.max(0, Math.round(DateTime.fromISO(running.until).diff(at).as('seconds'))) : 0;

  return (
    <div className={styles.control} id={id} tabIndex={id ? -1 : undefined}>
      {running ? (
        <div className={styles.controlRunning} role="group" aria-label={t('maintenance.title')}>
          <span className={styles.controlSays}>
            {t('maintenance.running', { until: clock(running.until, zone) })}
            <Help topic="maintenance" />
            <span className={styles.subline}>
              {send.isPending ? t(asked === 0 ? 'maintenance.ending' : 'maintenance.extending') : t('maintenance.runningNote')}
            </span>
          </span>
          <button type="button" className={ui.button} disabled={send.isPending} aria-disabled={disabled || undefined} onClick={() => ask(0)}>
            {t('maintenance.endShort')}
          </button>
          <button
            type="button"
            className={ui.button}
            disabled={send.isPending}
            aria-disabled={disabled || undefined}
            onClick={() => ask(left + VISIT_MINUTES * 60)}
          >
            {t('maintenance.extend')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.controlStart}
          disabled={send.isPending || ids.length === 0}
          aria-disabled={disabled || undefined}
          onClick={() => ask(VISIT_MINUTES * 60)}
        >
          {send.isPending && asked !== 0 ? t('maintenance.starting') : t('maintenance.actionShort', { minutes: VISIT_MINUTES })}
        </button>
      )}
      {unheard && !send.isPending ? <p className={ui.note}>{t('maintenance.unheardShort')}</p> : null}
      <Refused error={send.error} />
    </div>
  );
}

/**
 * A restart, asked first. What it costs is short and real: the device is gone
 * for a moment, regulates nothing while it is, and anything switched by hand is
 * let go, because an override lives in the device's memory and dies with it.
 */
export function RebootSheet({ device, name, onClose }: { device: Device; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const send = useDevicesCommand();
  const receipt = send.data?.[0] ?? null;

  return (
    <Sheet
      title={t('devices.reboot.title', { name })}
      onClose={onClose}
      actions={
        <SheetAnswer done={receipt !== null} error={send.error} onClose={onClose}>
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={send.isPending}
            onClick={() => send.mutate({ deviceIds: [device.id], command: { kind: 'reboot' } })}
          >
            <RotateCcw size={16} strokeWidth={1.75} aria-hidden />
            {t('devices.reboot.yes')}
          </button>
        </SheetAnswer>
      }
    >
      <div className={styles.body}>
        {receipt ? (
          <Answered>{t(receipt.deviceOnline ? 'devices.reboot.sent' : 'devices.reboot.unheard')}</Answered>
        ) : (
          <>
            <p>{t('devices.reboot.text')}</p>
            <p className={ui.note}>{t('devices.reboot.kept')}</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
