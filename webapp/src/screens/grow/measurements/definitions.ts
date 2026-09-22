import type { Entry, EntryReading, GrowMeasurementSeries, MeasurementDefinition } from '@fg2/shared-types/v1';
import { readingFigure } from '@/ui/entries';

/**
 * What the app knows about measurements before a grower has said anything.
 *
 * The templates are the handful that come up in every tent, so that starting to
 * measure something is one tap rather than three fields. They carry no target:
 * what a grower aims at is theirs, and a figure invented here would be read as
 * advice.
 *
 * One of them cannot be stated as a band at all - runoff EC is aimed under the
 * EC that went in, whatever that was on the day - so it carries the rule in
 * words instead. A target that took an expression would be a little language
 * nobody else can read, and the sentence is what a grower would say anyway.
 */

export interface MeasurementTemplate {
  key: string;
  unit: string;
  perPlant: boolean;
  chart: boolean;
}

export const TEMPLATES: MeasurementTemplate[] = [
  { key: 'water_temp', unit: '°C', perPlant: false, chart: true },
  { key: 'ppfd', unit: 'µmol', perPlant: false, chart: true },
  { key: 'pot_size', unit: 'L', perPlant: true, chart: false },
  { key: 'watering_volume', unit: 'L', perPlant: false, chart: true },
  { key: 'outside_temp', unit: '°C', perPlant: false, chart: true },
  { key: 'leaf_temp', unit: '°C', perPlant: false, chart: true },
  { key: 'runoff_ec', unit: 'mS/cm', perPlant: false, chart: true },
];

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A template as a definition of this grow, named in the reader's language. */
export const fromTemplate = (t: Translate, template: MeasurementTemplate): MeasurementDefinition => ({
  key: template.key,
  name: t(`grow.measurements.template.${template.key}`),
  unit: template.unit,
  perPlant: template.perPlant,
  targetMin: null,
  targetMax: null,
  chart: template.chart,
});

/**
 * The rule a template carries in words where it cannot be carried as a band.
 * Empty for every measurement that has nothing of the sort to say, which is
 * almost all of them.
 */
export const ruleOf = (t: Translate, key: string): string => t(`grow.measurements.templateNote.${key}`, { defaultValue: '' });

/**
 * Both ends of the band, either of which may be open.
 *
 * It reads them through a fallback because a server that has not run the
 * migration yet answers a definition with neither end, and a screen drawing
 * "target undefined" would be worse than one drawing no target at all.
 */
export const bandEnds = (definition: Band): [number | null, number | null] => [definition.targetMin ?? null, definition.targetMax ?? null];

type Band = Pick<MeasurementDefinition, 'targetMin' | 'targetMax'>;

/**
 * The band as a grower reads it: both ends, or the one end that was set, or
 * nothing at all where nobody is aiming at anything.
 */
export const bandOf = (t: Translate, definition: Band): string | null => {
  const [low, high] = bandEnds(definition);
  if (low !== null && high !== null) {
    return low === high ? readingFigure(low) : t('grow.measurements.bandBetween', { low: readingFigure(low), high: readingFigure(high) });
  }
  if (low !== null) return t('grow.measurements.bandFrom', { low: readingFigure(low) });
  if (high !== null) return t('grow.measurements.bandTo', { high: readingFigure(high) });

  return null;
};

/**
 * What a reading is filed under, made from what it is called: lower case, and
 * everything that is not a letter or a digit becomes an underscore, so that a
 * key is readable in an export and in the diary rows a chart leads back to.
 *
 * A key is never changed afterwards - it is what every reading already written
 * points at - so this is asked once, when the measurement is made. Two of them
 * colliding is the server's refusal to state, not ours to prevent by inventing
 * a suffix nobody asked for.
 */
export const keyFor = (name: string): string => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return slug || 'measurement';
};

/** How many readings each key holds, from the one series read the screen makes anyway. */
export const readingCounts = (series: GrowMeasurementSeries[] | undefined): Map<string, number> =>
  new Map((series ?? []).map(one => [one.key, one.points.length]));

/** What was written last under one key, for one plant or for the grow itself. */
export interface LastReading {
  value: number;
  at: string;
  plantId: string | null;
}

/** The composite a reading is remembered under: a key means something different per plant. */
export const slotOf = (key: string, plantId: string | null): string => `${key}|${plantId ?? ''}`;

/**
 * The newest reading of every key and plant in these lines, which is what a
 * field offers as its placeholder. It compares the instants rather than
 * trusting the order they arrived in: what a field promises is what was
 * measured last, and an answer sorted differently must not quietly change that.
 */
export const lastReadings = (entries: Entry[]): Map<string, LastReading> => {
  const newest = new Map<string, LastReading>();

  for (const entry of entries) {
    const readings: EntryReading[] = 'readings' in entry.values ? entry.values.readings : [];
    for (const reading of readings) {
      const slot = slotOf(reading.key, reading.plantId);
      const known = newest.get(slot);
      if (!known || known.at < entry.occurredAt) newest.set(slot, { value: reading.value, at: entry.occurredAt, plantId: reading.plantId });
    }
  }

  return newest;
};

/** "58 cm", and "6.3" for the measurements that have no unit at all, such as pH. */
export const withUnit = (value: number, unit: string): string => [readingFigure(value), unit].filter(Boolean).join(' ');
