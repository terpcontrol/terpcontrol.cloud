import { RotateCcw } from 'lucide-react';
import { DateTime } from 'luxon';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useDevicesCommand } from '@/api/commands';
import { useLog } from '@/log/log-context';
import { Help } from '@/ui/Help';
import { Refused } from '@/ui/PageState';
import { Sheet } from '@/ui/Sheet';
import { parkedQuiet, VISIT_MINUTES } from '@/ui/maintenance';
import { Answered, SheetAnswer } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { clock, useZone } from '@/ui/zone';
import styles from './Maintenance.module.css';

/**
 * Maintenance as one control, for whoever is about to open the tent: one tap
 * on "Wartung · 15 Min" starts a quarter of an hour, with no sheet before it.
 * While the window stands the same spot says until when and offers ending it
 * and another quarter of an hour.
 *
 * It is the device command and no diary line, sent to every device it is
 * given. The toast names the window as it now stands and puts it back as it
 * stood; a device that was not there to hear it is named. `disabled` is a
 * device known to be offline. A tap while the last is on its way sends
 * nothing, and no button is disabled for it: the focus stays where the hand
 * was.
 */
export function MaintenanceControl({ devices, now, id, disabled = false }: { devices: Device[]; now: DateTime; id?: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const zone = useZone();
  const { tell } = useLog();
  const send = useDevicesCommand();
  const at = DateTime.max(now, serverNow());
  const running = parkedQuiet(devices, at);
  const ids = devices.map(device => device.id);
  const asked = send.variables?.command.kind === 'maintenance' ? send.variables.command.forSeconds : null;
  const unheard = asked !== null && asked > 0 && (send.data ?? []).some(receipt => !receipt.deviceOnline);

  const hold = (forSeconds: number) => send.mutateAsync({ deviceIds: ids, command: { kind: 'maintenance', forSeconds } });
  const secondsTo = (until: string | null) =>
    until ? Math.max(0, Math.round(DateTime.fromISO(until).diff(DateTime.max(now, serverNow())).as('seconds'))) : 0;
  // A device nobody hears takes no window: the buttons stay in reach of the focus and send nothing, and whoever draws them says why.
  const ask = async (forSeconds: number) => {
    if (disabled || send.isPending) return;
    const before = running?.until ?? null;
    try {
      const receipts = await hold(forSeconds);
      if (!receipts.some(receipt => receipt.deviceOnline)) return;
      const until = clock(serverNow().plus({ seconds: forSeconds }).toISO()!, zone);
      tell({
        label: forSeconds === 0 ? t('maintenance.told.ended') : t(before ? 'maintenance.told.extended' : 'maintenance.told.started', { until }),
        undo: () => hold(secondsTo(before)),
        undone: before ? t('maintenance.running', { until: clock(before, zone) }) : t('maintenance.told.ended'),
        from: `maintenance-${ids.join(' ')}`,
      });
    } catch {
      // Drawn under the control, from the command that was refused.
    }
  };
  const left = secondsTo(running?.until ?? null);

  return (
    <div className={ui.stack2} id={id} tabIndex={id ? -1 : undefined}>
      {running ? (
        <div className={styles.controlRunning} role="group" aria-label={t('maintenance.title')}>
          <span className={styles.controlSays}>
            <span className={styles.until}>
              {t('maintenance.running', { until: clock(running.until, zone) })}
              <Help topic="maintenance" />
            </span>
            <span className={styles.subline}>
              {send.isPending ? t(asked === 0 ? 'maintenance.ending' : 'maintenance.extending') : t('maintenance.runningNote')}
            </span>
          </span>
          <button type="button" className={ui.button} aria-disabled={disabled || undefined} onClick={() => void ask(0)}>
            {t('maintenance.endShort')}
          </button>
          <button type="button" className={ui.button} aria-disabled={disabled || undefined} onClick={() => void ask(left + VISIT_MINUTES * 60)}>
            {t('maintenance.extend')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.controlStart}
          disabled={ids.length === 0}
          aria-disabled={disabled || undefined}
          onClick={() => void ask(VISIT_MINUTES * 60)}
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
 * A restart, asked first: the device is gone for a moment, regulates nothing
 * while it is, and anything switched by hand is let go, because an override
 * lives in the device's memory. A device that was not there to hear it is
 * said in the sheet, which stays.
 */
export function RebootSheet({ device, name, onClose }: { device: Device; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { tell } = useLog();
  const send = useDevicesCommand();
  const unheard = send.data?.[0]?.deviceOnline === false;

  const restart = async () => {
    try {
      const [receipt] = await send.mutateAsync({ deviceIds: [device.id], command: { kind: 'reboot' } });
      if (!receipt.deviceOnline) return;
      tell({ label: t('devices.reboot.sent', { name }), undo: null });
      onClose();
    } catch {
      // Said over the button, from the command that was refused.
    }
  };

  return (
    <Sheet
      title={t('devices.reboot.title', { name })}
      onClose={onClose}
      actions={
        <SheetAnswer done={unheard} error={send.error} onClose={onClose}>
          <button type="button" className={`${ui.button} ${ui.primary}`} disabled={send.isPending} onClick={() => void restart()}>
            <RotateCcw size={16} strokeWidth={1.75} aria-hidden />
            {t('devices.reboot.yes')}
          </button>
        </SheetAnswer>
      }
    >
      <div className={styles.body}>
        {unheard ? (
          <Answered>{t('devices.reboot.unheard')}</Answered>
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
