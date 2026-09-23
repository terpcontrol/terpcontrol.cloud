/**
 * The readings a diary entry could carry today.
 *
 * The old entry had a fixed set of numeric fields; the model has a reading list
 * per entry keyed by the grow's own measurement definitions. So the fixed set
 * becomes definitions - the same eight on every reconstructed grow - and each
 * value becomes a reading under the key it already had. Keeping the old key as
 * the new one is what lets a chart of them be drawn without a lookup table
 * anywhere.
 *
 * The names and units are the ones the old diary sheet printed beside each
 * field, so a migrated reading reads exactly as it did before.
 *
 * A name is a grower's own words the moment it is written - the app seeds one
 * from a translated template and never translates it again, because nothing
 * afterwards can tell a seeded name from one somebody typed. The migration is
 * that moment for these eight, and the old account carries no language to read,
 * so the install says which one its customers speak (`MIGRATION_LOCALE`, `en`
 * unless set). A shop whose growers are German sets it once rather than having
 * every one of them rename the same eight rows.
 */
export interface MigratedMeasurement {
  key: string;
  /** What each language calls it; the locale the run was given picks one. */
  names: Record<string, string>;
  unit: string;
  perPlant: boolean;
  targetMin: number | null;
  targetMax: number | null;
  chart: boolean;
}

export const MIGRATED_MEASUREMENTS: MigratedMeasurement[] = [
  {
    key: 'lightMeasurement',
    names: { en: 'Light measurement', de: 'Lichtmessung' },
    unit: 'µmol',
    perPlant: false,
    targetMin: null,
    targetMax: null,
    chart: true,
  },
  {
    key: 'distanceMeasurement',
    names: { en: 'Distance measurement', de: 'Abstandsmessung' },
    unit: 'cm',
    perPlant: false,
    targetMin: null,
    targetMax: null,
    chart: false,
  },
  {
    key: 'tdsMeasurement',
    names: { en: 'TDS measurement', de: 'TDS-Messung' },
    unit: 'ppm',
    perPlant: false,
    targetMin: null,
    targetMax: null,
    chart: true,
  },
  {
    key: 'ecMeasurement',
    names: { en: 'EC measurement', de: 'EC-Messung' },
    unit: 'mS/cm',
    perPlant: false,
    targetMin: null,
    targetMax: null,
    chart: true,
  },
  {
    key: 'outsideTemperatureMeasurement',
    names: { en: 'Outside temperature', de: 'Außentemperatur' },
    unit: '°C',
    perPlant: false,
    targetMin: null,
    targetMax: null,
    chart: true,
  },
  {
    key: 'phMeasurement',
    names: { en: 'pH measurement', de: 'pH-Messung' },
    unit: '',
    perPlant: false,
    targetMin: null,
    targetMax: null,
    chart: true,
  },
  {
    key: 'co2FillingInitial',
    names: { en: 'New cylinder filling', de: 'Neue Flasche Füllung' },
    unit: 'g',
    perPlant: false,
    targetMin: null,
    targetMax: null,
    chart: false,
  },
  {
    key: 'co2FillingRest',
    names: { en: 'Old cylinder rest', de: 'Alte Flasche Rest' },
    unit: 'g',
    perPlant: false,
    targetMin: null,
    targetMax: null,
    chart: false,
  },
];

const MEASUREMENT_KEYS = MIGRATED_MEASUREMENTS.map(measurement => measurement.key);

/** What to call each of them on a run told to speak this language, falling back to English. */
export const measurementNamesIn = (
  locale: string,
): { key: string; name: string; unit: string; perPlant: boolean; targetMin: number | null; targetMax: number | null; chart: boolean }[] =>
  MIGRATED_MEASUREMENTS.map(({ names, ...rest }) => ({ ...rest, name: names[locale] ?? names.en }));

/** The readings in one old entry's `data`, in the order the definitions are listed. */
export const readingsOf = (data: Record<string, unknown> | undefined): { key: string; value: number; plantId: null }[] =>
  MEASUREMENT_KEYS.filter(key => typeof data?.[key] === 'number' && Number.isFinite(data[key])).map(key => ({
    key,
    value: data?.[key] as number,
    plantId: null,
  }));
