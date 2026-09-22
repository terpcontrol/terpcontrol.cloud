import type { MeasurementDefinition, Metric, OutputMetric } from '@fg2/shared-types/v1';
import { DeviceSeries } from '@fg2/shared-types/v1';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { dayNumberOf, originOf } from '../diary/grow-calendar';

/**
 * What an export's CSVs say.
 *
 * A spreadsheet is the point of them, so every file is flat: one row per thing
 * that happened, every instant in ISO, and no column holding a structure a
 * reader would have to unpick. Where a row is about something that has a name -
 * a plant, a measurement, a person - the name is written beside the id rather
 * than instead of it, because the id is what makes two files join and the name
 * is what makes a column readable.
 *
 * Nothing here decides what a reader may see. The rows are handed in already
 * chosen and already redacted; this only lays them out.
 */

/** RFC 4180: quotes where a value could otherwise be misread, doubled quotes inside them. */
const cell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The header line. It carries a byte-order mark, because a CSV of a German
 * diary opened in Excel is otherwise a page of mojibake and the grower blames
 * the export rather than the spreadsheet.
 */
export const csvHeader = (columns: readonly string[]): Buffer => Buffer.from(`﻿${columns.join(',')}\r\n`, 'utf8');

/** A block of rows, for a file long enough to be written a piece at a time. */
export const csvRows = (rows: readonly unknown[][]): Buffer => Buffer.from(rows.map(row => `${row.map(cell).join(',')}\r\n`).join(''), 'utf8');

export const csvOf = (columns: readonly string[], rows: readonly unknown[][]): Buffer => Buffer.concat([csvHeader(columns), csvRows(rows)]);

/** A handle or a label to write beside an id, and nothing when the row it named is gone. */
export type Names = ReadonlyMap<string, string>;

/**
 * The diary, one row per entry, oldest first - which is how somebody reads
 * their own season back and the opposite of how a screen shows it.
 *
 * `values` is the one column that is not flat. An entry's values are typed per
 * kind and there are a dozen kinds, so a column per field of all of them would
 * be a sheet of empty cells; the whole object is written as JSON instead, and
 * the two kinds anybody actually sorts on - the readings and the doses - have
 * files of their own beside this one.
 */
export const DIARY_COLUMNS = [
  'occurredAt',
  'day',
  'kind',
  'source',
  'author',
  'text',
  'message',
  'plants',
  'growId',
  'spaceId',
  'deviceId',
  'mediaIds',
  'values',
  'entryId',
];

export const diaryRows = (entries: readonly EntryDocument[], grow: GrowDocument | null, people: Names, plants: Names): unknown[][] =>
  entries.map(entry => [
    entry.occurredAt,
    grow ? dayNumberOf(originOf(grow), entry.occurredAt) : null,
    entry.kind,
    entry.source,
    entry.authorId ? (people.get(entry.authorId) ?? entry.authorId) : null,
    entry.text,
    entry.message ? [entry.message.key, ...entry.message.params].join(' ') : null,
    entry.plantIds.map(id => plants.get(id) ?? id).join(' | '),
    entry.growId,
    entry.spaceId,
    entry.deviceId,
    entry.mediaIds.join(' | '),
    JSON.stringify(entry.values),
    entry.id,
  ]);

/**
 * Every reading of the grow's own measurements, one row each: the column the
 * Measurements screen promises. The definition's name and unit are written
 * beside the key so a sheet reads without the grow beside it, even though the
 * key is what the model joins on.
 */
export const measurementsCsv = (
  entries: readonly EntryDocument[],
  definitions: readonly MeasurementDefinition[],
  grow: GrowDocument,
  plants: Names,
): Buffer => {
  const known = new Map(definitions.map(definition => [definition.key, definition]));
  const origin = originOf(grow);

  return csvOf(
    ['occurredAt', 'day', 'key', 'name', 'unit', 'value', 'plant', 'plantId', 'entryId'],
    entries.flatMap(entry =>
      readingsIn(entry).map(reading => [
        entry.occurredAt,
        dayNumberOf(origin, entry.occurredAt),
        reading.key,
        known.get(reading.key)?.name ?? null,
        known.get(reading.key)?.unit ?? null,
        reading.value,
        reading.plantId ? (plants.get(reading.plantId) ?? null) : null,
        reading.plantId,
        entry.id,
      ]),
    ),
  );
};

export const readingsIn = (entry: EntryDocument): { key: string; value: number; plantId: string | null }[] =>
  'readings' in entry.values ? entry.values.readings : [];

/**
 * The climate, a row per instant per device: every metric it measured and every
 * output it drove side by side, because that is the sheet somebody plots a
 * night against a heater in.
 *
 * The points of one read share a grid of instants, so the columns line up by
 * construction and an instant a device said nothing at is an empty cell rather
 * than a missing row. A whole grow is read a stretch at a time, so this answers
 * rows rather than a file and the caller writes them as they come.
 */
export const climateColumns = (metrics: readonly Metric[], outputs: readonly OutputMetric[]): string[] => [
  'measuredAt',
  'deviceId',
  ...metrics,
  ...outputs.map(output => `out_${output}`),
];

export const climateRows = (series: readonly DeviceSeries[], metrics: readonly Metric[], outputs: readonly OutputMetric[]): unknown[][] =>
  series.flatMap(one =>
    (one.metrics[0]?.points ?? one.outputs[0]?.points ?? []).map((point, index) => [
      point.measuredAt,
      one.deviceId,
      ...metrics.map(metric => one.metrics.find(row => row.metric === metric)?.points[index]?.value ?? null),
      ...outputs.map(output => one.outputs.find(row => row.output === output)?.points[index]?.value ?? null),
    ]),
  );

/** The plants of a grow, with the weights they came off at - which nobody but their owner ever exports. */
export const plantsCsv = (plants: readonly PlantDocument[]): Buffer =>
  csvOf(
    ['label', 'strain', 'status', 'harvestedAt', 'wetWeightG', 'dryWeightG', 'createdAt', 'plantId'],
    plants.map(plant => [
      plant.label,
      plant.strain,
      plant.status,
      plant.harvest?.harvestedAt ?? null,
      plant.harvest?.wetWeightG ?? null,
      plant.harvest?.dryWeightG ?? null,
      plant.createdAt,
      plant.id,
    ]),
  );

/** What a grow was: its phases, where it stood, what it was fed. One file, three blocks, because three files of four rows is worse. */
export const growCsv = (grow: GrowDocument, spaces: Names): Buffer => {
  const origin = originOf(grow);

  return csvOf(
    ['what', 'startedAt', 'day', 'endedAt', 'detail', 'id'],
    [
      ['grow', grow.startedAt, 1, grow.endedAt, grow.name, grow.id],
      ...grow.phases.map(phase => [
        phase.plantIds === null ? 'phase' : 'phase (some plants)',
        phase.startedAt,
        dayNumberOf(origin, phase.startedAt),
        null,
        [phase.stage, phase.preset, `by ${phase.source}`].filter(Boolean).join(' · '),
        phase.id,
      ]),
      ...grow.placements.map(placement => [
        'placement',
        placement.startedAt,
        dayNumberOf(origin, placement.startedAt),
        placement.endedAt,
        placement.spaceId ? (spaces.get(placement.spaceId) ?? placement.spaceId) : 'nowhere in particular',
        placement.id,
      ]),
      ...(grow.scheme
        ? [
            [
              'scheme',
              null,
              null,
              null,
              `${grow.scheme.origin.type === 'asset' ? grow.scheme.origin.assetId : 'own'} · strength ${grow.scheme.strength}`,
              null,
            ],
          ]
        : []),
    ],
  );
};
