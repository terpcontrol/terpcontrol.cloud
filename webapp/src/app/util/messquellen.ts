import type { Quelle } from '@fg2/shared-types';

/**
 * Where one number came from. A pH read off a pen and a pH reported by a
 * controller are not the same number seen twice, and neither are two
 * controllers in one tent: each is its own origin.
 */
export interface Herkunft {
  quelle: Quelle;
  /** Absent on a hand reading - that is what makes it a hand reading. */
  geraet_id?: string;
  /** What the device calls itself, so a row can read `Temperatur (Controller)`. */
  geraet_name?: string;
}

/** One reading, before anything has been done to it. */
export interface Messung {
  /** The measure, never the source: `temperatur`, `ph`, `hoehe_cm`. */
  mass: string;
  herkunft: Herkunft;
  wert: number;
  /** When it was measured, epoch ms. */
  t: number;
}

/** One row of a values table: one measure, from one origin. */
export interface Messzeile {
  /** measure + origin, so a re-read hands the row its own identity back. */
  id: string;
  mass: string;
  herkunft: Herkunft;
  wert: number;
  t: number;
  /**
   * Whether the row prints its origin. A hand reading always says so; a device
   * says so once a second origin exists for the same measure, because that is
   * the moment `Temperatur` stops identifying a row on its own.
   */
  herkunftZeigen: boolean;
}

/** The identity of an origin. Two rows share a key only if the same instrument produced both. */
export const herkunftSchluessel = (herkunft: Herkunft): string =>
  herkunft.quelle === 'hand' ? 'hand' : `geraet:${herkunft.geraet_id ?? ''}`;

/**
 * §3.1, and the one rule the whole values table rests on:
 *
 * > One measure, two sources, two rows. Never merged, never averaged, never
 * > silently superseded.
 *
 * So this groups by *measure and origin* and never by measure alone. Within one
 * origin the newest reading wins - that is a value being current, not two
 * numbers being blended - and across origins nothing is combined at all.
 *
 * Order is first-seen: measures in the order they arrived, and within a measure
 * its origins in the order they arrived. A stable order is what lets a caller
 * cache the rendered rows.
 */
export const messzeilen = (messungen: Messung[]): Messzeile[] => {
  const zeilen = new Map<string, Messzeile>();
  const herkuenfteJeMass = new Map<string, Set<string>>();

  for (const messung of messungen) {
    if (!Number.isFinite(messung.wert)) continue;

    const schluessel = herkunftSchluessel(messung.herkunft);
    const id = `${messung.mass}|${schluessel}`;
    const bisher = zeilen.get(id);

    const herkuenfte = herkuenfteJeMass.get(messung.mass) ?? new Set<string>();
    herkuenfte.add(schluessel);
    herkuenfteJeMass.set(messung.mass, herkuenfte);

    if (!bisher) {
      zeilen.set(id, {
        id: id,
        mass: messung.mass,
        herkunft: messung.herkunft,
        wert: messung.wert,
        t: messung.t,
        herkunftZeigen: false,
      });
      continue;
    }

    if (messung.t >= bisher.t) {
      bisher.wert = messung.wert;
      bisher.t = messung.t;
      // A later reading may carry a name the first one did not.
      bisher.herkunft = messung.herkunft;
    }
  }

  return [...zeilen.values()].map(zeile => ({
    ...zeile,
    herkunftZeigen: zeile.herkunft.quelle === 'hand' || (herkuenfteJeMass.get(zeile.mass)?.size ?? 1) > 1,
  }));
};
