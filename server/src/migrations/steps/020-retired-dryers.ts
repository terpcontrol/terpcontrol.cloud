import { mongo } from 'mongoose';
import { everySamplePredicate } from '@modules/data/flux';
import { influxConfig } from '../../config/configuration';
import { MigrationContext, MigrationStep } from '../migration';

const DRYER = 'dryer';

/** Forgets every reading one device ever wrote. */
type ReadingsEraser = (deviceId: string) => Promise<void>;

// The whole of time as the store reads it: a device with a wrong clock writes
// readings decades away from today.
const FROM = '1970-01-01T00:00:00Z';
const UNTIL = '2200-01-01T00:00:00Z';

/**
 * The store the server writes readings to, as the environment names it, or
 * null where it names none - which only a spec does: the server does not start
 * without one.
 *
 * The client package has no delete API, so this is the HTTP one it would call,
 * as the retention sweep does.
 */
export const readingsStore = (): ReadingsEraser | null => {
  const { url, token, org, bucket } = influxConfig();
  if (!token || !org || !bucket) return null;

  return async deviceId => {
    const target = new URL('/api/v2/delete', url);
    target.searchParams.set('org', org);
    target.searchParams.set('bucket', bucket);

    const answer = await fetch(target, {
      method: 'POST',
      headers: { authorization: `Token ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ start: FROM, stop: UNTIL, predicate: everySamplePredicate(deviceId) }),
    });
    if (!answer.ok) throw new Error(`the store refused to forget the readings of ${deviceId}: ${answer.status} ${await answer.text()}`);
  };
};

const ids = (values: unknown[]): string[] => [...new Set(values.filter((value): value is string => typeof value === 'string'))];

/**
 * Takes the dryer out of the cloud: the hardware type is gone, firmware and
 * app alike, and a device of it is deleted with everything it left behind.
 *
 * - Its readings, raw and summarised, go first. The device rows are the only
 *   record of which ids they were written under, so those rows go last, and a
 *   run that dies in between finds the same dryers again.
 * - Its alarm rules and alerts, its log lines, its plan, the record of what it
 *   aimed at and its claim code are deleted; a saved chart forgets it and a
 *   camera it answered for is let go the way releasing a device lets it go.
 * - A place that held a dryer and holds nothing else - no device, no camera, no
 *   grow, no line or picture, no member, no reminder - is ended the way the app
 *   ends one: archived, with its invites and share links.
 * - The class goes with its builds, so a dryer that is still out there and
 *   tries to register is refused like any type this cloud has no class for.
 *
 * A database without dryers is left exactly as it is, which is nearly every one
 * of them and every fresh install. A rehearsal counts what would go and touches
 * neither database nor store.
 */
export const retiredDryersWith = (eraser: () => ReadingsEraser | null): MigrationStep => ({
  name: '020-retired-dryers',

  async run(context: MigrationContext): Promise<void> {
    const db = context.db;
    const classIds = ids(await db.collection('deviceClasses').distinct('id', { name: DRYER }));
    const dryers = await db
      .collection('devices')
      .find({ $or: [{ type: DRYER }, { classId: { $in: classIds } }] }, { projection: { id: 1, spaceId: 1 } })
      .toArray();
    const deviceIds = ids(dryers.map(dryer => dryer.id));
    if (classIds.length === 0 && deviceIds.length === 0) return;

    const firmwareIds = ids(await db.collection('firmwares').distinct('id', { classId: { $in: classIds } }));
    const spaceIds = ids(dryers.map(dryer => dryer.spaceId));

    const erase = context.dryRun ? null : eraser();
    for (const id of deviceIds) if (erase) await erase(id);
    if (deviceIds.length > 0) context.count(erase || context.dryRun ? 'readings.erased' : 'readings.leftInTheStore', deviceIds.length);

    const ofDryers = { deviceId: { $in: deviceIds } };
    for (const collection of ['alarmRules', 'alerts', 'entries', 'plans', 'targetChanges', 'claimCodes']) {
      await remove(context, collection, ofDryers);
    }
    const release = { $set: { removedAt: context.at, deviceId: null, uid: null, ip: null, secret: null } };
    await change(context, 'cameras', 'released', { ...ofDryers, removedAt: null }, release);

    const views = db.collection<{ definition: { deviceIds: string[] } }>('chartViews');
    const naming = { 'definition.deviceIds': { $in: deviceIds } };
    const forgot = context.dryRun
      ? await views.countDocuments(naming)
      : (await views.updateMany(naming, { $pull: { 'definition.deviceIds': { $in: deviceIds } } })).modifiedCount;
    if (forgot > 0) context.count('chartViews.forgotDryers', forgot);

    for (const spaceId of spaceIds) {
      if (await standsInUse(db, spaceId, deviceIds)) continue;
      await change(context, 'spaces', 'ended', { id: spaceId, archivedAt: null }, { $set: { archivedAt: context.at } });
      await remove(context, 'invites', { spaceId });
      await remove(context, 'shareLinks', { 'subject.type': 'space', 'subject.id': spaceId });
    }

    await remove(context, 'firmwareBinaries', { firmwareId: { $in: firmwareIds } });
    await remove(context, 'firmwares', { id: { $in: firmwareIds } });
    await remove(context, 'deviceClasses', { id: { $in: classIds } });
    await remove(context, 'devices', { id: { $in: deviceIds } });
  },
});

export const retiredDryers = retiredDryersWith(readingsStore);

/**
 * Whether anything but the dryers still stands in a place, or anybody but its
 * owner still uses it. What the dryers leave is read past rather than counted
 * as gone, so a rehearsal, which deletes none of it, answers as the run would.
 */
const standsInUse = async (db: mongo.Db, spaceId: string, dryerIds: string[]): Promise<boolean> => {
  const holds = (collection: string, filter: mongo.Filter<mongo.Document>) => db.collection(collection).countDocuments(filter, { limit: 1 });
  const found = await Promise.all([
    holds('devices', { spaceId, id: { $nin: dryerIds } }),
    holds('cameras', { spaceId, removedAt: null, deviceId: { $nin: dryerIds } }),
    holds('grows', { 'placements.spaceId': spaceId }),
    holds('entries', { spaceId, deviceId: { $nin: dryerIds } }),
    holds('media', { spaceId }),
    holds('memberships', { spaceId }),
    holds('reminders', { 'subject.type': 'space', 'subject.id': spaceId }),
    holds('spaces', { roomId: spaceId }),
  ]);
  return found.some(count => count > 0);
};

const remove = async (context: MigrationContext, collection: string, filter: mongo.Filter<mongo.Document>): Promise<void> => {
  const rows = context.db.collection(collection);
  const gone = context.dryRun ? await rows.countDocuments(filter) : ((await rows.deleteMany(filter)).deletedCount ?? 0);
  if (gone > 0) context.count(`${collection}.deleted`, gone);
};

const change = async (
  context: MigrationContext,
  collection: string,
  what: string,
  filter: mongo.Filter<mongo.Document>,
  update: mongo.UpdateFilter<mongo.Document>,
): Promise<void> => {
  const rows = context.db.collection(collection);
  const changed = context.dryRun ? await rows.countDocuments(filter) : (await rows.updateMany(filter, update)).modifiedCount;
  if (changed > 0) context.count(`${collection}.${what}`, changed);
};
