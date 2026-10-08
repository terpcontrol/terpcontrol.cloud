import type { Co2Cylinder, Co2Report } from '@fg2/shared-types/v1';

/**
 * What the CO2 cylinders of a place lasted, worked out from the refills
 * somebody wrote down and the valve openings the devices counted in between.
 *
 * A refill is a diary line carrying the weight of the new cylinder
 * (`co2FillingInitial`) and, where it was weighed, what was left in the old one
 * (`co2FillingRest`) - the two measurements the old app's refill sheet wrote,
 * which the migration kept under the same keys. Nothing here touches a store,
 * so the arithmetic can be read and tested on its own.
 */

export const REFILL_READINGS = ['co2FillingInitial', 'co2FillingRest'] as const;

/** What a cylinder is taken to hold where its weight was not written down: the usual 425 g soda cylinder, as the old report assumed. */
export const USUAL_FILL_GRAMS = 425;

interface Refill {
  at: Date;
  filledGrams: number | null;
  restGrams: number | null;
}

interface StoredReading {
  key?: unknown;
  value?: unknown;
}

const readingOf = (values: unknown, key: string): number | null => {
  const readings = (values as { readings?: StoredReading[] } | null)?.readings ?? [];
  const value = readings.find(reading => reading.key === key)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** The refills among a place's entries, oldest first: every line that carries either weight. */
export const refillsOf = (entries: readonly { occurredAt: Date; values: unknown }[]): Refill[] =>
  entries
    .map(entry => ({
      at: entry.occurredAt,
      filledGrams: readingOf(entry.values, 'co2FillingInitial'),
      restGrams: readingOf(entry.values, 'co2FillingRest'),
    }))
    .filter(refill => refill.filledGrams !== null || refill.restGrams !== null)
    .sort((one, other) => one.at.getTime() - other.at.getTime());

/** A cylinder before its openings are counted. */
type CylinderSpan = Omit<Co2Cylinder, 'since' | 'until' | 'openings' | 'openingsPerGram'> & { since: Date; until: Date | null };

/**
 * One cylinder per refill, in until the next one. A cylinder taken out without
 * its rest written down is taken to have run empty, which is why it was
 * changed - the old report's reading of the same lines.
 */
export const cylindersOf = (refills: readonly Refill[]): CylinderSpan[] =>
  refills.map((refill, index) => {
    const next = refills[index + 1] ?? null;
    return {
      since: refill.at,
      until: next?.at ?? null,
      filledGrams: refill.filledGrams ?? USUAL_FILL_GRAMS,
      restGrams: next ? Math.max(0, next.restGrams ?? 0) : null,
    };
  });

/**
 * The report, from the cylinders with the openings each saw.
 *
 * A finished cylinder's rate is its openings over the grams it gave. The rate
 * the cylinder in use is judged by is the one over every finished cylinder
 * together rather than an average of their rates, so a cylinder that gave
 * little does not weigh as much as one that gave all it had.
 */
export const reportOf = (cylinders: readonly (CylinderSpan & { openings: number })[]): Co2Report => {
  const used = (cylinder: CylinderSpan) => (cylinder.restGrams === null ? 0 : cylinder.filledGrams - cylinder.restGrams);
  const finished = cylinders.filter(cylinder => cylinder.until !== null && used(cylinder) > 0);
  const grams = finished.reduce((sum, cylinder) => sum + used(cylinder), 0);
  const openings = finished.reduce((sum, cylinder) => sum + cylinder.openings, 0);
  const rate = grams > 0 && openings > 0 ? openings / grams : null;
  const current = cylinders.find(cylinder => cylinder.until === null) ?? null;

  return {
    cylinders: [...cylinders].reverse().map(cylinder => ({
      since: cylinder.since.toISOString(),
      until: cylinder.until?.toISOString() ?? null,
      filledGrams: cylinder.filledGrams,
      restGrams: cylinder.restGrams,
      openings: cylinder.openings,
      openingsPerGram: cylinder.until !== null && used(cylinder) > 0 && cylinder.openings > 0 ? cylinder.openings / used(cylinder) : null,
    })),
    openingsPerGram: rate,
    restGrams: current && rate !== null ? Math.max(0, current.filledGrams - current.openings / rate) : null,
  };
};
