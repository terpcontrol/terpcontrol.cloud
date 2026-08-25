import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import deviceLogModel from '@models/devicelog.model';
import imageModel from '@models/images.model';
import migrationModel from '@models/migration.model';
import { indexPlan, istLeer, migriereIndexe } from '@/migrations/indexe';
import { aeltesteSpuren, fruehesteZeit } from '@utils/spur';

// `baueIndexe` skips index creation under NODE_ENV=test and nothing builds the
// Image indexes at import any more, which is the point of D3 - so everything
// here that needs a real index builds it the way a deployment does.
let mongo: MongoMemoryServer;

const T = 1750809600000;
const ALT_UNIQUE = 'device_id_1_format_1_timestamp_-1_duration_1';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  // Dropping the collection is how a test gets its indexes back to nothing.
  await imageModel.collection.drop().catch(() => undefined);
  await Promise.all([deviceLogModel.deleteMany({}), migrationModel.deleteMany({})]);
});

const bild = (image_id: string, verortung: { device_id?: string; zelt_id?: string }, rest: Record<string, unknown> = {}) =>
  imageModel.create({ image_id: image_id, timestamp: T, data: Buffer.from('x'), format: 'user/jpeg', ...verortung, ...rest });

const indexNamen = async (): Promise<string[]> => (await imageModel.collection.indexes()).map((index: any) => index.name).sort();

const indexNach = async (name: string): Promise<any> => (await imageModel.collection.indexes()).find((index: any) => index.name === name);

/** The state a deployment is in before the migration runs. */
const alterIndex = () => imageModel.collection.createIndex({ device_id: 1, format: 1, timestamp: -1, duration: 1 }, { unique: true });

describe('The Image index migration', () => {
  it('reports the degenerate unique index before it drops it', async () => {
    await alterIndex();

    const zeilen: string[] = [];
    const { plan, angewendet } = await migriereIndexe(undefined, zeile => zeilen.push(zeile));

    expect(plan[0].entfernen).toContain(ALT_UNIQUE);
    expect(angewendet).toBe(true);
    expect(zeilen.some(zeile => zeile.includes(`drop  ${ALT_UNIQUE}`))).toBe(true);
    expect(zeilen.some(zeile => zeile.includes('"format":"mp4"'))).toBe(true);
    expect(zeilen.some(zeile => zeile.includes('{"zelt_id":1,"timestamp":-1}'))).toBe(true);
  });

  it('narrows the unique index to timelapses and gives the tent key one of its own', async () => {
    await alterIndex();
    await migriereIndexe(undefined, () => undefined);

    expect(await indexNamen()).toEqual(['_id_', 'device_id_1_format_1_timestamp_-1', ALT_UNIQUE, 'image_id_1', 'zelt_id_1_timestamp_-1'].sort());
    const eindeutig = await indexNach(ALT_UNIQUE);
    expect(eindeutig.unique).toBe(true);
    expect(eindeutig.partialFilterExpression).toEqual({ format: 'mp4' });
    // Rows keyed by device were an index scan before the narrowing and have to
    // stay one: the partial index above cannot answer for a jpeg.
    expect(await indexNach('device_id_1_format_1_timestamp_-1')).toBeDefined();
    expect((await indexNach('zelt_id_1_timestamp_-1')).unique).toBeUndefined();
  });

  it('changes nothing on a second run, and says so', async () => {
    await alterIndex();
    await migriereIndexe(undefined, () => undefined);
    const nachher = await indexNamen();

    const zeilen: string[] = [];
    const zweiter = await migriereIndexe(undefined, zeile => zeilen.push(zeile));

    expect(istLeer(zweiter.plan)).toBe(true);
    expect(zweiter.angewendet).toBe(false);
    expect(zeilen).toEqual(['Indexes already match what the models declare - nothing to do.']);
    expect(await indexNamen()).toEqual(nachher);
  });

  it('touches nothing in a dry run', async () => {
    await alterIndex();
    const vorher = await indexNamen();

    const { plan, angewendet } = await migriereIndexe(undefined, () => undefined, true);

    expect(istLeer(plan)).toBe(false);
    expect(angewendet).toBe(false);
    expect(await indexNamen()).toEqual(vorher);
  });

  it('plans the full set on a database that has never had the collection', async () => {
    const plan = await indexPlan();
    expect(plan[0].entfernen).toEqual([]);
    expect(plan[0].anlegen.map(([schluessel]) => schluessel)).toEqual([
      { image_id: 1 },
      { zelt_id: 1, timestamp: -1 },
      { device_id: 1, format: 1, timestamp: -1 },
      { device_id: 1, format: 1, timestamp: -1, duration: 1 },
    ]);
  });
});

describe('What the Image indexes allow and refuse', () => {
  it('let two tents photograph the same millisecond, which the old index did not', async () => {
    await alterIndex();
    await bild('bild-a', { zelt_id: 'zelt-A' });
    await expect(bild('bild-b', { zelt_id: 'zelt-B' })).rejects.toMatchObject({ code: 11000 });

    await migriereIndexe(undefined, () => undefined);

    await expect(bild('bild-b', { zelt_id: 'zelt-B' })).resolves.toBeDefined();
    expect(await imageModel.countDocuments({ format: 'user/jpeg' })).toBe(2);
  });

  it('lets one device store two stills from the same millisecond', async () => {
    await migriereIndexe(undefined, () => undefined);

    await bild('bild-a', { device_id: 'controller-1' }, { format: 'jpeg' });
    await expect(bild('bild-b', { device_id: 'controller-1' }, { format: 'jpeg' })).resolves.toBeDefined();
  });

  it('still keeps one timelapse per device, format, start and window', async () => {
    await migriereIndexe(undefined, () => undefined);
    const film = (image_id: string) => bild(image_id, { device_id: 'controller-1' }, { format: 'mp4', duration: '1d' });

    await film('film-a');
    await expect(film('film-b')).rejects.toMatchObject({ code: 11000 });
  });

  it('refuses a row that belongs nowhere, because no read would ever find it again', async () => {
    await expect(imageModel.create({ image_id: 'waise', timestamp: T, data: Buffer.from('x'), format: 'user/jpeg' })).rejects.toThrow(
      /exactly one of device_id and zelt_id/,
    );
    expect(await imageModel.countDocuments({})).toBe(0);
  });

  it('refuses a row that claims to belong in two places', async () => {
    await expect(bild('beides', { device_id: 'controller-1', zelt_id: 'zelt-A' })).rejects.toThrow(/exactly one of device_id and zelt_id/);
  });

  it('treats an empty string as no key at all', async () => {
    await expect(bild('leer', { device_id: '', zelt_id: '' })).rejects.toThrow(/exactly one of device_id and zelt_id/);
  });
});

describe('The oldest trace a device left', () => {
  const log = (device_id: string, t: number) => deviceLogModel.create({ device_id: device_id, time: new Date(t), message: 'x' });

  it('finds the oldest photograph of a device that never reported a measurement', async () => {
    await bild('bild-a', { device_id: 'controller-1' }, { timestamp: T });
    await bild('bild-b', { device_id: 'controller-1' }, { timestamp: T - 86400000 });

    expect((await aeltesteSpuren(['controller-1'])).get('controller-1')).toEqual(T - 86400000);
  });

  it('takes the older of a log line and a photograph', async () => {
    await log('controller-1', T - 7 * 86400000);
    await bild('bild-a', { device_id: 'controller-1' }, { timestamp: T });

    expect((await aeltesteSpuren(['controller-1'])).get('controller-1')).toEqual(T - 7 * 86400000);
  });

  it('answers for the whole fleet at once and keeps devices apart', async () => {
    await log('controller-1', T);
    await log('controller-2', T - 86400000);

    const spuren = await aeltesteSpuren(['controller-1', 'controller-2', 'controller-3']);
    expect(spuren.get('controller-1')).toEqual(T);
    expect(spuren.get('controller-2')).toEqual(T - 86400000);
    // No trace, no date: only that device falls back to today.
    expect(spuren.get('controller-3')).toBeUndefined();
  });

  it("leaves another owner's device out of the answer", async () => {
    await log('controller-1', T);
    expect(await aeltesteSpuren(['controller-2'])).toEqual(new Map());
    expect(await aeltesteSpuren([])).toEqual(new Map());
  });

  it('ignores a photograph that belongs to a tent rather than a device', async () => {
    await bild('bild-a', { zelt_id: 'zelt-A' }, { timestamp: T - 86400000 });
    expect(await aeltesteSpuren(['controller-1'])).toEqual(new Map());
  });

  it('takes the earliest of what it is given, and nothing when it is given nothing', () => {
    expect(fruehesteZeit(undefined, T, T - 1)).toEqual(T - 1);
    expect(fruehesteZeit(undefined, undefined)).toBeUndefined();
    expect(fruehesteZeit(NaN, T)).toEqual(T);
  });
});
