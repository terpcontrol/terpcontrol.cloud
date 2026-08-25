import type { Ding, GabeProdukt, GabeVerteilung, Messwerte, Zelt, ZeltMedium } from '@fg2/shared-types';

/**
 * A product row as a sheet holds it. The dose stays text until it is sent, so
 * the comma a German keyboard offers survives being shown back to the person
 * who typed it - a field that renders `2.5` at somebody who typed `2,5` is how
 * an English decimal point gets onto this screen.
 */
export interface ProduktEingabe {
  name: string;
  ml_pro_l: unknown;
  aus_schema?: boolean;
}

/** What the server accepts as a `ding_id`, and therefore what has to be minted here. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The id is minted on the phone, before the entry has been anywhere near the
 * network, because the server upserts on it: the same watering sent twice over
 * a bad connection is stored once. An id invented server-side would make every
 * retry a second pour.
 */
export const neueDingId = (): string => {
  const krypto = globalThis.crypto;
  if (typeof krypto?.randomUUID === 'function') return krypto.randomUUID();

  // Older WebViews have `getRandomValues` without `randomUUID`; the layout of a
  // v4 is four bits of version and two bits of variant over random bytes.
  const bytes = new Uint8Array(16);
  krypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * A typed number, in either separator. A German keyboard offers a comma and the
 * field is a text input for exactly that reason - `<input type="number">` is
 * the one control that refuses what the phone put on its own keyboard.
 */
export const zahlAus = (roh: unknown): number | null => {
  if (roh === null || roh === undefined || roh === '') return null;
  const wert = typeof roh === 'number' ? roh : Number(String(roh).trim().replace(',', '.'));
  return Number.isFinite(wert) ? wert : null;
};

/** Two decimals is what a kitchen scale, a pH pen and a watering can all have. */
export const gerundet = (wert: number, stellen = 2): number => Math.round(wert * 10 ** stellen) / 10 ** stellen;

/** `2026-08-25T19:40` - what `ion-datetime` reads and writes, in local wall time. */
export const alsEingabe = (t: number): string => {
  const zeit = new Date(t);
  const zwei = (zahl: number): string => String(zahl).padStart(2, '0');
  return `${zeit.getFullYear()}-${zwei(zeit.getMonth() + 1)}-${zwei(zeit.getDate())}T${zwei(zeit.getHours())}:${zwei(zeit.getMinutes())}`;
};

export const ausEingabe = (roh: string): number | null => {
  const t = new Date(roh).getTime();
  return Number.isFinite(t) ? t : null;
};

export interface Zeitfenster {
  /** epoch ms of the earliest moment a sheet may be back-dated to. */
  min: number;
  max: number;
}

/**
 * §12.2: the wheel is bounded by the run at the low end and now at the high
 * end. A tent with no `lauf` is bounded by its own first day, which is the same
 * statement about a grow that has only ever had one run.
 */
export const zeitfenster = (zelt: Zelt, dinge: readonly Ding[], jetzt: number): Zeitfenster => {
  const lauf = dinge.filter(ding => ding.art === 'lauf').reduce((juengster, ding) => Math.max(juengster, ding.t), 0);
  return { min: lauf || zelt?.tag_null || 0, max: jetzt };
};

const SUBSTRATE = ['trocken', 'feucht', 'nass'] as const;
export type Substrat = (typeof SUBSTRATE)[number];
export const SUBSTRAT_WERTE: readonly Substrat[] = SUBSTRATE;

/** The instrument set of §4.2, in the order a person reads their own tools. */
export const MESSWERT_FELDER: readonly (keyof Messwerte)[] = [
  'ph',
  'ec',
  'tds',
  'ppfd',
  'abstand_cm',
  'hoehe_cm',
  'temperatur',
  'luftfeuchte',
  'aussen_temperatur',
  'topfgewicht_kg',
];

/**
 * An empty Messwerte is refused by the server on purpose - a Notiz carrying a
 * measurement row that measured nothing is worse than one carrying none - so a
 * sheet whose instrument fields were all left blank sends no object at all.
 */
export const messwerteAus = (roh: Partial<Record<keyof Messwerte, unknown>>): Messwerte | undefined => {
  const messwerte: Record<string, unknown> = {};
  for (const feld of MESSWERT_FELDER) {
    const wert = zahlAus(roh[feld]);
    if (wert !== null) messwerte[feld] = wert;
  }
  if (typeof roh.substrat === 'string' && SUBSTRATE.includes(roh.substrat as Substrat)) messwerte['substrat'] = roh.substrat;

  return Object.keys(messwerte).length > 0 ? (messwerte as Messwerte) : undefined;
};

/** Everything three sheets share: which tent, when, and who says so. */
interface Grundlage {
  zelt_id: string;
  t: number;
  akteur?: string | null;
}

const grundgeruest = (grund: Grundlage, art: Ding['art'], name: string): Ding => {
  const ding: Ding = { ding_id: neueDingId(), zelt_id: grund.zelt_id, art: art, name: name, t: Math.round(grund.t) };
  // A `mensch` is a stored art and carries a minted id; anything else in this
  // field is a client bug that would take the whole entry down with a 400.
  if (grund.akteur && UUID_V4.test(grund.akteur)) ding.akteur = grund.akteur;
  return ding;
};

export interface GabeEingabe extends Grundlage {
  kannen: number;
  kanne_l: number;
  verteilung: GabeVerteilung;
  /** ding_ids of the plants. Empty means the whole tent, which is the default and the common case. */
  pflanzen: readonly string[];
  produkte: readonly ProduktEingabe[];
  ph?: unknown;
  ec?: unknown;
  ablauf_ph?: unknown;
  ablauf_ec?: unknown;
  substrat?: Substrat | null;
  notiz?: string;
  /** ding_id of the Gabe this one duplicates, when two people logged one pour. */
  dublette_von?: string | null;
}

/**
 * The `Gabe` of §12.1. Litres are derived from the can count and never typed,
 * so the number that reaches the server is the one the sheet printed.
 *
 * `rel.an` is left out when no plant was picked. An empty edge is refused by
 * the server, and rightly: absent is the only way to say „the whole tent", and
 * that is what most waterings are.
 */
export const gabeEntwurf = (eingabe: GabeEingabe): Ding => {
  const ding = grundgeruest(eingabe, 'gabe', (eingabe.notiz ?? '').trim());
  const d: Record<string, unknown> = {
    wasser_l: gerundet(Math.max(0, eingabe.kannen) * Math.max(0, eingabe.kanne_l)),
    kannen: eingabe.kannen,
    kanne_l: eingabe.kanne_l,
    verteilung: eingabe.verteilung,
  };

  for (const [feld, roh] of [
    ['ph', eingabe.ph],
    ['ec', eingabe.ec],
    ['ablauf_ph', eingabe.ablauf_ph],
    ['ablauf_ec', eingabe.ablauf_ec],
  ] as const) {
    const wert = zahlAus(roh);
    if (wert !== null && wert >= 0) d[feld] = wert;
  }

  const produkte = eingabe.produkte
    .filter(produkt => produkt.name.trim() !== '')
    .map(produkt => ({ name: produkt.name.trim(), ml_pro_l: Math.max(0, zahlAus(produkt.ml_pro_l) ?? 0), aus_schema: produkt.aus_schema === true }));
  if (produkte.length > 0) d['produkte'] = produkte;

  const messwerte = messwerteAus({ substrat: eingabe.substrat ?? undefined });
  if (messwerte) d['messwerte'] = messwerte;

  if (eingabe.dublette_von && UUID_V4.test(eingabe.dublette_von)) d['dublette_von'] = eingabe.dublette_von;

  ding.d = d;
  if (eingabe.pflanzen.length > 0) ding.rel = { an: [...eingabe.pflanzen] };
  return ding;
};

export interface NotizEingabe extends Grundlage {
  text: string;
  messwerte?: Partial<Record<keyof Messwerte, unknown>>;
}

export const notizEntwurf = (eingabe: NotizEingabe): Ding => {
  const ding = grundgeruest(eingabe, 'notiz', '');
  const d: Record<string, unknown> = { text: eingabe.text.trim() };
  const messwerte = messwerteAus(eingabe.messwerte ?? {});
  if (messwerte) d['messwerte'] = messwerte;
  ding.d = d;
  return ding;
};

/**
 * The Zettel on the tent door. `t_ende: null` is what makes it *open*: the
 * Tafel's `Offen` section is exactly the `zustand` Dinge whose interval has not
 * been closed yet.
 */
export const zettelEntwurf = (eingabe: NotizEingabe): Ding => {
  const ding = grundgeruest(eingabe, 'zustand', '');
  ding.t_ende = null;
  ding.d = { text: eingabe.text.trim() };
  return ding;
};

export interface GabeVorgabe {
  kannen: number;
  kanne_l: number;
}

/** Beyond this the counter stops being faster than typing, and the dots stop fitting. */
export const KANNEN_MAX = 12;

/** A watering can nobody has told us about. Two litres is the one most people own. */
const KANNE_STANDARD = 2;

/**
 * What the sheet is already filled in with, so „routine water, volume
 * unchanged" costs two taps: open, `Eintragen`. The can size is remembered per
 * tent, and it is remembered off the entries rather than off a settings screen.
 */
export const gabeVorgabe = (zelt: Zelt | null, dinge: readonly Ding[]): GabeVorgabe => {
  const letzte = [...dinge].filter(ding => ding.art === 'gabe' && !ding.storniert_von).sort((links, rechts) => rechts.t - links.t)[0];
  const zahl = (feld: string): number | null => {
    const wert = letzte?.d?.[feld];
    return typeof wert === 'number' && Number.isFinite(wert) && wert > 0 ? wert : null;
  };

  const kanne_l = zelt?.d?.kanne_l || zahl('kanne_l') || KANNE_STANDARD;
  const wasser = zahl('wasser_l');
  const kannen = zahl('kannen') ?? (wasser ? Math.max(1, Math.round(wasser / kanne_l)) : 1);
  return { kannen: Math.min(KANNEN_MAX, Math.round(kannen)), kanne_l: kanne_l };
};

/** The can sizes the picker offers. A size not in the list arrives from the tent and is added. */
export const KANNEN_GROESSEN: readonly number[] = [0.5, 1, 1.5, 2, 3, 5, 10];

/** How the sheet reads the litres back: `6,0 l gesamt` or `6,0 l je Pflanze · 18,0 l gesamt`. */
export const gesamtLiter = (wasser_l: number, verteilung: GabeVerteilung, pflanzen: number): number =>
  verteilung === 'je_pflanze' ? gerundet(wasser_l * Math.max(1, pflanzen)) : wasser_l;

/** §13.4's windows, in hours: water, then feed. Coco is fed several times a day and correctly so. */
const FENSTER: Record<'coco' | 'erde', [number, number]> = { coco: [3, 12], erde: [6, 18] };

export const fensterMs = (medium: ZeltMedium | undefined, mitProdukten: boolean): number => {
  const [wasser, futter] = FENSTER[medium === 'coco' ? 'coco' : 'erde'];
  return (mitProdukten ? futter : wasser) * 3600 * 1000;
};

export interface DoppelWarnung {
  /** The earlier Gabe this one looks like a repeat of. */
  ding: Ding;
  wasser_l: number;
  pflanzen: string[];
  substrat?: string;
  /** True when the earlier entry is still sitting in the outbox - the local half of the guard fired. */
  lokal: boolean;
  bilder: string[];
}

const zielMenge = (ding: Ding): string[] => (Array.isArray(ding.rel?.['an']) ? (ding.rel?.['an'] as string[]) : []);

/**
 * §13.3: an absent `rel.an` is the whole tent, so it intersects every
 * selection - including a later pour aimed at one plant. „Anna watered the
 * tent, Ben then waters A1" is precisely the double feed this exists for.
 */
const trifftSich = (links: readonly string[], rechts: readonly string[]): boolean =>
  links.length === 0 || rechts.length === 0 || links.some(id => rechts.includes(id));

export interface GuardEingabe {
  dinge: readonly Ding[];
  /** The plants this sheet is about to water. Empty is the whole tent. */
  auswahl: readonly string[];
  t: number;
  medium?: ZeltMedium;
  mitProdukten: boolean;
  /** ding_ids still waiting in the outbox, so the sheet can say which half of the guard fired. */
  wartend?: readonly string[];
}

/**
 * The double-feed guard (§13.4), client-side. It reads the entries the screen
 * already has *and* the ones still queued, because a watering typed in a cellar
 * with no signal is invisible to any server-side query for as long as it sits
 * there.
 */
export const doppelGabe = (eingabe: GuardEingabe): DoppelWarnung | null => {
  const fenster = fensterMs(eingabe.medium, eingabe.mitProdukten);
  const wartend = eingabe.wartend ?? [];

  const treffer = eingabe.dinge
    .filter(
      ding =>
        ding.art === 'gabe' &&
        !ding.storniert_von &&
        !ding.d?.['dublette_von'] &&
        ding.t <= eingabe.t &&
        eingabe.t - ding.t < fenster &&
        trifftSich(zielMenge(ding), eingabe.auswahl),
    )
    .sort((links, rechts) => rechts.t - links.t)[0];
  if (!treffer) return null;

  const messwerte = treffer.d?.['messwerte'] as Messwerte | undefined;
  return {
    ding: treffer,
    wasser_l: typeof treffer.d?.['wasser_l'] === 'number' ? (treffer.d['wasser_l'] as number) : 0,
    pflanzen: zielMenge(treffer),
    substrat: messwerte?.substrat,
    lokal: wartend.includes(treffer.ding_id),
    bilder: treffer.bilder ?? [],
  };
};
