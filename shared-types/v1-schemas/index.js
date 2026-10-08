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
// No schema, so nothing of these reaches `v1.d.ts` or the API document: the
// figures and the arithmetic the server, the screens and the simulator have to
// agree on.
__exportStar(require("./socket-report.js"), exports); // how a device's socket report is decoded
__exportStar(require("./feeding.js"), exports); // the doses a feeding grid makes on a day of a grow
__exportStar(require("./grow-days.js"), exports); // the days and weeks a stage covers
__exportStar(require("./climate-presets.js"), exports); // the figures each growth stage asks of a tent
__exportStar(require("./alert-routing.js"), exports); // which row of the routing grid an alarm falls in
__exportStar(require("./vpd.js"), exports); // the curve a VPD is worked out along
__exportStar(require("./maintenance.js"), exports); // how long after a maintenance window alarms stay held
__exportStar(require("./configuration-fields.js"), exports); // the settings beyond the targets a device's type offers
__exportStar(require("./day-night.js"), exports); // day and night as the firmware keeps them
__exportStar(require("./capture.js"), exports); // how long one read of a camera may take, and how a failed one is named
__exportStar(require("./plan-clock.js"), exports); // the clock on a plan's step
__exportStar(require("./value-age.js"), exports); // how old a value is
__exportStar(require("./steering.js"), exports); // which readings a controller steers, and how far off still counts as on target
__exportStar(require("./pages.js"), exports); // the largest page any list answers
__exportStar(require("./entitlement.js"), exports); // when a camera's renewal is offered
__exportStar(require("./firmware-channels.js"), exports); // the channels a build is handed out on
