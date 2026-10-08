import { writeFile } from 'node:fs/promises';
import { jest } from '@jest/globals';
import sharp from 'sharp';
import { ImageStore } from '@database/image-store';
import { CameraDocument } from '@database/schemas/v1/cameras.schema';
import { MediaDocument } from '@database/schemas/v1/media.schema';
import { EntitlementService } from '@modules/v1/camera/entitlement.service';
import { MediaService } from '@modules/v1/camera/media.service';
import { TimelapseService } from '@modules/v1/camera/timelapse.service';
import { useV1TestDatabase } from './support/v1-database';

/**
 * The rolling day film as Premium shapes it: HD for an entitled camera, and a
 * camera whose year has run out at the resolution it always had, with the mark.
 *
 * The builder is driven directly, as its hourly pass drives it, with ffmpeg left
 * out: what ffmpeg is told and what is stored is what is held here.
 */

const MINUTE = 60 * 1000;
const NOON = new Date('2026-08-01T12:00:00.000Z');
const DAY_FILM = { window: 'day' as const, frameIntervalMs: 2 * MINUTE, refreshMs: 60 * MINUTE };

const PREMIUM = {
  enforced: true,
  freeStillWidth: 0,
  freeRetention: false,
  freeStillDays: 0,
  freeTimelapseDays: 0,
  extendUrl: '',
  priceLabel: '',
};

interface Builder {
  buildRolling(camera: CameraDocument, rolling: typeof DAY_FILM, zone: string | null): Promise<void>;
  writeFilm(directory: string, film: string, options: { quality: string; watermark: string | null }): Promise<void>;
}

const db = useV1TestDatabase();
let media: MediaService;
let builder: Builder;
let told: { quality: string; watermark: string | null } | null;

const camera = (validUntil: Date | null) => ({ id: 'a-camera', entitlement: { validUntil, grant: 'included' } }) as CameraDocument;

/** A morning of stills two minutes apart, as many as the day film is built from. */
const aMorningOfStills = async (): Promise<void> => {
  const picture = await sharp({ create: { width: 64, height: 36, channels: 3, background: '#3a5' } })
    .jpeg()
    .toBuffer();

  for (let index = 1; index <= 20; index++) {
    await media.storeBytes(
      { kind: 'still', mime: 'image/jpeg', cameraId: 'a-camera', capturedAt: new Date(NOON.getTime() - index * 2 * MINUTE) },
      picture,
    );
  }
};

const film = () => db.media.findOne({ kind: 'timelapse' }).lean<MediaDocument>();

beforeEach(async () => {
  // Only the clock is held: the morning has to lie inside the open day, and the database's own timers keep running.
  jest.useFakeTimers({
    now: NOON,
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
  await db.reset();

  media = new MediaService(db.media, db.grows, new ImageStore(db.connection));
  builder = new TimelapseService(undefined as never, media, new EntitlementService(PREMIUM), undefined as never) as unknown as Builder;
  told = null;
  builder.writeFilm = async (_directory, path, options) => {
    told = options;
    await writeFile(path, 'a film');
  };
});

afterEach(() => jest.useRealTimers());

it('renders an entitled camera´s day in HD and unmarked', async () => {
  await aMorningOfStills();

  await builder.buildRolling(camera(new Date(NOON.getTime() + 30 * 24 * 60 * MINUTE)), DAY_FILM, null);

  expect(told).toMatchObject({ quality: 'hd', watermark: null });
  expect(await film()).toMatchObject({ window: 'day', quality: 'hd' });
});

it('renders a free camera´s day at the lesser resolution, with the mark', async () => {
  await aMorningOfStills();

  await builder.buildRolling(camera(new Date(NOON.getTime() - 24 * 60 * MINUTE)), DAY_FILM, null);

  expect(told).toMatchObject({ quality: 'sd', watermark: expect.any(String) });
  expect(await film()).toMatchObject({ window: 'day', quality: 'sd' });
});
