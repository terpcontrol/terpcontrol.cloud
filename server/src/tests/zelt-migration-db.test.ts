import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import deviceModel from '@models/device.model';
import migrationModel from '@models/migration.model';
import zeltModel from '@models/zelt.model';
import { dataService } from '@services/data.service';
import { zeltService } from '@services/zelt.service';

// The mocked migration test cannot see whether the lock holds, because it stubs
// the lock away. These run against a real database so that concurrency and the
// indexes the lock depends on are exercised rather than assumed.
let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([zeltModel.deleteMany({}), migrationModel.deleteMany({}), deviceModel.deleteMany({})]);
  await Promise.all([zeltModel.syncIndexes(), migrationModel.syncIndexes()]);
  jest.spyOn(dataService, 'getFirstSampleTimes').mockResolvedValue(new Map());
});

afterEach(() => jest.restoreAllMocks());

const claimDevice = (device_id: string, owner_id: string, name = '') =>
  deviceModel.create({ device_id, owner_id, name, username: device_id, password: 'x', class_id: 'c', device_type: 'controller' });

/** A fresh instance booting: it knows nothing of the run that came before it. */
const forgetMigrationRun = () => migrationModel.deleteMany({});

describe('Zelt backfill against a real database', () => {
  it('gives every claimed device a tent of its own', async () => {
    await claimDevice('controller-1', 'user-1', 'Zelt Keller');
    await claimDevice('fridge-1', 'user-2');

    expect(await zeltService.backfillZelte()).toBe(2);
    expect(await zeltModel.countDocuments({})).toBe(2);
  });

  it('leaves unclaimed devices alone', async () => {
    await claimDevice('controller-1', 'user-1');
    await claimDevice('nobody-1', '');

    await zeltService.backfillZelte();
    expect(await zeltModel.countDocuments({})).toBe(1);
  });

  it('writes nothing on a second run', async () => {
    await claimDevice('controller-1', 'user-1');

    expect(await zeltService.backfillZelte()).toBe(1);
    expect(await zeltService.backfillZelte()).toBe(0);
    expect(await zeltModel.countDocuments({})).toBe(1);
  });

  it('does not resurrect a tent the user deleted, however often the server restarts', async () => {
    await claimDevice('controller-1', 'user-1');
    await zeltService.backfillZelte();
    await zeltModel.deleteMany({});

    expect(await zeltService.backfillZelte()).toBe(0);
    expect(await zeltModel.countDocuments({})).toBe(0);
  });

  it('creates one tent per device when two instances boot at the same moment', async () => {
    for (let i = 0; i < 8; i++) await claimDevice(`controller-${i}`, 'user-1');

    await Promise.all([zeltService.backfillZelte(), zeltService.backfillZelte(), zeltService.backfillZelte()]);

    expect(await zeltModel.countDocuments({})).toBe(8);
    const bindings = (await zeltModel.find({}).lean()).flatMap(zelt => zelt.geraete.map(b => b.geraet_id));
    expect(new Set(bindings).size).toBe(8);
  });

  it('creates no twin when a run that lost its lock writes anyway', async () => {
    await claimDevice('controller-1', 'user-1');
    await zeltService.backfillZelte();

    // The successor of a run whose lease went stale sees the same devices, and
    // its read-then-write check can pass while the loser is still writing.
    await forgetMigrationRun();
    jest.spyOn(zeltModel, 'exists').mockResolvedValue(null as any);

    expect(await zeltService.backfillZelte()).toBe(0);
    expect(await zeltModel.countDocuments({})).toBe(1);
  });

  it('gives the new owner a tent after a device changed hands', async () => {
    await claimDevice('controller-1', 'user-a');
    await zeltService.backfillZelte();

    await zeltService.bindungBeenden('controller-1');
    await deviceModel.updateOne({ device_id: 'controller-1' }, { owner_id: 'user-b' });
    await forgetMigrationRun();

    expect(await zeltService.backfillZelte()).toBe(1);
    const zelte = await zeltModel.find({}).sort({ besitzer_id: 1 }).lean();
    expect(zelte.map(zelt => zelt.besitzer_id)).toEqual(['user-a', 'user-b']);
    // The old owner's tent keeps the history but no longer points at the device.
    expect(zelte[0].geraete[0].bis).toBeGreaterThan(0);
    expect(zelte[1].geraete[0].bis).toBeUndefined();
  });

  it('keeps the lock name unique, which is what makes the race safe', async () => {
    const indexes = await migrationModel.collection.indexes();
    const nameIndex = indexes.find(i => i.key && i.key.name === 1);
    expect(nameIndex?.unique).toBe(true);
  });

  it('keeps the migrated binding unique, which is what makes the write safe', async () => {
    const indexes = await zeltModel.collection.indexes();
    const bindingIndex = indexes.find(i => i.key && i.key.migriert_aus === 1);
    expect(bindingIndex?.unique).toBe(true);
  });
});
