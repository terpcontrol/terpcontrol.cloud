import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Zelt } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import deviceLogModel from '@models/devicelog.model';
import imageModel from '@models/images.model';
import zeltModel from '@models/zelt.model';
import zielStandModel from '@models/zielstand.model';
import { projiziereDinge, PROJIZIERTE_ARTEN } from '@services/ding-adapter';
import { DingFenster } from '@services/ding-adapter/fenster';

// The tent with no device is the case the whole product is built around, so it
// is the case these projections are tested against first. Nothing here creates
// a Device, a DeviceLog or a binding, and the collections that hold them must
// stay untouched - not queried and found empty, but never asked.
let mongo: MongoMemoryServer;

const TAG = 24 * 60 * 60 * 1000;
const TAG_NULL = Date.UTC(2026, 4, 1);
const JETZT = TAG_NULL + 30 * TAG;

const zelt: Zelt = {
  zelt_id: 'zelt-ohne-geraet',
  besitzer_id: 'user-1',
  name: 'Keller',
  geraete: [],
  zeitzone: 'Europe/Berlin',
  tag_null: TAG_NULL,
  erstellt_at: TAG_NULL,
  d: { schema_id: 'biobizz-all-mix', schema_schritt: 5 },
};

const fenster: DingFenster = { zelt: zelt, von: TAG_NULL, bis: JETZT };

const bild = (image_id: string, t: number, format: 'jpeg' | 'user/jpeg' | 'mp4', keyed: { zelt_id?: string; device_id?: string }) =>
  imageModel.create({ image_id: image_id, timestamp: t, data: Buffer.from('x'), format: format, ...keyed });

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
    imageModel.deleteMany({}),
    zielStandModel.deleteMany({}),
    deviceModel.deleteMany({}),
    deviceLogModel.deleteMany({}),
  ]);
  await zeltModel.create(zelt);
});

afterEach(() => jest.restoreAllMocks());

describe('Projection without a device', () => {
  it('returns nothing for the six device arts, and asks no device collection to find that out', async () => {
    const geraeteAbfragen = [
      jest.spyOn(deviceModel, 'find'),
      jest.spyOn(deviceModel, 'findOne'),
      jest.spyOn(deviceLogModel, 'find'),
      jest.spyOn(deviceLogModel, 'findOne'),
    ];

    for (const art of ['geraet', 'dose', 'kamera', 'ereignis', 'ziel'] as const) {
      expect(await projiziereDinge(fenster, [art])).toEqual([]);
    }

    geraeteAbfragen.forEach(abfrage => expect(abfrage).not.toHaveBeenCalled());
  });

  it('still projects the tent, its schema, the photographs and a Rückblick', async () => {
    await bild('foto-1', TAG_NULL + TAG, 'user/jpeg', { zelt_id: zelt.zelt_id });
    await bild('foto-2', TAG_NULL + 2 * TAG, 'user/jpeg', { zelt_id: zelt.zelt_id });
    await bild('film-1', TAG_NULL + 3 * TAG, 'mp4', { zelt_id: zelt.zelt_id });

    expect((await projiziereDinge(fenster, ['zelt'])).map(ding => [ding.ding_id, ding.t])).toEqual([[`zelt:${zelt.zelt_id}`, TAG_NULL]]);
    expect((await projiziereDinge(fenster, ['schema']))[0].d).toEqual({ schema_id: 'biobizz-all-mix', schritt: 5 });
    expect((await projiziereDinge(fenster, ['bild'])).map(ding => ding.ding_id)).toEqual(['bild:foto-2', 'bild:foto-1']);
    expect((await projiziereDinge(fenster, ['film'])).map(ding => ding.ding_id)).toEqual(['film:film-1']);
  });

  it('leaves a projected photograph indistinguishable from a stored Ding - no geraet_id, hand as its source', async () => {
    await bild('foto-1', TAG_NULL + TAG, 'user/jpeg', { zelt_id: zelt.zelt_id });

    const [foto] = await projiziereDinge(fenster, ['bild']);
    expect(foto.geraet_id).toBeUndefined();
    expect(foto.d).toEqual({ quelle: 'hand', format: 'user/jpeg' });
    expect(foto.bilder).toEqual(['foto-1']);
  });

  it('does not hand the tent a picture that belongs to a device it never bound', async () => {
    await bild('fremd-1', TAG_NULL + TAG, 'jpeg', { device_id: 'controller-fremd' });

    expect(await projiziereDinge(fenster, ['bild'])).toEqual([]);
  });

  it('projects a hand target as soon as one exists, with no device on it', async () => {
    await zielStandModel.create({ zelt_id: zelt.zelt_id, schluessel: 'hand.ph', wert: 6.4, gilt_ab: TAG_NULL + TAG, quelle: 'hand' });

    const [ziel] = await projiziereDinge(fenster, ['ziel']);
    expect(ziel.geraet_id).toBeUndefined();
    expect(ziel.t_ende).toBeNull();
    expect(ziel.d).toEqual({ schluessel: 'hand.ph', wert: 6.4, quelle: 'hand' });
  });

  it('merges every art into one list, newest first, without being asked art by art', async () => {
    await bild('foto-1', TAG_NULL + 4 * TAG, 'user/jpeg', { zelt_id: zelt.zelt_id });
    await bild('film-1', TAG_NULL + 2 * TAG, 'mp4', { zelt_id: zelt.zelt_id });

    const dinge = await projiziereDinge(fenster);
    expect(dinge.map(ding => ding.art)).toEqual(['bild', 'film', 'schema', 'zelt']);
    expect(dinge.map(ding => ding.t)).toEqual([...dinge.map(ding => ding.t)].sort((a, b) => b - a));
  });

  it('ignores stored arts instead of refusing them, so one call can carry a whole request', async () => {
    expect(await projiziereDinge(fenster, ['gabe', 'notiz', 'pflanze'])).toEqual([]);
    expect(PROJIZIERTE_ARTEN).toHaveLength(9);
  });
});
