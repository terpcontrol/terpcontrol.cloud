import { Metric } from '@fg2/shared-types/v1';

/**
 * Which readings a controller aims at, and in which half of the cycle.
 *
 * Stated here because three screens judge it and they have to agree: the tent's
 * live card, the verdict over the last day, and the bands under the timeline's
 * curves. Each kept its own copy of these two lists, and the copies drifted -
 * at night the card called a tent's CO2 "in band" against a target the panel
 * two taps away said it did not have.
 */

/** The metrics a controller holds a target for, in the order a card draws them. */
export const STEERED: readonly Metric[] = ['temperature', 'humidity', 'co2'];

/**
 * The metrics whose target is a day target only. A controller raises CO2 while
 * the light is on and no further, so a dark tent falling back to fresh air is
 * the plants breathing and not a miss: the night has no band for it, and
 * nothing may be said to be in or out of one.
 */
export const DAY_ONLY: readonly Metric[] = ['co2'];

/** The metrics aimed at in one half of the cycle: all of them by day, and the rest of them at night. */
export const steeredIn = (half: 'day' | 'night'): readonly Metric[] => (half === 'day' ? STEERED : STEERED.filter(name => !DAY_ONLY.includes(name)));
