import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Device } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { parksAnything } from '@/ui/maintenance';
import { deviceTitle } from '@/ui/naming';
import { enough, useMayWith } from '@/ui/session-access';
import ui from '@/ui/ui.module.css';
import { useNow } from '@/ui/useNow';
import { useFirmware } from './firmware-builds';
import { PinSheet } from './FirmwarePin';
import { MaintenanceControl, RebootSheet } from './Maintenance';
import maintenance from './Maintenance.module.css';
import styles from './DevicePage.module.css';

/**
 * "Wartung · 15 Min" and "Neu starten" side by side: what is done to the
 * hardware itself, on the device's card under Steuerung and on its own page.
 * A device nobody hears takes neither, and one sentence says so; the buttons
 * stay where they are, so the page does not move when the device comes back.
 * Maintenance is offered only where the device parks something, and neither
 * to a reader who may not manage the device.
 */
export function DeviceActions({ device, offline }: { device: Device; offline: boolean }) {
  const { t } = useTranslation();
  const now = useNow();
  const devices = useDevices();
  const mayManage = enough(useMayWith()(device), 'manage');
  const [restarting, setRestarting] = useState(false);
  if (!mayManage) return null;

  const parks = parksAnything(device);

  return (
    <div className={styles.actions}>
      {parks ? <MaintenanceControl devices={[device]} now={now} disabled={offline} /> : null}
      <button
        type="button"
        className={maintenance.controlStart}
        aria-disabled={offline || undefined}
        onClick={() => (offline ? undefined : setRestarting(true))}
      >
        {t('devices.reboot.action')}
      </button>
      {/* A sentence about a device names only what that device does: a plug has no maintenance to wait for. */}
      {offline ? <p className={ui.note}>{t(parks ? 'device.waitsForDevice' : 'device.waitsForRestart')}</p> : null}
      {restarting ? <RebootSheet device={device} name={deviceTitle(device, t, devices.data?.items)} onClose={() => setRestarting(false)} /> : null}
    </div>
  );
}

/**
 * "Update vom 3. Nov.": the newer stable build of a device whose updates are
 * off, installed after a question because the device restarts with it. A
 * device that follows a channel is handed its builds by the rollout, and one
 * the cloud does not know the running build of cannot be called behind - both
 * are offered nothing here.
 */
export function UpdateButton({ device, offline, label }: { device: Device; offline: boolean; label?: string }) {
  const { t } = useTranslation();
  const mayManage = enough(useMayWith()(device), 'manage');
  const could = mayManage && !device.isDemo && device.classId !== null && device.firmware.channel === 'manual';
  const { offered, madeOn } = useFirmware(device, could);
  const [asking, setAsking] = useState(false);
  if (!could || !offered) return null;

  return (
    <>
      <button type="button" className={styles.update} aria-disabled={offline || undefined} onClick={() => (offline ? undefined : setAsking(true))}>
        {label ?? t('device.firmware.updateTo', { day: madeOn(offered) })}
      </button>
      {asking ? <PinSheet device={device} build={offered} onClose={() => setAsking(false)} /> : null}
    </>
  );
}
