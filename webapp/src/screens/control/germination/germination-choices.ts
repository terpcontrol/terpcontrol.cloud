import type { Device, GerminationChoices } from '@fg2/shared-types/v1';
import { germinationChoicesOf } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { SOCKET_HOST_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useSocketTables } from '@/api/devices';

/**
 * What germination does about the humidity on a device (owner's decision G2),
 * as every screen that sets germination offers it: whether the "too humid"
 * alarms go on warning, and - where a humidifier socket is paired - whether it
 * goes on holding the night's humidity. The defaults and why they are what they
 * are live with the server's (`GERMINATION_CHOICES`), so the screens and the
 * engine cannot disagree about what holds where nobody chose.
 */

/** What the device does in germination now: what was chosen, or the defaults. */
export const choicesOf = (device: Device | null): GerminationChoices => germinationChoicesOf(device?.control?.germinationChoices);

/**
 * Whether a socket is paired as a humidifier at the device: the one thing that
 * reads the humidity while it germinates, and so the only reason to offer the
 * second choice. Asked of the hardware that pairs sockets alone.
 */
export const useHumidifier = (device: Device | null): boolean => {
  const asks = device !== null && SOCKET_HOST_TYPES.includes(device.type);
  const tables = useSocketTables(asks ? [device.id] : []);
  return asks ? (tables.tables.get(device.id)?.items?.some(socket => socket.role === 'humidifier') ?? false) : false;
};

/**
 * What a save says about the choices: the alarm always, the humidifier only
 * where one is offered - the server writes the night's humidity in germination
 * only for a save that shows it.
 */
export const choicesSaid = (choices: GerminationChoices, humidifier: boolean): Partial<GerminationChoices> =>
  humidifier ? { ...choices } : { warnTooHumid: choices.warnTooHumid };
