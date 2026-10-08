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

// No schema, so nothing of these reaches `v1.d.ts` or the API document: the
// figures and the arithmetic the server, the screens and the simulator have to
// agree on.
export * from './socket-report.js'; // how a device's socket report is decoded
export * from './feeding.js'; // the doses a feeding grid makes on a day of a grow
export * from './grow-days.js'; // the days and weeks a stage covers
export * from './climate-presets.js'; // the figures each growth stage asks of a tent
export * from './alert-routing.js'; // which row of the routing grid an alarm falls in
export * from './vpd.js'; // the curve a VPD is worked out along
export * from './maintenance.js'; // how long after a maintenance window alarms stay held
export * from './configuration-fields.js'; // the settings beyond the targets a device's type offers
export * from './day-night.js'; // day and night as the firmware keeps them
export * from './capture.js'; // how long one read of a camera may take, and how a failed one is named
export * from './plan-clock.js'; // the clock on a plan's step
export * from './value-age.js'; // how old a value is
export * from './steering.js'; // which readings a controller steers, and how far off still counts as on target
export * from './pages.js'; // the largest page any list answers
export * from './entitlement.js'; // when a camera's renewal is offered
export * from './firmware-channels.js'; // the channels a build is handed out on
