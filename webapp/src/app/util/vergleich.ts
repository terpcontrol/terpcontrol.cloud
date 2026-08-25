import { DateTime } from 'luxon';
import type { Ding, DingArt, Zelt } from '@fg2/shared-types';
import { Text } from './ding-text';
import { einheitVon } from './einheiten';
import { Messung, herkunftSchluessel, messzeilen } from './messquellen';
import { standardabweichung } from './reihe';
import { handMessungen } from './unterschied';
import { pluralSchluessel, zahlText } from './zahl';
import { laufBeginn, tagNummer } from './zelt-tag';

/** §3.5 - what the handle was set to, and by which rung of the ladder. */
export type Anker = 'zuletzt' | 'gestern' | 'woche' | 'phase' | 'gabe' | 'foto' | 'beginn' | 'ziel' | 'plan' | 'lauf' | 'frei';

export interface Vergleich {
  von: number;
  anker: Anker;
}

/** One magnetic position on the track. It exists because its evidence exists. */
export interface Detent {
  id: string;
  anker: Anker;
  von: number;
  /** How the position reads, resolved through `DingTextService`. */
  text: Text;
}

const STUNDE_MS = 60 * 60 * 1000;
const TAG_MS = 24 * STUNDE_MS;

/** How far either side of the cursor counts as „around this moment". §8.1. */
export const FENSTER_MS = 2 * STUNDE_MS;

/**
 * §8.1, and the only rule there is:
 *
 * > A Ding that has a state diffs against a moment. A Ding that is a moment
 * > diffs against its predecessor.
 *
 * `mensch` and `film` are the two the rule reaches through something other than
 * their own art: a person is a chain of *their* entries, a film is a chain of
 * its own frames.
 */
export type Griffart = 'moment' | 'kette' | 'besuch' | 'kapitel';

/** Arts that *have* a state, so the handle scrubs a moment in the tent's history. */
const ZUSTAND_ARTEN: DingArt[] = ['zelt', 'geraet', 'dose', 'pflanze', 'kamera', 'ziel', 'schema', 'lauf'];

/** Arts that *are* a moment, so the handle walks the predecessor chain. */
const KETTEN_ARTEN: DingArt[] = ['gabe', 'notiz', 'bild', 'ereignis', 'phase'];

export const griffart = (art?: DingArt): Griffart => {
  if (art === 'mensch') return 'besuch';
  if (art === 'film') return 'kapitel';
  if (art && KETTEN_ARTEN.includes(art)) return 'kette';
  if (art && ZUSTAND_ARTEN.includes(art)) return 'moment';
  // A Ding whose art nobody has met yet still has a Tafel, and a Tafel still
  // has a handle. A state is the safe reading: it compares, it never chains
  // into rows that may not be there.
  return 'moment';
};

const zahl = (roh: unknown): number | null => (typeof roh === 'number' && Number.isFinite(roh) ? roh : null);

const lebend = (dinge: readonly Ding[]): Ding[] => dinge.filter(ding => !ding.storniert_von);

const neuestes = (dinge: readonly Ding[], passt: (ding: Ding) => boolean): Ding | null =>
  lebend(dinge)
    .filter(passt)
    .reduce<Ding | null>((bestes, ding) => (!bestes || ding.t > bestes.t ? ding : bestes), null);

/** The tent's own zone, or UTC when it carries something Luxon cannot read. */
const zoneVon = (zelt: Zelt): string =>
  zelt?.zeitzone && DateTime.now().setZone(zelt.zeitzone).isValid ? zelt.zeitzone : 'UTC';

const hhmm = (sekunden: number, zone: string): string =>
  DateTime.fromMillis(0, { zone: 'UTC' }).setZone(zone).startOf('day').plus({ seconds: sekunden }).toFormat('HH:mm');

/**
 * The last moment the light went off - measured if a device reported one,
 * declared if a human typed a `licht_plan`, and **absent** if neither, which is
 * what makes `gestern Abend` a detent that appears by data (§8.1).
 */
const lichtGrenze = (zelt: Zelt, messungen: readonly Messung[], jetzt: number): number | null => {
  const licht = messungen
    .filter(messung => messung.mass === 'out_light' && messung.t <= jetzt)
    .sort((links, rechts) => links.t - rechts.t);

  for (let index = licht.length - 1; index > 0; index--) {
    if (licht[index].wert === 0 && licht[index - 1].wert > 0) return licht[index].t;
  }

  const aus = zelt?.d?.licht_plan?.aus;
  if (typeof aus !== 'number') return null;

  const zone = zoneVon(zelt);
  const heute = DateTime.fromMillis(jetzt, { zone: zone }).startOf('day').plus({ seconds: aus });
  return (heute.toMillis() > jetzt ? heute.minus({ days: 1 }) : heute).toMillis();
};

export interface DetentEingabe {
  zelt: Zelt;
  dinge: readonly Ding[];
  /** Series readings, when something measured any. A tent with no device passes none. */
  messungen?: readonly Messung[];
  jetzt: number;
  /** `zuletzt`, already resolved by `VergleichService`. */
  zuletzt?: number | null;
  /** Whether that visit is this person's own (§3.5), which changes only the label. */
  zuletztPersoenlich?: boolean;
}

/**
 * The moment ladder: Beginn · Phasenwechsel · 1 Woche · gestern · gestern Abend
 * · letzte Gabe · letztes Foto · Lauf n · seit zuletzt.
 *
 * Every rung is here because its evidence is, and for no other reason - there
 * is no per-art table and nothing is hidden behind hardware. A tent with three
 * entries and no device has Beginn, gestern and the entries themselves.
 */
export const momentDetents = (eingabe: DetentEingabe): Detent[] => {
  const { zelt, dinge, jetzt } = eingabe;
  const messungen = eingabe.messungen ?? [];
  const zone = zoneVon(zelt);
  const beginn = laufBeginn(zelt, dinge);
  const roh: Detent[] = [{ id: 'beginn', anker: 'beginn', von: beginn, text: { key: 'zelt.griff.beginn' } }];

  const phase = neuestes(dinge, ding => ding.art === 'phase' && ding.t < jetzt);
  if (phase) roh.push({ id: 'phase', anker: 'phase', von: phase.t, text: { key: 'zelt.griff.phase' } });

  roh.push({ id: 'woche', anker: 'woche', von: jetzt - 7 * TAG_MS, text: { key: 'zelt.griff.woche' } });
  roh.push({ id: 'gestern', anker: 'gestern', von: jetzt - TAG_MS, text: { key: 'zelt.griff.gestern' } });

  const abend = lichtGrenze(zelt, messungen, jetzt);
  if (abend !== null) roh.push({ id: 'abend', anker: 'plan', von: abend, text: { key: 'zelt.griff.gesternAbend' } });

  const gabe = neuestes(dinge, ding => ding.art === 'gabe' && ding.t < jetzt);
  if (gabe) roh.push({ id: 'gabe', anker: 'gabe', von: gabe.t, text: { key: 'zelt.griff.gabe' } });

  const foto = neuestes(dinge, ding => ding.art === 'bild' && ding.t < jetzt);
  if (foto) roh.push({ id: 'foto', anker: 'foto', von: foto.t, text: { key: 'zelt.griff.foto' } });

  const lauf = laufDetent(zelt, dinge, jetzt, zone);
  if (lauf) roh.push(lauf);

  if (eingabe.zuletzt) {
    roh.push({
      id: 'zuletzt',
      anker: 'zuletzt',
      von: eingabe.zuletzt,
      text: { key: eingabe.zuletztPersoenlich ? 'zelt.griff.zuletztDu' : 'zelt.griff.zuletztGeraet' },
    });
  }

  // Nothing older than the tent itself and nothing in the future: a moment you
  // cannot have been in is not a moment to compare against. The bound is the
  // tent's own first day rather than the open run's, because `Lauf n` points
  // into the previous run on purpose (§3.2).
  const untergrenze = Math.min(zelt?.tag_null ?? beginn, beginn, ...dinge.map(ding => ding.t));
  return sortiert(roh.filter(detent => detent.von >= untergrenze && detent.von < jetzt));
};

/**
 * `Lauf n · Tag 34` - the same day number in the previous run (§3.2). It exists
 * from the moment a second `lauf` does, and never before.
 */
const laufDetent = (zelt: Zelt, dinge: readonly Ding[], jetzt: number, zone: string): Detent | null => {
  const laeufe = lebend(dinge)
    .filter(ding => ding.art === 'lauf')
    .sort((links, rechts) => rechts.t - links.t);
  const offen = laeufe.find(ding => ding.t_ende === null) ?? laeufe[0];
  const vorher = laeufe.find(ding => offen && ding.t < offen.t);
  if (!offen || !vorher) return null;

  const von = vorher.t + (jetzt - offen.t);
  return {
    id: 'lauf',
    anker: 'lauf',
    von: von,
    text: {
      key: 'zelt.griff.lauf',
      params: { nummer: zahl(vorher.d?.['nummer']) ?? 1, tag: tagNummer(zone, vorher.t, von) },
    },
  };
};

/** Newest last, and never two rungs the reader cannot tell apart. */
const sortiert = (detents: Detent[]): Detent[] => {
  const gesehen = new Set<number>();
  return detents
    .sort((links, rechts) => links.von - rechts.von)
    .filter(detent => {
      const minute = Math.floor(detent.von / 60000);
      if (gesehen.has(minute)) return false;
      gesehen.add(minute);
      return true;
    });
};

/** How many predecessors a chain shows. Beyond this the track cannot be hit with a thumb. */
const KETTE_MAX = 12;

/**
 * The predecessor chain of a Ding that *is* a moment. A `gabe` that names the
 * plants it went to chains along those plants - „die vorige Gabe an dieselben
 * Pflanzen" - and one that names none chains along every Gabe, because that is
 * what it was: a pour into the tent.
 */
export const kettenDetents = (subjekt: Ding, dinge: readonly Ding[]): Detent[] => {
  const an = new Set([...(subjekt.rel?.['an'] ?? []), ...(subjekt.rel?.['betrifft'] ?? [])]);

  const vorgaenger = lebend(dinge)
    .filter(ding => ding.art === subjekt.art && ding.t < subjekt.t && ding.ding_id !== subjekt.ding_id)
    .filter(ding => {
      if (an.size === 0) return true;
      const ziele = [...(ding.rel?.['an'] ?? []), ...(ding.rel?.['betrifft'] ?? [])];
      return ziele.length === 0 || ziele.some(ziel => an.has(ziel));
    })
    .sort((links, rechts) => rechts.t - links.t)
    .slice(0, KETTE_MAX);

  return sortiert(
    vorgaenger.map(ding => ({
      id: `kette:${ding.ding_id}`,
      anker: ankerVonArt(ding.art),
      von: ding.t,
      text: { key: `zelt.griff.kette.${ding.art}`, ersatz: ding.name },
    })),
  );
};

const ankerVonArt = (art: DingArt): Anker =>
  art === 'gabe' ? 'gabe' : art === 'bild' ? 'foto' : art === 'phase' ? 'phase' : 'frei';

/** A `mensch` diffs against their own previous visit, and their entries are the visits. */
export const besuchDetents = (subjekt: Ding, dinge: readonly Ding[], jetzt: number): Detent[] =>
  sortiert(
    lebend(dinge)
      .filter(ding => ding.akteur === subjekt.ding_id && ding.t < jetzt)
      .sort((links, rechts) => rechts.t - links.t)
      .slice(0, KETTE_MAX)
      .map(ding => ({
        id: `besuch:${ding.ding_id}`,
        anker: 'zuletzt' as const,
        von: ding.t,
        text: { key: 'zelt.griff.besuch' },
      })),
  );

/** A film scrubs its own frames; they are the only chapters it has. */
export const kapitelDetents = (subjekt: Ding, dinge: readonly Ding[]): Detent[] => {
  const eigene = new Set(subjekt.bilder ?? []);
  const von = zahl(subjekt.d?.['von']);
  const bis = zahl(subjekt.d?.['bis']) ?? subjekt.t;

  const frames = lebend(dinge)
    .filter(ding => ding.art === 'bild')
    .filter(ding => (eigene.size > 0 ? eigene.has(ding.ding_id) : ding.t <= bis && (von === null || ding.t >= von)))
    .sort((links, rechts) => rechts.t - links.t)
    .slice(0, KETTE_MAX);

  return sortiert(
    frames.map(ding => ({ id: `kapitel:${ding.ding_id}`, anker: 'foto' as const, von: ding.t, text: { key: 'zelt.griff.kapitel' } })),
  );
};

/** The rungs this Subjekt has, whichever half of the rule it falls under. */
export const detents = (eingabe: DetentEingabe, subjekt: Ding | null): Detent[] => {
  switch (griffart(subjekt?.art)) {
    case 'kette':
      return kettenDetents(subjekt as Ding, eingabe.dinge);
    case 'besuch':
      return besuchDetents(subjekt as Ding, eingabe.dinge, eingabe.jetzt);
    case 'kapitel':
      return kapitelDetents(subjekt as Ding, eingabe.dinge);
    default:
      return momentDetents(eingabe);
  }
};

/** What the track spans. Never zero-width, so a position is always computable. */
export const spanne = (eingabe: DetentEingabe, subjekt: Ding | null, detentliste: readonly Detent[]): { von: number; bis: number } => {
  const art = griffart(subjekt?.art);
  const bis = art === 'moment' || !subjekt ? eingabe.jetzt : subjekt.t;
  const kandidaten = [laufBeginn(eingabe.zelt, eingabe.dinge), ...detentliste.map(detent => detent.von)].filter(wert => wert < bis);
  const von = kandidaten.length > 0 ? Math.min(...kandidaten) : bis - TAG_MS;
  return { von: von, bis: Math.max(bis, von + 60000) };
};

export interface Aufloesung {
  von: number;
  /** True when the raw handle position was not itself a moment this tent can tell apart. */
  verschoben: boolean;
}

/**
 * §8.1: **the detents are the moments this Zelt can tell apart.** With samples
 * arriving that is every minute; with only entries it is every entry, and the
 * cursor lands on the newest Ding at or before where the thumb let go.
 */
export const aufloesen = (roh: number, dinge: readonly Ding[], fein: boolean): Aufloesung => {
  if (fein) return { von: Math.floor(roh / 60000) * 60000, verschoben: false };

  const davor = lebend(dinge)
    .filter(ding => ding.t <= roh)
    .reduce<Ding | null>((bestes, ding) => (!bestes || ding.t > bestes.t ? ding : bestes), null);

  if (!davor) return { von: roh, verschoben: false };
  return { von: davor.t, verschoben: davor.t !== roh };
};

/**
 * `Nächster Unterschied ›` - the next moment at which something actually
 * changed, so nobody has to hunt for one.
 *
 * Device-less it lands on entries, because an entry *is* the change: nothing
 * happened between two of them that this tent recorded. With a series it also
 * considers the next reading that moved by more than that series' own σ, and
 * takes whichever comes first. `null` means there is no next one, and the
 * caller leaves the cursor exactly where it is.
 */
export const naechsterUnterschied = (
  von: number,
  dinge: readonly Ding[],
  messungen: readonly Messung[] = [],
  jetzt: number = Date.now(),
): number | null => {
  const kandidaten = lebend(dinge)
    .filter(ding => ding.t > von && ding.t <= jetzt)
    .map(ding => ding.t);

  const gruppen = new Map<string, Messung[]>();
  for (const messung of messungen) {
    const schluessel = `${messung.mass}|${herkunftSchluessel(messung.herkunft)}`;
    gruppen.set(schluessel, [...(gruppen.get(schluessel) ?? []), messung]);
  }

  for (const reihe of gruppen.values()) {
    const sortierteReihe = [...reihe].sort((links, rechts) => links.t - rechts.t);
    const sigma = standardabweichung(sortierteReihe.map(messung => messung.wert));
    const basis = sortierteReihe.filter(messung => messung.t <= von).pop() ?? sortierteReihe[0];
    if (!basis) continue;

    const treffer = sortierteReihe.find(messung => messung.t > von && messung.t <= jetzt && Math.abs(messung.wert - basis.wert) > sigma);
    if (treffer) kandidaten.push(treffer.t);
  }

  return kandidaten.length > 0 ? Math.min(...kandidaten) : null;
};

/** One day of the Dichteband: what was written that day, and what was kept that day. */
export interface DichteTag {
  /** Start of the day, in the tent's zone. */
  t: number;
  dinge: number;
  bilder: number;
}

/** Beyond this the band is more bars than the track has pixels, and the oldest days fall away. */
const BAND_MAX_TAGE = 400;

/**
 * §8.1 - one bar per day, Dinge below and kept frames above. Days nobody
 * touched the app stay in the list with zeroes: a gap you can see is the whole
 * reason the band is drawn per day rather than per entry.
 */
export const dichteband = (zelt: Zelt, dinge: readonly Ding[], von: number, bis: number): DichteTag[] => {
  const zone = zoneVon(zelt);
  const erster = DateTime.fromMillis(von, { zone: zone }).startOf('day');
  const letzter = DateTime.fromMillis(bis, { zone: zone }).startOf('day');
  const gesamt = Math.floor(letzter.diff(erster, 'days').days) + 1;
  const tage = Math.min(Math.max(gesamt, 1), BAND_MAX_TAGE);
  // A grow longer than the band can draw loses its oldest days, never its
  // newest: the end of the track is where the thumb lives.
  const anfang = letzter.minus({ days: tage - 1 });

  const band: DichteTag[] = Array.from({ length: tage }, (_wert, index) => ({
    t: anfang.plus({ days: index }).toMillis(),
    dinge: 0,
    bilder: 0,
  }));

  for (const ding of lebend(dinge)) {
    const index = Math.floor(DateTime.fromMillis(ding.t, { zone: zone }).startOf('day').diff(anfang, 'days').days);
    if (index < 0 || index >= band.length) continue;
    if (ding.art === 'bild') band[index].bilder++;
    else band[index].dinge++;
  }

  return band;
};

/** How many values one scrub line can carry before it stops being one line. */
const SCRUB_WERTE = 3;

/**
 * Everything the scrub header prints while you drag, and everything the table
 * gains when you let go. Nothing here is persisted: it is a description of a
 * moment, recomputed from the same rows the screen already has.
 */
export interface Zeitlage {
  moment: number;
  tag: number;
  /** Line one after the date: what was measured then. */
  werte: Text[];
  /** Line two: how much was written around then. */
  zaehlung: Text[];
  /** `Damals galt:` - the last-known-value carry-forward, printed as prose. */
  damals: Text[];
  /** `Lief:` - outputs. Absent with no device, and never replaced by a lookalike. */
  lief: Text[];
  /** `Dinge ±2 Std:` - what was written around the moment, for the caller to name. */
  nahe: Ding[];
}

export interface ZeitlageEingabe {
  zelt: Zelt;
  dinge: readonly Ding[];
  messungen?: readonly Messung[];
  moment: number;
}

export const zeitlage = (eingabe: ZeitlageEingabe): Zeitlage => {
  const { zelt, dinge, moment } = eingabe;
  const messungen = eingabe.messungen ?? [];
  const zone = zoneVon(zelt);
  const bisJetzt = lebend(dinge).filter(ding => ding.t <= moment);
  const nahe = lebend(dinge)
    .filter(ding => Math.abs(ding.t - moment) <= FENSTER_MS)
    .sort((links, rechts) => links.t - rechts.t);

  return {
    moment: moment,
    tag: tagNummer(zone, laufBeginn(zelt, dinge), moment),
    werte: scrubWerte(bisJetzt, messungen, moment, nahe),
    zaehlung: scrubZaehlung(dinge, nahe),
    damals: damalsGalt(zelt, bisJetzt, zone, moment),
    lief: liefDamals(messungen, moment),
    nahe: nahe,
  };
};

const scrubWerte = (bisJetzt: readonly Ding[], messungen: readonly Messung[], moment: number, nahe: readonly Ding[]): Text[] => {
  const werte: Text[] = [];

  // A pour is the value of its own moment, and the reason the device-less
  // scrub line reads `2,0 l · pH 6,1` rather than only a pH.
  const gabe = nahe.filter(ding => ding.art === 'gabe' && zahl(ding.d?.['wasser_l']) !== null).pop();
  if (gabe) werte.push({ key: 'zelt.zeile.wasser', params: { liter: zahlText(zahl(gabe.d?.['wasser_l']) ?? 0, 2) } });

  const gemessen = messzeilen([
    ...handMessungen(bisJetzt),
    ...messungen.filter(messung => messung.t <= moment && !messung.mass.startsWith('out_')),
  ]);

  for (const zeile of gemessen.slice(0, SCRUB_WERTE)) {
    werte.push({
      key: 'zelt.lage.wert',
      params: {
        mass: { key: `zelt.mass.${zeile.mass}`, ersatz: zeile.mass },
        wert: zahlText(zeile.wert),
        einheit: einheitVon(zeile.mass),
      },
    });
  }

  return werte;
};

const scrubZaehlung = (dinge: readonly Ding[], nahe: readonly Ding[]): Text[] => {
  const zaehlung: Text[] = [{ key: pluralSchluessel('zelt.lage.eintraege', nahe.length), params: { anzahl: zahlText(nahe.length, 0) } }];

  const menschen = new Map(lebend(dinge).filter(ding => ding.art === 'mensch').map(ding => [ding.ding_id, ding.name]));
  for (const name of new Set(nahe.map(ding => menschen.get(ding.akteur ?? '')).filter(Boolean))) {
    zaehlung.push({ roh: name as string });
  }

  const foto = nahe.filter(ding => ding.art === 'bild').pop();
  if (foto) zaehlung.push({ key: 'zelt.lage.foto', params: { zeit: DateTime.fromMillis(foto.t).toFormat('HH:mm') } });

  return zaehlung;
};

/**
 * `Damals galt:` - what was true at that moment because somebody said so once.
 * It is a carry-forward, not a measurement, which is why a tent that has never
 * seen a device can answer it at all.
 */
const damalsGalt = (zelt: Zelt, bisJetzt: readonly Ding[], zone: string, moment: number): Text[] => {
  const damals: Text[] = [];

  const phase = neuestes(bisJetzt, ding => ding.art === 'phase');
  if (phase) {
    const stufe = typeof phase.d?.['stufe'] === 'string' ? (phase.d['stufe'] as string) : '';
    damals.push({
      key: 'zelt.lage.phase',
      params: { stufe: { key: `zelt.stufe.${stufe}`, ersatz: stufe }, tag: tagNummer(zone, phase.t, moment) },
    });
  }

  const schema = neuestes(bisJetzt, ding => ding.art === 'schema');
  const schritt = zahl(schema?.d?.['schritt']);
  if (schema && schritt !== null) damals.push({ key: 'zelt.lage.schema', params: { name: schema.name, schritt: schritt } });

  const plan = zelt?.d?.licht_plan;
  if (plan && typeof plan.an === 'number' && typeof plan.aus === 'number') {
    damals.push({ key: 'zelt.lage.lichtplan', params: { an: hhmm(plan.an, zone), aus: hhmm(plan.aus, zone) } });
  }

  return damals;
};

/** `Lief:` - the outputs, from the series that reported them. No series, no line. */
const liefDamals = (messungen: readonly Messung[], moment: number): Text[] => {
  const stand = messzeilen(messungen.filter(messung => messung.mass.startsWith('out_') && messung.t <= moment));

  return stand.map<Text>(zeile => {
    const rolle: Text = { key: `auxDevices.sockets.roles.${zeile.mass.slice(4)}`, ersatz: zeile.mass.slice(4) };
    // A dimmable light reports how far it is up; everything else is on or off,
    // and printing „100 %" for a socket the hardware can only switch would be
    // drawing something it cannot do.
    const gedimmt = zeile.mass === 'out_light' && zeile.wert > 0;
    const text: Text = {
      key: gedimmt ? 'zelt.lage.prozent' : zeile.wert > 0 ? 'zelt.lage.an' : 'zelt.lage.aus',
      params: gedimmt ? { mass: rolle, wert: zahlText(zeile.wert, 0) } : { mass: rolle },
    };
    return text;
  });
};
