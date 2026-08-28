import { Ding, Zelt } from '@fg2/shared-types';
import deviceModel from '@models/device.model';
import dingModel from '@models/ding.model';
import migrationModel from '@models/migration.model';
import zeltModel from '@models/zelt.model';
import { dataService } from '@services/data.service';
import { zeltService } from '@services/zelt.service';

const OWNER_ID = 'user-1';
const FIRST_SAMPLE = 1750809600000;
const CLAIM = 1735689600000;

let DEVICES: any[];

describe('Zelt backfill on boot', () => {
  let created: Zelt[];
  let dinge: Ding[];
  let deviceFilter: any;

  beforeEach(() => {
    created = [];
    dinge = [];
    DEVICES = [
      { device_id: 'controller-1', owner_id: OWNER_ID, name: 'Zelt Keller' },
      { device_id: 'fridge-1', owner_id: 'user-2', name: '' },
    ];

    migrationModel.createIndexes = jest.fn().mockResolvedValue(undefined) as any;
    migrationModel.findOneAndUpdate = jest.fn().mockResolvedValue(null) as any;
    migrationModel.updateOne = jest.fn().mockResolvedValue({}) as any;

    deviceModel.find = jest.fn().mockImplementation(filter => {
      deviceFilter = filter;
      return { lean: () => Promise.resolve(DEVICES) };
    }) as any;

    // Every tent gets its first run (§3.2). Mongo is never connected in this
    // suite; unmocked the write would buffer and reject ten seconds later.
    dingModel.create = jest.fn().mockImplementation((ding: Ding) => {
      dinge.push(ding);
      return Promise.resolve(ding);
    }) as any;

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

  it('starts a tent today only when the device never measured anything', async () => {
    jest.spyOn(dataService, 'getFirstSampleTimes').mockResolvedValue(new Map());
    const before = Date.now();
    await zeltService.backfillZelte();
    expect(created[0].tag_null).toBeGreaterThanOrEqual(before);
    expect(created[0].tag_null).toEqual(created[0].geraete[0].seit);
  });

  it('dates a tent from the claim when one was recorded, whatever the device measured', async () => {
    DEVICES[0].claimed_at = CLAIM;

    await zeltService.backfillZelte();

    // §3.1 asks for the claim first: a sample older than it belongs to whoever
    // owned the device then.
    expect(created[0].geraete[0].seit).toEqual(CLAIM);
    expect(created[0].tag_null).toEqual(CLAIM);
  });

  it('mints the first run with the tent, at tag_null', async () => {
    await zeltService.backfillZelte();

    const laeufe = dinge.filter(ding => ding.art === 'lauf');
    expect(laeufe.length).toEqual(2);
    expect(laeufe[0].zelt_id).toEqual(created[0].zelt_id);
    expect(laeufe[0].t).toEqual(created[0].tag_null);
    expect(laeufe[0].t_ende).toBeNull();
    expect(laeufe[0].d).toEqual({ nummer: 1 });
  });

  it('keeps the tent when its first run cannot be written', async () => {
    // A tent without a run counts its days from `tag_null`; a device without a
    // tent is invisible. Only one of the two may be lost here.
    dingModel.create = jest.fn().mockRejectedValue(new Error('mongo down')) as any;

    expect(await zeltService.backfillZelte()).toEqual(2);
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
