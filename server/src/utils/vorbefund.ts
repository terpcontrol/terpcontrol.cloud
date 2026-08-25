import { createHash } from 'crypto';
import { Ding } from '@fg2/shared-types';

const TAG = 24 * 60 * 60 * 1000;

/**
 * §14.6: what the diary held in the moment before a device joined it.
 *
 * These are the numbers the upgrade screen prints, so they are not decoration.
 * The fear at that moment is „habe ich jetzt zwei Tagebücher", and the answer is
 * a count the user can check against what they remember - which only works if
 * the count is the tent's own and was taken before the write, never rendered
 * from what the tent looks like afterwards.
 */
export interface Vorbefund {
  tage: number;
  dinge: number;
  fotos: number;
  gaben: number;
  wasser_l: number;
  tag_null: number;
  /** sha256 over the sorted `ding_id`s: what says the diary is the same one after the claim. */
  hash: string;
}

/** Day 1 is the day of `tag_null`, which is what every Tafel prints and what §14.4 asserts is unchanged. */
const tage = (tag_null: number, bis: number): number => Math.max(1, Math.floor((bis - tag_null) / TAG) + 1);

/** Litres are typed as decimals, and a sum of them must not print as 18.499999999999996. */
const liter = (summe: number): number => Math.round(summe * 1000) / 1000;

/**
 * The snapshot of a diary, out of the rows themselves rather than out of a
 * count query, so the hash and the counts cannot describe two different reads.
 */
export const vorbefund = (dinge: Ding[], fotos: number, tag_null: number, bis: number): Vorbefund => {
  const gaben = dinge.filter(ding => ding.art === 'gabe');
  const wasser = gaben.reduce((summe, gabe) => {
    const menge = (gabe.d as { wasser_l?: unknown } | undefined)?.wasser_l;
    return typeof menge === 'number' && Number.isFinite(menge) ? summe + menge : summe;
  }, 0);

  return {
    tage: tage(tag_null, bis),
    dinge: dinge.length,
    fotos: fotos,
    gaben: gaben.length,
    wasser_l: liter(wasser),
    tag_null: tag_null,
    hash: createHash('sha256')
      .update(
        dinge
          .map(ding => ding.ding_id)
          .sort()
          .join('\n'),
      )
      .digest('hex'),
  };
};
