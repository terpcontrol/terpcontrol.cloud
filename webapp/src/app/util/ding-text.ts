import type { Ding, DingArt } from '@fg2/shared-types';
import { zahlText } from './zahl';

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
 * The arts that are an *entry* - something somebody or something put in the
 * diary at a moment. The tent, its plants, its devices, its sockets, its
 * schema and its setpoints are not entries: they are what the tent *is*, and
 * counting them is how `1 Eintrag` turns up on a day nobody wrote anything.
 */
const EINTRAG_ARTEN: DingArt[] = ['gabe', 'notiz', 'bild', 'film', 'ereignis', 'phase', 'zustand'];

/** Whether this Ding is one of the entries the header counts. Cancelled ones are not. */
export const istEintrag = (ding: Ding): boolean => !ding.storniert_von && EINTRAG_ARTEN.includes(ding.art);

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
      return wasser === null ? null : { key: 'zelt.zeile.wasser', params: { liter: zahlText(wasser, 2) } };
    }
    case 'ziel': {
      const wert = ding.d?.['wert'];
      if (typeof wert === 'number') return { roh: zahlText(wert, 2) };
      return typeof wert === 'string' ? { roh: wert } : null;
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
export const dingMarke = (ding: Ding, jetzt: number, umfeld: readonly Ding[] = []): Marke => {
  if (ding.art === 'ereignis' && (zahl(ding, 'severity') ?? 0) >= 2) return 'alarm';
  if (ding.art === 'zustand' && ding.t_ende === null && !wort(ding, 'geschlossen_von')) return 'offen';
  if (ding.storniert_von || (ding.t_ende !== null && ding.t_ende !== undefined)) return 'hohl';

  if (MELDENDE_ARTEN.includes(ding.art)) {
    return jetzt - dingAlter(ding, umfeld) > VERALTET_MS ? 'hohl' : 'voll';
  }

  return STEHENDE_ARTEN.includes(ding.art) ? 'hohl' : 'voll';
};

/**
 * When the row last had something to say. Used for the `vor 2 Std` column.
 *
 * A socket has no clock of its own: it is heard about because the controller it
 * hangs on said something, and it is exactly as fresh as that controller. Its
 * projection carries `t = seit`, the moment it was bound to the tent, so
 * falling back to `t` reads `vor 2 Monaten` one row under the controller's
 * `vor 1 Minute` - about the same 40 seconds of evidence.
 */
export const dingAlter = (ding: Ding, umfeld: readonly Ding[] = []): number =>
  zahl(ding, 'zuletzt_gesehen') ?? zahl(ding, 'letztes_bild_t') ?? elternGehoert(ding, umfeld) ?? ding.t;

/**
 * When the device that reports this Ding was last heard from. `geraet_id` is
 * set on exactly the projected arts - a device, its sockets and its camera -
 * so the parent is the `geraet` row carrying the same id.
 */
const elternGehoert = (ding: Ding, umfeld: readonly Ding[]): number | null => {
  if (!ding.geraet_id || ding.art === 'geraet') return null;

  const eltern = umfeld.find(anderes => anderes.art === 'geraet' && anderes.geraet_id === ding.geraet_id);
  return eltern ? zahl(eltern, 'zuletzt_gesehen') : null;
};
