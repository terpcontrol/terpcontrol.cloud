import { DateTime } from 'luxon';
import type { Ding, Zelt } from '@fg2/shared-types';

/**
 * Where the day counter starts: the open run if the tent has one, `tag_null`
 * otherwise. §3.2 - a `lauf` is closed by stamping `t_ende`, so exactly one per
 * tent has an explicit `null` there, and a tent that has never had a run
 * recorded still counts from the day a human typed on the create sheet.
 */
export const laufBeginn = (zelt: Zelt, dinge: readonly Ding[]): number => {
  const offen = dinge.filter(ding => ding.art === 'lauf' && ding.t_ende === null && !ding.storniert_von);
  return offen.length > 0 ? Math.max(...offen.map(ding => ding.t)) : zelt.tag_null;
};

/**
 * `Tag 34`. Whole days between two calendar days *in the tent's own zone* - not
 * a division of milliseconds, which would put the boundary wherever the reader
 * happens to be standing and slip by an hour twice a year.
 */
export const tagNummer = (zeitzone: string, beginn: number, jetzt: number): number => {
  const zone = DateTime.fromMillis(beginn, { zone: zeitzone }).isValid ? zeitzone : 'UTC';
  const ersterTag = DateTime.fromMillis(beginn, { zone: zone }).startOf('day');
  const heute = DateTime.fromMillis(jetzt, { zone: zone }).startOf('day');
  return Math.floor(heute.diff(ersterTag, 'days').days) + 1;
};

/** The day number of the tent right now, run-aware. */
export const zeltTag = (zelt: Zelt, dinge: readonly Ding[], jetzt: number): number =>
  tagNummer(zelt.zeitzone, laufBeginn(zelt, dinge), jetzt);
