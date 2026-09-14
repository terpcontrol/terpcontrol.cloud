import { Device } from '@fg2/shared-types';

/** A device that has not reported for this long counts as offline. */
export const ONLINE_TIMEOUT: number = 10 * 60 * 1000;

/**
 * The questions several of the device services ask of a device document. They
 * are plain functions rather than methods because each is a filter or a derived
 * field with nothing behind it - the firmware rollout and the settings both ask
 * which firmware a device is headed for, and the settings and the firmware list
 * both narrow a lookup to what the caller may see.
 */

// Which devices the caller may see at all is decided by the auth middleware;
// these filters keep a mismatched device id from answering with someone else's device.
export const deviceAccessFilter = (device_id: string, user_id: string, is_admin: boolean, is_demo: boolean) => {
  if (is_admin) return { device_id: device_id };
  if (is_demo) return { device_id: device_id, demoDevice: true };
  return { device_id: device_id, owner_id: user_id };
};

// Alarms stay suppressed until `maintenance_mode_until`, a millisecond epoch that
// not every client can represent exactly - the Garmin watch app parses large JSON
// numbers only imprecisely. Device payloads therefore carry the seconds left as
// well, so a client can count down without doing epoch arithmetic.
export const withMaintenanceSecondsLeft = <T extends Partial<Device>>(device: T): T => ({
  ...device,
  maintenance_mode_seconds_left: Math.max(0, Math.ceil(((device.maintenance_mode_until ?? 0) - Date.now()) / 1000)),
});

/** The firmware a device is headed for, whichever of the two fields names it. */
export const effectivePendingFirmware = (device: { pending_firmware?: string; cloudSettings?: { pendingFirmware?: string } }): string =>
  device.cloudSettings?.pendingFirmware || device.pending_firmware || '';

export const pendingFirmwareMatches = (firmwareId: string): object => ({
  $or: [{ pending_firmware: firmwareId }, { 'cloudSettings.pendingFirmware': firmwareId }],
});

export const pendingFirmwareNotEquals = (firmwareId: string): object => ({
  $nor: [{ pending_firmware: firmwareId }, { 'cloudSettings.pendingFirmware': firmwareId }],
});
