import { Ding, DingArt, GESPEICHERTE_ARTEN, istGespeichert } from '@fg2/shared-types';

/** One reason a Ding was refused. Read by developers, so English. */
export interface DingProblem {
  /** Dotted path into the submitted object, e.g. `d.produkte[0].ml_pro_l`. */
  path: string;
  message: string;
}

/**
 * Narrow with `pruefung.ok === false`, not with `!pruefung.ok`: the server
 * compiles without `strictNullChecks`, and truthiness alone does not narrow a
 * boolean discriminant there.
 */
export type DingPruefung = { ok: true; ding: Ding } | { ok: false; problems: DingProblem[] };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A back-dated entry is normal, a timestamp from 1970 is a unit mix-up: seconds
 * that were never multiplied by a thousand land decades before this bound.
 */
export const T_MIN = Date.UTC(2000, 0, 1);
/** Clock skew and a phone in the wrong timezone, not a planned future entry. */
export const T_SKEW_MS = 24 * 60 * 60 * 1000;

/** Everything a client may send. `erfasst_at`, `auto_bild` and `storniert_von` are server-owned. */
const CLIENT_FELDER = ['ding_id', 'zelt_id', 'art', 'name', 't', 't_ende', 'rel', 'd', 'bilder', 'akteur'];
const SERVER_FELDER = ['erfasst_at', 'auto_bild', 'storniert_von'];
/** The named edges of §3.4. A misspelt edge is an edge nothing will ever query. */
const REL_KANTEN = ['an', 'in', 'betrifft', 'von'];

const PFLANZE_QUELLEN = ['samen', 'steckling', 'gekauft'];
const VERTEILUNGEN = ['gesamt', 'je_pflanze'];
const EC_BASEN = ['absolut', 'plus_leitungswasser'];
const SUBSTRATE = ['trocken', 'feucht', 'nass'];
/** The diary's six lifecycle stages plus the seventh a Phase gains. */
const STUFEN = ['germination', 'seedling', 'vegetative', 'flowering', 'drying', 'curing', 'ernte'];

type FeldTyp = 'string' | 'number' | 'boolean' | 'zeit' | 'menge' | 'ding_id' | 'ausschnitt' | 'produkte' | 'messwerte';

interface Feld {
  typ: FeldTyp;
  pflicht?: boolean;
  /** Allowed values, for the enum-valued strings. */
  werte?: string[];
}

/**
 * The `d` payload per stored art (§4.1). Only `gabe.wasser_l`, `phase.stufe`,
 * `notiz.text`, `zustand.text`, `mensch.farbe` and `lauf.nummer` are demanded:
 * the rest of the sheet is optional by design, and refusing a pour typed as
 * "5 l" because the phone left `verteilung` at its default would break the
 * most-used screen in the product.
 */
const DATEN: Record<string, Record<string, Feld>> = {
  pflanze: {
    sorte: { typ: 'string' },
    medium: { typ: 'string' },
    topf_l: { typ: 'menge' },
    quelle: { typ: 'string', werte: PFLANZE_QUELLEN },
    keimung_t: { typ: 'zeit' },
    ernte_t: { typ: 'zeit' },
    ernte_g: { typ: 'menge' },
    entfernt_t: { typ: 'zeit' },
    ausschnitt: { typ: 'ausschnitt' },
  },
  phase: {
    stufe: { typ: 'string', werte: STUFEN, pflicht: true },
  },
  gabe: {
    wasser_l: { typ: 'menge', pflicht: true },
    kannen: { typ: 'menge' },
    kanne_l: { typ: 'menge' },
    verteilung: { typ: 'string', werte: VERTEILUNGEN },
    ec: { typ: 'menge' },
    ph: { typ: 'menge' },
    ec_basis: { typ: 'string', werte: EC_BASEN },
    ablauf_ph: { typ: 'menge' },
    ablauf_ec: { typ: 'menge' },
    produkte: { typ: 'produkte' },
    schema_id: { typ: 'string' },
    schritt: { typ: 'menge' },
    dublette_von: { typ: 'ding_id' },
  },
  notiz: {
    text: { typ: 'string', pflicht: true },
    messwerte: { typ: 'messwerte' },
  },
  zustand: {
    text: { typ: 'string', pflicht: true },
    geschlossen_von: { typ: 'ding_id' },
  },
  mensch: {
    farbe: { typ: 'string', pflicht: true },
    schluessel_aktiv: { typ: 'boolean' },
    user_id: { typ: 'string' },
  },
  lauf: {
    nummer: { typ: 'menge', pflicht: true },
    ernte_g: { typ: 'menge' },
    ertrag_notiz: { typ: 'string' },
  },
};

/** Every hand instrument (§4.2). Temperatures are the only ones that may be negative. */
const MESSWERTE: Record<string, FeldTyp> = {
  ph: 'menge',
  ec: 'menge',
  tds: 'menge',
  ppfd: 'menge',
  abstand_cm: 'menge',
  aussen_temperatur: 'number',
  temperatur: 'number',
  luftfeuchte: 'menge',
  hoehe_cm: 'menge',
  substrat: 'string',
  topfgewicht_kg: 'menge',
};

const istObjekt = (wert: unknown): wert is Record<string, unknown> => typeof wert === 'object' && wert !== null && !Array.isArray(wert);
const istZahl = (wert: unknown): wert is number => typeof wert === 'number' && Number.isFinite(wert);

class Pruefer {
  public readonly problems: DingProblem[] = [];

  public add(path: string, message: string): void {
    this.problems.push({ path: path, message: message });
  }

  /** True when the value is acceptable, so a caller can stop after the first complaint about it. */
  public feld(path: string, wert: unknown, feld: Feld): boolean {
    switch (feld.typ) {
      case 'string':
        if (typeof wert !== 'string') return this.nein(path, 'must be a string');
        if (feld.werte && !feld.werte.includes(wert)) return this.nein(path, `must be one of ${feld.werte.join(', ')}`);
        return true;
      case 'boolean':
        return typeof wert === 'boolean' || this.nein(path, 'must be a boolean');
      case 'number':
        return istZahl(wert) || this.nein(path, 'must be a finite number');
      case 'menge':
        if (!istZahl(wert)) return this.nein(path, 'must be a finite number');
        return wert >= 0 || this.nein(path, 'must not be negative');
      case 'zeit':
        return this.zeit(path, wert);
      case 'ding_id':
        return this.uuid(path, wert);
      case 'ausschnitt':
        return this.ausschnitt(path, wert);
      case 'produkte':
        return this.produkte(path, wert);
      case 'messwerte':
        return this.messwerte(path, wert);
    }
  }

  public uuid(path: string, wert: unknown): boolean {
    if (typeof wert !== 'string' || !UUID_V4.test(wert)) return this.nein(path, 'must be a uuid v4');
    return true;
  }

  public zeit(path: string, wert: unknown): boolean {
    if (!istZahl(wert)) return this.nein(path, 'must be a finite epoch-ms number');
    if (wert < T_MIN) return this.nein(path, `must not be before ${new Date(T_MIN).toISOString()} - epoch seconds instead of milliseconds?`);
    if (wert > Date.now() + T_SKEW_MS) return this.nein(path, 'must not be more than a day in the future');
    return true;
  }

  private ausschnitt(path: string, wert: unknown): boolean {
    if (!Array.isArray(wert) || wert.length !== 4) return this.nein(path, 'must be [x, y, w, h]');
    // map, not every: a client fixing a form wants every bad corner named at once.
    return wert.map((zahl, i) => istZahl(zahl) || this.nein(`${path}[${i}]`, 'must be a finite number')).every(Boolean);
  }

  private produkte(path: string, wert: unknown): boolean {
    if (!Array.isArray(wert)) return this.nein(path, 'must be an array');
    let ok = true;
    wert.forEach((produkt, i) => {
      const pfad = `${path}[${i}]`;
      if (!istObjekt(produkt)) {
        ok = this.nein(pfad, 'must be an object');
        return;
      }
      ok = this.pflicht(`${pfad}.name`, produkt.name, { typ: 'string' }) && ok;
      if (typeof produkt.name === 'string' && produkt.name.trim() === '') ok = this.nein(`${pfad}.name`, 'must not be empty');
      ok = this.pflicht(`${pfad}.ml_pro_l`, produkt.ml_pro_l, { typ: 'menge' }) && ok;
      if (produkt.aus_schema !== undefined) ok = this.feld(`${pfad}.aus_schema`, produkt.aus_schema, { typ: 'boolean' }) && ok;
      const unbekannt = Object.keys(produkt).filter(key => !['name', 'ml_pro_l', 'aus_schema'].includes(key));
      for (const key of unbekannt) ok = this.nein(`${pfad}.${key}`, 'unknown field');
    });
    return ok;
  }

  private messwerte(path: string, wert: unknown): boolean {
    if (!istObjekt(wert)) return this.nein(path, 'must be an object');
    let ok = true;
    for (const [key, value] of Object.entries(wert)) {
      const typ = MESSWERTE[key];
      if (!typ) {
        ok = this.nein(`${path}.${key}`, `unknown field - Messwerte carries ${Object.keys(MESSWERTE).join(', ')}`);
        continue;
      }
      if (value === undefined) continue;
      ok = this.feld(`${path}.${key}`, value, key === 'substrat' ? { typ: 'string', werte: SUBSTRATE } : { typ: typ }) && ok;
    }
    return ok;
  }

  private pflicht(path: string, wert: unknown, feld: Feld): boolean {
    if (wert === undefined || wert === null) return this.nein(path, 'is required');
    return this.feld(path, wert, feld);
  }

  private nein(path: string, message: string): false {
    this.add(path, message);
    return false;
  }
}

const pruefeRel = (p: Pruefer, rel: unknown): void => {
  if (!istObjekt(rel)) {
    p.add('rel', 'must be an object of named edges');
    return;
  }
  for (const [kante, ziele] of Object.entries(rel)) {
    if (!REL_KANTEN.includes(kante)) {
      p.add(`rel.${kante}`, `unknown edge - the named edges are ${REL_KANTEN.join(', ')}`);
      continue;
    }
    if (!Array.isArray(ziele)) {
      p.add(`rel.${kante}`, 'must be an array of ding_ids');
      continue;
    }
    ziele.forEach((ziel, i) => p.uuid(`rel.${kante}[${i}]`, ziel));
  }
};

const pruefeDaten = (p: Pruefer, art: DingArt, d: unknown): void => {
  const felder = DATEN[art];
  if (!felder) return;
  const daten = d === undefined ? {} : d;
  if (!istObjekt(daten)) {
    p.add('d', 'must be an object');
    return;
  }

  for (const [key, feld] of Object.entries(felder)) {
    const wert = daten[key];
    if (wert === undefined || wert === null) {
      if (feld.pflicht) p.add(`d.${key}`, `is required on a ${art}`);
      continue;
    }
    p.feld(`d.${key}`, wert, feld);
  }

  for (const key of Object.keys(daten)) {
    if (!felder[key]) p.add(`d.${key}`, `unknown field on a ${art} - it carries ${Object.keys(felder).join(', ')}`);
  }
};

/**
 * Checks a Ding a client sent, before anything of it reaches the database. Pure
 * on purpose: no model, no service, so the rules can be exercised without a
 * database and without starting an MQTT client.
 *
 * Nothing here needs a device. Every stored art is human-entered, and a tent
 * with no device produces exactly the same objects as one with three.
 */
export function validateDing(eingabe: unknown): DingPruefung {
  const p = new Pruefer();

  if (!istObjekt(eingabe)) {
    return { ok: false, problems: [{ path: '', message: 'must be an object' }] };
  }

  const art = eingabe.art;
  if (typeof art !== 'string' || art === '') {
    p.add('art', `is required and must be one of ${GESPEICHERTE_ARTEN.join(', ')}`);
  } else if (!istGespeichert(art)) {
    // Deliberately one message for both the projected arts and the misspelt
    // ones: naming which nine are projected would be a second copy of a list
    // that lives in the contract.
    p.add(
      'art',
      `'${art}' cannot be stored - the stored arts are ${GESPEICHERTE_ARTEN.join(
        ', ',
      )}, and every other art is projected read-time from data that already exists`,
    );
  }

  p.uuid('ding_id', eingabe.ding_id);

  if (typeof eingabe.zelt_id !== 'string' || eingabe.zelt_id === '') {
    p.add('zelt_id', 'is required and must be a non-empty string');
  }

  if (eingabe.name !== undefined && typeof eingabe.name !== 'string') {
    p.add('name', 'must be a string');
  }

  p.zeit('t', eingabe.t);
  if (eingabe.t_ende !== undefined && eingabe.t_ende !== null) {
    // A null is the open interval and is not a timestamp to check; absent means
    // this Ding is not an interval at all.
    if (p.zeit('t_ende', eingabe.t_ende) && istZahl(eingabe.t) && (eingabe.t_ende as number) < eingabe.t) {
      p.add('t_ende', 'must not precede t');
    }
  }

  if (eingabe.geraet_id !== undefined) {
    p.add('geraet_id', 'is set only on a projected Ding - a stored one belongs to the Zelt, not to a device');
  }

  for (const key of SERVER_FELDER) {
    if (eingabe[key] !== undefined) p.add(key, 'is written by the server and must not be sent');
  }

  for (const key of Object.keys(eingabe)) {
    if (!CLIENT_FELDER.includes(key) && !SERVER_FELDER.includes(key) && key !== 'geraet_id') {
      p.add(key, `unknown field - a Ding carries ${CLIENT_FELDER.join(', ')}`);
    }
  }

  if (eingabe.rel !== undefined) pruefeRel(p, eingabe.rel);

  if (eingabe.bilder !== undefined) {
    if (!Array.isArray(eingabe.bilder)) {
      p.add('bilder', 'must be an array of image_ids');
    } else {
      eingabe.bilder.forEach((bild, i) => {
        if (typeof bild !== 'string' || bild === '') p.add(`bilder[${i}]`, 'must be a non-empty image_id');
      });
    }
  }

  if (eingabe.akteur !== undefined) p.uuid('akteur', eingabe.akteur);

  if (typeof art === 'string' && istGespeichert(art)) pruefeDaten(p, art as DingArt, eingabe.d);

  if (p.problems.length > 0) return { ok: false, problems: p.problems };
  return { ok: true, ding: eingabe as unknown as Ding };
}
