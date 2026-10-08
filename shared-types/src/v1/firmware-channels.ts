/**
 * The channels a class hands a build out on, which the rollout sweeps and the
 * admin screens state. `manual` is the absence of one and is never swept, so it
 * is not here.
 */
export const RELEASE_CHANNELS = ['stable', 'beta', 'alpha'] as const;
