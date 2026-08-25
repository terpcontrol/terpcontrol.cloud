import { DateTime } from 'luxon';
import { Herkunft, Messung, herkunftSchluessel } from './messquellen';

export const MINUTE_MS = 60 * 1000;
export const STUNDE_MS = 60 * MINUTE_MS;
export const TAG_MS = 24 * STUNDE_MS;

/** §9 rank 4: „σ over the last 14". The same window ranks the table (§6.1 `nach Abweichung`). */
export const SIGMA_TAGE = 14;

/**
 * §9 rank 4, device-less: „**≥ 3 readings in 14 days** … Below three: no
 * clause." Two readings have a standard deviation and it means nothing, so
 * below this a measure has **no** σ rather than a small one - which is what
 * keeps a single second reading from being declared a change.
 */
export const SIGMA_MIN = 3;

/** §9 rank 4, device arm: „σ₁₄ same time of day ±1 h". */
export const TAGESZEIT_FENSTER_MS = STUNDE_MS;

/** One reading of one series, with the clock and nothing else. */
export interface Punkt {
  t: number;
  wert: number;
}

/** One series: one measure from one instrument, oldest first. */
export interface Reihe {
  /** `temperatur|hand`, `temperatur|geraet:c-17` - measure and origin, never measure alone (§3.1). */
  id: string;
  mass: string;
  herkunft: Herkunft;
  punkte: Punkt[];
}

/** Readings split by measure *and* origin, oldest first. Two instruments are two series, always. */
export const reihen = (messungen: readonly Messung[]): Map<string, Reihe> => {
  const gefunden = new Map<string, Reihe>();

  for (const messung of messungen) {
    if (!Number.isFinite(messung.wert) || !Number.isFinite(messung.t)) continue;

    const id = `${messung.mass}|${herkunftSchluessel(messung.herkunft)}`;
    const reihe = gefunden.get(id) ?? { id: id, mass: messung.mass, herkunft: messung.herkunft, punkte: [] };
    reihe.punkte.push({ t: messung.t, wert: messung.wert });
    gefunden.set(id, reihe);
  }

  for (const reihe of gefunden.values()) reihe.punkte.sort((links, rechts) => links.t - rechts.t);
  return gefunden;
};

export const standardabweichung = (werte: readonly number[]): number => {
  if (werte.length < 2) return 0;
  const mittel = werte.reduce((summe, wert) => summe + wert, 0) / werte.length;
  return Math.sqrt(werte.reduce((summe, wert) => summe + (wert - mittel) ** 2, 0) / werte.length);
};

/** Seconds of the day a moment sits at, in the tent's own zone. */
const tageszeit = (t: number, zone: string): number => {
  const zeit = DateTime.fromMillis(t, { zone: zone });
  return (zeit.isValid ? zeit : DateTime.fromMillis(t, { zone: 'UTC' })).toSeconds() % 86400;
};

/** How far apart two times of day are, across midnight. */
const abstandImTag = (links: number, rechts: number): number => {
  const roh = Math.abs(links - rechts);
  return Math.min(roh, 86400 - roh);
};

export interface SigmaEingabe {
  /** The moment the comparison ends at. The 14 days run backwards from here. */
  bis: number;
  zeitzone: string;
  /**
   * §9 rank 4's device arm compares a moment against the same time of day ±1 h,
   * because a controller's temperature swings by three degrees every night and
   * comparing 03:00 against 15:00 would call that a change every single time.
   * A hand series has a handful of readings taken whenever somebody was in the
   * room, so it is measured against all of them.
   */
  tageszeit?: boolean;
};

/**
 * The noise floor of one series: how far it usually moves on its own, so a
 * change can be weighed against it instead of against zero.
 *
 * `null` when there is not enough evidence to say - fewer than three readings
 * in fourteen days - and `null` is not a small σ. Every caller must treat it as
 * „unknown", never as „quiet".
 */
export const sigma = (reihe: Reihe, eingabe: SigmaEingabe): number | null => {
  const von = eingabe.bis - SIGMA_TAGE * TAG_MS;
  const bezug = tageszeit(eingabe.bis, eingabe.zeitzone);

  const werte = reihe.punkte
    .filter(punkt => punkt.t >= von && punkt.t <= eingabe.bis)
    .filter(
      punkt =>
        !eingabe.tageszeit ||
        abstandImTag(tageszeit(punkt.t, eingabe.zeitzone), bezug) <= TAGESZEIT_FENSTER_MS / 1000,
    )
    .map(punkt => punkt.wert);

  if (werte.length < SIGMA_MIN) return null;
  const streuung = standardabweichung(werte);
  return streuung > 0 ? streuung : null;
};

/** σ for every series behind a screen, keyed the way `messzeilen` keys its rows. */
export const sigmaJeReihe = (messungen: readonly Messung[], eingabe: SigmaEingabe): Map<string, number | null> => {
  const werte = new Map<string, number | null>();

  for (const reihe of reihen(messungen).values()) {
    // Hand readings are taken whenever somebody was in the room; only a series
    // that reports around the clock has a time of day worth matching.
    werte.set(reihe.id, sigma(reihe, { ...eingabe, tageszeit: eingabe.tageszeit && reihe.herkunft.quelle !== 'hand' }));
  }

  return werte;
};

/** The value a series held at a moment: the last thing it said at or before it. */
export const standBei = (punkte: readonly Punkt[], t: number): Punkt | null => {
  let treffer: Punkt | null = null;
  for (const punkt of punkte) {
    if (punkt.t > t) break;
    treffer = punkt;
  }
  return treffer;
};

/**
 * How much of a window an output was on, 0 … 1.
 *
 * An output reports its state, not its changes, so the honest reading is
 * hold-the-last-value between samples. A window with no sample before it and
 * none inside it answers `null` - „we do not know" - rather than 0, because a
 * heater nobody heard from is not a heater that was off.
 */
export const laufzeitAnteil = (punkte: readonly Punkt[], von: number, bis: number): number | null => {
  if (bis <= von) return null;

  const innen = punkte.filter(punkt => punkt.t > von && punkt.t <= bis);
  const davor = standBei(punkte, von);
  if (!davor && innen.length === 0) return null;

  let an = 0;
  let stand = davor?.wert ?? innen[0].wert;
  let letzte = von;

  for (const punkt of innen) {
    if (stand > 0) an += punkt.t - letzte;
    stand = punkt.wert;
    letzte = punkt.t;
  }
  if (stand > 0) an += bis - letzte;

  return an / (bis - von);
};

/** How often an output went from off to on inside a window. */
export const schaltungen = (punkte: readonly Punkt[], von: number, bis: number): number[] => {
  const zeiten: number[] = [];
  let stand = standBei(punkte, von)?.wert ?? 0;

  for (const punkt of punkte) {
    if (punkt.t <= von || punkt.t > bis) continue;
    if (stand <= 0 && punkt.wert > 0) zeiten.push(punkt.t);
    stand = punkt.wert;
  }

  return zeiten;
};

/** How far a series moved over a window that starts at a moment. Used to ask „and did it help?". */
export const steigungNach = (punkte: readonly Punkt[], t: number, fenster: number): number | null => {
  const innen = punkte.filter(punkt => punkt.t >= t && punkt.t <= t + fenster);
  if (innen.length < 2) return null;
  return innen[innen.length - 1].wert - innen[0].wert;
};

/** Where a series stopped reporting for longer than it should have. */
export const luecken = (punkte: readonly Punkt[], von: number, bis: number, mindestens: number): { von: number; bis: number }[] => {
  const innen = punkte.filter(punkt => punkt.t >= von && punkt.t <= bis);
  const gefunden: { von: number; bis: number }[] = [];

  for (let index = 1; index < innen.length; index++) {
    if (innen[index].t - innen[index - 1].t >= mindestens) {
      gefunden.push({ von: innen[index - 1].t, bis: innen[index].t });
    }
  }

  return gefunden;
};

/** One measured night: when the light was off, and what the air did meanwhile. */
export interface Nacht {
  von: number;
  bis: number;
  /** Mean of `temperatur` across the window, `null` when nothing measured it. */
  mittel: number | null;
}

/**
 * The nights this tent can prove it had, from the lamp it switches itself.
 *
 * A declared `licht_plan` is deliberately **not** accepted here: §9.3's night
 * rules act on the tent, and acting on a schedule somebody typed rather than on
 * a lamp that was measured off is how an advisor starts guessing. No `out_light`
 * series, no nights, no night rule.
 */
export const naechte = (messungen: readonly Messung[], bis: number, anzahl: number): Nacht[] => {
  const alle = reihen(messungen);
  const licht = [...alle.values()].find(reihe => reihe.mass === 'out_light');
  if (!licht) return [];

  const temperatur = [...alle.values()].find(reihe => reihe.mass === 'temperatur' && reihe.herkunft.quelle !== 'hand');
  const gefunden: Nacht[] = [];
  let von: number | null = null;

  for (let index = 1; index < licht.punkte.length; index++) {
    const vorher = licht.punkte[index - 1];
    const jetzt = licht.punkte[index];
    if (vorher.wert > 0 && jetzt.wert === 0) von = jetzt.t;
    else if (von !== null && vorher.wert === 0 && jetzt.wert > 0) {
      gefunden.push({ von: von, bis: vorher.t, mittel: mittelZwischen(temperatur, von, vorher.t) });
      von = null;
    }
  }

  return gefunden.filter(nacht => nacht.bis <= bis).slice(-anzahl).reverse();
};

const mittelZwischen = (reihe: Reihe | undefined, von: number, bis: number): number | null => {
  const werte = (reihe?.punkte ?? []).filter(punkt => punkt.t >= von && punkt.t <= bis).map(punkt => punkt.wert);
  return werte.length === 0 ? null : werte.reduce((summe, wert) => summe + wert, 0) / werte.length;
};
