"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TARGET_BAND = exports.DAY_ONLY = exports.STEERED = void 0;
/**
 * Which readings a controller aims at, in which half of the cycle, and how far
 * from its target a reading still counts as on it.
 *
 * Stated here because every screen that judges a tent has to agree: the live
 * card, the verdict over the last day, the bands under the timeline's curves and
 * the cockpit's tiles. Each kept its own copy of these lists, and the copies
 * drifted - at night the card called a tent's CO2 "in band" against a target
 * the panel two taps away said it did not have. No schema, so a client imports
 * this module on its own without pulling zod in.
 */
/** The metrics a controller holds a target for, in the order a card draws them. */
exports.STEERED = ['temperature', 'humidity', 'co2'];
/**
 * The metrics whose target is a day target only. A controller raises CO2 while
 * the light is on and no further, so a dark tent falling back to fresh air is
 * the plants breathing and not a miss: the night has no band for it, and
 * nothing may be said to be in or out of one.
 */
exports.DAY_ONLY = ['co2'];
/**
 * How far either side of its target a reading still counts as on target: the
 * green band a chart draws, and what "in band" means in a verdict.
 *
 * It is one tolerance per metric rather than the controller's own hysteresis,
 * which differs per output, per hardware type and per firmware: a band read off
 * the control laws would mean something different on every device, and none of
 * them is what a grower means by "the humidity held". A metric that is not named
 * here is not steered and has no band.
 */
exports.TARGET_BAND = { temperature: 1, humidity: 5, co2: 200 };
