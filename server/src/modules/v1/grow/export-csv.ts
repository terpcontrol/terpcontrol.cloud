import type { MeasurementDefinition, Metric, OutputMetric } from '@fg2/shared-types/v1';
import { DeviceSeries } from '@fg2/shared-types/v1';
import { StoredAlarmRule } from '@database/schemas/v1/alarm-rules.schema';
import { StoredAlert } from '@database/schemas/v1/alerts.schema';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { GrowDocument } from '@database/schemas/v1/grows.schema';
import { StoredPlan } from '@database/schemas/v1/plans.schema';
import { PlantDocument } from '@database/schemas/v1/plants.schema';
import { ReminderDocument } from '@database/schemas/v1/reminders.schema';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
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

/**
 * What an account is beyond the row that names it: its settings, in the shape
 * they are stored in.
 *
 * This one file is JSON rather than CSV, and deliberately. Preferences,
 * privacy, retention and the notification grid are nested - the grid is a list
 * of channels per category - and flattening them into columns would either lose
 * the shape or invent a column per cell. The rest of the archive is a
 * spreadsheet; this is the settings screen, written down.
 *
 * Every field is named rather than the document handed over whole, because two
 * of them are never anybody's to export: the password hash and the activation
 * code. A field added to the schema is then missing here until somebody adds
 * it, which is the failure worth having.
 */
export const accountSettingsJson = (user: StoredUser): Buffer =>
  Buffer.from(
    `${JSON.stringify(
      {
        userId: user.id,
        handle: user.handle,
        email: user.email,
        createdAt: user.createdAt,
        bio: user.bio,
        avatarMediaId: user.avatarMediaId,
        publicProfile: user.publicProfile,
        privacy: { hideWeights: user.privacy.hideWeights, hideCounts: user.privacy.hideCounts },
        preferences: { units: user.preferences.units, locale: user.preferences.locale, timezone: user.preferences.timezone },
        retention: { climateDays: user.retention.climateDays },
        notifications: {
          channels: user.notifications.channels,
          routing: user.notifications.routing,
          quietHours: user.notifications.quietHours,
          mutedUntil: user.notifications.mutedUntil,
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

/** The places, with the people each is shared with - which is the half of a tent that is not in the tent. */
export const spacesCsv = (spaces: readonly SpaceDocument[], rooms: Names, members: ReadonlyMap<string, string[]>): Buffer =>
  csvOf(
    ['name', 'kind', 'room', 'sharedWith', 'presetPrompt', 'climateDays', 'archivedAt', 'createdAt', 'spaceId'],
    spaces.map(space => [
      space.name,
      space.kind,
      space.roomId ? (rooms.get(space.roomId) ?? space.roomId) : null,
      (members.get(space.id) ?? []).join(' | '),
      space.presetPrompt,
      space.retention.climateDays,
      space.archivedAt,
      space.createdAt,
      space.id,
    ]),
  );

/** The hardware, and where each piece of it stands. */
export const devicesCsv = (devices: readonly StoredDevice[], spaces: Names): Buffer =>
  csvOf(
    ['name', 'type', 'space', 'serialNumber', 'claimedAt', 'lastSeenAt', 'firmwareChannel', 'firmwareId', 'deviceId'],
    devices.map(device => [
      device.name,
      device.type,
      device.spaceId ? (spaces.get(device.spaceId) ?? device.spaceId) : null,
      device.serialNumber,
      device.state?.claimedAt ?? null,
      device.state?.lastSeenAt ?? null,
      device.firmware?.channel ?? null,
      device.state?.firmwareId ?? null,
      device.id,
    ]),
  );

/**
 * The cameras, with the settings that decide what they do. What lets the cloud
 * reach one is left out - the secret, and the credentials that live inside an
 * RTSP address - because an export is read on a laptop and passed on, and a
 * camera's password is not what somebody asked for when they asked for their
 * diary.
 */
export const camerasCsv = (cameras: readonly CameraDocument[], spaces: Names): Buffer =>
  csvOf(
    [
      'name',
      'kind',
      'model',
      'space',
      'looksAt',
      'stillIntervalSeconds',
      'nightOff',
      'maintenanceOff',
      'logErrors',
      'staleWarning',
      'entitlementUntil',
      'entitlementGrant',
      'lastStillAt',
      'createdAt',
      'removedAt',
      'deviceId',
      'cameraId',
    ],
    cameras.map(camera => [
      camera.name,
      camera.kind,
      camera.model,
      camera.spaceId ? (spaces.get(camera.spaceId) ?? camera.spaceId) : null,
      camera.looksAt,
      camera.stillIntervalSeconds,
      camera.nightOff,
      camera.maintenanceOff,
      camera.logErrors,
      camera.staleWarning,
      camera.entitlement.validUntil,
      camera.entitlement.grant,
      camera.state.lastStillAt,
      camera.createdAt,
      camera.removedAt,
      camera.deviceId,
      camera.id,
    ]),
  );

/**
 * The alarm rules. `watch` is flat here where the model keeps it a union, so a
 * rule on a reading and a rule on an output sit in one sheet and the columns of
 * the kind a row is not are simply empty.
 *
 * A rule's own delivery is named but not spelled out: `delivery.custom` carries
 * a webhook's address and its headers, which may hold an authorisation for a
 * machine on the grower's own network.
 */
export const alarmsCsv = (rules: readonly StoredAlarmRule[], devices: Names): Buffer =>
  csvOf(
    [
      'name',
      'device',
      'watches',
      'metric',
      'output',
      'lower',
      'upper',
      'forSeconds',
      'severity',
      'origin',
      'enabled',
      'cooldownSeconds',
      'repeatSeconds',
      'delivery',
      'silencedUntil',
      'triggered',
      'lastTriggeredAt',
      'lastResolvedAt',
      'createdAt',
      'deviceId',
      'ruleId',
    ],
    rules.map(rule => [
      rule.name,
      devices.get(rule.deviceId) ?? rule.deviceId,
      rule.watch.kind,
      'metric' in rule.watch ? rule.watch.metric : null,
      'output' in rule.watch ? rule.watch.output : null,
      'lower' in rule.watch ? rule.watch.lower : null,
      'upper' in rule.watch ? rule.watch.upper : null,
      rule.forSeconds,
      rule.severity,
      rule.origin,
      rule.enabled,
      rule.cooldownSeconds,
      rule.repeatSeconds,
      rule.delivery.mode === 'custom' ? `custom · ${rule.delivery.custom?.channel ?? ''}` : 'routing',
      rule.silencedUntil,
      rule.state.triggered,
      rule.state.lastTriggeredAt,
      rule.state.lastResolvedAt,
      rule.createdAt,
      rule.deviceId,
      rule.id,
    ]),
  );

/** Every alarm that ever opened, from trigger to resolution: one row an episode, which is what the alerts inbox shows. */
export const alertsCsv = (alerts: readonly StoredAlert[], devices: Names, cameras: Names): Buffer =>
  csvOf(
    ['startedAt', 'resolvedAt', 'kind', 'severity', 'device', 'camera', 'value', 'extremeValue', 'ruleId', 'deviceId', 'cameraId', 'alertId'],
    alerts.map(alert => [
      alert.startedAt,
      alert.resolvedAt,
      alert.kind,
      alert.severity,
      alert.deviceId ? (devices.get(alert.deviceId) ?? alert.deviceId) : null,
      alert.cameraId ? (cameras.get(alert.cameraId) ?? alert.cameraId) : null,
      alert.value,
      alert.extremeValue,
      alert.ruleId,
      alert.deviceId,
      alert.cameraId,
      alert.id,
    ]),
  );

/**
 * The rhythms the task list is derived from. A task is never stored - it is
 * worked out from the rhythm and from what has already been logged - so the
 * rhythm is the only row there is to hand over, and the entries that answered
 * each turn of it are in the diary.
 */
export const tasksCsv = (reminders: readonly ReminderDocument[], subjects: Names, people: Names): Buffer =>
  csvOf(
    ['label', 'kind', 'about', 'everyDays', 'onceAt', 'assignee', 'createdAt', 'subjectType', 'subjectId', 'reminderId'],
    reminders.map(reminder => [
      reminder.label,
      reminder.kind,
      subjects.get(reminder.subject.id) ?? reminder.subject.id,
      reminder.everyDays,
      reminder.onceAt,
      reminder.assigneeId ? (people.get(reminder.assigneeId) ?? reminder.assigneeId) : null,
      reminder.createdAt,
      reminder.subject.type,
      reminder.subject.id,
      reminder.id,
    ]),
  );

/**
 * The control plans, a row per step, in the order the controller walks them.
 * What a step applies is the firmware's own vocabulary and differs by device
 * type, so it is written as JSON in a column of its own - for the same reason
 * an entry's values are.
 */
export const plansCsv = (plans: readonly StoredPlan[], devices: Names): Buffer =>
  csvOf(
    ['plan', 'device', 'step', 'name', 'stage', 'preset', 'duration', 'waitForConfirmation', 'settings', 'status', 'loop', 'deviceId', 'planId'],
    plans.flatMap(plan =>
      plan.steps.map((step, index) => [
        plan.name,
        devices.get(plan.deviceId) ?? plan.deviceId,
        index + 1,
        step.name,
        step.stage,
        step.preset,
        `${step.duration.value} ${step.duration.unit}`,
        step.waitForConfirmation,
        JSON.stringify(step.settings),
        plan.state.status,
        plan.loop,
        plan.deviceId,
        plan.id,
      ]),
    ),
  );
