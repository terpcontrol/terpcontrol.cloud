import type { DeviceCapabilities, Socket, SocketOverride, SocketRole, SocketState, SocketTimer } from '@fg2/shared-types/v1';
import { SOCKET_HOLD_MAX_SECONDS } from '@fg2/shared-types/v1-schemas/socket-report.js';
import type { OverrideRequest } from '@/api/devices';

/**
 * What a socket row on the Devices tab is drawn from, and what a tap on its
 * switch means.
 *
 * The rows are the device's own table plus, on a build that takes one, the
 * controller's own light output: it is not a socket and has no slot, but it is
 * the one other thing on the tent a switch here forces.
 */

/** How long a plain tap holds a socket. A modest hold rather than the longest one the firmware allows. */
const DEFAULT_HOLD_SECONDS = 3600;

/** The times a held switch offers, up to the longest an override may live. */
const HOLDS_SECONDS = [900, DEFAULT_HOLD_SECONDS, 4 * 3600, 8 * 3600, SOCKET_HOLD_MAX_SECONDS];

/** Long enough to find which plug in the tent it is, short enough to be over before anybody worries. */
export const TEST_SECONDS = 5;

/**
 * The times a role may be held for, which is every one of them.
 *
 * `pulseSeconds` is not a minimum on-time and filtering by it read the device
 * backwards: it is the failsafe the socket programs itself with, the time after
 * the last command at which it switches off on its own, so that a controller
 * that goes quiet cannot leave a heater running. The controller re-asserts long
 * before then, so it never shortens a hold.
 */
export const holdsFor = (_capabilities: DeviceCapabilities, _role: SocketRole): number[] => [...HOLDS_SECONDS];

export const defaultHold = (capabilities: DeviceCapabilities, role: SocketRole): number => {
  const offered = holdsFor(capabilities, role);

  return offered.find(seconds => seconds >= DEFAULT_HOLD_SECONDS) ?? offered[offered.length - 1];
};

/** "30 s", "15 min", "6 h", "24 h": the coarsest unit the number is whole in. */
export const durationLabel = (seconds: number): string => {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600 || seconds % 3600 !== 0) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
};

/** One row of the Devices tab's socket list: a socket, or the controller's own light output. */
export interface SocketRowModel {
  key: string;
  role: SocketRole;
  /** The name of the row: what the role is called, or "unassigned" for a socket nobody gave one. */
  titleKey: string;
  address: string;
  hardwareId: string;
  slot: number | null;
  state: SocketState;
  override: SocketOverride | null;
  timer: SocketTimer | null;
  stateChangedAt: string | null;
  target: OverrideRequest['target'];
}

export const socketRow = (socket: Socket): SocketRowModel => ({
  key: `socket-${socket.slot}-${socket.role}`,
  role: socket.role,
  titleKey: `devices.role.${socket.role || 'unassigned'}`,
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
 * The controller's own light output as a row of the same list.
 *
 * Its state is deliberately `unknown`: an output's state is a series the cloud
 * records and no read answers what it is doing right now, so the row offers the
 * three-way control every row with an unknown state gets rather than a switch
 * drawn in a position nobody checked.
 */
export const lightOutputRow = (): SocketRowModel => ({
  key: 'output-light',
  role: 'light',
  titleKey: 'devices.role.light',
  address: '',
  hardwareId: '',
  slot: null,
  state: 'unknown',
  override: null,
  timer: null,
  stateChangedAt: null,
  target: { kind: 'output', output: 'light' },
});

/**
 * The rows of one device: its own light output first, as the board draws it,
 * then its table in slot order.
 *
 * The output row exists to carry a switch and reports no state of its own, so
 * it is left out for somebody who gets no switch: a line that says nothing to
 * a reader is not a row.
 */
export const rowsOf = (sockets: Socket[], capabilities: DeviceCapabilities, mayManage = true): SocketRowModel[] => [
  ...(capabilities.lightOverride && mayManage ? [lightOutputRow()] : []),
  ...sockets.map(socketRow),
];
