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

  it('carries the indexes the tent read needs, second sort key included', async () => {
    const schluessel = (await dingModel.collection.indexes()).map(index => JSON.stringify(index.key));

    expect(schluessel).toContain(JSON.stringify({ ding_id: 1 }));
    expect(schluessel).toContain(JSON.stringify({ zelt_id: 1, t: -1, ding_id: -1 }));
    expect(schluessel).toContain(JSON.stringify({ zelt_id: 1, art: 1, t: -1, ding_id: -1 }));
  });

  // Four entries on one moment is the normal case, not a corner: `t` is what the
  // person typed, and a back-dated „yesterday's watering" from six club members
  // lands on the same rounded midnight for all six.
  describe('paging through one moment', () => {
    const MITTERNACHT = Date.UTC(2026, 4, 3);

    const seite = (cursor: { t: number; ding_id: string } | null, grenze = 2) =>
      dingModel
        .find({
          zelt_id: 'zelt-1',
          // The half-open tail after the cursor, under the order below.
          ...(cursor ? { $or: [{ t: { $lt: cursor.t } }, { t: cursor.t, ding_id: { $lt: cursor.ding_id } }] } : {}),
        })
        .sort({ t: -1, ding_id: -1 })
        .limit(grenze)
        .lean();

    beforeEach(async () => {
      await dingModel.create([gabe({ t: MITTERNACHT }), gabe({ t: MITTERNACHT }), gabe({ t: MITTERNACHT }), gabe({ t: MITTERNACHT })]);
    });

    it('reaches all four, two at a time', async () => {
      const gesehen: string[] = [];
      let cursor: { t: number; ding_id: string } | null = null;

      for (let runde = 0; runde < 5; runde++) {
        const dinge = await seite(cursor);
        if (dinge.length === 0) {
          break;
        }
        gesehen.push(...dinge.map(ding => ding.ding_id));
        cursor = { t: dinge[dinge.length - 1].t, ding_id: dinge[dinge.length - 1].ding_id };
      }

      expect(gesehen).toHaveLength(4);
      expect(new Set(gesehen).size).toBe(4);
      expect(gesehen).toEqual([...gesehen].sort().reverse());
    });

    it('would lose two of them for good on a cursor keyed on `t` alone', async () => {
      const erste = await seite(null);

      // The regression this pair of tests exists for: no error, no empty result
      // that looks wrong - just two entries that no page can ever reach again.
      expect(await dingModel.find({ zelt_id: 'zelt-1', t: { $lt: erste[1].t } }).lean()).toHaveLength(0);
      expect(await seite({ t: erste[1].t, ding_id: erste[1].ding_id })).toHaveLength(2);
    });

    it('lets the index serve the sort instead of collecting the page in memory', async () => {
      const erklaert: any = await dingModel.find({ zelt_id: 'zelt-1' }).sort({ t: -1, ding_id: -1 }).limit(2).explain('queryPlanner');

      const stufen: string[] = [];
      for (let stufe = erklaert.queryPlanner.winningPlan; stufe; stufe = stufe.inputStage) {
        stufen.push(stufe.stage);
        if (stufe.indexName) {
          expect(stufe.indexName).toBe('zelt_id_1_t_-1_ding_id_-1');
        }
      }

      // A SORT stage would mean mongo read the whole tent into memory to hand
      // out two rows - which is what an index in the other direction forces.
      expect(stufen).toContain('IXSCAN');
      expect(stufen).not.toContain('SORT');
    });
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
