import type { Ding, Zelt } from '@fg2/shared-types';
import { dauer, wochentagText } from './datum';
import { Text, VERALTET_MS } from './ding-text';
import { einheitVon } from './einheiten';
import { Messung } from './messquellen';
import { KAMERA_STILL_MS, RegelZeile, letztesBild, regel } from './regel';
import { MINUTE_MS, SIGMA_MIN, STUNDE_MS, naechte, reihen, sigma, standBei, standardabweichung } from './reihe';
import { handMessungen } from './unterschied';
import { pluralSchluessel, zahlText } from './zahl';
import { laufBeginn, tagNummer } from './zelt-tag';

/** §9. Eight ranks, one order, one implementation - and rank 8 has five rungs of its own (§9.2). */
export type SatzRang = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8a' | '8b' | '8c' | '8d' | '8e';

export interface Klausel {
  rang: SatzRang;
  text: Text;
  /**
   * Whether this clause may be lowercased when it lands second in a composed
   * sentence. „Anna hat gegossen" may not; „du hast gegossen" may.
   */
  kleinbar: boolean;
  /** §9.2 - 8a and 8c move the Vorher half to the last moment that has evidence. */
  vorherNeu?: number;
}

export interface Satz {
  /** The rung that produced the sentence. The second clause's rank is in `klauseln`. */
  rang: SatzRang;
  /** One or two, in ladder order. */
  klauseln: Klausel[];
  /** §9.3's `→` line. At most one, and absent whenever no rule can name a mechanism. */
  regel: RegelZeile | null;
  /** Where the Vorher half moved to, when rank 8a or 8c moved it. */
  vorherNeu: number | null;
}

/** §9: „The first two matches compose with „ und " (second clause lowercased), ≤ 90 chars, else one clause." */
export const SATZ_MAX = 90;

/** §9 rank 2. */
export const OFFLINE_MS = 30 * MINUTE_MS;
/** §9 rank 3, device arm: „`gruenanteil` ±3 pp". */
export const GRUEN_SCHWELLE = 3;
/** §9 rank 3, device-less arm: „≥ 2 readings in the span". */
export const HOEHE_MIN_MESSUNGEN = 2;
/** How far around a moment 8a looks for something the previous run left behind. */
const LAUF_FENSTER_MS = 12 * STUNDE_MS;

export interface SatzEingabe {
  zelt: Zelt;
  dinge: readonly Ding[];
  messungen?: readonly Messung[];
  /** The resolved Vorher moment - what `vorherLage` decided, not the raw cursor. */
  vorher: number;
  jetzt: number;
}

const lebend = (dinge: readonly Ding[]): Ding[] => dinge.filter(ding => !ding.storniert_von);

const zahl = (roh: unknown): number | null => (typeof roh === 'number' && Number.isFinite(roh) ? roh : null);

const wort = (roh: unknown): string | null => (typeof roh === 'string' && roh !== '' ? roh : null);

const neustes = (dinge: readonly Ding[], passt: (ding: Ding) => boolean): Ding | null =>
  lebend(dinge).filter(passt).reduce<Ding | null>((bestes, ding) => (!bestes || ding.t > bestes.t ? ding : bestes), null);

/**
 * What a *person* put in the diary. A camera frame and a device log line are
 * entries too, but „zuletzt eingetragen" is a claim about somebody having been
 * there, and a controller reporting every five seconds is not that.
 */
export const menschlich = (ding: Ding): boolean =>
  !ding.storniert_von &&
  (['gabe', 'notiz', 'phase', 'zustand', 'pflanze'].includes(ding.art) ||
    (ding.art === 'bild' && (wort(ding.d?.['quelle']) ?? 'geraet') === 'hand'));

const imFenster = (dinge: readonly Ding[], von: number, bis: number): Ding[] =>
  lebend(dinge).filter(ding => ding.t > von && ding.t <= bis);

/** Whose entries these are, when they are all one person's and that person has a name. */
const akteurName = (dinge: readonly Ding[], umfeld: readonly Ding[]): string | null => {
  const akteure = new Set(dinge.map(ding => ding.akteur ?? ''));
  if (akteure.size !== 1) return null;

  const mensch = umfeld.find(ding => ding.art === 'mensch' && ding.ding_id === [...akteure][0]);
  return mensch?.name?.trim() || null;
};

/** `zwei`, `drei`, … and the digit when the language has no word left. */
const zahlwort = (anzahl: number): Text => ({ key: `zelt.zahlwort.${anzahl}`, ersatz: zahlText(anzahl, 0) });

/** `zweimal`, `dreimal`, … same idea, for how often something was done. */
const malwort = (anzahl: number): Text => ({
  key: `zelt.satz.mal.${anzahl}`,
  ersatz: `${zahlText(anzahl, 0)}-mal`,
});

const klausel = (rang: SatzRang, text: Text, zusatz: Partial<Klausel> = {}): Klausel => ({
  rang: rang,
  text: text,
  kleinbar: true,
  ...zusatz,
});

const hatGeraet = (eingabe: SatzEingabe): boolean =>
  (eingabe.zelt?.geraete?.length ?? 0) > 0 || lebend(eingabe.dinge).some(ding => ding.art === 'geraet');

/** Rank 1 - the camera has gone quiet. Never matches with no device: there is no camera row to be quiet. */
const rang1 = (eingabe: SatzEingabe): Klausel | null => {
  const kamera = neustes(eingabe.dinge, ding => ding.art === 'kamera');
  if (!kamera) return null;

  const still = eingabe.jetzt - letztesBild(eingabe.dinge, kamera, eingabe.jetzt);
  return still >= KAMERA_STILL_MS ? klausel('1', { key: 'zelt.satz.kamerastill', params: { dauer: dauer(still) } }) : null;
};

/** Rank 2 - the tent stopped talking. Never matches with no device: nothing was talking. */
const rang2 = (eingabe: SatzEingabe): Klausel | null => {
  const gesehen = zahl(neustes(eingabe.dinge, ding => ding.art === 'geraet')?.d?.['zuletzt_gesehen']);
  if (gesehen === null || gesehen === 0) return null;

  const weg = eingabe.jetzt - gesehen;
  return weg >= OFFLINE_MS ? klausel('2', { key: 'zelt.satz.offline', params: { dauer: dauer(weg) } }) : null;
};

/**
 * Rank 3 - growth, said two ways by two densities of evidence and never by
 * two ladders. The picture *describes* what changed in it and stops there; the
 * tape measure says what it measured. Neither diagnoses anything.
 */
const rang3 = (eingabe: SatzEingabe): Klausel | null => {
  const gruen = [...reihen(eingabe.messungen ?? []).values()].find(reihe => reihe.mass === 'gruenanteil');
  const davor = gruen ? standBei(gruen.punkte, eingabe.vorher) : null;
  const danach = gruen ? standBei(gruen.punkte, eingabe.jetzt) : null;

  if (davor && danach && Math.abs(danach.wert - davor.wert) >= GRUEN_SCHWELLE) {
    return klausel('3', { key: danach.wert > davor.wert ? 'zelt.satz.gewachsen' : 'zelt.satz.wenigerGruen' });
  }

  const hoehe = handMessungen(lebend(eingabe.dinge).filter(ding => ding.t <= eingabe.jetzt))
    .filter(messung => messung.mass === 'hoehe_cm')
    .sort((links, rechts) => links.t - rechts.t);
  const inSpanne = hoehe.filter(messung => messung.t > eingabe.vorher);
  if (hoehe.length < HOEHE_MIN_MESSUNGEN || inSpanne.length === 0) return null;

  const anfang = hoehe.filter(messung => messung.t <= eingabe.vorher).pop() ?? hoehe[0];
  const ende = hoehe[hoehe.length - 1];
  if (anfang.wert === ende.wert) return null;

  return klausel('3', {
    key: 'zelt.satz.hoehe',
    params: { vorher: zahlText(anfang.wert, 0), jetzt: zahlText(ende.wert, 0) },
  });
};

/** Measures that are a state of the kit or a property of an image, and never the subject of „X ist gestiegen". */
const KEINE_SATZ_MASSE = (mass: string): boolean =>
  mass.startsWith('out_') || ['gruenanteil', 'helligkeit', 'schaerfe', 'phash', 'dx', 'dy'].includes(mass);

/**
 * Rank 4 - a measure moved further than that measure usually moves.
 *
 * σ is the whole rung: without it „der pH ist gefallen" fires on the third
 * decimal place every time anybody opens the screen. A hand series with fewer
 * than three readings in fourteen days has no σ, and §9 is explicit about what
 * happens then - **no clause**, not a smaller claim.
 */
const rang4 = (eingabe: SatzEingabe): Klausel | null => {
  const nacht = nachtKlausel(eingabe);
  if (nacht) return nacht;

  const zone = eingabe.zelt?.zeitzone ?? 'UTC';
  const alle = reihen([...(eingabe.messungen ?? []), ...handMessungen(eingabe.dinge)]);

  let bestes: { klausel: Klausel; abweichung: number } | null = null;
  for (const reihe of alle.values()) {
    if (KEINE_SATZ_MASSE(reihe.mass)) continue;

    const streuung = sigma(reihe, { bis: eingabe.jetzt, zeitzone: zone, tageszeit: reihe.herkunft.quelle !== 'hand' });
    if (streuung === null) continue;

    const davor = standBei(reihe.punkte, eingabe.vorher);
    const danach = standBei(reihe.punkte, eingabe.jetzt);
    if (!davor || !danach || davor.t === danach.t) continue;

    const delta = danach.wert - davor.wert;
    if (Math.abs(delta) <= streuung) continue;

    const einheit = einheitVon(reihe.mass);
    const kandidat = klausel('4', {
      key: delta > 0 ? 'zelt.satz.gestiegen' : 'zelt.satz.gefallen',
      params: {
        mass: { key: `zelt.massSatz.${reihe.mass}`, ersatz: reihe.mass },
        vorher: zahlText(davor.wert),
        jetzt: einheit ? `${zahlText(danach.wert)} ${einheit}` : zahlText(danach.wert),
      },
    });

    const abweichung = Math.abs(delta) / streuung;
    if (!bestes || abweichung > bestes.abweichung) bestes = { klausel: kandidat, abweichung: abweichung };
  }

  return bestes?.klausel ?? null;
};

/**
 * The night is its own measure, because §9's device arm compares like with
 * like: „σ₁₄ same time of day ±1 h". A night mean against the nights before it
 * is that comparison in its cleanest form, and it is the sentence §6.1 draws.
 */
const nachtKlausel = (eingabe: SatzEingabe): Klausel | null => {
  const gemessen = naechte(eingabe.messungen ?? [], eingabe.jetzt, 15).filter(nacht => nacht.mittel !== null);
  if (gemessen.length < SIGMA_MIN + 1) return null;

  const [letzte, ...davor] = gemessen;
  if (letzte.von <= eingabe.vorher) return null;

  const mittel = davor.reduce((summe, nacht) => summe + (nacht.mittel ?? 0), 0) / davor.length;
  const streuung = standardabweichung(davor.map(nacht => nacht.mittel ?? 0));
  const delta = (letzte.mittel ?? 0) - mittel;
  if (streuung <= 0 || Math.abs(delta) <= streuung) return null;

  return klausel('4', { key: delta > 0 ? 'zelt.satz.nachtsWaermer' : 'zelt.satz.nachtsKuehler' });
};

/** How concentrated a change has to be before rank 5 will point at a corner of the frame. */
const KACHEL_KONZENTRATION = 2;

/**
 * Rank 5 - where in the frame something moved. `kacheln` says **where**, never
 * **what** (§11.6), and this clause says exactly that and nothing more. Never
 * matches with no device: hand photos are shown, not measured.
 */
const rang5 = (eingabe: SatzEingabe): Klausel | null => {
  const frame = neustes(
    eingabe.dinge,
    ding => ding.art === 'bild' && (wort(ding.d?.['quelle']) ?? 'geraet') === 'geraet' && ding.t <= eingabe.jetzt && ding.t > eingabe.vorher,
  );
  const kacheln = frame?.d?.['kacheln'];
  if (!Array.isArray(kacheln) || kacheln.length === 0) return null;

  const werte = kacheln.map(wert => (typeof wert === 'number' && Number.isFinite(wert) ? wert : 0));
  const sortiert = [...werte].sort((links, rechts) => links - rechts);
  const p90 = sortiert[Math.min(sortiert.length - 1, Math.floor(sortiert.length * 0.9))];
  const median = sortiert[Math.floor(sortiert.length / 2)];
  const hoechste = Math.max(...werte);

  // „≥ p90" localises nothing on its own - the largest tile always is. The
  // clause is only worth printing when the change actually sits in one place.
  if (hoechste <= 0 || hoechste < p90 || hoechste < median * KACHEL_KONZENTRATION) return null;

  return klausel('5', { key: 'zelt.satz.kachel', params: { ort: { key: `zelt.satz.ort.${ort(werte.indexOf(hoechste), werte.length)}` } } });
};

/** Which ninth of the frame a tile of the 8×6 grid sits in. */
const ort = (index: number, anzahl: number): string => {
  const spalten = 8;
  const zeilen = Math.max(1, Math.round(anzahl / spalten));
  const senkrecht = ['oben', 'mitte', 'unten'][Math.min(2, Math.floor((Math.floor(index / spalten) / zeilen) * 3))];
  const waagerecht = ['Links', 'Mitte', 'Rechts'][Math.min(2, Math.floor(((index % spalten) / spalten) * 3))];
  return `${senkrecht}${waagerecht}`;
};

/** Rank 6 - a target moved. The same mechanism at both densities: a `ZielStand` is a `ZielStand`. */
const rang6 = (eingabe: SatzEingabe): Klausel | null => {
  const geaendert = imFenster(eingabe.dinge, eingabe.vorher, eingabe.jetzt)
    .filter(ding => ding.art === 'ziel')
    .sort((links, rechts) => rechts.t - links.t)[0];
  if (!geaendert) return null;

  const schluessel = wort(geaendert.d?.['schluessel']);
  const wert = geaendert.d?.['wert'];
  if (!schluessel || (typeof wert !== 'number' && typeof wert !== 'string')) return null;

  const vonHand = wort(geaendert.d?.['quelle']) !== 'geraet';
  const einheit = einheitVon(schluessel);
  const gezeigt = typeof wert === 'number' ? `${zahlText(wert)}${einheit ? ` ${einheit}` : ''}` : wert;

  return klausel(
    '6',
    {
      key: vonHand ? 'zelt.satz.zielDu' : 'zelt.satz.zielGeraet',
      params: { ziel: { key: `zelt.ziel.${schluessel}`, ersatz: schluessel }, wert: gezeigt },
    },
    // The device clause opens with the target's own name, and „ziel
    // Tag-Temperatur steht jetzt auf 25 °C" is not German.
    { kleinbar: vonHand },
  );
};

/** §9 rank 7's template table, in its own order. The widened one: every art a person can write. */
const RANG7_ARTEN: Ding['art'][] = ['gabe', 'phase', 'notiz', 'bild', 'pflanze', 'zustand'];

/** Rank 7 - somebody was in the tent. One clause, from the first art in the table that has entries. */
const rang7 = (eingabe: SatzEingabe): Klausel | null => {
  const neu = imFenster(eingabe.dinge, eingabe.vorher, eingabe.jetzt).filter(menschlich);

  for (const art of RANG7_ARTEN) {
    const eigene = neu.filter(ding => ding.art === art);
    if (eigene.length === 0) continue;

    const name = akteurName(eigene, eingabe.dinge);
    const anzahl = eigene.length;

    if (art === 'phase') {
      const stufe = wort(eigene[eigene.length - 1].d?.['stufe']) ?? '';
      return klausel('7', {
        key: 'zelt.satz.phase',
        params: {
          // A stage opens this clause, so it needs the article German gives it:
          // `Die Blüte`, `Der Sämling`, `Das Wachstum`. The bare label the rows
          // and the bands use would read „Die Wachstum".
          stufe: { key: `zelt.stufeSatz.${stufe}`, ersatz: stufe },
          datum: new Date(eigene[eigene.length - 1].t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
        },
      });
    }

    if (art === 'pflanze') {
      return klausel(
        '7',
        { key: 'zelt.satz.pflanze', params: { name: eigene[0].name?.trim() || zahlwort(anzahl) } },
        // A plant's name opens the clause, and „a4 ist dazugekommen" is not German.
        { kleinbar: false },
      );
    }

    const params: Record<string, Text | string | number> = { anzahl: zahlwort(anzahl), mal: malwort(anzahl) };
    if (name) params['name'] = name;

    return klausel(
      '7',
      { key: `zelt.satz.${art}.${name ? 'wer' : 'du'}.${anzahl === 1 ? 'eins' : 'viele'}`, params: params },
      { kleinbar: !name },
    );
  }

  return null;
};

/**
 * §9.2 - rank 8, the empty day, and the one line the daily visitor sees most.
 *
 * > **Rank 8 never comments on the user.** It recalls, in this order, and the
 * > diff table underneath still shows every delta, so nothing is lost when the
 * > sentence is quiet.
 *
 * `Seit gestern hast du nichts eingetragen.` is not in here and must not be
 * added at any rung: an app that reports on your diligence every time you open
 * it is deleted in week three.
 */
const rang8 = (eingabe: SatzEingabe): Klausel => {
  const zone = eingabe.zelt?.zeitzone ?? 'UTC';

  const lauf = laufRueckblick(eingabe, zone);
  if (lauf) return lauf;

  const schema = neustes(eingabe.dinge, ding => ding.art === 'schema' && ding.t <= eingabe.jetzt);
  const schritt = zahl(schema?.d?.['schritt']);
  if (schema && schritt !== null) {
    return klausel('8b', { key: 'zelt.satz.naechster', params: { schritt: schritt + 1 } });
  }

  const zuletzt = lebend(eingabe.dinge)
    .filter(ding => menschlich(ding) && ding.t <= eingabe.jetzt)
    .sort((links, rechts) => rechts.t - links.t)[0];
  if (zuletzt) {
    return klausel(
      '8c',
      { key: 'zelt.satz.zuletztEingetragen', params: { tag: wochentagText(zuletzt.t), was: tagesbilanz(eingabe.dinge, zuletzt.t, zone) } },
      // The Vorher half moves to that day, so the screen shows you something
      // instead of reporting an absence.
      { vorherNeu: zuletzt.t },
    );
  }

  if (hatGeraet(eingabe)) {
    return klausel('8d', { key: 'zelt.satz.wenigGeaendert', params: { tag: wochentagText(eingabe.vorher) } });
  }

  // 8e. The day-one line, and now the last rung of the one ladder rather than a
  // second code path that also writes a sentence.
  return klausel('8e', { key: 'zelt.tagEins' });
};

/** 8a - the same day number in the previous run, which is the run-over-run comparison, free (§3.2). */
const laufRueckblick = (eingabe: SatzEingabe, zone: string): Klausel | null => {
  const laeufe = lebend(eingabe.dinge)
    .filter(ding => ding.art === 'lauf')
    .sort((links, rechts) => rechts.t - links.t);
  const offen = laeufe.find(ding => ding.t_ende === null) ?? laeufe[0];
  const vorher = laeufe.find(ding => offen && ding.t < offen.t);
  if (!offen || !vorher) return null;

  const damals = vorher.t + (eingabe.jetzt - offen.t);
  const belegt = lebend(eingabe.dinge).some(ding => Math.abs(ding.t - damals) <= LAUF_FENSTER_MS && menschlich(ding));
  if (!belegt) return null;

  const tag = tagNummer(zone, laufBeginn(eingabe.zelt, eingabe.dinge), eingabe.jetzt);
  const abstand = phasenAbstand(eingabe, offen, vorher, zone);

  const text: Text =
    abstand === null
      ? { key: 'zelt.satz.laufBild', params: { tag: tag } }
      : abstand === 0
      ? { key: 'zelt.satz.laufGleich', params: { tag: tag } }
      : {
          key: abstand > 0 ? 'zelt.satz.laufWeiter' : 'zelt.satz.laufZurueck',
          params: { tag: tag, tage: { key: pluralSchluessel('zelt.satz.tage', Math.abs(abstand)), params: { anzahl: zahlwort(Math.abs(abstand)) } } },
        };

  return klausel('8a', text, { vorherNeu: damals });
};

/** How many days earlier the previous run reached the stage this one is in. */
const phasenAbstand = (eingabe: SatzEingabe, offen: Ding, vorher: Ding, zone: string): number | null => {
  const jetztPhase = neustes(eingabe.dinge, ding => ding.art === 'phase' && ding.t >= offen.t && ding.t <= eingabe.jetzt);
  const stufe = wort(jetztPhase?.d?.['stufe']);
  if (!jetztPhase || !stufe) return null;

  const damalsPhase = lebend(eingabe.dinge)
    .filter(ding => ding.art === 'phase' && wort(ding.d?.['stufe']) === stufe && ding.t >= vorher.t && ding.t < offen.t)
    .sort((links, rechts) => links.t - rechts.t)[0];
  if (!damalsPhase) return null;

  return tagNummer(zone, offen.t, jetztPhase.t) - tagNummer(zone, vorher.t, damalsPhase.t);
};

/** What one day held, in the words 8c uses: „2,0 l und ein Foto". */
const tagesbilanz = (dinge: readonly Ding[], t: number, zone: string): Text => {
  // The calendar day in the tent's own zone, counted from a fixed origin so two
  // moments can be compared without either of them being the origin.
  const kalendertag = (moment: number): number => tagNummer(zone, 0, moment);
  const tag = kalendertag(t);
  const selbe = lebend(dinge).filter(ding => menschlich(ding) && kalendertag(ding.t) === tag);

  const teile: Text[] = [];
  const wasser = selbe
    .filter(ding => ding.art === 'gabe')
    .reduce<number | null>((summe, ding) => (zahl(ding.d?.['wasser_l']) === null ? summe : (summe ?? 0) + (zahl(ding.d?.['wasser_l']) ?? 0)), null);
  if (wasser !== null) teile.push({ key: 'zelt.zeile.wasser', params: { liter: zahlText(wasser, 1) } });

  const fotos = selbe.filter(ding => ding.art === 'bild').length;
  if (fotos > 0) teile.push({ key: pluralSchluessel('zelt.satz.fotos', fotos), params: { anzahl: zahlwort(fotos) } });

  const notizen = selbe.filter(ding => ding.art === 'notiz').length;
  if (teile.length < 2 && notizen > 0) teile.push({ key: pluralSchluessel('zelt.satz.notizen', notizen), params: { anzahl: zahlwort(notizen) } });

  if (teile.length === 0) return { key: pluralSchluessel('zelt.lage.eintraege', selbe.length), params: { anzahl: zahlText(selbe.length, 0) } };
  return teile.length === 1 ? teile[0] : { key: 'zelt.satz.und', params: { links: teile[0], rechts: teile[1] } };
};

const LADDER: ((eingabe: SatzEingabe) => Klausel | null)[] = [rang1, rang2, rang3, rang4, rang5, rang6, rang7];

/**
 * §9 - the one ladder. Deterministic, ranked, and computed once per screen
 * entry rather than re-ranked while somebody looks at it.
 *
 * There is one of these for every density of evidence. Which ranks *can* match
 * is decided by what evidence exists - ranks 1, 2 and 5 simply never match with
 * no device, because there is no camera row, nothing was reporting, and hand
 * photos are shown rather than measured. They are **not evaluated**, not
 * greyed and not „keine Daten".
 *
 * Two ladders would mean two rank orders, two key sets, two sets of edge cases
 * in the compose logic and a third undefined behaviour on the mixed Zelt where
 * both could match - and the mixed Zelt is where every upgraded account lives
 * forever.
 */
export const satz = (eingabe: SatzEingabe): Satz => {
  const klauseln: Klausel[] = [];
  for (const rang of LADDER) {
    const treffer = rang(eingabe);
    if (treffer) klauseln.push(treffer);
    if (klauseln.length === 2) break;
  }

  const gewaehlt = klauseln.length > 0 ? klauseln : [rang8(eingabe)];

  return {
    rang: gewaehlt[0].rang,
    klauseln: gewaehlt,
    regel: regel({ zelt: eingabe.zelt, dinge: eingabe.dinge, messungen: eingabe.messungen, vorher: eingabe.vorher, jetzt: eingabe.jetzt }),
    vorherNeu: gewaehlt.find(eine => eine.vorherNeu !== undefined)?.vorherNeu ?? null,
  };
};

const kleinAnfang = (satzteil: string): string => satzteil.charAt(0).toLowerCase() + satzteil.slice(1);

/**
 * §9's composition rule, and the one place a `Text` has to become a string
 * before it is finished: „ und " needs the second clause's first letter, and a
 * 90-character bound needs the characters.
 *
 * The resolver is handed in so the rule stays a pure function - the sentence is
 * the same in every language, and only the words are not.
 */
export const satzText = (klauseln: readonly Klausel[], aufloesen: (text: Text) => string, grenze = SATZ_MAX): string => {
  const teile = klauseln.map(eine => aufloesen(eine.text).trim()).filter(Boolean);
  if (teile.length === 0) return '';
  if (teile.length === 1) return teile[0];

  const zweiter = klauseln[1].kleinbar ? kleinAnfang(teile[1]) : teile[1];
  const zusammen = `${teile[0].replace(/[.!?]$/, '')} und ${zweiter}`;
  return zusammen.length <= grenze ? zusammen : teile[0];
};
