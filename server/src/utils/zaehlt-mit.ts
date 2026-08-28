import { Ding } from '@fg2/shared-types';

/**
 * Two different things mean "this row exists but must not count".
 *
 * `storniert_von` is a correction: the value was wrong and a later Ding
 * replaces it. `d.dublette_von` is a duplicate: two members logged the same
 * pour from two phones, and only one of them happened.
 *
 * They are easy to forget because they do not look alike - one is a top-level
 * indexable field, the other is nested inside the schemaless `d` and exists
 * only on a `gabe`. A total that remembers one and not the other is silently
 * wrong: a cancelled 6 l, a duplicated 6 l and a real 4 l add up to 16 l for
 * anyone who forgets, and to 4 l for anyone who does not.
 *
 * So neither is checked by hand anywhere. Every total, every chart lane and
 * every export goes through this.
 */
export function zaehltMit(ding: Pick<Ding, 'storniert_von' | 'd'>): boolean {
  if (ding.storniert_von) {
    return false;
  }
  return !ding.d || ding.d['dublette_von'] === undefined || ding.d['dublette_von'] === null;
}

/**
 * The same rule as a query fragment, for the reads that must not pull the
 * excluded rows back in the first place. Spread it into a filter:
 * `find({ zelt_id, ...NUR_ZAEHLENDE })`.
 *
 * A row is still *shown* in the diary - a member has to be able to see that
 * their correction landed - so this belongs to totals, not to listings.
 */
export const NUR_ZAEHLENDE = {
  storniert_von: { $in: [null, undefined] },
  'd.dublette_von': { $in: [null, undefined] },
};
