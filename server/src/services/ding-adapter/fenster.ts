import { Ding, GeraetBindung, Zelt } from '@fg2/shared-types';

/**
 * What every projection is asked: this tent, this stretch of time. Both bounds
 * are epoch ms and both are inclusive.
 */
export interface DingFenster {
  zelt: Zelt;
  von: number;
  bis: number;
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
 * Newest first, and a stable order within a moment so two identical requests
 * cannot page differently.
 */
export const nachZeitAbsteigend = (dinge: Ding[]): Ding[] => dinge.sort((a, b) => b.t - a.t || a.ding_id.localeCompare(b.ding_id));
