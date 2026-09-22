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
 */
export interface MigratedMeasurement {
  key: string;
  name: string;
  unit: string;
  perPlant: boolean;
  targetMin: number | null;
  targetMax: number | null;
  chart: boolean;
}

export const MIGRATED_MEASUREMENTS: MigratedMeasurement[] = [
  { key: 'lightMeasurement', name: 'Light measurement', unit: 'ppfd', perPlant: false, targetMin: null, targetMax: null, chart: true },
  { key: 'distanceMeasurement', name: 'Distance measurement', unit: 'cm', perPlant: false, targetMin: null, targetMax: null, chart: false },
  { key: 'tdsMeasurement', name: 'TDS measurement', unit: 'ppm', perPlant: false, targetMin: null, targetMax: null, chart: true },
  { key: 'ecMeasurement', name: 'EC measurement', unit: 'mS/cm', perPlant: false, targetMin: null, targetMax: null, chart: true },
  { key: 'outsideTemperatureMeasurement', name: 'Outside temperature', unit: '°C', perPlant: false, targetMin: null, targetMax: null, chart: true },
  { key: 'phMeasurement', name: 'pH measurement', unit: '', perPlant: false, targetMin: null, targetMax: null, chart: true },
  { key: 'co2FillingInitial', name: 'New cylinder filling', unit: 'g', perPlant: false, targetMin: null, targetMax: null, chart: false },
  { key: 'co2FillingRest', name: 'Old cylinder rest', unit: 'g', perPlant: false, targetMin: null, targetMax: null, chart: false },
];

const MEASUREMENT_KEYS = MIGRATED_MEASUREMENTS.map(measurement => measurement.key);

/** The readings in one old entry's `data`, in the order the definitions are listed. */
export const readingsOf = (data: Record<string, unknown> | undefined): { key: string; value: number; plantId: null }[] =>
  MEASUREMENT_KEYS.filter(key => typeof data?.[key] === 'number' && Number.isFinite(data[key])).map(key => ({
    key,
    value: data?.[key] as number,
    plantId: null,
  }));
