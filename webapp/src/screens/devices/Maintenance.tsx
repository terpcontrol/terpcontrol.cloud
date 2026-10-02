import { RotateCcw, Wrench, type LucideIcon } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device, DeviceCommandResult } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { useDevicesCommand } from '@/api/commands';
import { Sheet } from '@/log/Sheet';
import { MAINTENANCE_MINUTES, parkedLabel, parkedQuiet, parksAnything, quietMinutes, SETTLE_MINUTES, VISIT_MINUTES } from '@/ui/maintenance';
import { Refused } from '@/ui/PageState';
import { Choice, Choices } from '@/ui/SheetParts';
import ui from '@/ui/ui.module.css';
import { clock, useZone } from '@/ui/zone';
import { deviceTitle } from './naming';
import styles from './Maintenance.module.css';

/**
 * The two things a grower does to the hardware itself: a window of maintenance
 * - a quarter of an hour, half an hour or an hour - and a restart. Both reach
 * real hardware and neither can be taken back, so each is a button that opens
 * a question saying what is about to stop, and the question turns into the
 * receipt once it has been answered.
 *
 * Maintenance is sent as the device command and not written as a diary line:
 * it is the same window on the same hardware, but a grower who keeps no diary
 * should not find one started by pressing a button about the tent.
 */

/** A window of so many minutes, the settling after it, and the sum of the two - the span nothing is raised in. */
const spansOf = (minutes: number) => ({ minutes, settle: SETTLE_MINUTES, quiet: quietMinutes(minutes * 60) });

/** A button that says what it is, and under it what it does - the two lines a grower decides on. */
export function TwoLines({ Icon, name, does, disabled, className, onClick }: TwoLinesProps) {
  return (
    <button type="button" className={`${ui.button} ${styles.button} ${className ?? ''}`} disabled={disabled} onClick={onClick}>
      <Icon size={16} strokeWidth={1.75} aria-hidden />
      <span className={styles.words}>
        <span>{name}</span>
        <span className={styles.subline}>{does}</span>
      </span>
    </button>
  );
}

interface TwoLinesProps {
  Icon: LucideIcon;
  name: string;
  does: string;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}

/**
 * "Maintenance" and what that means under it, or, while the devices are
 * parked, until when. It opens the question, where the length is chosen; it
 * never sends.
 */
export function MaintenanceButton({
  devices,
  now,
  disabled,
  className,
}: {
  devices: Device[];
  now: DateTime;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const zone = useZone();
  const [asking, setAsking] = useState(false);
  const running = parkedQuiet(devices, DateTime.max(now, serverNow()));

  return (
    <>
      <TwoLines
        Icon={Wrench}
        name={running ? t('maintenance.running', { until: clock(running.until, zone) }) : t('maintenance.actionChoose')}
        does={t(running ? 'maintenance.runningNote' : 'maintenance.actionNote')}
        disabled={disabled}
        className={className}
        onClick={() => setAsking(true)}
      />
      {asking ? <MaintenanceSheet devices={devices} now={now} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

/** "Restart", and what a restart costs under it. It opens the question; it never sends. */
export function RebootButton({ device, name, disabled }: { device: Device; name: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);

  return (
    <>
      <TwoLines
        Icon={RotateCcw}
        name={t('devices.reboot.action')}
        does={t('devices.reboot.does')}
        disabled={disabled}
        onClick={() => setAsking(true)}
      />
      {asking ? <RebootSheet device={device} name={name} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

/**
 * The question before a window opens, or - while one is open - what is held and
 * the way out of it. What stops is said of each device, because only a
 * controller and a fridge module park anything; the others only go quiet.
 */
function MaintenanceSheet({ devices, now, onClose }: { devices: Device[]; now: DateTime; onClose: () => void }) {
  const { t } = useTranslation();
  const zone = useZone();
  const send = useDevicesCommand();
  const [minutes, setMinutes] = useState<number>(VISIT_MINUTES);
  const spans = spansOf(minutes);
  const running = parkedQuiet(devices, DateTime.max(now, serverNow()));
  const ids = devices.map(device => device.id);
  const receipts = send.data ?? null;
  const ended = send.variables?.command.kind === 'maintenance' && send.variables.command.forSeconds === 0;

  const start = () => send.mutate({ deviceIds: ids, command: { kind: 'maintenance', forSeconds: minutes * 60 } });
  const end = () => send.mutate({ deviceIds: ids, command: { kind: 'maintenance', forSeconds: 0 } });

  const actions = receipts ? (
    <button type="button" className={`${ui.button} ${ui.primary}`} onClick={onClose}>
      {t('maintenance.done')}
    </button>
  ) : (
    <>
      <Refused error={send.error} />
      {running ? (
        <button type="button" className={`${ui.button} ${ui.primary}`} disabled={send.isPending} onClick={end}>
          {t(send.isPending ? 'maintenance.ending' : 'maintenance.end')}
        </button>
      ) : (
        <button type="button" className={`${ui.button} ${ui.primary}`} disabled={send.isPending || devices.length === 0} onClick={start}>
          {t('maintenance.start')}
        </button>
      )}
      <button type="button" className={ui.button} onClick={onClose}>
        {t('maintenance.cancel')}
      </button>
    </>
  );

  return (
    <Sheet title={t('maintenance.title')} onClose={onClose} actions={actions}>
      <div className={styles.body} role={receipts ? 'status' : undefined}>
        {receipts ? (
          <Receipt receipts={receipts} ended={ended} spans={spans} />
        ) : running ? (
          <p>{t('maintenance.runningText', { until: clock(running.until, zone), alarms: clock(running.alarmsUntil, zone) })}</p>
        ) : (
          <>
            <Choices label={t('maintenance.howLong')}>
              {MAINTENANCE_MINUTES.map(length => (
                <Choice key={length} chosen={minutes === length} disabled={send.isPending} onChoose={() => setMinutes(length)}>
                  {t('maintenance.minutes', { minutes: length })}
                </Choice>
              ))}
            </Choices>
            <WhatPauses devices={devices} spans={spans} />
          </>
        )}
      </div>
    </Sheet>
  );
}

/** What a window stops, device by device where there are several, and how long nothing is raised. */
function WhatPauses({ devices, spans }: { devices: Device[]; spans: ReturnType<typeof spansOf> }) {
  const { t } = useTranslation();
  const only = devices.length === 1 ? devices[0] : null;

  return (
    <>
      {only ? (
        <p>{parksAnything(only) ? t('maintenance.pauses', { ...spans, outputs: parkedLabel(t, only) }) : t('maintenance.pausesNothing', spans)}</p>
      ) : (
        <>
          <p>{t('maintenance.pausesEach', { ...spans, count: devices.length })}</p>
          <ul className={styles.list}>
            {devices.map(device => (
              <li key={device.id}>
                <strong>{deviceTitle(device, t, devices)}</strong>
                {' — '}
                {parksAnything(device) ? t('log.visit.parksOutputs', { outputs: parkedLabel(t, device) }) : t('log.visit.parksNothing')}
              </li>
            ))}
          </ul>
        </>
      )}
      <p>{t('maintenance.alarms', spans)}</p>
      <p className={ui.note}>{t('maintenance.after', { count: devices.length })}</p>
    </>
  );
}

/** What came back: a window asked for, or ended - and, where a device was not there to hear it, that too. */
function Receipt({ receipts, ended, spans }: { receipts: DeviceCommandResult[]; ended: boolean; spans: ReturnType<typeof spansOf> }) {
  const { t } = useTranslation();
  const unheard = receipts.some(receipt => !receipt.deviceOnline);

  return (
    <>
      <p>{ended ? t('maintenance.ended') : t('maintenance.started', spans)}</p>
      {unheard && !ended ? <p className={ui.note}>{t('maintenance.unheard', spans)}</p> : null}
    </>
  );
}

/**
 * A restart, asked first. What it costs is short and real: the device is gone
 * for a moment, regulates nothing while it is, and anything switched by hand is
 * let go, because an override lives in the device's memory and dies with it.
 */
function RebootSheet({ device, name, onClose }: { device: Device; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const send = useDevicesCommand();
  const receipt = send.data?.[0] ?? null;

  return (
    <Sheet
      title={t('devices.reboot.title', { name })}
      onClose={onClose}
      actions={
        receipt ? (
          <button type="button" className={`${ui.button} ${ui.primary}`} onClick={onClose}>
            {t('maintenance.done')}
          </button>
        ) : (
          <>
            <Refused error={send.error} />
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              disabled={send.isPending}
              onClick={() => send.mutate({ deviceIds: [device.id], command: { kind: 'reboot' } })}
            >
              <RotateCcw size={16} strokeWidth={1.75} aria-hidden />
              {t('devices.reboot.yes')}
            </button>
            <button type="button" className={ui.button} onClick={onClose}>
              {t('maintenance.cancel')}
            </button>
          </>
        )
      }
    >
      <div className={styles.body} role={receipt ? 'status' : undefined}>
        {receipt ? (
          <p>{t(receipt.deviceOnline ? 'devices.reboot.sent' : 'devices.reboot.unheard')}</p>
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
