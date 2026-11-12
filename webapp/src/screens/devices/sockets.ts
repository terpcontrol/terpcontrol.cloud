import type { QueryClient } from '@tanstack/react-query';
import type { ActuatorRuns, ClimateVerdict, OutputMetric, Socket, SocketPage, SocketRole } from '@fg2/shared-types/v1';
import { SOCKET_HOLD_MAX_SECONDS } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { liveKey, socketsKey, type OverrideRequest } from '@/api/devices';

/**
 * What a smart socket is drawn from - on its own page and in the rows that
 * lead there - and how long an output is held by hand.
 *
 * The rows are the device's own table and nothing else. The controller's own
 * outputs are not sockets - one of them dims and none of them is reported in a
 * table - so they are drawn from their own model.
 */

/**
 * The lengths a hold offers, up to the longest an override may live, and
 * every one of them whatever is being held.
 *
 * `pulseSeconds` is not a minimum on-time and filtering by it read the device
 * backwards: it is the failsafe the socket programs itself with, the time after
 * the last command at which it switches off on its own, so that a controller
 * that goes quiet cannot leave a heater running. The controller re-asserts long
 * before then, so it never shortens a hold - which is why neither the role nor
 * the build narrows this list.
 */
export const HOLD_SECONDS: readonly number[] = [900, 3600, 4 * 3600, 8 * 3600, SOCKET_HOLD_MAX_SECONDS];

/** How long the caller takes a socket to be under test; the firmware's own pulse is two seconds on, then off. */
export const TEST_SECONDS = 5;

/**
 * A device answers a command with a report - its socket table, or its next
 * sample - and the firmware sends a changed table within half a minute. That
 * read is taken a few times on the way rather than on the next beat, wherever
 * the reader has gone meanwhile.
 */
const ANSWER_READS_MS = [2_000, 6_000, 12_000, 20_000, 30_000, 40_000];

export const answerSoon = (client: QueryClient, deviceId: string, what: 'sockets' | 'live' = 'sockets') => {
  const queryKey = what === 'live' ? liveKey(deviceId) : socketsKey(deviceId);
  for (const ms of ANSWER_READS_MS) setTimeout(() => void client.invalidateQueries({ queryKey }), ms);
};

/**
 * Takes a socket the device was just told to forget out of the table on
 * screen, so no row offers it until the device's next table says the same. It
 * is found by everything a row is known by: once the device has closed the
 * gap, the socket that moved up into its slot is another one and stays.
 */
export const forgetRow = (client: QueryClient, deviceId: string, gone: Socket) =>
  client.setQueryData<SocketPage>(
    socketsKey(deviceId),
    table =>
      table && {
        ...table,
        items: table.items.filter(
          one => !(one.slot === gone.slot && one.role === gone.role && one.hardwareId === gone.hardwareId && one.address === gone.address),
        ),
      },
  );

/** One plug of the device's own table. */
export interface SocketRowModel extends Socket {
  key: string;
  /** The name of the row: what the role is called, or "unassigned" for a socket nobody gave one. */
  titleKey: string;
  /**
   * Which of them this is, where a role holds several - a tent with two lamps
   * has two rows called "Light", and a switch has to belong to one of them.
   * Null where the role holds one socket and the name is already unambiguous.
   */
  ordinal: number | null;
  target: OverrideRequest['target'];
}

const socketRow = (socket: Socket, ordinal: number | null = null): SocketRowModel => ({
  ...socket,
  key: `socket-${socket.slot}-${socket.role}`,
  titleKey: `devices.role.${socket.role || 'unassigned'}`,
  ordinal,
  target: { kind: 'socket', slot: socket.slot },
});

/**
 * The device's table in slot order, each row numbered within its role where
 * that role holds more than one socket.
 *
 * Two plugs both called "Light" are two lamps a grower switches separately, and
 * a row that cannot be told from the one under it is a switch nobody can aim.
 */
export const rowsOf = (sockets: Socket[]): SocketRowModel[] => {
  const perRole = new Map<SocketRole, number>();
  for (const socket of sockets) perRole.set(socket.role, (perRole.get(socket.role) ?? 0) + 1);

  const seen = new Map<SocketRole, number>();
  return sockets.map(socket => {
    const nth = (seen.get(socket.role) ?? 0) + 1;
    seen.set(socket.role, nth);

    return socketRow(socket, (perRole.get(socket.role) ?? 0) > 1 ? nth : null);
  });
};

/** The outputs a socket role drives, where the place's day has already been read. */
const ROLE_OUTPUT: Partial<Record<SocketRole, OutputMetric>> = {
  heater: 'heater',
  dehumidifier: 'dehumidifier',
  co2: 'co2',
  light: 'light',
  fan: 'fan',
};

/** How often what a role drives came on in the last day, from the place's verdict; null where the verdict does not count it. */
export const runsOf = (verdict: ClimateVerdict | undefined, role: SocketRole): ActuatorRuns | null => {
  const output = ROLE_OUTPUT[role];

  return (output && verdict?.actuators.find(one => one.output === output)) || null;
};
