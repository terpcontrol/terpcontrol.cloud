"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
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
__exportStar(require("./common.js"), exports);
__exportStar(require("./accounts.js"), exports);
__exportStar(require("./devices.js"), exports);
__exportStar(require("./growing.js"), exports);
__exportStar(require("./diary.js"), exports);
// No schema, so nothing of it reaches `v1.d.ts` or the API document: constants
// the server and the simulator both decode a device's socket report with, the
// arithmetic the feed sheet and the entry writer both read a grid with, the days
// and weeks a stage covers that the phase bar, the week cards and the report's
// chapters all state, the curve the charts and the targets screen both work a
// VPD out along, and the span the alarm engine holds a worked-on device's alarms
// for that the screens offering a maintenance window have to promise. And the
// settings beyond the targets a device's type offers, which the server checks a
// change against and the screens draw their controls from. And day and night as
// the firmware keeps them, which the server judges by, the screens draw and the
// simulator runs. And how long one read of a camera may take, which the poller
// keeps and the test button promises, and the kinds of failure it is named as.
// And the clock on a plan's step, which the engine walks the plan by and the
// screens say its next pass from.
__exportStar(require("./socket-report.js"), exports);
__exportStar(require("./feeding.js"), exports);
__exportStar(require("./grow-days.js"), exports);
__exportStar(require("./climate-presets.js"), exports);
__exportStar(require("./alert-routing.js"), exports);
__exportStar(require("./vpd.js"), exports);
__exportStar(require("./maintenance.js"), exports);
__exportStar(require("./configuration-fields.js"), exports);
__exportStar(require("./day-night.js"), exports);
__exportStar(require("./capture.js"), exports);
__exportStar(require("./plan-clock.js"), exports);
// Also without a schema: how old a value is, which the server answers and the
// screens age further; which readings a controller steers and how far from a
// target still counts as on it; the largest page any list answers; and how long
// before its year runs out a camera's renewal is offered.
__exportStar(require("./value-age.js"), exports);
__exportStar(require("./steering.js"), exports);
__exportStar(require("./pages.js"), exports);
__exportStar(require("./entitlement.js"), exports);
