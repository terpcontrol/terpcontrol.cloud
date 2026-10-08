"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RELEASE_CHANNELS = void 0;
/**
 * The channels a class hands a build out on, which the rollout sweeps and the
 * admin screens state. `manual` is the absence of one and is never swept, so it
 * is not here.
 */
exports.RELEASE_CHANNELS = ['stable', 'beta', 'alpha'];
