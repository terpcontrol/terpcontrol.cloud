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
/** A device drives at most this many sockets, spread over the roles as it likes (`wifi.h`). */
export declare const MAX_SOCKETS = 32;
/** Sockets per `socket_list<k>` chunk; it has to match what the firmware sends (`wifi.cpp`). */
export declare const SOCKETS_PER_REPORT_CHUNK = 3;
export declare const socketListKey: (chunk: number) => string;
/** The chunk a `socket_list<k>` key carries, or null for any other key. */
export declare const socketListChunk: (key: string) => number | null;
/** How many chunks a table of `count` sockets is reported in. */
export declare const socketChunkCount: (count: number) => number;
