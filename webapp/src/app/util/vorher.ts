import type { Ding, Zelt } from '@fg2/shared-types';
import { Text, istEintrag } from './ding-text';
import { Messung } from './messquellen';
import { Griffart, besuchDetents, griffart, kapitelDetents, kettenDetents } from './vergleich';

/**
 * §7.4 - a diff needs a *Vorher* and day one has none, and „the answer is not
 * an empty state; it is **a different comparand in the same frame**."
 */
export type VorherSpalte = 'vorher' | 'ziel' | 'plan' | 'beginn';

export interface VorherLage {
  von: number;
  spalte: VorherSpalte;
  /** Which half of §8.1's rule answered: a state diffs against a moment, a moment against its predecessor. */
  griffart: Griffart;
  /** True when the moment asked for was not the moment answered with. */
  verschoben: boolean;
  /** The mini-cap over the left picture: `VORHER` · `ZIEL` · `PLAN` · `BEGINN`. */
  kappe: Text;
}

export interface VorherEingabe {
  zelt: Zelt;
  dinge: readonly Ding[];
  /** The Ding the screen is about. `null` - or a `zelt` - is the tent itself. */
  subjekt: Ding | null;
  /** Where the one cursor stands (§3.5). What it *means* is what this resolves. */
  cursor: number;
  messungen?: readonly Messung[];
  jetzt: number;
}

const lebend = (dinge: readonly Ding[]): Ding[] => dinge.filter(ding => !ding.storniert_von);

/** Whether anything at all was recorded at or before a moment - an entry or a reading. */
const evidenzBis = (eingabe: VorherEingabe, t: number): boolean =>
  lebend(eingabe.dinge).some(ding => istEintrag(ding) && ding.t <= t) ||
  (eingabe.messungen ?? []).some(messung => messung.t <= t);

/** Whether a device ever reported into this tent - a binding, or a `geraet` row. */
const hatGeraet = (eingabe: VorherEingabe): boolean =>
  (eingabe.zelt?.geraete?.length ?? 0) > 0 || lebend(eingabe.dinge).some(ding => ding.art === 'geraet');

const hatSchema = (eingabe: VorherEingabe): boolean =>
  Boolean(eingabe.zelt?.d?.schema_id) || lebend(eingabe.dinge).some(ding => ding.art === 'schema');

/**
 * §7.4's three comparands, in order of what exists: the setpoints when a device
 * was claimed, the schema's current step when one was chosen, the tent's own
 * beginning when neither. There is no fourth and there is no empty state.
 */
const ohneVorher = (eingabe: VorherEingabe, von: number): VorherLage => {
  const spalte: VorherSpalte = hatGeraet(eingabe) ? 'ziel' : hatSchema(eingabe) ? 'plan' : 'beginn';
  return { von: von, spalte: spalte, griffart: griffart(eingabe.subjekt?.art), verschoben: false, kappe: kappeVon(spalte) };
};

const kappeVon = (spalte: VorherSpalte): Text => ({ key: `zelt.kappe.${spalte}` });

const lage = (von: number, art: Griffart, verschoben: boolean): VorherLage => ({
  von: von,
  spalte: 'vorher',
  griffart: art,
  verschoben: verschoben,
  kappe: kappeVon('vorher'),
});

/**
 * What `Vorher` means for this Subjekt, at this cursor. §8.1, and the only rule
 * there is:
 *
 * > **A Ding that has a state diffs against a moment. A Ding that is a moment
 * > diffs against its predecessor.**
 *
 * So the tent, a plant, a socket, a target and a schema all take the cursor
 * itself - one cursor, one meaning, whichever Tafel is open. A Gabe, a Notiz, a
 * photograph, an event and a phase take the newest predecessor at or before the
 * cursor instead, which is why dragging the handle on a Gabe walks its chain
 * rather than sliding it through a history it is not part of.
 *
 * A person diffs against their own previous visit and a film against its own
 * frames - the same rule reached through something other than their own art.
 *
 * With nothing on the far side, §7.4 takes over: the column becomes `ZIEL`,
 * `PLAN` or `BEGINN` and the frame does not change shape.
 */
export const vorherLage = (eingabe: VorherEingabe): VorherLage => {
  const art = griffart(eingabe.subjekt?.art);
  const subjekt = eingabe.subjekt;

  if (art === 'moment' || !subjekt) {
    // The cursor may sit before the tent's first evidence - the mixed Zelt does
    // it constantly (§6.3). That is not an error and not an empty state; it is
    // day one's comparand, arrived at from the other direction.
    return evidenzBis(eingabe, eingabe.cursor) ? lage(eingabe.cursor, art, false) : ohneVorher(eingabe, eingabe.cursor);
  }

  const kette =
    art === 'kette'
      ? kettenDetents(subjekt, eingabe.dinge)
      : art === 'besuch'
      ? besuchDetents(subjekt, eingabe.dinge, subjekt.t)
      : kapitelDetents(subjekt, eingabe.dinge);

  if (kette.length === 0) return ohneVorher(eingabe, subjekt.t);

  // The handle still decides *which* predecessor, so a chain honours the one
  // cursor rather than owning a second one. Past the oldest link it stops at
  // the oldest link: there is nothing further back to be at.
  const gewaehlt = [...kette].reverse().find(detent => detent.von <= eingabe.cursor) ?? kette[0];
  return lage(gewaehlt.von, art, gewaehlt.von !== eingabe.cursor);
};

/**
 * §9.2 - „8a and 8c both **move the Vorher half to the last moment that has
 * evidence**, so the screen shows you something rather than reporting an
 * absence. That is the third option all four documents said they could not
 * find."
 *
 * It is applied by the sentence rather than by the cursor: the cursor stays
 * where the reader put it, and only what the left half is drawn from moves.
 */
export const vorherVerschoben = (lageJetzt: VorherLage, von: number): VorherLage =>
  von === lageJetzt.von ? lageJetzt : { ...lageJetzt, von: von, spalte: 'vorher', verschoben: true, kappe: kappeVon('vorher') };
