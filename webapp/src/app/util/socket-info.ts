/**
 * Shared parsing of the controller/fridge smart-socket hardware reports:
 * `hardwareInfo.sockets` is a csv of connected roles ("none" = definitively
 * empty, absent = firmware too old to report), `hardwareInfo.socket_ips`
 * carries "role@ip" pairs.
 */
export const SOCKET_ROLES = ['dehumidifier', 'heater', 'light', 'secondary_light', 'co2'] as const;

/** A device drives at most this many sockets, spread over the roles as it likes. */
export const MAX_SOCKETS = 32;

/** Sockets per `socket_list<n>` chunk; has to match the firmware. */
const SOCKETS_PER_CHUNK = 3;

export interface SocketEntry {
  /** Position in the device's socket table, and how a command addresses it. */
  slot: number;
  role: string;
  /** Hardware id (MAC) the device finds it by; empty on sockets paired before. */
  id: string;
  ip: string;
}

export function parseSocketRoles(csv: string | undefined): string[] {
  if (!csv || csv === 'none') {
    return [];
  }
  return csv.split(',').filter(role => role.length > 0);
}

export function socketIpFromCsv(csv: string | undefined, role: string): string | null {
  if (!csv || csv === 'none') {
    return null;
  }
  const entry = csv.split(',').find(pair => pair.startsWith(role + '@'));
  return entry ? entry.slice(role.length + 1) : null;
}

/**
 * The device's full socket table. It travels chunked because a log message has
 * a fixed size budget: `sockets_n` is how many slots are live and
 * `socket_list<k>` holds the next few "role|id|ip" entries. Chunks left over
 * from a larger table are ignored, which is what `sockets_n` is for.
 *
 * Returns null when the device reports no table at all — firmware from before
 * a role could hold several sockets. Callers fall back to the per-role summary.
 */
export function parseSocketList(hardwareInfo: Record<string, string> | undefined): SocketEntry[] | null {
  const reported = hardwareInfo?.['sockets_n'];
  if (reported === undefined) {
    return null;
  }
  const count = Number(reported);
  if (!Number.isInteger(count) || count < 0) {
    return null;
  }

  const sockets: SocketEntry[] = [];
  for (let chunk = 0; chunk * SOCKETS_PER_CHUNK < count; chunk++) {
    const value = hardwareInfo?.['socket_list' + chunk];
    if (!value) {
      continue;
    }
    value.split(',').forEach((entry, index) => {
      const slot = chunk * SOCKETS_PER_CHUNK + index;
      const [role, id, ip] = entry.split('|');
      if (slot >= count || !role) {
        return;
      }
      sockets.push({ slot, role, id: id ?? '', ip: ip ?? '' });
    });
  }
  return sockets;
}
