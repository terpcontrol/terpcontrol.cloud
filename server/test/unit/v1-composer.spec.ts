import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FastifyReply } from 'fastify';
import sharp from 'sharp';
import { TimelapseCreate } from '@fg2/shared-types/v1';
import { AccessContext } from '@common/v1/access.types';
import { AccessService } from '@common/v1/access.service';
import { CamerasController } from '@modules/v1/camera/cameras.controller';
import { CamerasService } from '@modules/v1/camera/cameras.service';
import { EntitlementService } from '@modules/v1/camera/entitlement.service';
import { MediaService } from '@modules/v1/camera/media.service';
import { OverlayFrame, composeFrame, overlayLayer, sizeFor, wasDark } from '@modules/v1/camera/timelapse-overlays';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The composer: what is asked of a render, and what is refused.
 *
 * A render does not finish inside a request, so the route's whole job is to
 * decide - the span, the second camera, what is drawn, what it may cost - and
 * hand back a row to poll. That decision is what is held here; what ffmpeg then
 * does with the frames is the builder's.
 */

const OWNER = 'user-owner';
const TENT = 'space-tent';
const BALCONY = 'space-balcony';
const CAMERA = 'camera-1';
const BESIDE = 'camera-2';
const ELSEWHERE = 'camera-3';

const session: AccessContext = { userId: OWNER, isAdmin: false, isDemo: false, shareToken: null };

const PREMIUM = {
  enforced: true,
  freeStillWidth: 640,
  freeRetention: false,
  freeStillDays: 0,
  freeTimelapseDays: 0,
  extendUrl: 'https://example.invalid/premium',
  priceLabel: '',
};

const PHASE = { window: 'phase' as const, startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-08-20T00:00:00.000Z' };

let db: V1TestDatabase;
let controller: CamerasController;
let media: MediaService;
let status: number;

/** The reply only ever has its status set; the body is what the route answers. */
const reply = (): FastifyReply =>
  ({
    status: (code: number) => {
      status = code;
      return reply();
    },
  }) as unknown as FastifyReply;

/** A picture of the size a camera delivers, so a composed frame has something to place. */
const picture = (colour: string): Promise<Buffer> =>
  sharp({ create: { width: 1280, height: 720, channels: 3, background: colour } })
    .jpeg()
    .toBuffer();

const compose = (body: TimelapseCreate, cameraId = CAMERA) => controller.requestTimelapse(session, cameraId, body, reply());

const build = (rendezvous: string[] = []): void => {
  const entitlement = new EntitlementService(PREMIUM);
  const cameras = new CamerasService(db.cameras, db.devices, db.memberships, entitlement);
  media = new MediaService(db.media, null as never);
  const access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  const poller = { settingsChanged: () => undefined, forget: () => undefined };
  // The builder is asked to take the queue now rather than on its hourly pass;
  // what it then renders is the builder's own test.
  const builder = { renderQueued: () => undefined };

  controller = new CamerasController(cameras, media, null as never, poller as never, builder as never, entitlement, access, {
    rendezvousHosts: rendezvous,
    advertiseAddress: '',
    portsStart: 0,
    portsEnd: 0,
  });
};

const world = async (entitledUntil: Date | null): Promise<void> => {
  await db.spaces.create([
    { id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent 1', roomId: null },
    { id: BALCONY, ownerId: OWNER, kind: 'balcony', name: 'Balcony', roomId: null },
  ]);

  await db.cameras.create([
    { id: CAMERA, ownerId: OWNER, kind: 'rtsp', spaceId: TENT, name: 'Cam 1', entitlement: { validUntil: entitledUntil, grant: 'purchase' } },
    { id: BESIDE, ownerId: OWNER, kind: 'rtsp', spaceId: TENT, name: 'Cam 2', entitlement: { validUntil: null, grant: null } },
    { id: ELSEWHERE, ownerId: OWNER, kind: 'rtsp', spaceId: BALCONY, name: 'Cam 3', entitlement: { validUntil: null, grant: null } },
  ]);
};

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  status = 0;
});

describe('what a film costs', () => {
  const inAYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  it('refuses HD to a camera without entitlement rather than quietly rendering it smaller', async () => {
    build();
    await world(null);

    // Somebody handed SD without a word would think that is what HD looks like.
    await expect(compose({ ...PHASE, quality: 'hd' })).rejects.toThrow(/part of Premium/);
    expect(await db.media.countDocuments()).toBe(0);
  });

  it('refuses a film of a whole grow to a camera without entitlement', async () => {
    build();
    await world(null);

    await expect(compose({ window: 'grow', startsAt: PHASE.startsAt, endsAt: PHASE.endsAt })).rejects.toThrow(/part of Premium/);
  });

  it('renders a phase for a free camera, with the mark on it', async () => {
    build();
    await world(null);

    const answer = await compose(PHASE);

    expect(status).toBe(202);
    expect(answer.queued).toBe(true);
    expect(answer.media.render).toMatchObject({ status: 'queued', watermark: true });
    expect(answer.media.quality).toBe('sd');
  });

  it('renders HD without a mark for an entitled camera', async () => {
    build();
    await world(inAYear);

    const answer = await compose({ ...PHASE, quality: 'hd' });

    expect(answer.media.quality).toBe('hd');
    expect(answer.media.render).toMatchObject({ watermark: false });
  });
});

describe('what is asked of a render', () => {
  beforeEach(async () => {
    build();
    await world(null);
  });

  it('carries the board´s options onto the row the builder drains', async () => {
    const answer = await compose({
      ...PHASE,
      secondCameraId: BESIDE,
      overlays: { dayCounter: true, entries: true },
      includeLightsOff: true,
      aspect: '9_16',
    });

    expect(answer.media.render).toMatchObject({
      status: 'queued',
      aspect: '9_16',
      includeLightsOff: true,
      secondCameraId: BESIDE,
      overlays: { dayCounter: true, climate: false, entries: true },
    });
    expect(answer.media).toMatchObject({ window: 'phase', capturedAt: PHASE.startsAt, endsAt: PHASE.endsAt });
  });

  it('leaves the frames taken in the dark out unless they are asked for', async () => {
    const answer = await compose(PHASE);

    expect(answer.media.render).toMatchObject({ includeLightsOff: false, aspect: '16_9' });
  });

  it('needs both ends of a span it cannot work out for itself', async () => {
    await expect(compose({ window: 'phase' })).rejects.toThrow(/needs both ends/);
    await expect(compose({ window: 'custom', startsAt: PHASE.endsAt, endsAt: PHASE.startsAt })).rejects.toThrow(/ends after it begins/);
  });

  it('shows two cameras of one place side by side, and refuses one from another', async () => {
    const answer = await compose({ ...PHASE, secondCameraId: BESIDE });
    expect(answer.media.render?.secondCameraId).toBe(BESIDE);

    await expect(compose({ ...PHASE, secondCameraId: ELSEWHERE })).rejects.toThrow(/stand in the same place/);
  });
});

describe('asking twice', () => {
  beforeEach(async () => {
    build();
    await world(null);
  });

  it('answers the film that is already there rather than making a second', async () => {
    const first = await compose(PHASE);
    const again = await compose(PHASE);

    expect(status).toBe(200);
    expect(again.queued).toBe(false);
    expect(again.media.id).toBe(first.media.id);
    expect(await db.media.countDocuments()).toBe(1);
  });

  it('answers the film the other tap made when two of them race for it', async () => {
    // The index is what decides which of two requests makes the film, so it has
    // to be there before one of them is turned away by it.
    await db.media.createIndexes();
    const first = await compose(PHASE);

    // The second tap read before the first had written its row: its read misses
    // once, and its insert is the one the index refuses.
    const found = media.newest.bind(media);
    let misses = 1;
    media.newest = filter => (misses-- > 0 ? Promise.resolve(null) : found(filter));

    const raced = await compose(PHASE);

    expect(status).toBe(200);
    expect(raced.queued).toBe(false);
    expect(raced.media.id).toBe(first.media.id);
    expect(await db.media.countDocuments()).toBe(1);
  });

  it('replaces it when the same span is composed differently', async () => {
    const first = await compose(PHASE);
    const reel = await compose({ ...PHASE, aspect: '9_16' });

    expect(reel.queued).toBe(true);
    expect(reel.media.id).not.toBe(first.media.id);
    expect(await db.media.countDocuments()).toBe(1);
  });

  it('never replaces the rolling film the builder keeps by itself', async () => {
    const today = new Date(Math.floor(Date.now() / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000) - 24 * 60 * 60 * 1000);
    await media.queue({ kind: 'timelapse', mime: 'video/mp4', cameraId: CAMERA, capturedAt: today, window: 'day' });

    // A plain "today" is that film; a composed one is the range it covers, and
    // the two live side by side.
    const plain = await compose({ window: 'day' });
    expect(plain.queued).toBe(false);

    const composed = await compose({ window: 'day', overlays: { dayCounter: true } });
    expect(composed.queued).toBe(true);
    expect(composed.media.window).toBe('custom');
    expect(await db.media.countDocuments()).toBe(2);
  });
});

describe('what the builder makes of it', () => {
  it('reads a frame as taken in the dark only where the light was measured off', () => {
    const light = [
      { measuredAt: '2026-08-01T02:00:00.000Z', value: 0 },
      { measuredAt: '2026-08-01T08:00:00.000Z', value: 100 },
    ];

    expect(wasDark(new Date('2026-08-01T02:30:00.000Z'), light)).toBe(true);
    expect(wasDark(new Date('2026-08-01T09:00:00.000Z'), light)).toBe(false);
    // Nothing measured is not the same as off: a frame is never dropped for a
    // night nobody can confirm.
    expect(wasDark(new Date('2026-08-01T02:30:00.000Z'), [])).toBe(false);
  });

  it('renders each shape at an even size, because the encoder refuses an odd one', () => {
    expect(sizeFor('16_9', 'sd')).toEqual({ width: 1280, height: 720 });
    expect(sizeFor('9_16', 'hd')).toEqual({ width: 1080, height: 1920 });
    expect(sizeFor('1_1', 'sd')).toEqual({ width: 1280, height: 1280 });
  });

  it('draws two cameras side by side with the overlays on top, at the size of the film', async () => {
    const size = sizeFor('9_16', 'sd');
    const context = {
      growStartedAt: new Date('2026-08-01T00:00:00.000Z'),
      temperature: [
        { measuredAt: '2026-08-20T00:00:00.000Z', value: 24.5 },
        { measuredAt: '2026-08-20T12:00:00.000Z', value: 27.5 },
      ],
      humidity: [
        { measuredAt: '2026-08-20T00:00:00.000Z', value: 55 },
        { measuredAt: '2026-08-20T12:00:00.000Z', value: 60 },
      ],
      light: [],
      // A caption is whatever somebody typed, which is on its way into an XML
      // document: a line with a `<` in it must not end the film there.
      captions: [{ at: new Date('2026-08-20T06:00:00.000Z'), text: 'topped <2> & tied' }],
    };

    const at = new Date('2026-08-20T06:00:00.000Z');
    const layer = (frame: OverlayFrame) => overlayLayer(frame, { dayCounter: true, climate: true, entries: true }, context);
    const path = join(await mkdtemp(join(tmpdir(), 'composer-spec-')), 'frame.jpeg');

    await composeFrame([await picture('#2d4b95'), await picture('#7ed957')], size, layer, at, path);

    const written = await sharp(path).metadata();
    expect({ width: written.width, height: written.height }).toEqual(size);
  });

  /**
   * The span of a film is the window that was asked for, and the readings
   * inside it begin whenever the device began reporting - so the first bucket
   * of a "Today" film is empty on every device that was off at midnight. The
   * command of the first point is the one thing that made this fatal: a path
   * that opens with an L is not path data, and the renderer drew the panel, the
   * two readings and the cursor over a fifth of every frame with no curve in
   * it and nothing anywhere saying the curve had been dropped.
   */
  it('starts the curve at the first reading, on a span that opens before the device was reporting', () => {
    const readings = [
      { measuredAt: '2026-08-20T00:00:00.000Z', value: null },
      { measuredAt: '2026-08-20T06:00:00.000Z', value: null },
      { measuredAt: '2026-08-20T12:00:00.000Z', value: 24.5 },
      { measuredAt: '2026-08-20T18:00:00.000Z', value: 27.5 },
    ];
    const context = { growStartedAt: null, temperature: readings, humidity: readings, light: [], captions: [] };

    const layer = overlayLayer(
      { at: new Date('2026-08-20T18:00:00.000Z'), width: 1080, height: 1920 },
      { dayCounter: false, climate: true, entries: false },
      context,
    )!;
    const paths = [...layer.matchAll(/<path d="([^"]*)"/g)].map(found => found[1]);

    expect(paths).toHaveLength(2);
    for (const path of paths) expect(path.startsWith('M')).toBe(true);
  });

  it('draws nothing where every overlay that was asked for has nothing to say', () => {
    const empty = { growStartedAt: null, temperature: [], humidity: [], light: [], captions: [] };

    expect(overlayLayer({ at: new Date(), width: 1280, height: 720 }, { dayCounter: true, climate: true, entries: true }, empty)).toBeNull();
  });
});
