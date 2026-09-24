import { ImageStore } from '@database/image-store';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { MediaService } from '@modules/v1/camera/media.service';
import { TimelapseService } from '@modules/v1/camera/timelapse.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * What the thinning tiers do to history the previous release kept.
 *
 * The tiers are new: before them every still this server ever took was kept, so
 * the first pass after an upgrade meets years of pictures at thirty-second
 * spacing and thins all of it at once - and the bytes it frees are the only
 * copy, because the first migration moved them out of the picture's document.
 * While `legacy_images` is standing the way back is open, and history is not a
 * sweep's to decide about.
 *
 * The builder is driven directly: a thinning pass reaches nothing but the media
 * service, and there is no route that asks for one.
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const CAMERA = { id: 'a-camera' } as CameraDocument;

let db: V1TestDatabase;
let media: MediaService;
let timelapse: TimelapseService;

const thin = () => (timelapse as unknown as { thin(camera: CameraDocument): Promise<void> }).thin(CAMERA);

/** Stills every two minutes over a day, ten days ago: well inside the tier that keeps one every five minutes. */
const aDayOfStills = async (prefix: string): Promise<string[]> => {
  const start = Date.now() - 10 * DAY;
  const ids = [...Array(30).keys()].map(index => `${prefix}-${index}`);

  await db.media.create(
    ids.map((id, index) => ({
      id,
      createdAt: new Date(start + index * 2 * MINUTE),
      kind: 'still',
      mime: 'image/jpeg',
      bytes: 1,
      capturedAt: new Date(start + index * 2 * MINUTE),
      cameraId: CAMERA.id,
    })),
  );

  return ids;
};

const remaining = async (prefix: string): Promise<number> => db.media.countDocuments({ cameraId: CAMERA.id, id: { $regex: `^${prefix}-` } });

beforeAll(async () => {
  db = await startV1TestDatabase();
  media = new MediaService(db.media, db.grows, new ImageStore(db.connection));
  timelapse = new TimelapseService(undefined as never, media, undefined as never, undefined as never);
});

afterAll(async () => {
  await db?.stop();
});

beforeEach(() => db.reset());

describe('thinning stills as they age', () => {
  it('thins what this release has taken', async () => {
    await aDayOfStills('own');

    await thin();

    // One every five minutes past the first week, out of one every two.
    expect(await remaining('own')).toBeLessThan(15);
  });

  it('leaves what the migration carried over while the previous release still holds a row for it', async () => {
    const carried = await aDayOfStills('carried');
    await db.connection.db!.collection('legacy_images').insertMany(carried.map(id => ({ image_id: id, format: 'jpeg' })));

    await thin();

    expect(await remaining('carried')).toBe(carried.length);
  });

  it('thins them like anything else once the way back has been dropped', async () => {
    const carried = await aDayOfStills('carried');
    await db.connection.db!.collection('legacy_images').insertMany(carried.map(id => ({ image_id: id, format: 'jpeg' })));
    await db.connection.db!.collection('legacy_images').drop();

    await thin();

    expect(await remaining('carried')).toBeLessThan(carried.length);
  });
});
