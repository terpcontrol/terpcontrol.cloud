import type { DateTime } from 'luxon';
import type { Device } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useSocketTables } from '@/api/devices';
import type { Translate } from '@/i18n/i18n';
import type { Held } from '@/screens/devices/HandHold';
import { isLightRole, useLightHold } from '@/screens/devices/lights';
import { lightWindowOf } from '@/screens/start/place';
import { sinceLabel } from '@/ui/age';
import { outputsOf } from '@/ui/climate-hardware';
import { deviceTitle } from '@/ui/naming';

/**
 * A device's lamp held by hand, for every place that says what the light is
 * doing: its own light output as this browser last asked for it (the device
 * reports no hold of it, see `useLightHold`), else a light socket its table
 * says is held. Null for a lamp that keeps to its schedule.
 */
export const useHeldLight = (device: Device | null, now: DateTime): Held | null => {
  const hosts = device !== null && SOCKET_HOST_TYPES.includes(device.type);
  const output = useLightHold(hosts ? device.id : '', now);
  const table = useSocketTables(hosts ? [device.id] : []).tables.get(device?.id ?? '');
  const socket = table?.items.find(one => isLightRole(one.role) && one.override && one.override.state !== 'auto')?.override;

  return output ?? (socket && socket.state !== 'auto' ? { state: socket.state, until: socket.validUntil } : null);
};

/** "von Hand aus bis 13:05". */
export const heldWords = (t: Translate, held: Held, now: DateTime, zone: string | null): string =>
  t(`devices.lightOutput.holding.${held.state}`, { until: sinceLabel(held.until, now, zone) });

/** The devices among these that light the place: a controller's or a fridge module's light output, a lamp module. */
export const lampsAmong = (devices: readonly Device[]): Device[] => devices.filter(device => outputsOf(device).includes('light'));

/**
 * What one lamp is called where its light is shown or set. Each lamp of a place is controlled on its own, so where
 * `lamps` holds more than one each is named - "Licht · Controller" for a device's light output, a lamp module by its
 * own name -, and one alone is the place's "Licht".
 */
export const lampName = (t: Translate, device: Device, lamps: readonly Device[]): string => {
  if (lamps.length < 2) return t('control.rows.light');
  const title = deviceTitle(device, t, [...lamps]);
  return device.type === 'light' ? title : t('control.light.of', { device: title });
};

/**
 * "Lampenmodul bleibt bei 07:00 bis 23:00": the other lamps of a place, each with its window, which a climate written
 * to `device` leaves burning as they do. Empty where `device` is the place's one lamp.
 */
export const lampsLeft = (t: Translate, device: Device, lamps: readonly Device[], now: DateTime, zone: string | null): string[] =>
  lamps
    .filter(one => one.id !== device.id)
    .map(one => {
      const light = lightWindowOf(one, now, zone);
      const window = !light
        ? null
        : light.always
          ? t('start.light.always')
          : light.never
            ? t('start.light.never')
            : t('start.targets.window', { on: light.on, off: light.off });
      return t(window ? 'control.preset.lampLeft' : 'control.preset.lampLeftAsIs', { lamp: lampName(t, one, lamps), window });
    });
