import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import { targetsOf } from './phase-targets';

/**
 * The record of what a device aimed at over time: written wherever its stored
 * configuration changes, read wherever a band is drawn across the past.
 *
 * Only a move of the targets is a row. A configuration is saved again for a
 * plan re-sending its step every hour, a lamp's dimming or the clocks changing,
 * and none of those moved what a band is drawn from.
 */

/** The row a write leaves, or nothing where the targets came out of it where they went in. */
export const targetChangeOf = (deviceId: string, before: unknown, after: unknown, at: Date): StoredTargetChange | null => {
  const targets = targetsOf(asConfiguration(after));

  return JSON.stringify(targetsOf(asConfiguration(before))) === JSON.stringify(targets) ? null : { id: uuidv4(), deviceId, at, targets };
};

export const recordTargets = async (
  record: Model<StoredTargetChange>,
  deviceId: string,
  before: unknown,
  after: unknown,
  at: Date,
): Promise<void> => {
  const change = targetChangeOf(deviceId, before, after, at);
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

const asConfiguration = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
