import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FastifyReply } from 'fastify';
import sharp from 'sharp';
import { SeriesPoint, TimelapseCreate } from '@fg2/shared-types/v1';
import { CamerasController } from '@modules/v1/camera/cameras.controller';
import { CamerasService } from '@modules/v1/camera/cameras.service';
import { EntitlementService } from '@modules/v1/camera/entitlement.service';
import { MediaService } from '@modules/v1/camera/media.service';
import {
  OverlayFrame,
  captionAt,
  composeFrame,
  curveStrokes,
  fitted,
  overlayLayer,
  readingIn,
  sizeFor,
  textWidth,
  wasDark,
} from '@modules/v1/camera/timelapse-overlays';
import { TimelapseContextService } from '@modules/v1/camera/timelapse-context.service';
import { TimelapseService, whyNoFilm } from '@modules/v1/camera/timelapse.service';
import { session } from './support/callers';
import { accessOn } from './support/services';
import { useV1TestDatabase } from './support/v1-database';

/**
 * The composer: what is asked of a render, and what is refused.
 *
 * A render does not finish inside a request, so asking for one is a decision -
 * the span, the second camera, what is drawn, what it may cost - and a row to
 * poll. That decision (`TimelapseService.request`, reached through the route) is
 * what is held here; what ffmpeg then does with the frames is the render's own.
 */

const OWNER = 'user-owner';
const TENT = 'space-tent';
const BALCONY = 'space-balcony';
const CAMERA = 'camera-1';
const BESIDE = 'camera-2';
const ELSEWHERE = 'camera-3';

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

const db = useV1TestDatabase();
let controller: CamerasController;
let media: MediaService;
let status: number;
/** The light output the render would read over the span: on, off, or never measured. */
let light: SeriesPoint[] = [];

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

const compose = (body: TimelapseCreate, cameraId = CAMERA) => controller.requestTimelapse(session(OWNER), cameraId, body, reply());

const build = (): void => {
  const entitlement = new EntitlementService(PREMIUM);
  const cameras = new CamerasService(db.cameras, db.devices, db.memberships, entitlement, db.users, db.alerts);
  media = new MediaService(db.media, db.grows, null as never, db.entries);
  const access = accessOn(db);
  const poller = { settingsChanged: () => undefined, forget: () => undefined };
  // The builder is asked to take the queue now rather than on its hourly pass;
  // what it then renders is the builder's own test.
  const context = { contextFor: async () => ({ temperature: [], humidity: [], light, captions: [], growStartedAt: null }) };
  const builder = new TimelapseService(cameras, media, entitlement, context as never);
  builder.renderQueued = () => undefined;

  controller = new CamerasController(cameras, media, poller as never, builder, access, {} as never, db.spaces);
};

/** Pictures of a camera every `everyMs` between two instants, as the poller stores them. */
const pictures = (cameraId: string, from: number, to: number, everyMs: number) =>
  db.media.insertMany(
    Array.from({ length: Math.floor((to - from) / everyMs) + 1 }, (_, index) => ({
      id: `picture-${cameraId}-${from + index * everyMs}`,
      kind: 'still',
      mime: 'image/jpeg',
      bytes: 1,
      cameraId,
      capturedAt: new Date(from + index * everyMs),
    })),
  );

const HOUR_MS = 3600_000;

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
  // Enough pictures for a film of the phase, half past every hour, and of the last two days every four minutes: a span
  // with too few is refused before anything is queued.
  await pictures(CAMERA, Date.parse(PHASE.startsAt) + HOUR_MS / 2, Date.parse(PHASE.endsAt), HOUR_MS);
  await pictures(CAMERA, Date.now() - 48 * HOUR_MS, Date.now() - 1000, 4 * 60_000);
};

beforeEach(async () => {
  await db.reset();
  status = 0;
  light = [];
});

/**
 * A camera looking into a place that has ended would be on no screen. A new
 * one is refused there and so is one moved there; a camera a place that was
 * put away still holds keeps its settings changeable, since nothing is put
 * anywhere by that.
 */
describe('where a camera may be put', () => {
  const stream = { kind: 'rtsp' as const, name: 'Cam 4', url: 'rtsp://10.0.0.5:554/stream1' };
  const refused = async (act: Promise<unknown>) =>
    (
      await act.then(
        () => null,
        error => error as { problem?: { status: number; code: string } },
      )
    )?.problem;

  it('puts none into a place that has ended, new or moved, and leaves one standing there to be changed', async () => {
    build();
    await world(null);
    expect((await controller.create(session(OWNER), { ...stream, spaceId: BALCONY })).spaceId).toBe(BALCONY);
    await db.spaces.updateOne({ id: BALCONY }, { $set: { archivedAt: new Date() } });
    const ended = { status: 409, code: 'space_archived' };

    expect(await refused(controller.create(session(OWNER), { ...stream, spaceId: BALCONY }))).toMatchObject(ended);
    expect(await refused(controller.update(session(OWNER), CAMERA, { spaceId: BALCONY }))).toMatchObject(ended);
    expect((await db.cameras.findOne({ id: CAMERA }).lean())?.spaceId).toBe(TENT);

    expect((await controller.update(session(OWNER), ELSEWHERE, { spaceId: BALCONY, name: 'Still on the balcony' })).name).toBe(
      'Still on the balcony',
    );
    expect((await controller.update(session(OWNER), ELSEWHERE, { spaceId: TENT })).spaceId).toBe(TENT);
  });
});

describe('what a film costs', () => {
  const inAYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  it('refuses HD to a camera without entitlement rather than quietly rendering it smaller', async () => {
    build();
    await world(null);

    // Somebody handed SD without a word would think that is what HD looks like.
    await expect(compose({ ...PHASE, quality: 'hd' })).rejects.toThrow(/part of Premium/);
    expect(await db.media.countDocuments({ kind: 'timelapse' })).toBe(0);
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

  /** Asked at night, the day's film was said to be on its way and then failed: the render's own rule is asked first. */
  it('refuses at once a span whose every picture was taken in the dark, unless those pictures are asked for', async () => {
    const hours = Array.from({ length: 30 }, (_, hour) => new Date(Date.parse(PHASE.startsAt) + hour * 3600_000));
    await db.media.create(
      hours.map((capturedAt, index) => ({ id: `still-${index}`, kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt })),
    );
    light = hours.map(at => ({ measuredAt: at.toISOString(), value: 0 }));

    await expect(compose(PHASE)).rejects.toThrow(/taken with the light off/);
    expect(await db.media.countDocuments({ kind: 'timelapse' })).toBe(0);

    expect((await compose({ ...PHASE, includeLightsOff: true })).queued).toBe(true);
    light = hours.map((at, index) => ({ measuredAt: at.toISOString(), value: index % 2 === 0 ? 0 : 100 }));
    expect((await compose({ ...PHASE, aspect: '1_1' })).queued).toBe(true);
  });

  /** A day film with too few pictures was said to be on its way and failed 8 ms later: refused at once, as the dark one is. */
  it('refuses at once a span with too few pictures for a film, lights-off frames or not', async () => {
    const few = { window: 'custom' as const, startsAt: '2026-07-01T00:00:00.000Z', endsAt: '2026-07-02T00:00:00.000Z' };
    await pictures(CAMERA, Date.parse(few.startsAt), Date.parse(few.startsAt) + 4 * HOUR_MS, HOUR_MS);

    const refused = await compose(few).then(
      () => null,
      error => (error as { problem?: { status: number; code: string } }).problem,
    );
    expect(refused).toMatchObject({ status: 422, code: 'too_few_pictures' });
    await expect(compose({ ...few, includeLightsOff: true })).rejects.toThrow(/too few for a film/);
    expect(await db.media.countDocuments({ kind: 'timelapse' })).toBe(0);
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
    expect(await db.media.countDocuments({ kind: 'timelapse' })).toBe(1);
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
    expect(await db.media.countDocuments({ kind: 'timelapse' })).toBe(1);
  });

  it('replaces it when the same span is composed differently', async () => {
    const first = await compose(PHASE);
    const reel = await compose({ ...PHASE, aspect: '9_16' });

    expect(reel.queued).toBe(true);
    expect(reel.media.id).not.toBe(first.media.id);
    expect(await db.media.countDocuments({ kind: 'timelapse' })).toBe(1);
  });

  /**
   * "Film von heute" was asked for at one in the morning and kept the end of
   * the day as its end, so it read as covering the whole day: the hourly pass
   * never rebuilt it and every later tap answered the same one-second film. A
   * film of a span still going covers it up to its last picture, and a tap once
   * the camera has gone on films the rest.
   */
  it('films today again once the camera has gone on, and not while it is current', async () => {
    const now = Date.now();
    const still = (minutesAgo: number) => ({
      id: `still-${minutesAgo}`,
      kind: 'still',
      mime: 'image/jpeg',
      bytes: 1,
      cameraId: CAMERA,
      capturedAt: new Date(now - minutesAgo * 60_000),
    });
    await db.media.create([still(1)]);

    const asked = await compose({ window: 'day', startsAt: new Date(now).toISOString() });
    expect(asked.queued).toBe(true);
    const dayEnd = new Date(asked.media.endsAt!);
    expect(dayEnd.getTime()).toBeGreaterThan(now);

    // Rendered at the start of the hour, the way the builder fills it in, with
    // the end of the day still on the row as a render before this fix left it.
    await db.media.updateOne(
      { id: asked.media.id },
      { $set: { bytes: 10, lengthSeconds: 1, 'render.status': 'ready', 'render.endedAt': new Date(now - 40 * 60_000) } },
    );
    const stuck = await compose({ window: 'day', startsAt: new Date(now).toISOString() });
    expect(stuck.queued).toBe(true);
    expect(stuck.media.id).not.toBe(asked.media.id);

    // Ready and reaching the newest picture: a second tap answers it.
    await db.media.updateOne(
      { id: stuck.media.id },
      { $set: { bytes: 10, lengthSeconds: 1, endsAt: new Date(now - 2 * 60_000), 'render.status': 'ready', 'render.endedAt': new Date(now) } },
    );
    const again = await compose({ window: 'day', startsAt: new Date(now).toISOString() });
    expect(again.queued).toBe(false);
    expect(again.media.id).toBe(stuck.media.id);
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
    expect(await db.media.countDocuments({ kind: 'timelapse' })).toBe(2);
  });
});

describe('a film of a whole grow', () => {
  it('becomes the film of the grow that stood in front of the camera, which the public diary plays', async () => {
    const startedAt = new Date('2026-08-01T00:00:00.000Z');
    await db.grows.create({
      id: 'grow-1',
      ownerId: OWNER,
      name: 'Autumn',
      type: 'photoperiod',
      slug: 'autumn',
      startedAt,
      phases: [],
      placements: [{ id: 'placement-1', spaceId: TENT, startedAt, endedAt: null, plantIds: null }],
    });
    const context = new TimelapseContextService(db.grows, db.entries, db.devices, null);

    await context.attachGrowFilm({ spaceId: TENT }, { startsAt: startedAt, endsAt: new Date('2026-09-01T00:00:00.000Z') }, 'film-1');
    await context.attachGrowFilm({ spaceId: BALCONY }, { startsAt: startedAt, endsAt: new Date('2026-09-01T00:00:00.000Z') }, 'film-2');

    expect((await db.grows.findOne({ id: 'grow-1' }).lean())?.filmMediaId).toBe('film-1');
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

  /**
   * A render that produced nothing says which of the three things went wrong,
   * because only one of them is anybody's to do something about. The tent this
   * was found on runs its light output at zero all night, so the lights-off
   * filter emptied every one-tap film of it and each was reported as a span
   * with too few pictures in it - ten lines under the page's own count of the
   * twenty-seven it had taken that day.
   */
  it('says which of the three ways a render can come back empty it was', () => {
    // Pictures enough, and none of them left once the dark ones were dropped.
    expect(whyNoFilm(400, 0)).toBe('every picture in that span was taken with the light off');
    // A span that genuinely holds nothing, which is what the one sentence used to say of all three.
    expect(whyNoFilm(3, 3)).toBe('there are not enough pictures in that span to make a film');
    // Frames enough to encode, and no film at the end of it: ffmpeg, or the frames that could not be written.
    expect(whyNoFilm(400, 400)).toBe('the pictures in that span could not be made into a film');
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

  it('counts the days in the language the owner uses the app in', () => {
    const context = { growStartedAt: new Date('2026-08-01T00:00:00.000Z'), temperature: [], humidity: [], light: [], captions: [] };
    const frame = { at: new Date('2026-08-04T12:00:00.000Z'), width: 1280, height: 720 };
    const only = { dayCounter: true, climate: false, entries: false };

    expect(overlayLayer(frame, only, { ...context, language: 'de' })).toContain('>Tag 4</text>');
    expect(overlayLayer(frame, only, context)).toContain('>Day 4</text>');
  });

  /** A German owner's film said "25.6°C" beside "Tag 29": the figures are the app's, in the owner's language. */
  it('writes the climate´s figures as the app writes them for the owner: its decimals, its decimal mark, a space before the unit', () => {
    const readings = (values: number[]) => values.map((value, index) => ({ measuredAt: `2026-08-20T0${index}:00:00.000Z`, value }));
    const context = { growStartedAt: null, temperature: readings([24.04, 25.63]), humidity: readings([58.4, 59.2]), light: [], captions: [] };
    const frame = { at: new Date('2026-08-20T01:00:00.000Z'), width: 1280, height: 720 };
    const climate = { dayCounter: false, climate: true, entries: false };

    expect(overlayLayer(frame, climate, { ...context, language: 'de' })).toMatch(/>25,6 °C<\/text>[\s\S]*>59 %<\/text>/);
    expect(overlayLayer(frame, climate, { ...context, language: 'en' })).toMatch(/>25\.6 °C<\/text>/);
    expect(readingIn(-0.04, 1, '°C', 'de')).toBe('0,0 °C');
  });

  /** The curve poked four pixels out of its box at the right: drawn inside it now, joined round. */
  it('keeps the curves and the cursor inside the climate box, and the caption over it as wide as the box', () => {
    // A steep last step, which a mitred join drew past the box's edge.
    const steep = [20, 20, 20, 30, 20].map((value, index) => ({ measuredAt: `2026-08-20T0${index}:00:00.000Z`, value }));
    const context = {
      growStartedAt: null,
      temperature: steep,
      humidity: steep,
      light: [],
      captions: [{ at: new Date('2026-08-20T04:00:00.000Z'), text: 'topped' }],
    };
    const frame = { at: new Date('2026-08-20T04:00:00.000Z'), width: 1280, height: 720 };
    const layer = overlayLayer(frame, { dayCounter: false, climate: true, entries: true }, context)!;

    const rects = [...layer.matchAll(/<rect x="(\d+)" y="\d+" width="(\d+)"/g)].map(found => ({ left: Number(found[1]), width: Number(found[2]) }));
    const [caption, box] = rects;
    expect(caption).toEqual(box);
    const xs = [...layer.matchAll(/<path d="([^"]*)"/g)].flatMap(found => [...found[1].matchAll(/[ML]([\d.]+) /g)].map(point => Number(point[1])));
    const cursor = Number(/<line x1="([\d.]+)"/.exec(layer)![1]);
    for (const x of [...xs, cursor]) {
      expect(x).toBeGreaterThanOrEqual(box.left + 2);
      expect(x).toBeLessThanOrEqual(box.left + box.width - 2);
    }
    // Nor up through the readings: a spike ran across "20,9 °C". Every point and the cursor stand below their row.
    const ys = [...layer.matchAll(/<path d="([^"]*)"/g)].flatMap(found =>
      [...found[1].matchAll(/[ML][\d.]+ ([\d.]+)/g)].map(point => Number(point[1])),
    );
    const cursorTop = Number(/<line x1="[\d.]+" y1="([\d.]+)"/.exec(layer)![1]);
    const readingsRow = Math.max(...[...layer.matchAll(/<text x="\d+" y="(\d+)"[^>]*>[\d,.]+ (?:°C|%)</g)].map(found => Number(found[1])));
    expect(ys.length).toBeGreaterThan(0);
    expect(readingsRow).toBeGreaterThan(0);
    for (const y of [...ys, cursorTop]) expect(y).toBeGreaterThan(readingsRow);
    expect(layer).toContain('stroke-linejoin="round"');
  });

  /** A portrait film cut "Erste Trichome milchig." to "Erste Tricho…" in a box of 62 % of its 720 px. */
  it('gives a caption the width it needs, up to the frame´s margins, on a portrait film as on a landscape one', () => {
    const readings = [20, 21].map((value, index) => ({ measuredAt: `2026-08-20T0${index}:00:00.000Z`, value }));
    const caption = (text: string) => ({
      growStartedAt: null,
      temperature: readings,
      humidity: readings,
      light: [],
      captions: [{ at: new Date('2026-08-20T01:00:00.000Z'), text }],
    });
    const portrait = { at: new Date('2026-08-20T01:00:00.000Z'), ...sizeFor('9_16', 'sd') };
    const both = { dayCounter: false, climate: true, entries: true };

    const said = overlayLayer(portrait, both, caption('Erste Trichome milchig.'))!;
    expect(said).toContain('>Erste Trichome milchig.</text>');
    const [box, plate] = [...said.matchAll(/<rect x="(\d+)" y="\d+" width="(\d+)"/g)].map(found => ({
      left: Number(found[1]),
      width: Number(found[2]),
    }));
    expect(plate).toEqual(box);

    // A line wider than the climate box widens its plate, and one longer than the frame is cut at its margin.
    const longer = overlayLayer(portrait, both, caption('Erste Trichome milchig, Spitzen gelb.'))!;
    const [, wider] = [...longer.matchAll(/<rect x="(\d+)" y="\d+" width="(\d+)"/g)].map(found => ({
      left: Number(found[1]),
      width: Number(found[2]),
    }));
    expect(longer).toContain('>Erste Trichome milchig, Spitzen gelb.</text>');
    expect(wider.width).toBeGreaterThan(box.width);
    expect(wider.left).toBeGreaterThan(0);
    expect(wider.left + wider.width).toBeLessThan(portrait.width);
    const long = overlayLayer(portrait, both, caption('Erste Trichome milchig, die Blätter an der Spitze werden gelb und die Buds wachsen.'))!;
    const [, widest] = [...long.matchAll(/<rect x="(\d+)" y="\d+" width="(\d+)"/g)].map(found => Number(found[2]));
    expect(long).toMatch(/…<\/text>/);
    expect(widest).toBeGreaterThan(portrait.width * 0.9);
  });

  /**
   * Lines at 17:09 and 17:22 in a film of 17:07 to 17:40: every frame took the first line within half an hour of it,
   * and the second never stood on one.
   */
  it('captions a frame with the diary line nearest it', () => {
    const at = (clock: string) => new Date(`2026-11-13T${clock}:00.000Z`);
    const captions = [
      { at: at('17:09'), text: 'Erste Trichome milchig.' },
      { at: at('17:22'), text: 'Spitzen gelb.' },
    ];

    expect(captionAt(at('17:12'), captions)?.text).toBe('Erste Trichome milchig.');
    expect(captionAt(at('17:20'), captions)?.text).toBe('Spitzen gelb.');
    expect(captionAt(at('17:40'), captions)?.text).toBe('Spitzen gelb.');
    expect(captionAt(at('18:00'), captions)).toBeNull();
    const frame = { at: at('17:30'), width: 1280, height: 720 };
    expect(
      overlayLayer(
        frame,
        { dayCounter: false, climate: false, entries: true },
        { growStartedAt: null, temperature: [], humidity: [], light: [], captions },
      ),
    ).toContain('>Spitzen gelb.</text>');
  });

  /**
   * Guessed at 0.55 of its size a letter, a caption's "…" came about a fifth before its bar ended. It is measured by
   * Albert Sans's own advance widths, and cut only where the next letter would run past the bar.
   */
  it('runs a caption to its bar´s end by the face´s own widths before it cuts it', () => {
    // H and i as the face sets them: 705 and 258 thousandths of the size.
    expect(textWidth('Hi', 100)).toBeCloseTo(96.3);
    const text = 'Erste Trichome milchig, die Blätter an der Spitze werden gelb und die Buds wachsen.';
    for (const [room, size] of [
      [575, 28],
      [900, 28],
      [640, 41],
    ]) {
      const cut = fitted(text, room, size);
      expect(cut.endsWith('…')).toBe(true);
      expect(textWidth(cut, size)).toBeLessThanOrEqual(room);
      // Not a letter's width left over: the next one would not have fitted.
      expect(room - textWidth(cut, size)).toBeLessThan(size);
    }
    expect(fitted('Spitzen gelb.', 575, 28)).toBe('Spitzen gelb.');
  });

  /** A film across seven hours offline drew a straight slope from the last reading to the first after it. */
  it('breaks a curve where the device was silent, as Verlauf does, and joins one that only skipped a window', () => {
    const at = (minutes: number) => new Date(Date.parse('2026-08-20T00:00:00.000Z') + minutes * 60_000).toISOString();
    const points = [
      ...[0, 5, 10, 15].map(minutes => ({ measuredAt: at(minutes), value: 24 })),
      // One window without a reading is no silence.
      { measuredAt: at(20), value: null },
      ...[25, 30].map(minutes => ({ measuredAt: at(minutes), value: 25 })),
      // Seven hours of nothing.
      ...Array.from({ length: 84 }, (_, index) => ({ measuredAt: at(35 + index * 5), value: null })),
      ...[455, 460, 465].map(minutes => ({ measuredAt: at(minutes), value: 22 })),
    ];

    const strokes = curveStrokes(points, Date.parse(at(0)), Date.parse(at(465)));
    expect(strokes.filter(point => point.starts).map(point => point.at)).toEqual([Date.parse(at(0)), Date.parse(at(455))]);

    const layer = overlayLayer(
      { at: new Date(at(200)), width: 1280, height: 720 },
      { dayCounter: false, climate: true, entries: false },
      { growStartedAt: null, temperature: points, humidity: [], light: [], captions: [] },
    )!;
    expect([.../<path d="([^"]*)"/.exec(layer)![1].matchAll(/M/g)]).toHaveLength(2);
  });

  /** A 16:9 film drew its curve in the middle of its box, 127 and 107 px in from its ends, where the span had no reading. */
  it('draws the readings across the box´s width where the span opens before and closes after them', () => {
    const at = (minutes: number) => new Date(Date.parse('2026-08-20T17:00:00.000Z') + minutes * 60_000).toISOString();
    const points = Array.from({ length: 36 }, (_, minute) => ({
      measuredAt: at(minute),
      value: minute < 6 || minute > 30 ? null : 20 + (minute % 3),
    }));
    const frame = { at: new Date(at(18)), width: 1280, height: 720 };
    const layer = overlayLayer(
      frame,
      { dayCounter: false, climate: true, entries: false },
      { growStartedAt: null, temperature: points, humidity: [], light: [], captions: [] },
    )!;

    const [box] = [...layer.matchAll(/<rect x="(\d+)" y="\d+" width="(\d+)"/g)].map(found => ({ left: Number(found[1]), width: Number(found[2]) }));
    const xs = [.../<path d="([^"]*)"/.exec(layer)![1].matchAll(/[ML]([\d.]+) /g)].map(point => Number(point[1]));
    expect(Math.min(...xs) - box.left).toBeLessThan(20);
    expect(box.left + box.width - Math.max(...xs)).toBeLessThan(20);
  });

  it('draws nothing where every overlay that was asked for has nothing to say', () => {
    const empty = { growStartedAt: null, temperature: [], humidity: [], light: [], captions: [] };

    expect(overlayLayer({ at: new Date(), width: 1280, height: 720 }, { dayCounter: true, climate: true, entries: true }, empty)).toBeNull();
  });
});
