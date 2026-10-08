import { Metric } from '@fg2/shared-types/v1';
import { DAY_ONLY, STEERED } from '@fg2/shared-types/v1-schemas';

/** The metrics aimed at in one half of the cycle: all of them by day, and the rest of them at night. */
export const steeredIn = (half: 'day' | 'night'): readonly Metric[] => (half === 'day' ? STEERED : STEERED.filter(name => !DAY_ONLY.includes(name)));
