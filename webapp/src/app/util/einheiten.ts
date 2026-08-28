/**
 * The unit a measure is printed in. These are symbols rather than words - `°C`
 * is `°C` in every language this product speaks - which is why they live in
 * code and not in the bundles. The bundles' `zelt.einheit.*` are the same
 * symbols for the bodies, which look them up by field rather than by measure.
 */
const EINHEITEN: Record<string, string> = {
  temperatur: '°C',
  aussen_temperatur: '°C',
  luftfeuchte: '%',
  vpd: 'kPa',
  co2: 'ppm',
  ec: 'mS/cm',
  tds: 'ppm',
  ppfd: 'µmol/m²s',
  abstand_cm: 'cm',
  hoehe_cm: 'cm',
  topfgewicht_kg: 'kg',
  wasser_gesamt: 'l',
};

/** A setpoint is measured in the unit of the measure it is a setpoint for. */
const ZIEL_EINHEITEN: Record<string, string> = {
  temperature: '°C',
  humidity: '%',
  vpd: 'kPa',
  co2: 'ppm',
  ec: 'mS/cm',
  hoehe_cm: 'cm',
  limit: '%',
};

/**
 * `48` is a number; `48 cm` is a height. Every value in the drawn screens
 * carries its unit, and the table is no exception.
 *
 * Empty for anything that has none - a pH, a step number, a count of entries -
 * because `pH 6,1 -` is worse than `pH 6,1`.
 */
export const einheitVon = (mass: string): string => {
  const eigen = EINHEITEN[mass];
  if (eigen) return eigen;

  // `day.temperature`, `night.humidity`, `hand.hoehe_cm`, `lights.limit`.
  const punkt = mass.lastIndexOf('.');
  return punkt < 0 ? '' : ZIEL_EINHEITEN[mass.slice(punkt + 1)] ?? '';
};
