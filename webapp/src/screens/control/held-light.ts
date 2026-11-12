import type { DateTime } from 'luxon';
import type { Device } from '@fg2/shared-types/v1';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useSocketTables } from '@/api/devices';
import type { Translate } from '@/i18n/i18n';
import type { Held } from '@/screens/devices/HandHold';
import { isLightRole, useLightHold } from '@/screens/devices/lights';
import { sinceLabel } from '@/ui/age';

/**
 * A device's lamp held by hand, for every place that says what the light is
 * doing - the Licht card, Start's tile and its sentence: its own light output
 * as this browser last asked for it (the device reports no hold of it, see
 * `useLightHold`), else a light socket its table says is held. Null for a
 * lamp that keeps to its schedule, as far as anything here can know.
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
