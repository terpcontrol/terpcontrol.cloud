import { randomUUID } from 'crypto';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import dingModel from '@models/ding.model';
import { NUR_ZAEHLENDE, zaehltMit } from '@utils/zaehlt-mit';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

const gabe = (wasser_l: number, felder: Record<string, unknown> = {}) => ({
  ding_id: randomUUID(),
  zelt_id: 'zelt-1',
  art: 'gabe',
  name: '',
  t: Date.now(),
  d: { wasser_l: wasser_l },
  ...felder,
});

describe('what counts towards a total', () => {
  it('drops a correction and a duplicate, and keeps everything else', () => {
    expect(zaehltMit(gabe(4))).toBe(true);
    expect(zaehltMit(gabe(6, { storniert_von: randomUUID() }))).toBe(false);
    expect(zaehltMit({ d: { wasser_l: 6, dublette_von: randomUUID() } })).toBe(false);
    // A Ding with no payload at all is not a duplicate of anything.
    expect(zaehltMit({})).toBe(true);
  });

  it('adds up to what was actually poured', async () => {
    // The case a reviewer measured: forgetting either exclusion reads 16 l
    // where the tent got 4.
    const dinge = [gabe(6, { storniert_von: randomUUID() }), gabe(6, { d: { wasser_l: 6, dublette_von: randomUUID() } }), gabe(4)];

    expect(dinge.reduce((summe, ding) => summe + Number(ding.d.wasser_l), 0)).toBe(16);
    expect(dinge.filter(zaehltMit).reduce((summe, ding) => summe + Number(ding.d.wasser_l), 0)).toBe(4);
  });

  it('excludes the same two in the database as it does in memory', async () => {
    await dingModel.deleteMany({});
    await dingModel.create([gabe(6, { storniert_von: randomUUID() }), gabe(6, { d: { wasser_l: 6, dublette_von: randomUUID() } }), gabe(4)]);

    const gezaehlt = await dingModel.find({ zelt_id: 'zelt-1', ...NUR_ZAEHLENDE }).lean();

    expect(gezaehlt).toHaveLength(1);
    expect(gezaehlt.reduce((summe, ding: any) => summe + Number(ding.d.wasser_l), 0)).toBe(4);
    // The rows are still there; a member has to be able to see their correction landed.
    expect(await dingModel.countDocuments({ zelt_id: 'zelt-1' })).toBe(3);
  });
});
