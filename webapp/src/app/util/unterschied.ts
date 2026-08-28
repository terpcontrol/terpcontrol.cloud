import type { Ding, Messwerte } from '@fg2/shared-types';
import { istEintrag } from './ding-text';
import { Herkunft, Messung, messzeilen } from './messquellen';
import { sigmaJeReihe } from './reihe';

/** Which band of the table a row belongs to. The band order is fixed; ranking only reorders inside one. §6.3. */
export type ZeilenGruppe = 'geraet' | 'hand' | 'ziel' | 'summe' | 'anzahl';

/**
 * The mark at the end of a row (§6.1): `▲` a change bigger than this row's
 * own noise, `◼` a change inside it, `○` no change at all.
 *
 * A row whose σ is **unknown** can never be `'ueber'`. That is the whole
 * point of the mark: it is a claim that something moved further than this
 * measure usually moves, and a measure nobody has read three times has not
 * earned that claim yet.
 */
export type ZeilenMarke = 'ueber' | 'ruhig' | 'gleich';

export interface UnterschiedZeile {
  id: string;
  gruppe: ZeilenGruppe;
  /** `temperatur`, `wasser_gesamt`, `eintraege` - what the label is looked up by. */
  mass: string;
  herkunft?: Herkunft;
  herkunftZeigen: boolean;
  /** A target sits under the measure it is a target for. */
  eingerueckt: boolean;
  vorher: number | null;
  jetzt: number | null;
  delta: number | null;
  richtung: 'hoch' | 'runter' | 'gleich';
  /** The series this row is a reading of, when it is one. `messzeilen` keys it. */
  reihe?: string;
  /** How far this measure usually moves on its own. `null` = not enough readings to say. */
  sigma: number | null;
  /** |Δ| in units of that noise - the number `ⓘ nach Abweichung` sorts on. */
  abweichung: number;
  marke: ZeilenMarke;
}

/**
 * Both halves are *cumulative*: everything up to the cursor, and everything up
 * to now. That is what makes `Wasser gesamt 12,5 → 16,5 l` a subtraction rather
 * than a comparison of two arbitrary windows.
 */
export interface UnterschiedEingabe {
  vorher: readonly Ding[];
  jetzt: readonly Ding[];
  /** Series readings, when a device produced any. A tent with no device passes none and loses no row it ever had. */
  messungenVorher?: readonly Messung[];
  messungenJetzt?: readonly Messung[];
  /** The right-hand moment. The σ window runs fourteen days back from it. */
  bis?: number;
  /** The tent's zone, because „same time of day“ is a claim about a wall clock. */
  zeitzone?: string;
}

/** §6.3: the mixed tent is the union of both row sets, and somebody had to count it. */
export const KAPPE = 11;

/** Which measure a setpoint is a setpoint *for*, so the row can sit under it. */
const ZIEL_ZU_MASS: Record<string, string> = {
  'day.temperature': 'temperatur',
  'night.temperature': 'temperatur',
  'day.humidity': 'luftfeuchte',
  'night.humidity': 'luftfeuchte',
  'day.vpd': 'vpd',
  'night.vpd': 'vpd',
  'day.co2': 'co2',
  'hand.ph': 'ph',
  'hand.ec': 'ec',
  'hand.hoehe_cm': 'hoehe_cm',
};

const HAND_MASSE: (keyof Messwerte)[] = [
  'temperatur',
  'luftfeuchte',
  'ph',
  'ec',
  'tds',
  'ppfd',
  'abstand_cm',
  'aussen_temperatur',
  'hoehe_cm',
  'topfgewicht_kg',
];

const zahl = (roh: unknown): number | null => (typeof roh === 'number' && Number.isFinite(roh) ? roh : null);

/**
 * Every hand reading in a set of Dinge, as readings. A pH felt while watering
 * rides on the `gabe` and a pH written down on its own rides on a `notiz`; both
 * came off the same pen, so both are the same origin and neither outranks the
 * other - only the clock does.
 */
export const handMessungen = (dinge: readonly Ding[]): Messung[] => {
  const messungen: Messung[] = [];

  for (const ding of dinge) {
    if (ding.storniert_von) continue;
    const messwerte = ding.d?.['messwerte'] as Messwerte | undefined;
    if (!messwerte) continue;

    for (const mass of HAND_MASSE) {
      const wert = zahl(messwerte[mass]);
      if (wert !== null) messungen.push({ mass: mass, herkunft: { quelle: 'hand' }, wert: wert, t: ding.t });
    }
  }

  return messungen;
};

const richtungVon = (delta: number | null): UnterschiedZeile['richtung'] =>
  delta === null || delta === 0 ? 'gleich' : delta > 0 ? 'hoch' : 'runter';

const zeile = (
  id: string,
  gruppe: ZeilenGruppe,
  mass: string,
  vorher: number | null,
  jetzt: number | null,
  zusatz: Partial<UnterschiedZeile> = {},
): UnterschiedZeile => {
  const delta = vorher === null || jetzt === null ? null : Number((jetzt - vorher).toFixed(4));
  return {
    id: id,
    gruppe: gruppe,
    mass: mass,
    herkunftZeigen: false,
    eingerueckt: false,
    vorher: vorher,
    jetzt: jetzt,
    delta: delta,
    richtung: richtungVon(delta),
    sigma: null,
    abweichung: 0,
    marke: 'gleich',
    ...zusatz,
  };
};

/**
 * How far a row moved, measured in its own noise.
 *
 * A series that has been read often enough to have a σ is weighed against it.
 * Everything else - a cumulative litre count, a step number, a tally of
 * entries - has no noise floor to speak of, and is weighed against its own
 * size instead, so `12,5 → 16,5 l` and `4 → 5 Schritte` land on one scale.
 */
const bewerten = (zeileJetzt: UnterschiedZeile, sigma: number | null): UnterschiedZeile => {
  const delta = Math.abs(zeileJetzt.delta ?? 0);
  const basis = Math.max(Math.abs(zeileJetzt.vorher ?? 0), Math.abs(zeileJetzt.jetzt ?? 0));
  const abweichung = sigma !== null && sigma > 0 ? delta / sigma : basis > 0 ? delta / basis : delta > 0 ? 1 : 0;

  return {
    ...zeileJetzt,
    sigma: sigma,
    abweichung: abweichung,
    marke: delta === 0 || zeileJetzt.delta === null ? 'gleich' : sigma !== null && delta > sigma ? 'ueber' : 'ruhig',
  };
};

const messGruppe = (
  gruppe: ZeilenGruppe,
  vorher: readonly Messung[],
  jetzt: readonly Messung[],
): UnterschiedZeile[] => {
  const links = new Map(messzeilen([...vorher]).map(z => [z.id, z]));

  return messzeilen([...jetzt]).map(rechts =>
    zeile(`${gruppe}:${rechts.id}`, gruppe, rechts.mass, links.get(rechts.id)?.wert ?? null, rechts.wert, {
      herkunft: rechts.herkunft,
      herkunftZeigen: rechts.herkunftZeigen,
      reihe: rechts.id,
    }),
  );
};

/** The newest setpoint per key, from the `ziel` Dinge in a half. */
const zieleAus = (dinge: readonly Ding[]): Map<string, number> => {
  const stand = new Map<string, { wert: number; t: number }>();

  for (const ding of dinge) {
    if (ding.art !== 'ziel') continue;
    const schluessel = ding.d?.['schluessel'];
    const wert = zahl(ding.d?.['wert']);
    if (typeof schluessel !== 'string' || wert === null) continue;

    const bisher = stand.get(schluessel);
    if (!bisher || ding.t >= bisher.t) stand.set(schluessel, { wert: wert, t: ding.t });
  }

  return new Map([...stand].map(([schluessel, eintrag]) => [schluessel, eintrag.wert]));
};

const summe = (dinge: readonly Ding[], art: string, feld: string): number | null => {
  let gesamt: number | null = null;

  for (const ding of dinge) {
    if (ding.art !== art || ding.storniert_von) continue;
    const wert = zahl(ding.d?.[feld]);
    if (wert !== null) gesamt = (gesamt ?? 0) + wert;
  }

  return gesamt === null ? null : Number(gesamt.toFixed(4));
};

const anzahl = (dinge: readonly Ding[], passt: (ding: Ding) => boolean): number =>
  dinge.filter(ding => !ding.storniert_von && passt(ding)).length;

const neuster = (dinge: readonly Ding[], art: string, feld: string): number | null => {
  let treffer: { wert: number; t: number } | null = null;

  for (const ding of dinge) {
    if (ding.art !== art) continue;
    const wert = zahl(ding.d?.[feld]);
    if (wert !== null && (!treffer || ding.t >= treffer.t)) treffer = { wert: wert, t: ding.t };
  }

  return treffer?.wert ?? null;
};

/**
 * The rows of `Der Unterschied`, in the fixed band order of §6.3 - measured
 * climate, hand measures, targets, sums, counts - with each target placed under
 * the measure it belongs to when that measure has a row of its own.
 *
 * A band nobody has data for contributes nothing. There is no `Temperatur —`
 * row and no placeholder: an absent measure is an absent row (§6).
 *
 * Ranking within a band is the diff engine's, not this function's; the order
 * here is the one the table falls back to and never crosses a band boundary.
 */
export const unterschiedZeilen = (eingabe: UnterschiedEingabe): UnterschiedZeile[] => {
  const messwerte = [
    ...messGruppe('geraet', eingabe.messungenVorher ?? [], eingabe.messungenJetzt ?? []),
    ...messGruppe('hand', handMessungen(eingabe.vorher), handMessungen(eingabe.jetzt)),
  ];

  const zieleVorher = zieleAus(eingabe.vorher);
  const zieleJetzt = zieleAus(eingabe.jetzt);
  const zielZeilen = [...new Set([...zieleVorher.keys(), ...zieleJetzt.keys()])].map(schluessel =>
    zeile(`ziel:${schluessel}`, 'ziel', schluessel, zieleVorher.get(schluessel) ?? null, zieleJetzt.get(schluessel) ?? null, {
      eingerueckt: true,
    }),
  );

  // A target under its measure, the way §6.1 and §6.2 draw it; one whose measure
  // has no row of its own falls back to the target band and stays indented,
  // because it is still a target and not a measurement.
  const gebunden = new Set<string>();
  const mitZielen: UnterschiedZeile[] = [];
  for (const messzeile of messwerte) {
    mitZielen.push(messzeile);
    for (const zielZeile of zielZeilen) {
      if (ZIEL_ZU_MASS[zielZeile.mass] === messzeile.mass && !gebunden.has(zielZeile.id)) {
        gebunden.add(zielZeile.id);
        mitZielen.push(zielZeile);
      }
    }
  }

  const summen = [
    zeile('summe:wasser_gesamt', 'summe', 'wasser_gesamt', summe(eingabe.vorher, 'gabe', 'wasser_l'), summe(eingabe.jetzt, 'gabe', 'wasser_l')),
    zeile('summe:schema_schritt', 'summe', 'schema_schritt', neuster(eingabe.vorher, 'schema', 'schritt'), neuster(eingabe.jetzt, 'schema', 'schritt')),
  ];

  // The count is of *entries*, not of rows read: a tent that projects itself, a
  // plant, a socket and a setpoint are not four things somebody wrote down, and
  // crediting a brand-new tent with `1 Eintrag` it never made is the first
  // thing day one gets wrong.
  const zaehlungen = [
    zeile(
      'anzahl:eintraege',
      'anzahl',
      'eintraege',
      anzahl(eingabe.vorher, istEintrag) || null,
      anzahl(eingabe.jetzt, istEintrag) || null,
    ),
    zeile(
      'anzahl:fotos',
      'anzahl',
      'fotos',
      anzahl(eingabe.vorher, ding => ding.art === 'bild') || null,
      anzahl(eingabe.jetzt, ding => ding.art === 'bild') || null,
    ),
  ];

  const alle = [...mitZielen, ...zielZeilen.filter(z => !gebunden.has(z.id)), ...summen, ...zaehlungen].filter(
    z => z.vorher !== null || z.jetzt !== null,
  );

  // σ is read off every reading behind the screen rather than off the two
  // halves separately: how far a measure usually moves is a property of the
  // measure, not of the window somebody happens to be looking at.
  const sigmas = sigmaJeReihe(
    [
      ...(eingabe.messungenVorher ?? []),
      ...(eingabe.messungenJetzt ?? []),
      ...handMessungen(eingabe.vorher),
      ...handMessungen(eingabe.jetzt),
    ],
    { bis: eingabe.bis ?? Date.now(), zeitzone: eingabe.zeitzone ?? 'UTC', tageszeit: true },
  );

  return alle.map(zeileJetzt => bewerten(zeileJetzt, zeileJetzt.reihe ? sigmas.get(zeileJetzt.reihe) ?? null : null));
};

/**
 * §6.1's `ⓘ nach Abweichung`, under §6.3's law that **row order is fixed and
 * does not depend on which half of the history you are looking at**:
 *
 * > Ranking reorders *within* those groups, never across them.
 *
 * Two things follow, and both are structural rather than a sort comparator's
 * opinion. A row that moved further than its own noise (`▲`) always outranks
 * one that did not, whatever the two raw numbers look like - that is the σ rule,
 * and it is why a CO₂ sensor wandering by 14 ppm cannot push a 2,2 °C night
 * above it. And a target stays under the measure it belongs to, because the
 * pair is ranked as one block: an indented row is not a row that can be sorted.
 */
export const nachAbweichung = (zeilen: readonly UnterschiedZeile[]): UnterschiedZeile[] => {
  const bloecke: UnterschiedZeile[][] = [];
  for (const zeileJetzt of zeilen) {
    if (zeileJetzt.eingerueckt && bloecke.length > 0) bloecke[bloecke.length - 1].push(zeileJetzt);
    else bloecke.push([zeileJetzt]);
  }

  const baender: ZeilenGruppe[] = [];
  for (const block of bloecke) if (!baender.includes(block[0].gruppe)) baender.push(block[0].gruppe);

  return baender.flatMap(band =>
    bloecke
      .filter(block => block[0].gruppe === band)
      .map((block, stelle) => ({ block: block, stelle: stelle }))
      .sort((links, rechts) => rangSchluessel(rechts.block[0], links.block[0]) || links.stelle - rechts.stelle)
      .flatMap(eintrag => eintrag.block),
  );
};

/** Beyond its own noise first, then by how far beyond. Ties keep the band's own order. */
const rangSchluessel = (links: UnterschiedZeile, rechts: UnterschiedZeile): number =>
  (links.marke === 'ueber' ? 1 : 0) - (rechts.marke === 'ueber' ? 1 : 0) || links.abweichung - rechts.abweichung;
