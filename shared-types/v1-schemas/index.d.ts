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
export * from './socket-report.js';
export * from './feeding.js';
export * from './grow-days.js';
export * from './climate-presets.js';
export * from './alert-routing.js';
export * from './vpd.js';
export * from './maintenance.js';
export * from './configuration-fields.js';
export * from './day-night.js';
export * from './capture.js';
export * from './plan-clock.js';
export * from './value-age.js';
export * from './steering.js';
export * from './pages.js';
export * from './entitlement.js';
export * from './firmware-channels.js';
