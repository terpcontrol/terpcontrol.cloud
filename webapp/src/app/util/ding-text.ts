import type { Ding, DingArt } from '@fg2/shared-types';

/**
 * A piece of text before it has a language. Exactly one of the three is set:
 * `roh` is text a human typed and is printed as it stands, `logSchluessel` is a
 * `message-*` key a device sent, and `key` is one of ours.
 */
export interface Text {
  key?: string;
  params?: Record<string, TextParam>;
  /** Printed when `key` resolves to nothing but itself. */
  ersatz?: string;
  roh?: string;
  logSchluessel?: string;
}

export type TextParam = string | number | Text;

/** How the 12 px square in front of a row reads. §6.4. */
export type Marke = 'voll' | 'hohl' | 'offen' | 'alarm';

/** After this long without a word, a device's row is stale rather than fresh. §6.4. */
export const VERALTET_MS = 10 * 60 * 1000;

const zahl = (ding: Ding, feld: string): number | null => {
  const wert = ding.d?.[feld];
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null;
};

const wort = (ding: Ding, feld: string): string | null => {
  const wert = ding.d?.[feld];
  return typeof wert === 'string' && wert !== '' ? wert : null;
};

/**
 * Arts whose row stands for something that is *reporting*. Only they can go
 * stale, because only they have somebody who was supposed to have said
 * something by now. A watering does not go stale.
 */
const MELDENDE_ARTEN: DingArt[] = ['geraet', 'dose', 'kamera'];

/**
 * Arts that are a standing fact rather than a moment. They read hollow the way
 * `◻ Ziele` and `◻ + Gerät hinzufügen` do in §6.2 - present, current, and not
 * something that just happened.
 */
const STEHENDE_ARTEN: DingArt[] = ['zelt', 'schema', 'ziel'];

/**
 * The one name every art gets, in the reader's language. A device, a socket, a
 * camera and a schema all reach the app nameless on purpose - the server has no
 * locale and must not put German in the database - so the key is what travels
 * and the label is made here.
 */
export const dingName = (ding: Ding): Text => {
  const getippt = ding.name?.trim();

  switch (ding.art) {
    case 'dose':
      return {
        key: 'zelt.zeile.dose',
        params: {
          rolle: { key: `auxDevices.sockets.roles.${wort(ding, 'rolle') ?? getippt ?? ''}`, ersatz: wort(ding, 'rolle') ?? getippt ?? '' },
          slot: (zahl(ding, 'slot') ?? 0) + 1,
        },
      };
    case 'kamera':
      return { key: 'zelt.arten.kamera' };
    case 'bild':
      return { key: wort(ding, 'quelle') === 'hand' ? 'zelt.zeile.bildHand' : 'zelt.zeile.bildGeraet' };
    case 'film':
      return { key: 'zelt.arten.film' };
    case 'phase':
      return { key: `zelt.stufe.${wort(ding, 'stufe') ?? ''}`, ersatz: wort(ding, 'stufe') ?? '' };
    case 'ziel':
      return { key: `zelt.ziel.${wort(ding, 'schluessel') ?? getippt ?? ''}`, ersatz: wort(ding, 'schluessel') ?? getippt ?? '' };
    case 'zustand':
      return { roh: wort(ding, 'text') ?? getippt ?? '' };
    case 'notiz':
      // A note typed today carries its own text; one projected out of the old
      // diary carries the category key the sheet titled it with.
      return wort(ding, 'text') ? { roh: wort(ding, 'text') ?? '' } : { logSchluessel: getippt ?? '' };
    case 'ereignis':
      return { logSchluessel: getippt ?? '' };
    case 'gabe':
      return getippt ? { roh: getippt } : { key: 'zelt.arten.gabe' };
    case 'lauf':
      return { key: 'zelt.zeile.lauf', params: { nummer: zahl(ding, 'nummer') ?? 0 } };
    case 'schema':
      return getippt ? { roh: getippt } : { key: 'zelt.arten.schema', ersatz: wort(ding, 'schema_id') ?? '' };
    default:
      return getippt ? { roh: getippt } : { key: `zelt.arten.${ding.art}` };
  }
};

/**
 * The middle column - what the row is worth, when `d` alone says so. Anything
 * that needs a second Ding to work out (a plant's phase, a socket's live state)
 * is the Tafel's business and reaches the row as an override.
 */
export const dingWert = (ding: Ding): Text | null => {
  switch (ding.art) {
    case 'gabe': {
      const wasser = zahl(ding, 'wasser_l');
      return wasser === null ? null : { key: 'zelt.zeile.wasser', params: { liter: wasser } };
    }
    case 'ziel': {
      const wert = ding.d?.['wert'];
      return typeof wert === 'number' || typeof wert === 'string' ? { roh: String(wert) } : null;
    }
    case 'film': {
      const dauer = wort(ding, 'dauer');
      return dauer ? { key: `zelt.filmDauer.${dauer}`, ersatz: dauer } : null;
    }
    case 'schema': {
      const schritt = zahl(ding, 'schritt');
      return schritt === null ? null : { key: 'zelt.zeile.schritt', params: { schritt: schritt } };
    }
    case 'geraet': {
      const typ = wort(ding, 'typ');
      return typ ? { key: `devices.${typ}.title`, ersatz: typ } : null;
    }
    case 'pflanze': {
      const sorte = wort(ding, 'sorte');
      return sorte ? { roh: sorte } : null;
    }
    default:
      return null;
  }
};

/**
 * `gefüllt = frisch, hohl = veraltet, amber = offen, rot = Alarm` (§6.4), and
 * the same rule at every density: with no device the arts that can be stale
 * simply never appear, so nothing needs a second reading of the square.
 */
export const dingMarke = (ding: Ding, jetzt: number): Marke => {
  if (ding.art === 'ereignis' && (zahl(ding, 'severity') ?? 0) >= 2) return 'alarm';
  if (ding.art === 'zustand' && ding.t_ende === null && !wort(ding, 'geschlossen_von')) return 'offen';
  if (ding.storniert_von || (ding.t_ende !== null && ding.t_ende !== undefined)) return 'hohl';

  if (MELDENDE_ARTEN.includes(ding.art)) {
    const gehoert = zahl(ding, 'zuletzt_gesehen') ?? zahl(ding, 'letztes_bild_t') ?? ding.t;
    return jetzt - gehoert > VERALTET_MS ? 'hohl' : 'voll';
  }

  return STEHENDE_ARTEN.includes(ding.art) ? 'hohl' : 'voll';
};

/** When the row last had something to say. Used for the `vor 2 Std` column. */
export const dingAlter = (ding: Ding): number =>
  (typeof ding.d?.['zuletzt_gesehen'] === 'number' ? (ding.d['zuletzt_gesehen'] as number) : null) ??
  (typeof ding.d?.['letztes_bild_t'] === 'number' ? (ding.d['letztes_bild_t'] as number) : null) ??
  ding.t;
