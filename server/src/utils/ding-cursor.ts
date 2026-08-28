import { Ding } from '@fg2/shared-types';

/** Where a page stopped. Both halves are needed; see `vergleicheDinge`. */
export interface DingCursor {
  t: number;
  ding_id: string;
}

/**
 * Newest first, and `ding_id` descending inside one moment.
 *
 * `t` alone is not unique - six Gaben typed in one sitting share a millisecond,
 * and a back-dated entry lands on a rounded midnight next to every other one -
 * so a sort keyed on `t` alone is not a total order, and a cursor built from it
 * either skips rows or repeats them. The second key is what makes the order
 * total, and therefore the paging exact.
 *
 * Byte order, not `localeCompare`: half of a page comes out of MongoDB, which
 * compares strings by bytes, and the two halves have to be merged under one
 * order or the merge reintroduces exactly the ambiguity this removes.
 */
export const vergleicheDinge = (a: Ding, b: Ding): number => {
  if (a.t !== b.t) return b.t - a.t;
  if (a.ding_id === b.ding_id) return 0;
  return a.ding_id > b.ding_id ? -1 : 1;
};

/** True for a Ding that sorts strictly after the cursor, i.e. belongs on a later page. */
export const nachCursor = (ding: Ding, cursor: DingCursor | null): boolean =>
  !cursor || ding.t < cursor.t || (ding.t === cursor.t && ding.ding_id < cursor.ding_id);

/**
 * Opaque on purpose. It carries the sort key and nothing else, so a client that
 * takes it apart and rebuilds it has invented an API the server never promised.
 */
export const kodiereCursor = (ding: Ding): string => Buffer.from(`${ding.t}:${ding.ding_id}`, 'utf8').toString('base64url');

/** Null for anything this server did not hand out, so a caller can answer 400 rather than page from nowhere. */
export const dekodiereCursor = (roh: string): DingCursor | null => {
  const klartext = Buffer.from(roh, 'base64url').toString('utf8');
  const trenner = klartext.indexOf(':');
  if (trenner < 1) return null;

  const t = Number(klartext.slice(0, trenner));
  const ding_id = klartext.slice(trenner + 1);
  if (!Number.isSafeInteger(t) || ding_id === '') return null;

  return { t: t, ding_id: ding_id };
};
