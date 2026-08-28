import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import deviceModel from '@models/device.model';
import deviceLogModel from '@models/devicelog.model';
import dingModel from '@models/ding.model';
import migrationModel from '@models/migration.model';
import shareModel from '@models/share.model';
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
  await Promise.all([
    zeltModel.deleteMany({}),
    migrationModel.deleteMany({}),
    deviceModel.deleteMany({}),
    dingModel.deleteMany({}),
    deviceLogModel.deleteMany({}),
    shareModel.deleteMany({}),
  ]);
  await Promise.all([zeltModel.syncIndexes(), migrationModel.syncIndexes()]);
  jest.spyOn(dataService, 'getFirstSampleTimes').mockResolvedValue(new Map());
});

afterEach(() => jest.restoreAllMocks());

const claimDevice = (device_id: string, owner_id: string, name = '', claimed_at?: number) =>
  deviceModel.create({ device_id, owner_id, name, claimed_at, username: device_id, password: 'x', class_id: 'c', device_type: 'controller' });

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

  it('gives every migrated tent its first run, like the create sheet does', async () => {
    await claimDevice('controller-1', 'user-1');

    await zeltService.backfillZelte();

    const zelt = await zeltModel.findOne({}).lean();
    const laeufe = await dingModel.find({ art: 'lauf' }).lean();
    expect(laeufe.length).toBe(1);
    expect(laeufe[0].zelt_id).toBe(zelt?.zelt_id);
    expect(laeufe[0].t).toBe(zelt?.tag_null);
    expect(laeufe[0].t_ende).toBeNull();
  });

  it('does not date a tent from rows a previous owner left behind', async () => {
    // Nothing deletes a sold device's log lines and photographs, so the oldest
    // one in Mongo is evidence of somebody's grow but not of whose.
    const jahr = Date.now() - 365 * 24 * 60 * 60 * 1000;
    await claimDevice('controller-1', 'user-neu');
    await deviceLogModel.create({ device_id: 'controller-1', message: 'alarm', severity: 1, time: new Date(jahr) });

    await zeltService.backfillZelte();

    const zelt = await zeltModel.findOne({}).lean();
    expect(zelt?.tag_null).toBeGreaterThan(jahr + 300 * 24 * 60 * 60 * 1000);
  });

  it('dates a migrated tent from the claim when the device recorded one', async () => {
    const claim = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await claimDevice('controller-1', 'user-1', '', claim);

    await zeltService.backfillZelte();

    const zelt = await zeltModel.findOne({}).lean();
    expect(zelt?.geraete[0].seit).toBe(claim);
    expect(zelt?.tag_null).toBe(claim);
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

/**
 * The tents dated from the migration moment rather than from anything that
 * happened in them. Their owner cannot widen a binding from the UI - moving
 * `tag_null` moves the day counter, not the window the reads are clipped to -
 * so the only correction is one that can prove the owner had the device.
 */
describe('Widening a binding back to what its owner demonstrably had', () => {
  const TAG = 24 * 60 * 60 * 1000;
  const JETZT = Date.now();

  const teile = (device_id: string, owner_id: string, createdAt: number, felder: Record<string, unknown> = {}) =>
    shareModel.create({
      share_id: `share-${device_id}-${createdAt}`,
      device_id: device_id,
      owner_id: owner_id,
      page: 'charts',
      editable: false,
      webcam: false,
      createdAt: createdAt,
      ...felder,
    });

  const zeltMitBindung = (zelt_id: string, besitzer_id: string, geraete: { geraet_id: string; seit: number; bis?: number }[]) =>
    zeltModel.create({
      zelt_id: zelt_id,
      besitzer_id: besitzer_id,
      name: '',
      geraete: geraete,
      zeitzone: 'Europe/Berlin',
      tag_null: geraete[0].seit,
      erstellt_at: geraete[0].seit,
    });

  const seitVon = async (zelt_id: string): Promise<number[]> =>
    ((await zeltModel.findOne({ zelt_id: zelt_id }).lean())?.geraete ?? []).map(b => b.seit);

  it('moves the binding back to the day the owner shared the device', async () => {
    await claimDevice('controller-1', 'user-1');
    await zeltMitBindung('zelt-1', 'user-1', [{ geraet_id: 'controller-1', seit: JETZT }]);
    await teile('controller-1', 'user-1', JETZT - 200 * TAG);
    await teile('controller-1', 'user-1', JETZT - 30 * TAG);

    expect(await zeltService.repariereBindungen()).toBe(1);
    expect(await seitVon('zelt-1')).toEqual([JETZT - 200 * TAG]);
  });

  it('leaves the day counter alone, because moving it would mean rewriting a stored Ding', async () => {
    await claimDevice('controller-1', 'user-1');
    await zeltMitBindung('zelt-1', 'user-1', [{ geraet_id: 'controller-1', seit: JETZT }]);
    await teile('controller-1', 'user-1', JETZT - 200 * TAG);

    await zeltService.repariereBindungen();

    expect((await zeltModel.findOne({ zelt_id: 'zelt-1' }).lean())?.tag_null).toBe(JETZT);
  });

  it('changes nothing on a second run, and nothing on a third instance booting', async () => {
    await claimDevice('controller-1', 'user-1');
    await zeltMitBindung('zelt-1', 'user-1', [{ geraet_id: 'controller-1', seit: JETZT }]);
    await teile('controller-1', 'user-1', JETZT - 200 * TAG);
    await zeltService.repariereBindungen();

    expect(await zeltService.repariereBindungen()).toBe(0);
    await forgetMigrationRun();
    expect(await zeltService.repariereBindungen()).toBe(0);
    expect(await seitVon('zelt-1')).toEqual([JETZT - 200 * TAG]);
  });

  it('never widens a device whose claim recorded its own moment', async () => {
    // Every claim since `claimed_at` exists dates itself, so there is nothing
    // to repair and nothing to widen past.
    await claimDevice('controller-1', 'user-1', '', JETZT - 2 * TAG);
    await zeltMitBindung('zelt-1', 'user-1', [{ geraet_id: 'controller-1', seit: JETZT - 2 * TAG }]);
    await teile('controller-1', 'user-1', JETZT - 200 * TAG);

    expect(await zeltService.repariereBindungen()).toBe(0);
    expect(await seitVon('zelt-1')).toEqual([JETZT - 2 * TAG]);
  });

  it('never moves a binding later', async () => {
    await claimDevice('controller-1', 'user-1');
    await zeltMitBindung('zelt-1', 'user-1', [{ geraet_id: 'controller-1', seit: JETZT - 300 * TAG }]);
    await teile('controller-1', 'user-1', JETZT - 200 * TAG);

    expect(await zeltService.repariereBindungen()).toBe(0);
    expect(await seitVon('zelt-1')).toEqual([JETZT - 300 * TAG]);
  });

  it('ignores a share somebody else made for the same device', async () => {
    // Whoever had the hardware before does not date this tent - that is the
    // regression this must not reintroduce.
    await claimDevice('controller-1', 'user-1');
    await zeltMitBindung('zelt-1', 'user-1', [{ geraet_id: 'controller-1', seit: JETZT }]);
    await teile('controller-1', 'user-vorbesitzer', JETZT - 200 * TAG);

    expect(await zeltService.repariereBindungen()).toBe(0);
    expect(await seitVon('zelt-1')).toEqual([JETZT]);
  });

  it('stops at a stretch of ownership that belongs to somebody else', async () => {
    await claimDevice('controller-1', 'user-kaeufer');
    await zeltMitBindung('zelt-verkaeufer', 'user-verkaeufer', [{ geraet_id: 'controller-1', seit: JETZT - 100 * TAG, bis: JETZT - 10 * TAG }]);
    await zeltMitBindung('zelt-kaeufer', 'user-kaeufer', [{ geraet_id: 'controller-1', seit: JETZT }]);
    // The buyer did once share it - long before they had it, on a device they
    // had at the time and sold on. The window in between is not theirs.
    await teile('controller-1', 'user-kaeufer', JETZT - 200 * TAG);

    expect(await zeltService.repariereBindungen()).toBe(0);
    expect(await seitVon('zelt-kaeufer')).toEqual([JETZT]);
  });

  it('widens only the earliest binding of a device that was rebound', async () => {
    await claimDevice('controller-1', 'user-1');
    await zeltMitBindung('zelt-1', 'user-1', [
      { geraet_id: 'controller-1', seit: JETZT - 20 * TAG, bis: JETZT - 10 * TAG },
      { geraet_id: 'controller-1', seit: JETZT - 5 * TAG },
    ]);
    await teile('controller-1', 'user-1', JETZT - 200 * TAG);

    expect(await zeltService.repariereBindungen()).toBe(1);
    expect(await seitVon('zelt-1')).toEqual([JETZT - 200 * TAG, JETZT - 5 * TAG]);
  });

  it('does nothing for a tent whose owner never shared anything', async () => {
    await claimDevice('controller-1', 'user-1');
    await zeltMitBindung('zelt-1', 'user-1', [{ geraet_id: 'controller-1', seit: JETZT }]);

    expect(await zeltService.repariereBindungen()).toBe(0);
    expect(await seitVon('zelt-1')).toEqual([JETZT]);
  });
});
