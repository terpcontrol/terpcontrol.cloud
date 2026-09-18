/**
 * The `/v1` wire contract, assembled.
 *
 * Nothing is defined here: this is the one module `scripts/generate.mjs`
 * compiles and imports, so that `v1.d.ts` and `openapi-schemas.json` are
 * generated from one registry holding every schema of the contract. A domain
 * file that nothing here re-exports would silently be left out of both.
 *
 * `registry` and the `named` helper come with `./common.js`.
 */
export * from './common.js';
export * from './accounts.js';
export * from './devices.js';
export * from './growing.js';
export * from './diary.js';

// No schema, so nothing of it reaches `v1.d.ts` or the API document: constants
// the server and the simulator both decode a device's socket report with.
export * from './socket-report.js';
