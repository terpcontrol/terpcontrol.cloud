/**
 * The two keys that reach a Zelt without an account, kept as plain interfaces so
 * the guards and the tests can name them without importing a mongoose model.
 *
 * Neither stores its token. A token is a random 128 bit string, so a hash of it
 * is looked up as fast as the token would be and a leaked database hands out
 * nothing that still works.
 */

/** The per-Zelt read key (§13.7), offered as `Zugangsschlüssel` next to the export. One per Zelt, printed once. */
export interface Zugangsschluessel {
  zelt_id: string;
  hash: string;
  erstellt_at: number;
  zuletzt_at?: number;
}

/**
 * The club write key (§13.5). It *is* the person: `akteur` is taken from
 * `mensch_ding_id`, never from a request body, which is what fixes
 * mis-attribution on the shared tent phone by construction.
 *
 * What a key may write is not stored here. It is `SCHLUESSEL_ARTEN` in the
 * contract, the same fixed set for every key, and a per-row copy could only
 * ever drift away from it or be widened by a bad write.
 */
export interface Schluessel {
  schluessel_id: string;
  zelt_id: string;
  mensch_ding_id: string;
  hash: string;
  erstellt_at: number;
  widerrufen_at?: number | null;
  zuletzt_at?: number;
}
