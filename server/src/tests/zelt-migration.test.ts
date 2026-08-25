import { Zelt } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import deviceLogModel from '@models/devicelog.model';
import imageModel from '@models/images.model';
import migrationModel from '@models/migration.model';
import zeltModel from '@models/zelt.model';
import { dataService } from '@services/data.service';
import { zeltService } from '@services/zelt.service';

const OWNER_ID = 'user-1';
const FIRST_SAMPLE = 1750809600000;
const ERSTES_FOTO = 1719273600000;

const DEVICES = [
  { device_id: 'controller-1', owner_id: OWNER_ID, name: 'Zelt Keller' },
  { device_id: 'fridge-1', owner_id: 'user-2', name: '' },
];

describe('Zelt backfill on boot', () => {
  let created: Zelt[];
  let deviceFilter: any;

  beforeEach(() => {
    created = [];

    migrationModel.createIndexes = jest.fn().mockResolvedValue(undefined) as any;
    migrationModel.findOneAndUpdate = jest.fn().mockResolvedValue(null) as any;
    migrationModel.updateOne = jest.fn().mockResolvedValue({}) as any;

    deviceModel.find = jest.fn().mockImplementation(filter => {
      deviceFilter = filter;
      return { lean: () => Promise.resolve(DEVICES) };
    }) as any;

    // The oldest stored trace is read straight from Mongo, which this suite
    // never connects to; unmocked they buffer and reject ten seconds later.
    deviceLogModel.aggregate = jest.fn().mockResolvedValue([]) as any;
    imageModel.aggregate = jest.fn().mockResolvedValue([]) as any;

    zeltModel.createIndexes = jest.fn().mockResolvedValue(undefined) as any;
    zeltModel.exists = jest
      .fn()
      .mockImplementation((filter: any) =>
        created.some(zelt => zelt.besitzer_id === filter.besitzer_id && zelt.geraete.some(b => b.geraet_id === filter['geraete.geraet_id']))
          ? { _id: 'x' }
          : null,
      ) as any;
    zeltModel.create = jest.fn().mockImplementation((zelt: Zelt) => {
      created.push(zelt);
      return Promise.resolve(zelt);
    }) as any;

    jest.spyOn(dataService, 'getFirstSampleTimes').mockResolvedValue(new Map(DEVICES.map(device => [device.device_id, FIRST_SAMPLE])));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('gives every claimed device a tent containing exactly itself', async () => {
    expect(await zeltService.backfillZelte()).toEqual(2);
    expect(created.map(zelt => zelt.geraete.map(b => b.geraet_id))).toEqual([['controller-1'], ['fridge-1']]);
    expect(created.map(zelt => zelt.besitzer_id)).toEqual([OWNER_ID, 'user-2']);
  });

  it('names the tent after the device and dates it from the first measurement', async () => {
    await zeltService.backfillZelte();
    expect(created[0].name).toEqual('Zelt Keller');
    expect(created[0].geraete[0].seit).toEqual(FIRST_SAMPLE);
    expect(created[0].tag_null).toEqual(FIRST_SAMPLE);
    expect(created[0].geraete[0].bis).toBeUndefined();
  });

  it('leaves the name empty when the device has none, because the app owns the wording', async () => {
    await zeltService.backfillZelte();
    expect(created[1].name).toEqual('');
  });

  it('starts a tent today only when the device left no trace anywhere', async () => {
    jest.spyOn(dataService, 'getFirstSampleTimes').mockResolvedValue(new Map());
    const before = Date.now();
    await zeltService.backfillZelte();
    expect(created[0].tag_null).toBeGreaterThanOrEqual(before);
    expect(created[0].tag_null).toEqual(created[0].geraete[0].seit);
  });

  it('dates a tent from a photograph when that is the only trace the device left', async () => {
    // Never online, offline past the retention window, or a diary-and-photos
    // owner: no sample, and a whole past that `seit` would otherwise hide.
    jest.spyOn(dataService, 'getFirstSampleTimes').mockResolvedValue(new Map());
    imageModel.aggregate = jest.fn().mockResolvedValue([{ _id: 'controller-1', t: ERSTES_FOTO }]) as any;

    await zeltService.backfillZelte();

    expect(created[0].geraete[0].seit).toEqual(ERSTES_FOTO);
    expect(created[0].tag_null).toEqual(ERSTES_FOTO);
  });

  it('dates a tent from a log line when that is older than the first sample', async () => {
    deviceLogModel.aggregate = jest.fn().mockResolvedValue([{ _id: 'controller-1', t: new Date(ERSTES_FOTO) }]) as any;

    await zeltService.backfillZelte();

    expect(created[0].geraete[0].seit).toEqual(ERSTES_FOTO);
  });

  it('keeps the first sample when it is older than every stored row', async () => {
    imageModel.aggregate = jest.fn().mockResolvedValue([{ _id: 'controller-1', t: FIRST_SAMPLE + 86400000 }]) as any;

    await zeltService.backfillZelte();

    expect(created[0].geraete[0].seit).toEqual(FIRST_SAMPLE);
  });

  it('writes nothing at all when the stored rows cannot be read', async () => {
    imageModel.aggregate = jest.fn().mockRejectedValue(new Error('mongo down')) as any;
    expect(await zeltService.backfillZelte()).toEqual(0);
    expect(zeltModel.create).not.toHaveBeenCalled();
  });

  it('writes nothing at all when the measurement store cannot answer', async () => {
    jest.spyOn(dataService, 'getFirstSampleTimes').mockRejectedValue(new Error('influx down'));
    expect(await zeltService.backfillZelte()).toEqual(0);
    // Guessing today for every device would be permanent: the next boot retries instead.
    expect(zeltModel.create).not.toHaveBeenCalled();
  });

  it('gives the tent a time zone, because every day boundary is computed in it', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';
    try {
      await zeltService.backfillZelte();
      expect(created[0].zeitzone).toEqual('Europe/Berlin');
    } finally {
      process.env.TZ = tz;
    }
  });

  it('creates nothing on a second run', async () => {
    await zeltService.backfillZelte();
    expect(await zeltService.backfillZelte()).toEqual(0);
    expect(created.length).toEqual(2);
  });

  it('counts a tent another instance wrote first as not created, and carries on', async () => {
    zeltModel.create = jest.fn().mockRejectedValue({ code: 11000 }) as any;
    expect(await zeltService.backfillZelte()).toEqual(0);
    expect(zeltModel.create).toHaveBeenCalledTimes(2);
  });

  it('looks at claimed devices only', async () => {
    await zeltService.backfillZelte();
    expect(deviceFilter).toEqual({ owner_id: { $nin: [null, ''] } });
  });

  it('writes nothing while another instance holds the lock', async () => {
    migrationModel.findOneAndUpdate = jest.fn().mockRejectedValue({ code: 11000 }) as any;
    expect(await zeltService.backfillZelte()).toEqual(0);
    expect(zeltModel.create).not.toHaveBeenCalled();
  });

  it('releases the lock it holds when the backfill fails', async () => {
    zeltModel.create = jest.fn().mockRejectedValue(new Error('mongo down')) as any;
    await zeltService.backfillZelte();
    expect(migrationModel.updateOne).toHaveBeenCalledWith({ name: 'zelt-aus-geraet', run_id: expect.any(String) }, { $set: { laeuft_seit: null } });
  });
});
