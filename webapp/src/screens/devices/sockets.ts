import type { Socket, SocketOverride, SocketRole, SocketState, SocketTimer } from '@fg2/shared-types/v1';
import { SOCKET_HOLD_MAX_SECONDS } from '@fg2/shared-types/v1-schemas/socket-report.js';
import type { OverrideRequest } from '@/api/devices';
import { durationFigure } from '@/ui/age';

/**
 * What a socket row on the Devices tab is drawn from, and what a tap on its
 * switch means.
 *
 * The rows are the device's own table and nothing else. The controller's own
 * outputs are not sockets - one of them dims and none of them is reported in a
 * table - so they are drawn from their own model, above these.
 */

/** How long a plain tap holds a socket. A modest hold rather than the longest one the firmware allows. */
const DEFAULT_HOLD_SECONDS = 3600;

/** The times a held switch offers, up to the longest an override may live. */
const HOLDS_SECONDS = [900, DEFAULT_HOLD_SECONDS, 4 * 3600, 8 * 3600, SOCKET_HOLD_MAX_SECONDS];

/** Long enough to find which plug in the tent it is, short enough to be over before anybody worries. */
export const TEST_SECONDS = 5;

/**
 * The times anything may be held for, which is every one of them whatever is
 * being held.
 *
 * `pulseSeconds` is not a minimum on-time and filtering by it read the device
 * backwards: it is the failsafe the socket programs itself with, the time after
 * the last command at which it switches off on its own, so that a controller
 * that goes quiet cannot leave a heater running. The controller re-asserts long
 * before then, so it never shortens a hold - which is why neither the role nor
 * the build narrows this list.
 */
export const holdsFor = (): number[] => [...HOLDS_SECONDS];

export const defaultHold = (): number => holdsFor().find(seconds => seconds >= DEFAULT_HOLD_SECONDS) ?? HOLDS_SECONDS[HOLDS_SECONDS.length - 1];

/** "30 s", "15 min", "6 h", "24 h": the coarsest unit the number is whole in. */
export const durationLabel = (seconds: number): string => {
  if (seconds < 60) return durationFigure(seconds, 's');
  if (seconds < 3600 || seconds % 3600 !== 0) return durationFigure(Math.round(seconds / 60), 'min');
  return durationFigure(Math.round(seconds / 3600), 'h');
};

/** One row of the Devices tab's socket list: one plug of the device's own table. */
export interface SocketRowModel {
  key: string;
  role: SocketRole;
  /** The name of the row: what the role is called, or "unassigned" for a socket nobody gave one. */
  titleKey: string;
  /**
   * Which of them this is, where a role holds several - a tent with two lamps
   * has two rows called "Light", and a switch has to belong to one of them.
   * Null where the role holds one socket and the name is already unambiguous.
   */
  ordinal: number | null;
  address: string;
  hardwareId: string;
  slot: number;
  state: SocketState;
  override: SocketOverride | null;
  timer: SocketTimer | null;
  stateChangedAt: string | null;
  target: OverrideRequest['target'];
}

export const socketRow = (socket: Socket, ordinal: number | null = null): SocketRowModel => ({
  key: `socket-${socket.slot}-${socket.role}`,
  role: socket.role,
  titleKey: `devices.role.${socket.role || 'unassigned'}`,
  ordinal,
  address: socket.address,
  hardwareId: socket.hardwareId,
  slot: socket.slot,
  state: socket.state,
  override: socket.override,
  timer: socket.timer,
  stateChangedAt: socket.stateChangedAt,
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
