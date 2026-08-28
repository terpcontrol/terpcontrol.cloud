import { DiaryEntryData, Messwerte } from '@fg2/shared-types';

/**
 * The six legacy diary fields that have a home in `Messwerte`, and where each
 * one lands. The other five hand instruments never existed in the old diary.
 */
type ZahlenFeld = 'ph' | 'ec' | 'tds' | 'ppfd' | 'abstand_cm' | 'aussen_temperatur';

const AUS_DIARY: Record<string, ZahlenFeld> = {
  phMeasurement: 'ph',
  ecMeasurement: 'ec',
  tdsMeasurement: 'tds',
  lightMeasurement: 'ppfd',
  distanceMeasurement: 'abstand_cm',
  outsideTemperatureMeasurement: 'aussen_temperatur',
};

/** The old diary stored numbers, but a Mixed field can hold what a client once sent. */
const alsZahl = (wert: unknown): number | undefined => {
  if (typeof wert === 'number') return Number.isFinite(wert) ? wert : undefined;
  if (typeof wert === 'string' && wert.trim() !== '') {
    const zahl = Number(wert);
    return Number.isFinite(zahl) ? zahl : undefined;
  }
  return undefined;
};

/**
 * Maps an old `diary-measurement` entry's data onto `Messwerte` at **read
 * time**. No migration writes this: the legacy rows stay exactly as they are,
 * and the mapping happens every time the entry is projected, so an owner's old
 * pH readings show up in the new UI without anything being rewritten.
 *
 * `temperatur`, `luftfeuchte`, `hoehe_cm`, `substrat` and `topfgewicht_kg` have
 * no legacy source and therefore stay **absent** - not zero. A zero here would
 * be a measurement nobody took, and the app would have no way left to say that
 * the old diary simply did not hold them.
 *
 * Returns undefined when the entry carried none of the six, so a projected
 * Notiz has no empty `messwerte` object hanging off it.
 */
export function messwerteAusDiary(data?: Partial<DiaryEntryData> | null): Messwerte | undefined {
  if (!data || typeof data !== 'object') return undefined;

  const messwerte: Messwerte = {};
  for (const [legacy, feld] of Object.entries(AUS_DIARY)) {
    const zahl = alsZahl((data as Record<string, unknown>)[legacy]);
    if (zahl !== undefined) messwerte[feld] = zahl;
  }

  return Object.keys(messwerte).length > 0 ? messwerte : undefined;
}
