import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import dingModel from '@models/ding.model';

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
  await dingModel.deleteMany({});
  await dingModel.syncIndexes();
});

const gabe = (felder: Record<string, unknown> = {}) => ({
  ding_id: randomUUID(),
  zelt_id: 'zelt-1',
  art: 'gabe',
  name: '',
  t: Date.now(),
  d: { wasser_l: 5, verteilung: 'gesamt', ec_basis: 'absolut', produkte: [{ name: 'Bio Grow', ml_pro_l: 2, aus_schema: false }] },
  ...felder,
});

describe('the dinge collection', () => {
  it('tells an open interval from a Ding that is not one', async () => {
    const offen = await dingModel.create(gabe({ art: 'zustand', d: { text: 'Lüfter defekt' }, t_ende: null }));
    const zeitpunkt = await dingModel.create(gabe());
    const beendet = await dingModel.create(gabe({ art: 'phase', d: { stufe: 'flowering' }, t_ende: Date.now() + 1000 }));

    const geladen = async (ding_id: string) => dingModel.findOne({ ding_id: ding_id }, { _id: 0, __v: 0 }).lean();

    expect(await geladen(offen.ding_id)).toHaveProperty('t_ende', null);
    expect(await geladen(zeitpunkt.ding_id)).not.toHaveProperty('t_ende');
    expect(await geladen(beendet.ding_id)).toHaveProperty('t_ende', expect.any(Number));

    // The distinction has to survive the query too: "still open" is a search,
    // "not an interval" is not.
    expect(await dingModel.countDocuments({ t_ende: null })).toBe(2);
    expect(await dingModel.countDocuments({ t_ende: { $type: 'null' } })).toBe(1);
    expect(await dingModel.countDocuments({ t_ende: { $exists: false } })).toBe(1);
  });

  it('upserts on ding_id, so a retry over a bad connection logs one watering', async () => {
    const ding = gabe();

    for (let versuch = 0; versuch < 3; versuch++) {
      await dingModel.updateOne({ ding_id: ding.ding_id }, { $set: ding }, { upsert: true });
    }

    expect(await dingModel.countDocuments({})).toBe(1);
    await expect(dingModel.create(ding)).rejects.toMatchObject({ code: 11000 });
  });

  it('keeps the payload and the edges as they were written', async () => {
    const pflanze_id = randomUUID();
    const ding = gabe({ rel: { an: [pflanze_id] }, bilder: ['image-1'], akteur: randomUUID() });
    await dingModel.create(ding);

    const geladen = await dingModel.findOne({ ding_id: ding.ding_id }).lean();
    expect(geladen.d).toEqual(ding.d);
    expect(geladen.rel).toEqual({ an: [pflanze_id] });
    expect(geladen.bilder).toEqual(['image-1']);
    // No photos means no photos, not an empty array somebody has to interpret.
    await dingModel.create(gabe());
    expect(await dingModel.countDocuments({ bilder: { $exists: false } })).toBe(1);
  });

  it('drops a geraet_id instead of storing one on a Ding the tent owns', async () => {
    const ding = gabe({ geraet_id: 'controller-1' });
    await dingModel.create(ding);

    expect(await dingModel.findOne({ ding_id: ding.ding_id }).lean()).not.toHaveProperty('geraet_id');
  });

  it('carries the indexes the tent read needs', async () => {
    const schluessel = (await dingModel.collection.indexes()).map(index => JSON.stringify(index.key));

    expect(schluessel).toContain(JSON.stringify({ ding_id: 1 }));
    expect(schluessel).toContain(JSON.stringify({ zelt_id: 1, t: -1 }));
    expect(schluessel).toContain(JSON.stringify({ zelt_id: 1, art: 1, t: -1 }));
  });

  it('reads one tent newest first without touching another tent', async () => {
    const jetzt = Date.now();
    await dingModel.create([
      gabe({ zelt_id: 'zelt-1', t: jetzt - 2000 }),
      gabe({ zelt_id: 'zelt-1', t: jetzt - 1000, art: 'notiz', d: { text: 'gegossen' } }),
      gabe({ zelt_id: 'zelt-2', t: jetzt }),
    ]);

    const seite = await dingModel.find({ zelt_id: 'zelt-1' }).sort({ t: -1 }).lean();
    expect(seite.map(ding => ding.art)).toEqual(['notiz', 'gabe']);
  });
});

describe('baueIndexe', () => {
  // The guard exists so an import-time index build cannot answer ten seconds
  // into an unrelated test. That makes the helper itself the only place the
  // production behaviour can be checked.
  const helfer = () => require('@utils/indexe').baueIndexe;

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    jest.resetModules();
  });

  it('does not touch the database under test', async () => {
    const model = { modelName: 'Ding', createIndexes: jest.fn() };
    helfer()(model);
    expect(model.createIndexes).not.toHaveBeenCalled();
  });

  it('builds them anywhere else', async () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const model = { modelName: 'Ding', createIndexes: jest.fn().mockResolvedValue(undefined) };
    helfer()(model);
    expect(model.createIndexes).toHaveBeenCalled();
  });

  it('swallows a failure instead of rejecting into nothing', async () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const model = { modelName: 'Ding', createIndexes: jest.fn().mockRejectedValue(new Error('mongo away')) };
    expect(() => helfer()(model)).not.toThrow();
    // The rejection is handled inside the helper; nothing reaches the process.
    await new Promise(fertig => setImmediate(fertig));
  });
});
