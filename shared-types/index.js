/**
 * The runtime half of the shared package: the smart-socket hardware report.
 *
 * A device announces its sockets as hardware info, and three parties have to
 * agree on what that looks like - the firmware writes it, the server stores it
 * and the webapp reads it. The format lives here so it is described once.
 *
 * A report consists of:
 *   sockets      csv of the roles that have a socket, "none" when none has;
 *                absent means firmware too old to report anything.
 *   socket_ips   "role@ip" for the first socket of each role - the summary
 *                that predates a role holding several sockets.
 *   sockets_n    how many sockets the table holds.
 *   socket_list<k>  the table itself, "role|id|ip" entries, a few per chunk
 *                because a log message has a fixed size budget.
 */

/** The jobs a socket can be given. A role may hold several sockets. */
const SOCKET_ROLES = ['dehumidifier', 'heater', 'light', 'secondary_light', 'co2'];

/** A device drives at most this many sockets, spread over the roles as it likes. */
const MAX_SOCKETS = 32;

/** Sockets per `socket_list<k>` chunk; has to match what the firmware sends. */
const SOCKETS_PER_REPORT_CHUNK = 3;

const socketListKey = chunk => 'socket_list' + chunk;

/** The chunk a `socket_list<k>` hardware-info key carries, or null for any other key. */
function socketListChunk(key) {
  const match = /^socket_list(\d+)$/.exec(key);
  return match ? Number(match[1]) : null;
}

/** How many chunks a table of `count` sockets is reported in. */
const socketChunkCount = count => Math.ceil(Math.max(count, 0) / SOCKETS_PER_REPORT_CHUNK);

/** Roles from the `sockets` csv. */
function parseSocketRoles(csv) {
  if (!csv || csv === 'none') {
    return [];
  }
  return csv.split(',').filter(role => role.length > 0);
}

/** One role's address from the `socket_ips` csv. */
function socketIpFromCsv(csv, role) {
  if (!csv || csv === 'none') {
    return null;
  }
  const entry = csv.split(',').find(pair => pair.startsWith(role + '@'));
  return entry ? entry.slice(role.length + 1) : null;
}

/**
 * How many sockets the device says its table holds, or null when it reports no
 * table at all - firmware from before a role could hold several sockets.
 */
function reportedSocketCount(hardwareInfo) {
  const reported = hardwareInfo && hardwareInfo['sockets_n'];
  if (reported === undefined || reported === null) {
    return null;
  }
  const count = Number(reported);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

/**
 * The device's socket table, or null when it reports none. Chunks left over
 * from a larger table are ignored, which is what `sockets_n` is for.
 */
function parseSocketList(hardwareInfo) {
  const count = reportedSocketCount(hardwareInfo);
  if (count === null) {
    return null;
  }

  const sockets = [];
  for (let chunk = 0; chunk < socketChunkCount(count); chunk++) {
    const value = hardwareInfo[socketListKey(chunk)];
    if (!value) {
      continue;
    }
    value.split(',').forEach((entry, index) => {
      const slot = chunk * SOCKETS_PER_REPORT_CHUNK + index;
      const [role, id, ip] = entry.split('|');
      if (slot >= count || !role) {
        return;
      }
      sockets.push({ slot, role, id: id || '', ip: ip || '' });
    });
  }
  return sockets;
}

/** Whether the device reports its sockets at all. */
function socketsReported(hardwareInfo) {
  return (hardwareInfo && hardwareInfo['sockets'] !== undefined) || reportedSocketCount(hardwareInfo) !== null;
}

/**
 * Every socket the device reports, preferring its table. The per-role summary
 * is the fallback for firmware that reports no table - and for a report whose
 * table did not survive (demo devices have the addresses stripped out) - where
 * a socket has no slot to be addressed by.
 */
function readSockets(hardwareInfo) {
  const table = parseSocketList(hardwareInfo);
  if (table && table.length > 0) {
    return table;
  }
  return parseSocketRoles(hardwareInfo && hardwareInfo['sockets']).map(role => ({
    slot: -1,
    role,
    id: '',
    ip: socketIpFromCsv(hardwareInfo && hardwareInfo['socket_ips'], role) || '',
  }));
}

/** The roles that have at least one socket. */
function socketRoles(hardwareInfo) {
  return [...new Set(readSockets(hardwareInfo).map(socket => socket.role))];
}

/**
 * How a socket is identified in the UI and addressed in a command: its slot in
 * the table, or its role for firmware that reports no table.
 */
function socketKey(socket) {
  return socket.slot >= 0 ? String(socket.slot) : socket.role;
}

/** Everything the socket report is made of, as one string - a cheap cache key. */
function socketReportKey(hardwareInfo) {
  return Object.entries(hardwareInfo || {})
    .filter(([key]) => key.startsWith('socket'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + '=' + value)
    .join(';');
}

module.exports = {
  SOCKET_ROLES,
  MAX_SOCKETS,
  SOCKETS_PER_REPORT_CHUNK,
  socketListKey,
  socketListChunk,
  socketChunkCount,
  parseSocketRoles,
  socketIpFromCsv,
  reportedSocketCount,
  parseSocketList,
  socketsReported,
  readSockets,
  socketRoles,
  socketKey,
  socketReportKey,
};
