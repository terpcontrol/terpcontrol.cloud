import { jest } from '@jest/globals';
import { ImageStore } from '@database/image-store';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { CamerasService } from '@modules/v1/camera/cameras.service';
import { EntitlementService } from '@modules/v1/camera/entitlement.service';
import { MediaService } from '@modules/v1/camera/media.service';
import { StillDeletionService } from '@modules/v1/camera/still-deletion.service';
import { TimelapseService } from '@modules/v1/camera/timelapse.service';
import { useV1TestDatabase } from './support/v1-database';

/**
 * Deleting a camera's stills: they go with their bytes, a still a diary holds on
 * to stays, and every film holding one that goes is deleted and queued anew from
 * what is left - including a film another camera shows this one beside in.
 */

const MINUTE = 60 * 1000;
const DAY = new Date('2026-08-01T00:00:00.000Z');
const at = (minutes: number) => new Date(DAY.getTime() + minutes * MINUTE);

const PREMIUM = {
  enforced: false,
  freeStillWidth: 0,
  freeRetention: false,
  freeStillDays: 0,
  freeTimelapseDays: 0,
  extendUrl: '',
  priceLabel: '',
};

const db = useV1TestDatabase();
let media: MediaService;
let store: ImageStore;
let deletion: StillDeletionService;
let queuedRenders: number;

const camera = (id: string) =>
  ({ id, ownerId: 'an-owner', removedAt: null, entitlement: { validUntil: null, grant: 'included' } }) as unknown as CameraDocument;

/** Stills every two minutes from 10:00, `count` of them. */
const stills = async (cameraId: string, count: number): Promise<MediaDocument[]> => {
  const rows: MediaDocument[] = [];
  for (let index = 0; index < count; index++) {
    rows.push(
      await media.storeBytes({ kind: 'still', mime: 'image/jpeg', cameraId, capturedAt: at(600 + index * 2) }, Buffer.from(`still ${index}`)),
    );
  }
  return rows;
};

const dayFilm = (cameraId: string, endsAt: Date, render: MediaDocument['render'] = null) =>
  media.storeBytes(
    { kind: 'timelapse', mime: 'video/mp4', cameraId, capturedAt: DAY, endsAt, window: 'day', quality: 'sd', render },
    Buffer.from('a film'),
  );

const films = () => db.media.find({ kind: 'timelapse' }).lean<MediaDocument[]>();

beforeEach(async () => {
  await db.reset();

  store = new ImageStore(db.connection);
  media = new MediaService(db.media, db.grows, store, db.entries);
  const cameras = { byId: async (id: string) => camera(id), zoneOf: async () => null } as unknown as CamerasService;
  const builder = new TimelapseService(cameras, media, new EntitlementService(PREMIUM), undefined as never);
  queuedRenders = 0;
  builder.renderQueued = () => void queuedRenders++;
  deletion = new StillDeletionService(media, builder, cameras);
});

it('deletes the stills of a span with their bytes, and keeps the ones a diary line or a grow´s cover holds', async () => {
  const taken = await stills('a-camera', 10);
  await db.entries.collection.insertOne({ id: 'a-line', mediaIds: [taken[3].id] });
  await db.grows.collection.insertOne({ id: 'a-grow', coverMediaId: taken[4].id });

  const done = await deletion.delete(camera('a-camera'), { startsAt: at(602).toISOString(), endsAt: at(610).toISOString() });

  expect(done).toMatchObject({ stills: 3, kept: [taken[3].id, taken[4].id], films: [] });
  expect(done.hours).toEqual([{ startsAt: '2026-08-01T10:00:00.000Z', stills: 5, newestId: taken[5].id }]);
  const left = (await db.media.find({ kind: 'still' }).lean<MediaDocument[]>()).map(row => row.id);
  expect(left).toEqual([0, 3, 4, 6, 7, 8, 9].map(index => taken[index].id));
  await expect(store.download(taken[1].id)).rejects.toThrow();
});

it('deletes the stills picked one by one, and leaves those of the span named in `except`', async () => {
  const taken = await stills('a-camera', 5);

  expect((await deletion.delete(camera('a-camera'), { ids: [taken[0].id] })).stills).toBe(1);
  expect(
    (await deletion.delete(camera('a-camera'), { startsAt: at(600).toISOString(), endsAt: at(700).toISOString(), except: [taken[2].id] })).stills,
  ).toBe(3);
  expect((await db.media.find({ kind: 'still' }).lean<MediaDocument[]>()).map(row => row.id)).toEqual([taken[2].id]);
});

it('touches no still of another camera, even one it is asked for by id', async () => {
  const theirs = await stills('another-camera', 2);

  expect((await deletion.delete(camera('a-camera'), { ids: [theirs[0].id] })).stills).toBe(0);
  expect(await db.media.countDocuments({ kind: 'still' })).toBe(2);
});

it('refuses a selection that is both picked and a span, or a span with one end', async () => {
  await expect(deletion.delete(camera('a-camera'), { ids: ['x'], startsAt: at(0).toISOString() })).rejects.toMatchObject({
    problem: { code: 'selection_unclear' },
  });
  await expect(deletion.delete(camera('a-camera'), { startsAt: at(0).toISOString() })).rejects.toMatchObject({
    problem: { code: 'selection_unclear' },
  });
});

it('deletes the film holding a deleted still and queues it anew as the builder made it, leaving a film that does not hold it', async () => {
  const taken = await stills('a-camera', 20);
  const holding = await dayFilm('a-camera', taken[19].capturedAt);
  const before = await media.storeBytes(
    { kind: 'timelapse', mime: 'video/mp4', cameraId: 'a-camera', capturedAt: at(-24 * 60), endsAt: at(-60), window: 'day', quality: 'sd' },
    Buffer.from('yesterday'),
  );

  const done = await deletion.delete(camera('a-camera'), { ids: [taken[5].id] });

  expect(done.films).toEqual([expect.objectContaining({ id: holding.id, window: 'day', remade: true })]);
  const now = await films();
  expect(now.map(film => film.id)).toEqual(expect.arrayContaining([before.id]));
  expect(now.find(film => film.id === holding.id)).toBeUndefined();
  expect(now.find(film => film.id !== before.id)).toMatchObject({
    window: 'day',
    capturedAt: DAY,
    endsAt: at(24 * 60),
    quality: 'sd',
    render: { status: 'queued', includeLightsOff: true, secondCameraId: null },
  });
  await expect(store.download(holding.id)).rejects.toThrow();
  expect(queuedRenders).toBe(1);
});

it('makes a film no more where too few stills are left for one, and says so', async () => {
  const taken = await stills('a-camera', 14);
  await dayFilm('a-camera', taken[13].capturedAt);

  const done = await deletion.delete(camera('a-camera'), { ids: [taken[0].id, taken[1].id] });

  expect(done.films).toEqual([expect.objectContaining({ remade: false })]);
  expect(await films()).toEqual([]);
});

it('makes again the film another camera shows this one beside in, with what it was asked for', async () => {
  const taken = await stills('a-camera', 2);
  await stills('another-camera', 20);
  const render = {
    status: 'ready' as const,
    framesPerSecond: 25,
    watermark: false,
    aspect: '16_9' as const,
    overlays: { dayCounter: true, climate: false, entries: false },
    includeLightsOff: false,
    secondCameraId: 'a-camera',
    startedAt: at(700),
    endedAt: at(701),
    error: null,
  };
  const split = await media.storeBytes(
    {
      kind: 'timelapse',
      mime: 'video/mp4',
      cameraId: 'another-camera',
      capturedAt: at(0),
      endsAt: at(1000),
      window: 'custom',
      quality: 'hd',
      render,
    },
    Buffer.from('two cameras'),
  );

  const done = await deletion.delete(camera('a-camera'), { ids: [taken[0].id] });

  expect(done.films).toEqual([expect.objectContaining({ id: split.id, cameraId: 'another-camera', remade: true })]);
  expect(await films()).toEqual([
    expect.objectContaining({
      cameraId: 'another-camera',
      window: 'custom',
      quality: 'hd',
      endsAt: at(1000),
      render: expect.objectContaining({ status: 'queued', secondCameraId: 'a-camera', overlays: render.overlays, startedAt: null }),
    }),
  ]);
});

it('leaves a film that is still queued: it is made from what is left anyway', async () => {
  const taken = await stills('a-camera', 20);
  const queued = await media.queue({
    kind: 'timelapse',
    mime: 'video/mp4',
    cameraId: 'a-camera',
    capturedAt: DAY,
    endsAt: at(24 * 60),
    window: 'day',
    quality: 'sd',
    render: {
      status: 'queued',
      framesPerSecond: 25,
      watermark: false,
      aspect: '16_9',
      overlays: { dayCounter: false, climate: false, entries: false },
      includeLightsOff: false,
      secondCameraId: null,
      startedAt: null,
      endedAt: null,
      error: null,
    },
  });

  expect((await deletion.delete(camera('a-camera'), { ids: [taken[0].id] })).films).toEqual([]);
  expect((await films()).map(film => film.id)).toEqual([queued.id]);
});

it('says beforehand what would go and which films would be made again, and deletes nothing', async () => {
  const taken = await stills('a-camera', 14);
  await dayFilm('a-camera', taken[13].capturedAt);

  const one = await deletion.preview(camera('a-camera'), { ids: [taken[0].id] });
  const two = await deletion.preview(camera('a-camera'), { ids: [taken[0].id, taken[1].id] });

  expect(one).toMatchObject({ stills: 1, films: [expect.objectContaining({ remade: true })] });
  expect(two).toMatchObject({ stills: 2, films: [expect.objectContaining({ remade: false })] });
  expect(await db.media.countDocuments()).toBe(15);
});

it('drops the bytes of a film rendered onto a row that was deleted meanwhile', async () => {
  const gone = await media.queue({ kind: 'timelapse', mime: 'video/mp4', cameraId: 'a-camera', capturedAt: DAY, window: 'day' });
  await db.media.deleteOne({ id: gone.id });
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const path = join(await mkdtemp(join(tmpdir(), 'fill-')), 'film.mp4');
  await writeFile(path, 'a film of deleted stills');

  expect(await media.fill(gone.id, path, {})).toBe(false);
  await expect(store.download(gone.id)).rejects.toThrow();
});

it('does not store a rolling film encoded while stills were deleted, and encodes the period again', async () => {
  await stills('a-camera', 20);
  const cameras = { byId: async (id: string) => camera(id), zoneOf: async () => null } as unknown as CamerasService;
  const builder = new TimelapseService(cameras, media, new EntitlementService(PREMIUM), undefined as never) as unknown as {
    buildRolling(camera: CameraDocument, rolling: object, zone: string | null): Promise<void>;
    writeFilm(directory: string, film: string): Promise<void>;
    stillsErased(cameraId: string): void;
  };
  let encoded = 0;
  builder.writeFilm = async (_directory, path) => {
    // The first film's frames were read before a deletion that lands while it is encoded.
    if (++encoded === 1) builder.stillsErased('a-camera');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, `film ${encoded}`);
  };

  // Only the clock is held: the stills have to lie inside the open day, and the database's own timers keep running.
  jest.useFakeTimers({
    now: at(700),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  try {
    await builder.buildRolling(camera('a-camera'), { window: 'day', frameIntervalMs: 2 * MINUTE, refreshMs: 60 * MINUTE }, null);
  } finally {
    jest.useRealTimers();
  }

  expect(encoded).toBe(2);
  const stored = await films();
  expect(stored).toHaveLength(1);
  expect((await store.download(stored[0].id)).toString()).toBe('film 2');
});
