import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import deviceModel from '@models/device.model';
import dingModel from '@models/ding.model';
import zeltModel from '@models/zelt.model';
import { zeltService } from '@services/zelt.service';

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
  await Promise.all([zeltModel.deleteMany({}), deviceModel.deleteMany({}), dingModel.deleteMany({})]);
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
