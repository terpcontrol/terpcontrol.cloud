import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import deviceLogModel from '@models/devicelog.model';
import deviceModel from '@models/device.model';
import dingModel from '@models/ding.model';
import imageModel from '@models/images.model';
import zeltModel from '@models/zelt.model';
import zielStandModel from '@models/zielstand.model';
import { zeltService } from '@services/zelt.service';
import { projiziereDinge } from '@services/ding-adapter';

// The claim is where a tent starts existing (§14.2 step 2), so it is tested
// against a real database: the append, the second binding after an unclaim and
// the tent a device changing hands must not inherit are all writes whose shape
// a mock would only assert back at itself.
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
    deviceModel.deleteMany({}),
    dingModel.deleteMany({}),
    deviceLogModel.deleteMany({}),
    imageModel.deleteMany({}),
    zielStandModel.deleteMany({}),
  ]);
  await zeltModel.syncIndexes();
});

const TAG = 24 * 60 * 60 * 1000;

const zeltAnlegen = (besitzer_id: string, name: string, tag_null: number) =>
  zeltModel.create({ zelt_id: `zelt-${name}`, besitzer_id, name, geraete: [], zeitzone: 'Europe/Berlin', tag_null, erstellt_at: tag_null });

describe('Claiming a device binds it to a tent', () => {
  it('gives an owner with no tent one containing the device', async () => {
    const vorher = Date.now();
    await zeltService.bindungBeginnen('controller-1', 'user-1', 'Zelt Keller');

    const zelte = await zeltModel.find({}).lean();
    expect(zelte.length).toBe(1);
    expect(zelte[0].besitzer_id).toBe('user-1');
    expect(zelte[0].name).toBe('Zelt Keller');
    expect(zelte[0].geraete.map(b => b.geraet_id)).toEqual(['controller-1']);
    expect(zelte[0].geraete[0].seit).toBeGreaterThanOrEqual(vorher);
    expect(zelte[0].geraete[0].bis).toBeUndefined();
    expect(zelte[0].tag_null).toEqual(zelte[0].geraete[0].seit);
  });

  it('mints run 1 with the tent, because the day counter reads the open run', async () => {
    await zeltService.bindungBeginnen('controller-1', 'user-1');

    const zelt = await zeltModel.findOne({}).lean();
    const laeufe = await dingModel.find({ art: 'lauf' }).lean();
    expect(laeufe.length).toBe(1);
    expect(laeufe[0].zelt_id).toBe(zelt?.zelt_id);
    expect(laeufe[0].t).toBe(zelt?.tag_null);
    expect(laeufe[0].t_ende).toBeNull();
    expect(laeufe[0].d).toEqual({ nummer: 1 });
  });

  it('appends to the tent an owner already has instead of starting a second one', async () => {
    await zeltAnlegen('user-1', 'Keller', Date.now() - 61 * TAG);

    await zeltService.bindungBeginnen('controller-1', 'user-1', 'Controller');

    const zelte = await zeltModel.find({}).lean();
    expect(zelte.length).toBe(1);
    expect(zelte[0].name).toBe('Keller');
    expect(zelte[0].geraete.map(b => b.geraet_id)).toEqual(['controller-1']);
    // §14.4: the day the diary started is not the day the hardware arrived.
    expect(zelte[0].tag_null).toBeLessThan(zelte[0].geraete[0].seit);
    expect(await dingModel.countDocuments({ art: 'lauf' })).toBe(0);
  });

  it('starts a tent of its own when the owner has several and nobody said which', async () => {
    await zeltAnlegen('user-1', 'Keller', Date.now() - 61 * TAG);
    await zeltAnlegen('user-1', 'Dachboden', Date.now() - 12 * TAG);

    await zeltService.bindungBeginnen('controller-1', 'user-1', 'Controller');

    const zelte = await zeltModel.find({}).lean();
    expect(zelte.length).toBe(3);
    expect(zelte.filter(zelt => zelt.geraete.length > 0).map(zelt => zelt.name)).toEqual(['Controller']);
  });

  it('binds to the named tent when the claim says which', async () => {
    await zeltAnlegen('user-1', 'Keller', Date.now() - 61 * TAG);
    await zeltAnlegen('user-1', 'Dachboden', Date.now() - 12 * TAG);

    await zeltService.bindungBeginnen('controller-1', 'user-1', 'Controller', 'zelt-Dachboden');

    const zelte = await zeltModel.find({}).lean();
    expect(zelte.length).toBe(2);
    expect(zelte.filter(zelt => zelt.geraete.length > 0).map(zelt => zelt.name)).toEqual(['Dachboden']);
  });

  it('ignores a tent the claiming owner does not own', async () => {
    await zeltAnlegen('user-2', 'Fremd', Date.now() - 61 * TAG);

    await zeltService.bindungBeginnen('controller-1', 'user-1', 'Controller', 'zelt-Fremd');

    const fremd = await zeltModel.findOne({ besitzer_id: 'user-2' }).lean();
    expect(fremd?.geraete).toEqual([]);
    const eigen = await zeltModel.findOne({ besitzer_id: 'user-1' }).lean();
    expect(eigen?.geraete.map(b => b.geraet_id)).toEqual(['controller-1']);
  });

  it('changes nothing when the same owner claims the same device again', async () => {
    await zeltService.bindungBeginnen('controller-1', 'user-1');
    const vorher = await zeltModel.findOne({}).lean();

    await zeltService.bindungBeginnen('controller-1', 'user-1');

    const zelte = await zeltModel.find({}).lean();
    expect(zelte.length).toBe(1);
    expect(zelte[0].geraete).toEqual(vorher?.geraete);
    expect(await dingModel.countDocuments({ art: 'lauf' })).toBe(1);
  });

  it('appends a second binding after an unclaim instead of reopening the first', async () => {
    await zeltService.bindungBeginnen('controller-1', 'user-1');
    await zeltService.bindungBeenden('controller-1');
    const geschlossen = (await zeltModel.findOne({}).lean())?.geraete[0];

    await zeltService.bindungBeginnen('controller-1', 'user-1');

    const zelt = await zeltModel.findOne({}).lean();
    expect(zelt?.geraete.length).toBe(2);
    expect(zelt?.geraete[0]).toEqual(geschlossen);
    expect(zelt?.geraete[1].bis).toBeUndefined();
    expect(zelt?.geraete[1].seit).toBeGreaterThanOrEqual(geschlossen?.bis as number);
    // One tent, one run: a re-claim is not a new grow.
    expect(await dingModel.countDocuments({ art: 'lauf' })).toBe(1);
  });

  it('dates a second-hand device from the sale and not from its previous owner', async () => {
    const jahr = Date.now() - 365 * TAG;
    await zeltModel.create({
      zelt_id: 'zelt-verkaeufer',
      besitzer_id: 'user-verkaeufer',
      name: 'Verkäufer',
      geraete: [{ geraet_id: 'controller-1', seit: jahr }],
      zeitzone: 'Europe/Berlin',
      tag_null: jahr,
      erstellt_at: jahr,
    });

    const verkauf = Date.now();
    await zeltService.bindungBeginnen('controller-1', 'user-kaeufer', 'Controller');

    const kaeufer = await zeltModel.findOne({ besitzer_id: 'user-kaeufer' }).lean();
    expect(kaeufer?.geraete[0].seit).toBeGreaterThanOrEqual(verkauf);
    expect(kaeufer?.tag_null).toBeGreaterThanOrEqual(verkauf);

    // And the seller's tent stops pointing at hardware that is no longer theirs.
    const verkaeufer = await zeltModel.findOne({ besitzer_id: 'user-verkaeufer' }).lean();
    expect(verkaeufer?.geraete[0].seit).toBe(jahr);
    expect(verkaeufer?.geraete[0].bis).toBeGreaterThanOrEqual(verkauf);
  });
});

const KONFIGURATION = JSON.stringify({
  workmode: 'small',
  day: { temperature: 25, humidity: 60 },
  lights: { limit: 100, maintenanceOn: false },
});

const geraetAnlegen = (device_id: string, konfiguration?: string) =>
  deviceModel.create({ device_id: device_id, username: device_id, password: 'x', device_type: 'controller', configuration: konfiguration });

const gabe = (zelt_id: string, ding_id: string, t: number, wasser_l: number) =>
  dingModel.create({ ding_id: ding_id, zelt_id: zelt_id, art: 'gabe', name: '', t: t, d: { wasser_l: wasser_l }, erfasst_at: t });

describe('§14.2 step 3 — the first observation of the device settings', () => {
  it('writes one erstbefund target per configuration key, in force from the binding', async () => {
    await geraetAnlegen('controller-1', KONFIGURATION);

    const zelt = await zeltService.bindungBeginnen('controller-1', 'user-1');

    const staende = await zielStandModel.find({}).lean();
    expect(staende.map(stand => stand.schluessel).sort()).toEqual([
      'day.humidity',
      'day.temperature',
      'lights.limit',
      'lights.maintenanceOn',
      'workmode',
    ]);
    expect(staende.every(stand => stand.quelle === 'erstbefund')).toBe(true);
    expect(staende.every(stand => stand.gilt_ab === zelt?.geraete[0].seit)).toBe(true);
    expect(staende.every(stand => stand.gilt_bis === undefined || stand.gilt_bis === null)).toBe(true);
    expect(staende.every(stand => stand.zelt_id === zelt?.zelt_id && stand.geraet_id === 'controller-1')).toBe(true);
    // A boolean is a setting like any other and keeps its own word, because
    // `ZielStand.wert` is a number or a string and `false` is not `0`.
    expect(staende.find(stand => stand.schluessel === 'lights.maintenanceOn')?.wert).toBe('false');
  });

  it('says nothing about targets before the claim, which is what stops the chart back-projecting today', async () => {
    await geraetAnlegen('controller-1', KONFIGURATION);
    const zelt = await zeltService.bindungBeginnen('controller-1', 'user-1');
    const seit = zelt?.geraete[0].seit as number;

    const davor = await projiziereDinge({ zelt: zelt, von: seit - 30 * TAG, bis: seit - 1 }, ['ziel']);
    const danach = await projiziereDinge({ zelt: zelt, von: seit, bis: seit + TAG }, ['ziel']);

    expect(davor).toEqual([]);
    expect(danach.map(ding => ding.name).sort()).toContain('day.temperature');
  });

  it('leaves a hand target alone and closes only what the same device set before', async () => {
    await geraetAnlegen('controller-1', KONFIGURATION);
    const zelt = await zeltService.bindungBeginnen('controller-1', 'user-1');
    await zielStandModel.create({
      zelt_id: zelt?.zelt_id,
      schluessel: 'hand.ph',
      wert: 6.2,
      gilt_ab: (zelt?.geraete[0].seit as number) - 20 * TAG,
      quelle: 'hand',
    });

    await zeltService.bindungBeenden('controller-1');
    await zeltService.bindungBeginnen('controller-1', 'user-1');

    const hand = await zielStandModel.findOne({ quelle: 'hand' }).lean();
    expect(hand?.gilt_bis === undefined || hand?.gilt_bis === null).toBe(true);

    const zweit = (await zeltModel.findOne({}).lean())?.geraete[1].seit as number;
    const erste = await zielStandModel.find({ quelle: 'erstbefund', gilt_ab: { $lt: zweit } }).lean();
    expect(erste.length).toBe(5);
    expect(erste.every(stand => stand.gilt_bis === zweit)).toBe(true);
    expect(await zielStandModel.countDocuments({ quelle: 'erstbefund', gilt_ab: zweit })).toBe(5);
  });

  it('writes no target at all for a device that has never been configured', async () => {
    await geraetAnlegen('controller-1');

    await zeltService.bindungBeginnen('controller-1', 'user-1');

    expect(await zielStandModel.countDocuments({})).toBe(0);
  });
});

describe('§14.2 step 4 — the row that says the device arrived', () => {
  it('carries the count of what the diary held just before the claim', async () => {
    const tag_null = Date.now() - 61 * TAG;
    await zeltAnlegen('user-1', 'Keller', tag_null);
    await gabe('zelt-Keller', 'gabe-1', tag_null + TAG, 5);
    await gabe('zelt-Keller', 'gabe-2', tag_null + 2 * TAG, 13.5);
    await dingModel.create({ ding_id: 'notiz-1', zelt_id: 'zelt-Keller', art: 'notiz', name: '', t: tag_null, erfasst_at: tag_null });
    await imageModel.create({
      image_id: 'foto-1',
      zelt_id: 'zelt-Keller',
      timestamp: tag_null + TAG,
      data: Buffer.from('x'),
      format: 'user/jpeg',
    });
    await geraetAnlegen('controller-1', KONFIGURATION);

    const zelt = await zeltService.bindungBeginnen('controller-1', 'user-1', 'Controller', 'zelt-Keller');

    const [ereignis] = await projiziereDinge({ zelt: zelt, von: tag_null, bis: Date.now() + TAG }, ['ereignis']);
    expect(ereignis.name).toBe('message-device-connected');
    expect(ereignis.geraet_id).toBe('controller-1');
    expect(ereignis.t).toBe(zelt?.geraete[0].seit);
    expect(ereignis.d?.zaehler).toMatchObject({
      tage: 62,
      dinge: 3,
      fotos: 1,
      gaben: 2,
      wasser_l: 18.5,
      tag_null: tag_null,
    });
    expect(String((ereignis.d?.zaehler as { hash: string }).hash)).toHaveLength(64);
  });

  it('counts nothing for a tent that starts with the device, and still says so', async () => {
    await geraetAnlegen('controller-1', KONFIGURATION);

    const zelt = await zeltService.bindungBeginnen('controller-1', 'user-1');

    const logs = await deviceLogModel.find({}).lean();
    expect(logs.length).toBe(1);
    expect((logs[0].data as { zaehler: { dinge: number; tage: number; tag_null: number } }).zaehler).toMatchObject({
      dinge: 0,
      gaben: 0,
      fotos: 0,
      wasser_l: 0,
      tage: 1,
      tag_null: zelt?.tag_null,
    });
  });

  it('leaves the diary itself untouched, which is the whole promise of §14.4', async () => {
    const tag_null = Date.now() - 61 * TAG;
    await zeltAnlegen('user-1', 'Keller', tag_null);
    await gabe('zelt-Keller', 'gabe-1', tag_null + TAG, 5);
    const vorher = await dingModel.find({}, { _id: 0, __v: 0 }).lean();
    await geraetAnlegen('controller-1', KONFIGURATION);

    await zeltService.bindungBeginnen('controller-1', 'user-1', 'Controller', 'zelt-Keller');

    expect(await dingModel.find({}, { _id: 0, __v: 0 }).lean()).toEqual(vorher);
    expect((await zeltModel.findOne({ zelt_id: 'zelt-Keller' }).lean())?.tag_null).toBe(tag_null);
  });

  it('writes neither a target nor an event when the same device is claimed again into the same tent', async () => {
    await geraetAnlegen('controller-1', KONFIGURATION);
    await zeltService.bindungBeginnen('controller-1', 'user-1');

    await zeltService.bindungBeginnen('controller-1', 'user-1');

    expect(await zielStandModel.countDocuments({})).toBe(5);
    expect(await deviceLogModel.countDocuments({})).toBe(1);
  });
});
