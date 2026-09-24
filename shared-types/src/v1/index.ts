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
// the server and the simulator both decode a device's socket report with, the
// arithmetic the feed sheet and the entry writer both read a grid with, the days
// and weeks a stage covers that the phase bar, the week cards and the report's
// chapters all state, the curve the charts and the targets screen both work a
// VPD out along, and the span the alarm engine holds a worked-on device's alarms
// for that the screens offering a maintenance window have to promise.
export * from './socket-report.js';
export * from './feeding.js';
export * from './grow-days.js';
export * from './climate-presets.js';
export * from './alert-routing.js';
export * from './vpd.js';
export * from './maintenance.js';
