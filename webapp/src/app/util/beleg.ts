import type { Ding, Zelt } from '@fg2/shared-types';
import { Text } from './ding-text';
import { einheitVon } from './einheiten';
import { Herkunft, Messung, messzeilen } from './messquellen';
import { STUNDE_MS, reihen } from './reihe';
import { handMessungen } from './unterschied';
import { pluralSchluessel, zahlText } from './zahl';
import { laufBeginn, tagNummer } from './zelt-tag';

/** §5. The five things a half of the picture pair can be drawn from, in ladder order. */
export type BelegArt = 'bild' | 'foto' | 'band' | 'karte' | 'nichts';

/** One stacked min/max of `das Werteband`. */
export interface BandWert {
  id: string;
  mass: string;
  herkunft: Herkunft;
  min: number;
  max: number;
}

export interface Beleg {
  art: BelegArt;
  /** The picture, when there is one. */
  image_id?: string;
  ding_id?: string;
  /** When the evidence is from, which is not the moment that was asked for. */
  t?: number;
  /**
   * The caption's third slot - `Kamerabild` · `Foto` · `Werte` · `Einträge` -
   * and §5 is explicit that it is **always printed**: „That one word is what
   * makes there be no mode: the screen always says what it is looking at."
   */
  kennung: Text;
  /** `'karte'`: die Standkarte, at most five lines. Empty for every other art. */
  text: Text[];
  /** `'band'`: das Werteband, 24 h min/max per measure. Empty for every other art. */
  band: BandWert[];
}

/** Rung 1: „a KEPT camera frame within ±5 min of t". */
export const BILD_FENSTER_MS = 5 * 60 * 1000;
/** Rung 2: „a user photo within ±12 h of t". */
export const FOTO_FENSTER_MS = 12 * STUNDE_MS;
/** Rung 3: „sensor samples in [t − 12 h, t]". */
export const BAND_FENSTER_MS = 12 * STUNDE_MS;
/** What das Werteband spans once rung 3 has decided it exists. */
export const BAND_SPANNE_MS = 24 * STUNDE_MS;
/** §5: „at most five lines". */
export const KARTE_ZEILEN = 5;
/** How many hand readings fit on the Standkarte's measurement line. */
const KARTE_MESSWERTE = 2;

export interface BelegEingabe {
  zelt: Zelt;
  dinge: readonly Ding[];
  /** Series readings, when something measured any. A tent with no device passes none. */
  messungen?: readonly Messung[];
  /**
   * Which half is asking. It changes exactly one thing: what the empty-state
   * mark is captioned with, because „noch kein Vorher" and „noch nichts
   * eingetragen" are different facts about the same emptiness.
   */
  halbe?: 'vorher' | 'jetzt';
}

const lebend = (dinge: readonly Ding[]): Ding[] => dinge.filter(ding => !ding.storniert_von);

const zahl = (roh: unknown): number | null => (typeof roh === 'number' && Number.isFinite(roh) ? roh : null);

const wort = (roh: unknown): string | null => (typeof roh === 'string' && roh !== '' ? roh : null);

/** The nearest picture of one kind to a moment, inside a window. */
const nahestes = (dinge: readonly Ding[], t: number, fenster: number, quelle: 'geraet' | 'hand'): Ding | null =>
  lebend(dinge)
    .filter(ding => ding.art === 'bild' && (wort(ding.d?.['quelle']) ?? 'geraet') === quelle)
    // A frame the cull threw away is never shown as evidence (§6.4,
    // `Bild verworfen`); the picture pair may only ever show a kept one.
    .filter(ding => ding.d?.['verworfen'] !== true)
    .filter(ding => Math.abs(ding.t - t) <= fenster)
    .reduce<Ding | null>(
      (bestes, ding) => (!bestes || Math.abs(ding.t - t) < Math.abs(bestes.t - t) ? ding : bestes),
      null,
    );

const bildAus = (ding: Ding): string | undefined => ding.bilder?.[0] ?? ding.auto_bild;

/**
 * §5 - **the** evidence ladder, and the reason there is no device-less
 * renderer.
 *
 * > one ordered function, evaluated **per half, per moment** - never per
 * > account, never per session, never per route.
 *
 * It is asked what a half of the picture pair is drawn from, at one moment, and
 * it answers with the first rung that has evidence. A tent with three
 * controllers and a tent with none walk the same five rungs and land on
 * different ones; neither is a fallback for the other, and there is no second
 * copy of this function anywhere.
 *
 * Ties go to the device frame, because rung 1 is above rung 2 and nothing else
 * decides it. Each half is resolved independently, so a mixed pair - a hand
 * photo on the left from before the claim, a camera frame on the right - needs
 * no code at all.
 */
export const beleg = (eingabe: BelegEingabe, t: number): Beleg => {
  const messungen = eingabe.messungen ?? [];

  const frame = nahestes(eingabe.dinge, t, BILD_FENSTER_MS, 'geraet');
  if (frame) {
    return leer('bild', { image_id: bildAus(frame), ding_id: frame.ding_id, t: frame.t });
  }

  const foto = nahestes(eingabe.dinge, t, FOTO_FENSTER_MS, 'hand');
  if (foto) {
    return leer('foto', { image_id: bildAus(foto), ding_id: foto.ding_id, t: foto.t });
  }

  const band = werteband(messungen, t);
  if (band.length > 0) return { ...leer('band', { t: t }), band: band };

  const karte = standkarte(eingabe.zelt, eingabe.dinge, t);
  if (karte.length > 0) return { ...leer('karte', { t: t }), text: karte };

  return leer('nichts', { t: t }, eingabe.halbe === 'vorher' ? 'keinVorher' : 'nochNichts');
};

/**
 * The captions of the empty-state mark. §5 lists six; the two below are the two
 * this function can honestly choose between, because the other four are facts
 * about a camera, a connection or a particular day that the caller knows and
 * this one does not.
 *
 * `Noch nichts passiert` is not among them at any density and must never be
 * added: things did happen, you just did not write them down, and the app does
 * not get to claim otherwise.
 */
export type NichtsGrund = 'keinVorher' | 'nochNichts' | 'keineKamera' | 'nichtsVerbunden' | 'keinFoto' | 'keineMesswerte';

const leer = (art: BelegArt, zusatz: Partial<Beleg>, grund?: NichtsGrund): Beleg => ({
  art: art,
  kennung: { key: art === 'nichts' ? `zelt.beleg.nichts.${grund ?? 'nochNichts'}` : `zelt.beleg.kennung.${art}` },
  text: [],
  band: [],
  ...zusatz,
});

/**
 * §5 - „**`'band'` is das Werteband** - 24 h min/max per measure, stacked. It is
 * what a tent with sensors and no camera shows, and it is unreachable
 * device-less because there is nothing to band."
 *
 * Unreachable is a consequence, not a check: hand readings never reach here
 * because they are not a series, and no branch says so.
 */
export const werteband = (messungen: readonly Messung[], t: number): BandWert[] => {
  const ausloeser = messungen.some(
    messung => messung.herkunft.quelle !== 'hand' && messung.t <= t && messung.t >= t - BAND_FENSTER_MS,
  );
  if (!ausloeser) return [];

  const band: BandWert[] = [];
  for (const reihe of reihen(messungen.filter(messung => messung.herkunft.quelle !== 'hand')).values()) {
    // An output is a state, not a measure: `out_light` has no min and max worth
    // stacking, and `Licht 0 … 100 %` would say nothing about the night.
    if (reihe.mass.startsWith('out_')) continue;

    const werte = reihe.punkte.filter(punkt => punkt.t <= t && punkt.t >= t - BAND_SPANNE_MS).map(punkt => punkt.wert);
    if (werte.length === 0) continue;

    band.push({ id: reihe.id, mass: reihe.mass, herkunft: reihe.herkunft, min: Math.min(...werte), max: Math.max(...werte) });
  }

  return band;
};

/**
 * §5 - „**`'karte'` is die Standkarte** - what was *true* at that moment, from
 * last-known-value carry-forward over stored Dinge, at most five lines".
 *
 * Which is the whole argument that hand entries are a real state and not a list
 * of anecdotes: the app can say what was true on a Tuesday in July because
 * somebody said so once, in June.
 */
export const standkarte = (zelt: Zelt, dinge: readonly Ding[], t: number): Text[] => {
  const bisher = lebend(dinge).filter(ding => ding.t <= t);
  const zeilen: Text[] = [];

  const phase = neustes(bisher, ding => ding.art === 'phase');
  const stufe = wort(phase?.d?.['stufe']);
  const tag = tagNummer(zelt?.zeitzone ?? 'UTC', laufBeginn(zelt, dinge), t);
  zeilen.push(
    stufe
      ? { key: 'zelt.beleg.karte.tagPhase', params: { tag: tag, stufe: { key: `zelt.stufe.${stufe}`, ersatz: stufe } } }
      : { key: 'zelt.tag', params: { tag: tag } },
  );

  const schema = neustes(bisher, ding => ding.art === 'schema');
  const schritt = zahl(schema?.d?.['schritt']);
  if (schema && schritt !== null) {
    zeilen.push({
      key: 'zelt.beleg.karte.schema',
      params: { name: schema.name?.trim() || { key: 'zelt.arten.schema' }, schritt: schritt },
    });
  }

  const wasser = bisher
    .filter(ding => ding.art === 'gabe')
    .reduce<number | null>((summe, ding) => (zahl(ding.d?.['wasser_l']) === null ? summe : (summe ?? 0) + (zahl(ding.d?.['wasser_l']) ?? 0)), null);
  if (wasser !== null) {
    zeilen.push({ key: 'zelt.beleg.karte.wasser', params: { liter: zahlText(wasser, 1) } });
  }

  const gemessen = messzeilen(handMessungen(bisher)).slice(0, KARTE_MESSWERTE);
  if (gemessen.length > 0) {
    zeilen.push({
      key: 'zelt.beleg.karte.messwerte',
      params: {
        werte: gemessen
          .map(zeile => ({
            key: 'zelt.beleg.karte.messwert',
            params: {
              mass: { key: `zelt.mass.${zeile.mass}`, ersatz: zeile.mass },
              wert: zahlText(zeile.wert),
              einheit: einheitVon(zeile.mass),
            },
          }))
          // Two readings on one line, joined the way the drawn card joins them.
          .reduce<Text>((links, rechts, index) =>
            index === 0 ? rechts : { key: 'zelt.beleg.karte.und', params: { links: links, rechts: rechts } },
          {} as Text),
      },
    });
  }

  const offen = bisher.filter(ding => ding.art === 'zustand' && ding.t_ende === null && !ding.d?.['geschlossen_von']).length;
  if (offen > 0) {
    zeilen.push({ key: pluralSchluessel('zelt.beleg.karte.zettel', offen), params: { anzahl: zahlText(offen, 0) } });
  }

  // A tent whose only line is its own day number has nothing to carry forward,
  // and a card that says only `Tag 1` is the empty-state mark with a number on
  // it. The ladder falls through to `'nichts'` instead.
  return zeilen.length > 1 ? zeilen.slice(0, KARTE_ZEILEN) : [];
};

const neustes = (dinge: readonly Ding[], passt: (ding: Ding) => boolean): Ding | null =>
  dinge.filter(passt).reduce<Ding | null>((bestes, ding) => (!bestes || ding.t > bestes.t ? ding : bestes), null);
