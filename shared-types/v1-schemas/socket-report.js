"use strict";
/**
 * How a device spells its smart-socket table in the `hardware-info:` report.
 *
 * This is not a wire shape of `/v1` - the API answers `Socket` rows and never
 * the report - but three parties have to agree on the same numbers: the firmware
 * that writes the report, the server that decodes it, and the simulator that
 * stands in for hardware. So it is stated once, here.
 *
 * ```
 * sockets_n=4                          how many rows the table holds
 * socket_list0=heater|4C75…|10.0.0.6,… SOCKETS_PER_REPORT_CHUNK rows per key
 * socket_list1=co2|…|…
 * ```
 *
 * A log message is serialised into a fixed buffer, which is why the table
 * travels in chunks rather than as one value. Entry *n* of chunk *k* is the
 * socket in slot `k * SOCKETS_PER_REPORT_CHUNK + n`, and that slot is what a
 * command addresses.
 *
 * Deliberately free of imports: the simulator runs from a checkout with no
 * `npm install` behind it, and reads the compiled form of this file directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.socketChunkCount = exports.socketListChunk = exports.socketListKey = exports.SOCKETS_PER_REPORT_CHUNK = exports.SOCKET_HOST_TYPES = exports.TIMED_SOCKET_ROLES = exports.SOCKET_HOLD_MAX_SECONDS = exports.SOCKET_CREDENTIAL_MAX_LEN = exports.SOCKET_ADDRESS_MAX_LEN = exports.MAX_SOCKETS = void 0;
/** A device drives at most this many sockets, spread over the roles as it likes (`wifi.h`). */
exports.MAX_SOCKETS = 32;
/**
 * The address a row may carry (`wifi.cpp`). Three rows have to fit one log
 * message and the address is the only column without a length of its own, so a
 * longer one is refused by `socket_set` rather than stored and then left out of
 * the table.
 */
exports.SOCKET_ADDRESS_MAX_LEN = 40;
/** A socket's own web credentials, each bounded so the whole command fits the device's parse buffer. */
exports.SOCKET_CREDENTIAL_MAX_LEN = 48;
/**
 * The longest an override may hold, and the longest a timer's period may be
 * (`wifi.cpp`). It is a day: the override lives in the device's RAM and dies
 * with a reboot, so nothing outside the firmware holds a socket for longer.
 */
exports.SOCKET_HOLD_MAX_SECONDS = 86400;
/**
 * The roles whose socket follows a timer and nothing else. Every other role is
 * driven by the control loop, so a timer sent with one is stored and never
 * consulted - which is why it is refused rather than sent.
 */
exports.TIMED_SOCKET_ROLES = ['pump', 'custom_timer'];
/**
 * The device types whose firmware carries a smart-socket table (`wifi.cpp`'s
 * auxiliary commands, which only the controller and the fridge wire up). The
 * same builds relay a still from a paired camera and hold their own light
 * output on command; a plug, a fan and a light have none of it in any build, so
 * what they have not announced is not something a newer build would bring.
 */
exports.SOCKET_HOST_TYPES = ['controller', 'fridge'];
/** Sockets per `socket_list<k>` chunk; it has to match what the firmware sends (`wifi.cpp`). */
exports.SOCKETS_PER_REPORT_CHUNK = 3;
const socketListKey = (chunk) => `socket_list${chunk}`;
exports.socketListKey = socketListKey;
/** The chunk a `socket_list<k>` key carries, or null for any other key. */
const socketListChunk = (key) => {
    const match = /^socket_list(\d+)$/.exec(key);
    return match ? Number(match[1]) : null;
};
exports.socketListChunk = socketListChunk;
/** How many chunks a table of `count` sockets is reported in. */
const socketChunkCount = (count) => Math.ceil(Math.max(count, 0) / exports.SOCKETS_PER_REPORT_CHUNK);
exports.socketChunkCount = socketChunkCount;
