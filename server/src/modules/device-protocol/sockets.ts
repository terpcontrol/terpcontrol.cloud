import { DeviceCapabilities, Socket, SocketOverrideState, SocketRole, SocketState, SocketTimer } from '@fg2/shared-types/v1';
import { MAX_SOCKETS, SOCKETS_PER_REPORT_CHUNK, socketChunkCount, socketListKey, socketRole } from '@fg2/shared-types/v1-schemas';

/**
 * The smart-socket table, as a device reports it and as the API reads it.
 *
 * A device drives its sockets itself and tells the cloud what it has through the
 * `hardware-info:` sub-protocol. How that report is spelled - the chunking, and
 * how many sockets fit - is shared with the simulator and comes from the
 * contract's `socket-report`; the decoding is here:
 *
 * ```
 * sockets=heater,light                 the older summary: one entry per role
 * socket_ips=heater@192.168.1.60,…     the same, with the first address of each
 * sockets_n=4                          how many rows the table holds
 * socket_list0=heater|4C75…|192.168.1.60,heater|…|…,light|…|…
 * socket_list1=co2|…|…
 * ```
 *
 * The count always arrives before the chunks, so a reader that bounds the table
 * by it never misses a row.
 *
 * Nothing here is stored twice: a socket is a view of `devices.state.hardware`.
 */

/**
 * The roles every build in the field knows (`wifi.cpp`). A device that reports
 * no `socket_roles` is one of those, so it is offered exactly these and never a
 * role from the firmware change it has not taken.
 */
const DEPLOYED_SOCKET_ROLES: readonly SocketRole[] = ['dehumidifier', 'heater', 'light', 'secondary_light', 'co2'];

/** The capabilities a build announces by name in `caps`. */
const CAPABILITY_KEYS = { socketOverride: 'socket_override', socketTimer: 'socket_timer', lightOverride: 'light_override' } as const;

/** What the report spells "there is none" as. Silence would be "too old to report", which is a different fact. */
const NONE = 'none';

const list = (value: string | undefined): string[] =>
  !value || value === NONE
    ? []
    : value
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0);

const asRole = (value: string): SocketRole | null => {
  const parsed = socketRole.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const asState = (value: string | undefined): SocketState => (value === 'on' || value === 'off' ? value : 'unknown');

/**
 * One row of the table as the device sends it. The fifth column is either an
 * override or a timer, and a row that carries neither ends after the fourth -
 * as does a row from a build that reports the three columns it always has.
 *
 * ```
 * heater|4C7525A1B2C3|192.168.1.60|on|override=off@120
 * pump|4C7525A1B2C4|192.168.1.62|off|timer=30/900
 * ```
 */
const OVERRIDE_COLUMN = /^override=(on|off|auto)@(\d+)$/;
const TIMER_COLUMN = /^timer=(\d+)\/(\d+)$/;

const overrideOf = (column: string | undefined, reportedAt: Date): Socket['override'] => {
  const match = column ? OVERRIDE_COLUMN.exec(column) : null;
  if (!match) return null;

  return { state: match[1] as SocketOverrideState, validUntil: new Date(reportedAt.getTime() + Number(match[2]) * 1000).toISOString() };
};

const timerOf = (column: string | undefined): SocketTimer | null => {
  const match = column ? TIMER_COLUMN.exec(column) : null;
  return match ? { onSeconds: Number(match[1]), everySeconds: Number(match[2]) } : null;
};

export interface DecodeSocketsOptions {
  /** Slot to the instant that row was last seen to change state, as the ingest stamped it. */
  stateChangedAt?: Record<string, Date>;
  /**
   * When the device last sent its table. An override's column carries the
   * seconds it had left then, which is as good as that instant - the device
   * re-sends a row when it changes, at most once per 30 s.
   */
  reportedAt?: Date;
}

/**
 * The sockets a device has, in slot order.
 *
 * A build that reports no table still names the roles that have a socket, so
 * those are answered with slot -1: the role addresses them, which is all a
 * command could mean back when a role held one socket.
 */
export const decodeSockets = (hardware: Record<string, string>, options: DecodeSocketsOptions = {}): Socket[] => {
  const stamps = options.stateChangedAt ?? {};
  const reportedAt = options.reportedAt ?? new Date();
  const stateChangedAt = (slot: number): string | null => stamps[String(slot)]?.toISOString() ?? null;

  const count = Number(hardware.sockets_n);
  if (!Number.isInteger(count) || count <= 0) {
    return summarySockets(hardware).map(socket => ({ ...socket, stateChangedAt: null }));
  }

  const sockets: Socket[] = [];
  for (let chunk = 0; chunk < socketChunkCount(Math.min(count, MAX_SOCKETS)); chunk++) {
    const entries = list(hardware[socketListKey(chunk)]);

    entries.forEach((entry, index) => {
      const slot = chunk * SOCKETS_PER_REPORT_CHUNK + index;
      const [role, hardwareId, address, state, extra] = entry.split('|');
      const known = asRole(role ?? '');
      // A row whose role this server does not know says nothing it could act on.
      if (known === null || slot >= count) return;

      sockets.push({
        slot,
        role: known,
        hardwareId: hardwareId ?? '',
        address: address ?? '',
        state: asState(state),
        override: overrideOf(extra, reportedAt),
        timer: timerOf(extra),
        stateChangedAt: stateChangedAt(slot),
      });
    });
  }

  return sockets;
};

/** The older, lossy summary: one entry per role, with the first address of each. */
const summarySockets = (hardware: Record<string, string>): Omit<Socket, 'stateChangedAt'>[] => {
  const addresses = new Map(list(hardware.socket_ips).map(entry => [entry.split('@')[0], entry.split('@')[1] ?? '']));

  return list(hardware.sockets).flatMap(role => {
    const known = asRole(role);
    if (known === null) return [];

    return [
      {
        slot: -1,
        role: known,
        hardwareId: '',
        address: addresses.get(role) ?? '',
        state: 'unknown' as SocketState,
        override: null,
        timer: null,
      },
    ];
  });
};

/**
 * What a build announced it understands. The server sends a command or a role
 * only to a device that named it: a firmware version is the build's uuid and
 * cannot be compared, and an old build drops an unknown command without a word,
 * so what a device has not announced is never tried.
 */
export const decodeCapabilities = (hardware: Record<string, string>): DeviceCapabilities => {
  const caps = list(hardware.caps);
  const announced = list(hardware.socket_roles).flatMap(role => {
    const known = asRole(role);
    return known === null ? [] : [known];
  });

  const pulseSeconds: Record<string, number> = {};
  for (const entry of list(hardware.socket_pulse)) {
    const [role, seconds] = entry.split(':');
    const known = asRole(role ?? '');
    if (known !== null && Number.isFinite(Number(seconds))) pulseSeconds[known] = Number(seconds);
  }

  return {
    socketOverride: caps.includes(CAPABILITY_KEYS.socketOverride),
    socketTimer: caps.includes(CAPABILITY_KEYS.socketTimer),
    lightOverride: caps.includes(CAPABILITY_KEYS.lightOverride),
    roles: announced.length > 0 ? announced : [...DEPLOYED_SOCKET_ROLES],
    pulseSeconds,
  };
};
