import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { isSection } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { STEERED } from '@fg2/shared-types/v1-schemas';
import { SETTLE_SECONDS, cycleOf, type Cycle } from '@fg2/shared-types/v1-schemas/day-night.js';
import { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import { settlingOf, type RecordedClimate, type Settling } from '../device/held-targets';
import { targetsOf } from './phase-targets';

/**
 * The record of what a device aimed at over time: written wherever its stored
 * configuration changes, read wherever a band is drawn across the past.
 *
 * Only a move of the targets, or of the cycle that decides which half of them
 * holds, is a row. A configuration is saved again for a plan re-sending its step
 * every hour or a lamp's dimming, and neither moved what a band or a night is
 * drawn from; the clocks changing did move the schedule, in UTC.
 */

/** The row a write leaves, or nothing where the targets and the cycle came out of it where they went in. */
export const targetChangeOf = (deviceId: string, type: string, before: unknown, after: unknown, at: Date): StoredTargetChange | null => {
  const targets = targetsOf(asConfiguration(after));
  const cycle = cycleOf(type, asConfiguration(after));
  const same =
    JSON.stringify(targetsOf(asConfiguration(before))) === JSON.stringify(targets) &&
    JSON.stringify(cycleOf(type, asConfiguration(before))) === JSON.stringify(cycle);

  return same ? null : { id: uuidv4(), deviceId, at, targets, cycle };
};

export const recordTargets = async (
  record: Model<StoredTargetChange>,
  device: { id: string; type: string },
  before: unknown,
  after: unknown,
  at: Date,
): Promise<void> => {
  const change = targetChangeOf(device.id, device.type, before, after, at);
  if (change) await record.create(change);
};

/**
 * What one device's record says about a window, oldest first: the row standing
 * when the window opens and every row inside it.
 *
 * Where the record only begins after the window opens - a window reaching back
 * before anything was recorded - its first row is answered instead of the one
 * standing, wherever that row lies, because the first thing the record knows is
 * the nearest thing anyone knows about the stretch before it.
 */
export const recordOf = async (
  record: Model<StoredTargetChange>,
  deviceId: string | null,
  window: { startsAt: Date; endsAt: Date },
): Promise<StoredTargetChange[]> => {
  if (deviceId === null) return [];

  const [standing, inside] = await Promise.all([
    // Two writes in one millisecond are told apart by the order they were made in.
    record
      .findOne({ deviceId, at: { $lte: window.startsAt } })
      .sort({ at: -1, _id: -1 })
      .lean<StoredTargetChange>(),
    record
      .find({ deviceId, at: { $gt: window.startsAt, $lte: window.endsAt } })
      .sort({ at: 1, _id: 1 })
      .lean<StoredTargetChange[]>(),
  ]);
  if (standing || inside.length > 0) return standing ? [standing, ...inside] : inside;

  const first = await record
    .findOne({ deviceId, at: { $gt: window.endsAt } })
    .sort({ at: 1, _id: 1 })
    .lean<StoredTargetChange>();
  return first ? [first] : [];
};

/** A stretch of a window and the cycle the record says stood over it; null where it does not say. */
export interface CycleStretch {
  from: number;
  to: number;
  cycle: Cycle | null;
}

/**
 * The cycle over each stretch of a window, from one device's record (`recordOf`).
 *
 * A row stands from its instant until the next, so the last one reaches the end
 * of the window. Before the first row nothing is known - a row after the window
 * says nothing about it - and a row from before cycles were recorded says
 * nothing either: both are stretches whose nights are read off the lamp, as
 * they always were.
 */
export const cyclesOf = (rows: readonly StoredTargetChange[], window: { startsAt: Date; endsAt: Date }): CycleStretch[] => {
  const start = window.startsAt.getTime();
  const end = window.endsAt.getTime();
  const sorted = [...rows].sort((one, other) => one.at.getTime() - other.at.getTime());
  const stretches: CycleStretch[] = [];
  let cursor = start;

  sorted.forEach((row, index) => {
    const from = Math.max(row.at.getTime(), start);
    const to = Math.min(sorted[index + 1]?.at.getTime() ?? end, end);
    if (from > cursor) stretches.push({ from: cursor, to: Math.min(from, end), cycle: null });
    if (to > from) stretches.push({ from, to, cycle: row.cycle ?? null });
    cursor = Math.max(cursor, to);
  });
  if (cursor < end) stretches.push({ from: cursor, to: end, cycle: null });

  return stretches.filter(stretch => stretch.to > stretch.from);
};

const asConfiguration = (value: unknown): Record<string, unknown> | null => (isSection(value) ? value : null);

/** A row of the record as the arithmetic of `held-targets.ts` reads it. */
export const climateOf = (row: StoredTargetChange): RecordedClimate => ({
  at: row.at.getTime(),
  targets: row.targets ?? null,
  cycle: row.cycle ?? null,
});

/**
 * The hour after a change, for each of these devices still in one at `now`
 * (`settlingOf`): their rows of the last hour, and the one standing before the
 * first of them. One read for all of them, and a second per device that has
 * one - which is a device somebody just changed, not every device on a card.
 */
export const settlingsOf = async (
  record: Model<StoredTargetChange>,
  devices: readonly { id: string; state?: { hardware?: Record<string, string> } | null }[],
  now: Date,
): Promise<Map<string, Settling>> => {
  if (devices.length === 0) return new Map();

  const recent = await record
    .find({ deviceId: { $in: devices.map(device => device.id) }, at: { $gt: new Date(now.getTime() - SETTLE_SECONDS * 1000), $lte: now } })
    .sort({ at: 1, _id: 1 })
    .lean<StoredTargetChange[]>();
  const changed = [...new Set(recent.map(row => row.deviceId))];

  const settlings = await Promise.all(
    changed.map(async deviceId => {
      const rows = recent.filter(row => row.deviceId === deviceId);
      const standing = await record
        .findOne({ deviceId, at: { $lt: rows[0].at } })
        .sort({ at: -1, _id: -1 })
        .lean<StoredTargetChange>();
      const hardware = devices.find(device => device.id === deviceId)?.state?.hardware ?? {};
      const settling = settlingOf([...(standing ? [standing] : []), ...rows].map(climateOf), now.getTime(), STEERED, hardware);
      return settling ? ([[deviceId, settling]] as const) : [];
    }),
  );

  return new Map(settlings.flat());
};
