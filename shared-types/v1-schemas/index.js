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
// the server and the simulator both decode a device's socket report with, and
// the arithmetic the feed sheet and the entry writer both read a grid with.
__exportStar(require("./socket-report.js"), exports);
__exportStar(require("./feeding.js"), exports);
__exportStar(require("./climate-presets.js"), exports);
__exportStar(require("./alert-routing.js"), exports);
