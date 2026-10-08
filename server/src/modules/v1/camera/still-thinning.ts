const MS_IN_A_DAY = 24 * 60 * 60 * 1000;

/**
 * How stills are thinned out as they age: once a picture is older than
 * `afterMs`, no more than one is kept per `minIntervalMs`. Ordered oldest
 * boundary last, so each tier only thins pictures younger than the next,
 * coarser one.
 */
export const THINNING_TIERS = [
  { afterMs: MS_IN_A_DAY, minIntervalMs: 60 * 1000 },
  { afterMs: 7 * MS_IN_A_DAY, minIntervalMs: 5 * 60 * 1000 },
  { afterMs: 30 * MS_IN_A_DAY, minIntervalMs: 15 * 60 * 1000 },
  { afterMs: 90 * MS_IN_A_DAY, minIntervalMs: 60 * 60 * 1000 },
] as const;

/** The least time thinning leaves between two kept stills of this age; none for a still younger than a day. */
export const thinnedSpacingAt = (ageMs: number): number =>
  THINNING_TIERS.reduce<number>((spacing, tier) => (ageMs >= tier.afterMs ? tier.minIntervalMs : spacing), 0);
