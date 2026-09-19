"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALUE_AGE = void 0;
/**
 * The one place the ages of a value are stated. The server decides `valueState`
 * from these and its own clock, so no client works out the state of a value.
 *
 * A device's own liveness is in no answer - `lastSeenAt` is the raw instant -
 * so the screens that draw a device rather than a reading judge it by these
 * same seconds. That is why this is a module of its own rather than a line in
 * `common.ts`: it carries no schema, so a client can import it without pulling
 * zod and the whole contract into its bundle.
 */
exports.VALUE_AGE = { liveSeconds: 120, staleSeconds: 600 };
