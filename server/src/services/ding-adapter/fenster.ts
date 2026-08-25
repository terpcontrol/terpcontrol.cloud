import { Ding, GeraetBindung, Zelt } from '@fg2/shared-types';
import { DingCursor, nachCursor, vergleicheDinge } from '@utils/ding-cursor';

/**
 * What every projection is asked: this tent, this stretch of time, and how much
 * of it. Both bounds are epoch ms and both are inclusive.
 *
 * `limit` and `cursor` are what keep a year-wide window from being read into
 * memory before it is sorted (§3.4: paging is mandatory from day one). They are
 * optional only so that a caller which genuinely wants everything - a migration,
 * an export - can say so; a request coming out of the API always carries both.
 */
export interface DingFenster {
  zelt: Zelt;
  von: number;
  bis: number;
  /** How many Dinge the page holds. Every adapter reads one more, so the caller can tell a full page from the last one. */
  limit?: number;
  /** Where the previous page stopped. Both halves matter - see `@utils/ding-cursor`. */
  cursor?: DingCursor | null;
}

/**
 * A read-time projection of one art. The signature is deliberately the same for
 * all nine, and deliberately the same shape a stored art comes back in, because
 * the caller merging the two lists must not be able to tell them apart.
 */
export type DingAdapter = (fenster: DingFenster) => Promise<Ding[]>;

/**
 * For things that last - a tent, a binding, a socket, a target - the question
 * is overlap, not containment: a device bound a year ago is still in the tent
 * today. `t_ende` null or absent means it has not ended.
 */
export const ueberschneidet = (fenster: DingFenster, t: number, t_ende?: number | null): boolean =>
  t <= fenster.bis && (t_ende === undefined || t_ende === null || t_ende >= fenster.von);

/** The bindings whose lifetime touches the window. `geraete: []` yields none. */
export const bindungenImFenster = (fenster: DingFenster): GeraetBindung[] =>
  (fenster.zelt.geraete ?? []).filter(bindung => ueberschneidet(fenster, bindung.seit, bindung.bis ?? null));

/** The bindings that have not ended - what the device reports *now* describes only these. */
export const offeneBindungen = (fenster: DingFenster): GeraetBindung[] =>
  bindungenImFenster(fenster).filter(bindung => bindung.bis === undefined || bindung.bis === null);

/**
 * The window clipped to one binding. Device-keyed rows are only this tent's
 * while the device was in it: a second-hand controller carries the previous
 * owner's history, and §14.3 forbids it from ever reaching this tent's diary.
 */
export const bindungsFenster = (fenster: DingFenster, bindung: GeraetBindung): { von: number; bis: number } => ({
  von: Math.max(fenster.von, bindung.seit),
  bis: bindung.bis === undefined || bindung.bis === null ? fenster.bis : Math.min(fenster.bis, bindung.bis),
});

/**
 * The window a `t`-ordered query may actually read. Everything above the cursor
 * sits on a page that has already been handed out, and asking for it again is
 * the whole of what makes a year-wide read expensive.
 *
 * The bound stays inclusive: the rows sharing the cursor's moment are not all
 * on the previous page, and `nachCursor` is what separates the two halves.
 */
export const bisCursor = (fenster: DingFenster): DingFenster =>
  fenster.cursor && fenster.cursor.t < fenster.bis ? { ...fenster, bis: fenster.cursor.t } : fenster;

/**
 * Newest first, and a stable order within a moment so two identical requests
 * cannot page differently. The order itself lives in `@utils/ding-cursor`,
 * because the stored half of a page is sorted by mongo under the same rule and
 * two spellings of one order is exactly how a cursor starts losing rows.
 */
export const nachZeitAbsteigend = (dinge: Ding[]): Ding[] => dinge.sort(vergleicheDinge);

/**
 * One page out of what an adapter built in memory: sorted, cut off after the
 * cursor, and one row longer than the page - that row is what says another page
 * follows, and it costs nothing to carry.
 */
export const begrenze = (fenster: DingFenster, dinge: Ding[]): Ding[] => {
  const gefiltert = nachZeitAbsteigend(dinge.filter(ding => nachCursor(ding, fenster.cursor ?? null)));

  return fenster.limit === undefined ? gefiltert : gefiltert.slice(0, fenster.limit + 1);
};

/**
 * The same page out of a database query. `lade` runs the query with the row
 * count it is given - `undefined` for "no limit" - and maps the rows to Dinge;
 * they must come back newest first, because everything below trusts that order.
 *
 * A query can only be cut off and ordered by `t`: a projected `ding_id` is
 * derived from the row, and no index sorts by it. So the rows sharing the last
 * moment the query reached are not a complete set - more of them may still be
 * in the collection - and none of them can be placed in the total order yet.
 * Only the rows *above* that moment are settled, which is why the page is cut
 * from those, and why the query asks for two rows more than the page: with
 * distinct moments that already settles the page in one round.
 *
 * When it does not - a moment shared by more entries than the page holds, which
 * is what a back-dated evening of typing or a migration produces - the query is
 * repeated with room for the whole tie. Reading the moment out completely is
 * the only thing that can order it, and it is bounded by the tie itself.
 */
export const begrenzeAbfrage = async (fenster: DingFenster, lade: (grenze?: number) => Promise<Ding[]>): Promise<Ding[]> => {
  const cursor = fenster.cursor ?? null;
  if (fenster.limit === undefined) {
    return nachZeitAbsteigend((await lade()).filter(ding => nachCursor(ding, cursor)));
  }

  const seitenlaenge = fenster.limit + 1;
  for (let angefragt = seitenlaenge + 1; ; angefragt *= 2) {
    const roh = await lade(angefragt);
    const seite = nachZeitAbsteigend(roh.filter(ding => nachCursor(ding, cursor)));
    if (roh.length < angefragt) {
      return seite.slice(0, seitenlaenge);
    }

    const letzteT = roh.reduce((frueheste, ding) => Math.min(frueheste, ding.t), Infinity);
    const geordnet = seite.filter(ding => ding.t > letzteT);
    if (geordnet.length >= seitenlaenge) {
      return geordnet.slice(0, seitenlaenge);
    }
  }
};
