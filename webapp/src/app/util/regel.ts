import type { Ding, Zelt } from '@fg2/shared-types';
import { calculateVpd } from './calculateVpd';
import { dauer } from './datum';
import { Text, VERALTET_MS } from './ding-text';
import { GROW_STAGE_PRESETS } from './grow-presets';
import { Messung } from './messquellen';
import { MINUTE_MS, Punkt, Reihe, STUNDE_MS, TAG_MS, laufzeitAnteil, luecken, naechte, reihen, schaltungen, standBei, steigungNach } from './reihe';
import { zahlText } from './zahl';

/** §9.3, in the order the table lists them. Evaluation order *is* the table order. */
export type RegelId = 'N-3' | 'N-4' | 'H-1' | 'H-2' | 'L-1' | 'E-1' | 'V-1' | 'K-1' | 'D-1' | 'F-1' | 'Z-1';

/**
 * What a rule is allowed to point at, and the whole of the list.
 *
 * > **Hard boundary: remedies are about the tent and the kit, never about the
 * > plant. No rule reads a picture as evidence about a plant.**
 *
 * The picture *describes* a difference (§9 ranks 3 and 5) and never diagnoses
 * one. The numbers may prescribe - but only for kit this app itself switches,
 * and every line names the rule that produced it so the advice can be argued
 * with. There is deliberately no `pflanze` member here and there must never be
 * one: a rule that wants to say something about a plant has no mechanism, and
 * a rule with no mechanism produces no line at all.
 */
export type Mechanismus = 'dose' | 'licht' | 'ziel' | 'gabe' | 'kamera' | 'geraet';

export interface RegelZeile {
  id: RegelId;
  text: Text;
  /** `ding_id` of the thing the line walks to. Never empty - see `Mechanismus`. */
  ziel: string;
  mechanismus: Mechanismus;
  /** `Regel N-3 ›`. The rule is printed alongside its own advice, always. */
  marke: Text;
}

export interface RegelEingabe {
  zelt: Zelt;
  dinge: readonly Ding[];
  messungen?: readonly Messung[];
  /** The left edge of what is being compared - the cursor, resolved. */
  vorher: number;
  jetzt: number;
}

/**
 * The image measures the ingest computes (§11.6). They may caption, they may
 * describe, they may join a second witness about the *lamp* - and they may
 * never be the evidence a remedy rests on. `L-1` is the one rule that touches
 * one at all, and only because the lamp is the other half of it: neither the
 * picture nor the switch state detects a dead contactor alone.
 */
export const BILDMASSE = ['gruenanteil', 'schaerfe', 'phash', 'kacheln', 'dx', 'dy'];

/**
 * §9.3, V-1: „`SOCKET_ROLES` is exactly `dehumidifier, heater, light,
 * secondary_light, co2`. **The tent cannot humidify and cannot actively
 * cool.**" So this list is empty on purpose, and it is a list rather than a
 * `false` so the day a cooling role exists the rule stops firing by itself.
 */
export const KUEHLENDE_ROLLEN: string[] = [];

/** §9.3, E-1. The device configuration in this codebase spells its modes `small` / `dry` / `off`. */
export const KUEHLENDE_BETRIEBSARTEN = ['temp', 'breed'];

/** L-1's lights-off band, on the 0…255 mean the ingest reports as `helligkeit`. */
export const HELLIGKEIT_AUS_BIS = 40;
export const HELLIGKEIT_AN_AB = 90;

const lebend = (dinge: readonly Ding[]): Ding[] => dinge.filter(ding => !ding.storniert_von);

const zahl = (roh: unknown): number | null => (typeof roh === 'number' && Number.isFinite(roh) ? roh : null);

const wort = (roh: unknown): string | null => (typeof roh === 'string' && roh !== '' ? roh : null);

const neustes = (dinge: readonly Ding[], passt: (ding: Ding) => boolean): Ding | null =>
  lebend(dinge).filter(passt).reduce<Ding | null>((bestes, ding) => (!bestes || ding.t > bestes.t ? ding : bestes), null);

/** The whole context every rule reads, built once so eleven rules cannot disagree about the facts. */
interface Lage {
  eingabe: RegelEingabe;
  reihen: Map<string, Reihe>;
  dosen: Ding[];
  rollen: string[];
  geraet: Ding | null;
  kamera: Ding | null;
  online: boolean;
  hatGeraet: boolean;
}

const reihe = (lage: Lage, mass: string): Reihe | null =>
  [...lage.reihen.values()].find(kandidat => kandidat.mass === mass && kandidat.herkunft.quelle !== 'hand') ?? null;

const punkte = (lage: Lage, mass: string): Punkt[] => reihe(lage, mass)?.punkte ?? [];

/** The newest setpoint under a key at a moment - device-written or hand-written, one lookup. */
const ziel = (lage: Lage, schluessel: string): Ding | null =>
  neustes(lage.eingabe.dinge, ding => ding.art === 'ziel' && wort(ding.d?.['schluessel']) === schluessel && ding.t <= lage.eingabe.jetzt);

const zielWert = (lage: Lage, schluessel: string): number | null => zahl(ziel(lage, schluessel)?.d?.['wert']);

const dose = (lage: Lage, rolle: string): Ding | null => lage.dosen.find(ding => wort(ding.d?.['rolle']) === rolle) ?? null;

const zeile = (id: RegelId, mechanismus: Mechanismus, zielDing: Ding | null, text: Text): RegelZeile | null =>
  // „**A rule that cannot name a mechanism produces no line at all.**" The
  // mechanism is a Ding that is actually in this tent, not a product category:
  // that is what stops a remedy pointing at hardware nobody owns.
  zielDing ? { id: id, text: text, ziel: zielDing.ding_id, mechanismus: mechanismus, marke: { key: 'zelt.regel.marke', params: { id: id } } } : null;

const grad = (wert: number): string => `${zahlText(wert, 1)} °C`;

/** N-3 - the night runs warm and nothing in the tent can cool it, so dim the one thing that heats it. */
const n3 = (lage: Lage): RegelZeile | null => {
  const zielNacht = zielWert(lage, 'night.temperature');
  if (zielNacht === null) return null;
  if (lage.rollen.some(rolle => KUEHLENDE_ROLLEN.includes(rolle))) return null;

  const fuenf = naechte(lage.eingabe.messungen ?? [], lage.eingabe.jetzt, 5);
  const warm = fuenf.filter(nacht => nacht.mittel !== null && nacht.mittel > zielNacht + 1.5);
  if (warm.length < 3) return null;

  // „Licht dimmen" is only advice if the light can be dimmed. A socket that can
  // only switch is not a dimmer, and the PWM series is what proves there is one.
  const licht = punkte(lage, 'out_light');
  const stand = standBei(licht, lage.eingabe.jetzt);
  if (!stand) return null;

  return zeile('N-3', 'licht', dose(lage, 'light') ?? lage.geraet, {
    key: 'zelt.regel.N-3',
    params: { ziel: grad(zielNacht), licht: zahlText(stand.wert, 0) },
  });
};

/** N-4 - the night target barely drops below the day target, which is a setting, not a fault. */
const n4 = (lage: Lage): RegelZeile | null => {
  const tag = zielWert(lage, 'day.temperature');
  const nacht = zielWert(lage, 'night.temperature');
  if (tag === null || nacht === null) return null;

  const absenkung = tag - nacht;
  // A night target *above* the day target is a different problem and §9.3 has
  // no line for it. Silence beats inventing one.
  if (absenkung < 0 || absenkung >= 1.5) return null;

  return zeile('N-4', 'ziel', ziel(lage, 'night.temperature'), {
    key: 'zelt.regel.N-4',
    params: { nacht: grad(nacht), abstand: grad(absenkung) },
  });
};

/** How far back H-1 looks for a run, and how finely it walks the window backwards. */
const H1_RUECKBLICK_MS = TAG_MS;
const H1_SCHRITT_MS = 10 * MINUTE_MS;

/** H-1 - the heater ran flat out and it stayed cold anyway. Either it is too small or it is not switching. */
const h1 = (lage: Lage): RegelZeile | null => {
  const heizung = punkte(lage, 'out_heater');
  const temperatur = punkte(lage, 'temperatur');
  if (heizung.length === 0 || temperatur.length === 0) return null;

  const jetzt = lage.eingabe.jetzt;
  let laengste: { von: number; kaelte: number } | null = null;

  for (let laenge = 2 * STUNDE_MS; laenge <= H1_RUECKBLICK_MS; laenge += H1_SCHRITT_MS) {
    const von = jetzt - laenge;
    if ((laufzeitAnteil(heizung, von, jetzt) ?? 0) < 0.9) break;

    const innen = temperatur.filter(punkt => punkt.t >= von && punkt.t <= jetzt);
    if (innen.length === 0) break;

    const abstaende = innen.map(punkt => (zielFuer(lage, punkt.t) ?? NaN) - punkt.wert);
    if (abstaende.some(abstand => !Number.isFinite(abstand) || abstand <= 1)) break;

    laengste = { von: von, kaelte: abstaende.reduce((summe, abstand) => summe + abstand, 0) / abstaende.length };
  }

  if (!laengste) return null;

  return zeile('H-1', 'dose', dose(lage, 'heater'), {
    key: 'zelt.regel.H-1',
    params: { dauer: dauer(jetzt - laengste.von), abstand: grad(laengste.kaelte) },
  });
};

/** Which temperature target was in force at a moment: the night one while the lamp was measured off. */
const zielFuer = (lage: Lage, t: number): number | null => {
  const licht = standBei(punkte(lage, 'out_light'), t);
  const schluessel = licht && licht.wert === 0 ? 'night.temperature' : 'day.temperature';
  return zielWert(lage, schluessel) ?? zielWert(lage, 'day.temperature');
};

/** H-2 - the socket switched all day and nothing followed it. Something is not plugged in. */
const h2 = (lage: Lage): RegelZeile | null => {
  const heizung = punkte(lage, 'out_heater');
  const temperatur = punkte(lage, 'temperatur');
  const jetzt = lage.eingabe.jetzt;

  const an = schaltungen(heizung, jetzt - TAG_MS, jetzt);
  if (an.length < 6) return null;

  const wirkungslos = an.filter(t => (steigungNach(temperatur, t, 10 * MINUTE_MS) ?? 1) <= 0);
  if (wirkungslos.length < 5) return null;

  return zeile('H-2', 'dose', dose(lage, 'heater'), { key: 'zelt.regel.H-2', params: { anzahl: an.length } });
};

/** How long the two witnesses have to disagree before L-1 believes them. */
const L1_FENSTER_MS = 15 * MINUTE_MS;

/**
 * L-1 - the switch says the lamp is on and the picture says the room is dark.
 *
 * This is the one rule that reads a frame, and it is not the picture
 * diagnosing anything: the frame is the second witness about **the lamp**,
 * which is kit this app switches. Neither half detects a dead contactor alone.
 */
const l1 = (lage: Lage): RegelZeile | null => {
  const licht = punkte(lage, 'out_light');
  const helligkeit = punkte(lage, 'helligkeit');
  if (licht.length === 0 || helligkeit.length === 0) return null;

  const jetzt = lage.eingabe.jetzt;
  const streit = helligkeit
    .filter(punkt => punkt.t >= jetzt - TAG_MS)
    .some(punkt => {
      const von = punkt.t - L1_FENSTER_MS;
      const stand = standBei(licht, von);
      const stabil = licht.filter(kandidat => kandidat.t > von && kandidat.t <= punkt.t);
      if (!stand) return false;

      const anzeit = [stand, ...stabil].map(kandidat => kandidat.wert);
      if (anzeit.every(wert => wert > 50) && punkt.wert <= HELLIGKEIT_AUS_BIS) return true;
      return anzeit.every(wert => wert === 0) && punkt.wert >= HELLIGKEIT_AN_AB;
    });

  return streit ? zeile('L-1', 'kamera', lage.kamera, { key: 'zelt.regel.L-1' }) : null;
};

/** E-1 - the dehumidifier never stops, and in this operating mode that socket is not dehumidifying at all. */
const e1 = (lage: Lage): RegelZeile | null => {
  const betriebsart = wort(ziel(lage, 'workmode')?.d?.['wert']);
  if (!betriebsart || !KUEHLENDE_BETRIEBSARTEN.includes(betriebsart)) return null;

  const jetzt = lage.eingabe.jetzt;
  const anteil = laufzeitAnteil(punkte(lage, 'out_dehumidifier'), jetzt - TAG_MS, jetzt);
  if (anteil === null || anteil < 0.8) return null;

  return zeile('E-1', 'dose', dose(lage, 'dehumidifier'), {
    key: 'zelt.regel.E-1',
    params: { dauer: dauer(anteil * TAG_MS), betriebsart: betriebsart },
  });
};

/** How long a day VPD may sit outside its band before V-1 says so. */
const V1_MINDESTDAUER_MS = 2 * STUNDE_MS;
/** How close to its target the air has to be for „the temperature is fine, the humidity is not" to hold. */
const V1_TEMPERATUR_BAND = 1.5;

/** V-1 - the VPD is out of band while the temperature is fine, so it is the humidity, which nothing here can raise. */
const v1 = (lage: Lage): RegelZeile | null => {
  const stufe = wort(neustes(lage.eingabe.dinge, ding => ding.art === 'phase' && ding.t <= lage.eingabe.jetzt)?.d?.['stufe']);
  const band = GROW_STAGE_PRESETS.find(preset => preset.stage === stufe)?.vpdRange;
  if (!stufe || !band) return null;

  const jetzt = lage.eingabe.jetzt;
  const vpd = punkte(lage, 'vpd').filter(punkt => punkt.t >= jetzt - TAG_MS);
  const temperatur = punkte(lage, 'temperatur');
  const feuchte = punkte(lage, 'luftfeuchte');
  if (vpd.length < 2) return null;

  let draussen = 0;
  for (let index = 1; index < vpd.length; index++) {
    const warm = standBei(temperatur, vpd[index].t);
    const zielTemperatur = zielFuer(lage, vpd[index].t);
    const passt = warm && zielTemperatur !== null && Math.abs(warm.wert - zielTemperatur) <= V1_TEMPERATUR_BAND;
    if (passt && (vpd[index].wert > band[1] || vpd[index].wert < band[0])) draussen += vpd[index].t - vpd[index - 1].t;
  }
  if (draussen < V1_MINDESTDAUER_MS) return null;

  const letzte = vpd[vpd.length - 1];
  const luft = standBei(temperatur, letzte.t);
  const ist = standBei(feuchte, letzte.t);
  if (!luft || !ist) return null;

  // `calculateVpd(T, T, 0)` is the saturation pressure at T, so the humidity a
  // target VPD needs falls straight out of it - no second formula, no drift
  // against the number the charts already draw.
  const saettigung = calculateVpd(luft.wert, luft.wert, 0);
  const zielVpd = letzte.wert > band[1] ? band[1] : band[0];
  const noetig = saettigung > 0 ? 100 * (1 - zielVpd / saettigung) : null;
  if (noetig === null) return null;

  return zeile('V-1', 'ziel', ziel(lage, 'day.humidity') ?? ziel(lage, 'day.vpd'), {
    key: 'zelt.regel.V-1',
    params: {
      wert: zahlText(letzte.wert, 2),
      stufe: { key: `zelt.stufe.${stufe}`, ersatz: stufe },
      unten: zahlText(band[0], 1),
      oben: zahlText(band[1], 1),
      temperatur: grad(luft.wert),
      noetig: zahlText(noetig, 0),
      ist: zahlText(ist.wert, 0),
    },
  });
};

/** §9 rank 1 and §9.3 K-1 read the same silence; this is how long it has to last. */
export const KAMERA_STILL_MS = 3 * STUNDE_MS;

/** K-1 - the tent is talking and the camera is not, so it is the camera. */
const k1 = (lage: Lage): RegelZeile | null => {
  if (!lage.kamera || !lage.online) return null;

  const still = lage.eingabe.jetzt - letztesBild(lage.eingabe.dinge, lage.kamera, lage.eingabe.jetzt);
  if (still < KAMERA_STILL_MS) return null;

  return zeile('K-1', 'kamera', lage.kamera, { key: 'zelt.regel.K-1', params: { dauer: dauer(still) } });
};

/** When the camera last produced a frame - the camera's own row knows, and the frames confirm it. */
export const letztesBild = (dinge: readonly Ding[], kamera: Ding | null, jetzt: number): number => {
  const gemeldet = zahl(kamera?.d?.['letztes_bild_t']) ?? 0;
  const frame = neustes(dinge, ding => ding.art === 'bild' && (wort(ding.d?.['quelle']) ?? 'geraet') === 'geraet' && ding.t <= jetzt);
  return Math.max(gemeldet, frame?.t ?? 0);
};

/** How long a series may say nothing before it counts as a hole rather than a pause. */
export const LUECKE_MS = 30 * MINUTE_MS;

/** D-1 - values and pictures stop in the same minute and start again together. That is not the camera. */
const d1 = (lage: Lage): RegelZeile | null => {
  const temperatur = punkte(lage, 'temperatur');
  if (temperatur.length < 2) return null;

  const loch = luecken(temperatur, lage.eingabe.vorher, lage.eingabe.jetzt, LUECKE_MS)
    .filter(fenster => !lage.eingabe.dinge.some(ding => ding.art === 'bild' && ding.t > fenster.von && ding.t < fenster.bis))
    .pop();
  if (!loch) return null;

  return zeile('D-1', 'geraet', lage.geraet, {
    key: 'zelt.regel.D-1',
    params: { von: uhr(loch.von), bis: uhr(loch.bis) },
  });
};

const uhr = (t: number): string => new Date(t).toTimeString().slice(0, 5);

/**
 * F-1 - the schema's next step came due and nothing was poured. The free
 * product's one proactive line, and one of the two rules that fire with no
 * device anywhere.
 *
 * `d.faellig_ab` is filled by the schema catalogue; until that slice lands
 * nothing sets it and the rule is silent, which is the correct behaviour for a
 * step whose due date nobody knows.
 */
const f1 = (lage: Lage): RegelZeile | null => {
  const schema = neustes(lage.eingabe.dinge, ding => ding.art === 'schema');
  const faellig = zahl(schema?.d?.['faellig_ab']);
  const schritt = zahl(schema?.d?.['schritt']);
  if (!schema || faellig === null || schritt === null || faellig > lage.eingabe.jetzt) return null;

  if (lage.eingabe.dinge.some(ding => ding.art === 'gabe' && !ding.storniert_von && ding.t >= faellig)) return null;

  return zeile('F-1', 'gabe', schema, {
    key: 'zelt.regel.F-1',
    params: { schritt: schritt + 1, dauer: dauer(lage.eingabe.jetzt - faellig) },
  });
};

/**
 * Z-1 - a target moved inside the window you are comparing, so the numbers on
 * the left were measured against a different one. The other rule that fires
 * device-less, for hand-written targets, by exactly the same mechanism.
 */
const z1 = (lage: Lage): RegelZeile | null => {
  const geaendert = lebend(lage.eingabe.dinge)
    .filter(ding => ding.art === 'ziel' && ding.t > lage.eingabe.vorher && ding.t <= lage.eingabe.jetzt)
    .filter(ding => lage.hatGeraet || wort(ding.d?.['quelle']) === 'hand')
    .sort((links, rechts) => rechts.t - links.t)[0];
  if (!geaendert) return null;

  const schluessel = wort(geaendert.d?.['schluessel']);
  const jetztWert = zahl(geaendert.d?.['wert']);
  const davor = lebend(lage.eingabe.dinge)
    .filter(ding => ding.art === 'ziel' && wort(ding.d?.['schluessel']) === schluessel && ding.t < geaendert.t)
    .sort((links, rechts) => rechts.t - links.t)[0];
  const vorherWert = zahl(davor?.d?.['wert']);
  if (schluessel === null || jetztWert === null || vorherWert === null) return null;

  return zeile('Z-1', 'ziel', geaendert, {
    key: 'zelt.regel.Z-1',
    params: {
      name: { key: `zelt.ziel.${schluessel}`, ersatz: schluessel },
      datum: new Date(geaendert.t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
      vorher: zahlText(vorherWert, 1),
      jetzt: zahlText(jetztWert, 1),
    },
  });
};

type RegelFunktion = (lage: Lage) => RegelZeile | null;

/**
 * §9.3, as a table rather than a judgement call. The order is the
 * specification's own, evaluation stops at the first line, and „**at most one
 * `→` line per Tafel**" is that `find`, not a policy somebody has to remember.
 */
const TABELLE: { id: RegelId; nurMitGeraet: boolean; pruefen: RegelFunktion }[] = [
  { id: 'N-3', nurMitGeraet: true, pruefen: n3 },
  { id: 'N-4', nurMitGeraet: true, pruefen: n4 },
  { id: 'H-1', nurMitGeraet: true, pruefen: h1 },
  { id: 'H-2', nurMitGeraet: true, pruefen: h2 },
  { id: 'L-1', nurMitGeraet: true, pruefen: l1 },
  { id: 'E-1', nurMitGeraet: true, pruefen: e1 },
  { id: 'V-1', nurMitGeraet: true, pruefen: v1 },
  { id: 'K-1', nurMitGeraet: true, pruefen: k1 },
  { id: 'D-1', nurMitGeraet: true, pruefen: d1 },
  { id: 'F-1', nurMitGeraet: false, pruefen: f1 },
  { id: 'Z-1', nurMitGeraet: false, pruefen: z1 },
];

/** The ids in table order, for the exhaustive test and for `Werte {…}`. */
export const REGEL_IDS: RegelId[] = TABELLE.map(eintrag => eintrag.id);

/** Which rules a tent with no device can ever see. §9.3: nine of eleven are silent, and no substitute is invented. */
export const REGELN_OHNE_GERAET: RegelId[] = TABELLE.filter(eintrag => !eintrag.nurMitGeraet).map(eintrag => eintrag.id);

const lageBauen = (eingabe: RegelEingabe): Lage => {
  const dosen = lebend(eingabe.dinge).filter(ding => ding.art === 'dose');
  const geraet = neustes(eingabe.dinge, ding => ding.art === 'geraet');
  const gesehen = zahl(geraet?.d?.['zuletzt_gesehen']) ?? 0;

  return {
    eingabe: eingabe,
    reihen: reihen(eingabe.messungen ?? []),
    dosen: dosen,
    rollen: dosen.map(ding => wort(ding.d?.['rolle']) ?? '').filter(Boolean),
    geraet: geraet,
    kamera: neustes(eingabe.dinge, ding => ding.art === 'kamera'),
    online: gesehen > 0 && eingabe.jetzt - gesehen <= VERALTET_MS,
    hatGeraet: (eingabe.zelt?.geraete?.length ?? 0) > 0 || geraet !== null,
  };
};

/**
 * §9.3's `→` line - the one that says what to *do*.
 *
 * Eleven rules, one order, at most one line. Each names what was measured, what
 * mechanism we own and one concrete change, and each walks to a Ding that is
 * really in this tent. Nine of them need a device and are **silent** without
 * one: when a device-less user hand-logs 31 °C a rule *could* fire as „ein
 * Controller hätte das gemerkt", and it does not. That restraint is the
 * discipline, not a gap in it.
 */
export const regel = (eingabe: RegelEingabe): RegelZeile | null => {
  const lage = lageBauen(eingabe);

  for (const eintrag of TABELLE) {
    if (eintrag.nurMitGeraet && !lage.hatGeraet) continue;
    const treffer = eintrag.pruefen(lage);
    if (treffer) return treffer;
  }

  return null;
};
