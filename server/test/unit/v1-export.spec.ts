import { jest } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import type { DeviceSeries } from '@fg2/shared-types/v1';
import { media as mediaShape } from '@fg2/shared-types/v1-schemas';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { ImageStore } from '@database/image-store';
import { DataService, SeriesRequest } from '@modules/data/data.service';
import { MediaService } from '@modules/v1/camera/media.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * Exporting: the job, the zip it leaves behind, and the fact that the zip is
 * nobody's but the person who asked for it.
 *
 * The archive is read back twice rather than taken on trust. It is written by
 * hand - there is no zip library in this server - so the spec walks the central
 * directory itself, inflates what was deflated and checks the checksum the
 * archive claims against the bytes that come out; and then, where the machine
 * has one, it hands the same file to a real `unzip`, which shares none of the
 * writer's assumptions. A hand reader can only ever confirm that the spec and
 * the writer agree, and what a grower has is an unzip.
 */

/**
 * Whether the archive can be handed to somebody else's reader. Skipping the
 * second opinion where there is no `unzip` is only acceptable because
 * everything it is a second opinion about is asserted by hand as well.
 */
const canUnzip = ((): boolean => {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });

    return true;
  } catch {
    return false;
  }
})();

/**
 * A write of the archive that fails, armed by the one case that needs it. A
 * full disk cannot be arranged in a spec, and what matters is the half of a
 * failed write that used to end the server: the `error` event node raises on
 * the stream beside the callback the writer is waiting on.
 */
let writeFails: Error | null = null;

// The module itself, from outside jest's registry: importing it in the factory
// below would be the factory asking for what the factory answers.
const fs: typeof import('node:fs') = createRequire(import.meta.url)('node:fs');

jest.unstable_mockModule('node:fs', () => ({
  ...fs,
  default: fs,
  createWriteStream: (...args: Parameters<typeof fs.createWriteStream>) => {
    const stream = fs.createWriteStream(...args);
    const failure = writeFails;
    if (failure) setImmediate(() => stream.emit('error', failure));

    return stream;
  },
}));

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';

const TENT = 'tent-1';
const CONTROLLER = 'device-controller';
const CAMERA = 'camera-mine';
const GROW = 'grow-spring';

const ORIGIN = new Date('2026-06-08T12:00:00.000Z');
const ENDED = new Date('2026-06-10T12:00:00.000Z');
const PHOTO_TAKEN = new Date('2026-06-09T09:00:00.000Z');

/** Asked for now, because how fresh a finished export is, is measured against the clock the build ran on. */
const NOW = new Date();

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });
const visitor = (shareToken: string): AccessContext => ({ userId: null, isAdmin: false, isDemo: false, shareToken });
const demo = (): AccessContext => ({ userId: null, isAdmin: false, isDemo: true, shareToken: null });

let db: V1TestDatabase;
let access: AccessService;
let store: ImageStore;
let media: MediaService;
let exports: InstanceType<typeof ExportService>;

// The builder is loaded after the mock above, because an ES module is linked
// before the file importing it runs and a static import would take the real
// `node:fs` with it.
let ExportService: typeof import('@modules/v1/grow/export.service').ExportService;

const fakeData = {
  series: async (deviceId: string, request: SeriesRequest): Promise<DeviceSeries> => {
    const step = (request.stepSeconds ?? 60) * 1000;
    const instants: Date[] = [];
    for (let at = request.startsAt.getTime(); at < request.endsAt.getTime(); at += step) instants.push(new Date(at));

    return {
      deviceId,
      startsAt: request.startsAt.toISOString(),
      endsAt: request.endsAt.toISOString(),
      stepSeconds: request.stepSeconds ?? 60,
      metrics: request.metrics.map(name => ({
        metric: name,
        points: instants.map(at => ({ measuredAt: at.toISOString(), value: name === 'temperature' ? 23.5 : null })),
      })),
      outputs: (request.outputs ?? []).map(output => ({
        output,
        points: instants.map(at => ({ measuredAt: at.toISOString(), value: output === 'light' ? 1 : null })),
      })),
    };
  },
} as unknown as DataService;

/**
 * The archive, read back: every entry by name, with its bytes recovered the way
 * an unzip recovers them.
 *
 * It walks the directory at the end rather than the headers at the front, which
 * is what a reader does, and so is also a check that the two agree.
 */
const unzip = (archive: Buffer): Map<string, Buffer> => {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);

  const zip64 = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
  const count = Number(archive.readBigUInt64LE(zip64 + 32));
  let at = Number(archive.readBigUInt64LE(zip64 + 48));

  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    expect(archive.readUInt32LE(at)).toBe(0x02014b50);
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const offset = archive.readUInt32LE(at + 42);
    const compressedSize = archive.readUInt32LE(at + 20);

    // Where the bytes start: past the local header and whatever it carries.
    const from = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
    const stored = archive.subarray(from, from + compressedSize);
    const content = method === 8 ? inflateRawSync(stored) : stored;
    expect(crc32(content) >>> 0).toBe(crc);

    // The descriptor that follows the bytes says what the directory says. A
    // reader going forwards through the file has only that one to go by.
    expect(archive.readUInt32LE(from + compressedSize)).toBe(0x08074b50);
    expect(archive.readUInt32LE(from + compressedSize + 4)).toBe(crc);
    expect(Number(archive.readBigUInt64LE(from + compressedSize + 8))).toBe(compressedSize);
    expect(Number(archive.readBigUInt64LE(from + compressedSize + 16))).toBe(content.length);

    files.set(name, content);
    at += 46 + nameLength + extraLength;
  }

  return files;
};

const archiveOf = async (id: string): Promise<Map<string, Buffer>> => unzip(await media.download(id));

const world = async (): Promise<void> => {
  await db.users.create([
    { id: OWNER, email: 'owner@test.invalid', handle: 'owner', passwordHash: 'x' },
    { id: MEMBER, email: 'member@test.invalid', handle: 'mia', passwordHash: 'x' },
    { id: STRANGER, email: 'stranger@test.invalid', handle: 'greenthumb', passwordHash: 'x' },
  ]);
  await db.spaces.create({ id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent 1', roomId: null });
  await db.memberships.create({ id: 'membership-member', spaceId: TENT, userId: MEMBER, role: 'can_manage' });
  await db.devices.create({ id: CONTROLLER, type: 'controller', ownerId: OWNER, spaceId: TENT, configuration: null, createdAt: ORIGIN });

  await db.grows.create({
    id: GROW,
    ownerId: OWNER,
    name: 'Spring run #3',
    type: 'photoperiod',
    slug: 'spring-run-3',
    startedAt: ORIGIN,
    endedAt: ENDED,
    phases: [
      {
        id: 'phase-veg',
        stage: 'vegetative',
        preset: null,
        startedAt: ORIGIN,
        source: 'human',
        plantIds: null,
        deviceId: null,
        targets: null,
        setBy: OWNER,
      },
    ],
    placements: [{ id: 'placement-1', spaceId: TENT, startedAt: ORIGIN, endedAt: null, plantIds: null }],
    measurements: [{ key: 'height', name: 'Height', unit: 'cm', perPlant: true, targetMin: null, targetMax: null, chart: true }],
  });
  await db.plants.create({ id: 'plant-1', growId: GROW, strain: 'Amnesia', label: 'Amnesia 1', status: 'active', createdAt: ORIGIN });

  const picture = await media.storeBytes(
    { kind: 'photo', mime: 'image/jpeg', growId: GROW, uploadedBy: OWNER, capturedAt: PHOTO_TAKEN },
    Buffer.from('not really a jpeg, but bytes all the same'),
  );

  await db.entries.create([
    {
      id: 'entry-measure',
      createdAt: new Date('2026-06-09T09:00:00.000Z'),
      kind: 'measurement',
      occurredAt: new Date('2026-06-09T09:00:00.000Z'),
      source: 'human',
      authorId: OWNER,
      growId: GROW,
      plantIds: ['plant-1'],
      values: { kind: 'measurement', readings: [{ key: 'height', value: 21, plantId: 'plant-1' }] },
      mediaIds: [],
    },
    {
      id: 'entry-photo',
      createdAt: new Date('2026-06-09T10:00:00.000Z'),
      kind: 'photo',
      occurredAt: new Date('2026-06-09T10:00:00.000Z'),
      source: 'human',
      authorId: OWNER,
      growId: GROW,
      // A comma and a quote, which is what a CSV has to survive.
      text: 'Topped, "hard", above node 5',
      values: { kind: 'photo' },
      mediaIds: [picture.id],
    },
    {
      id: 'entry-in-the-tent',
      createdAt: new Date('2026-06-09T11:00:00.000Z'),
      kind: 'note',
      occurredAt: new Date('2026-06-09T11:00:00.000Z'),
      source: 'human',
      authorId: OWNER,
      spaceId: TENT,
      values: { kind: 'note' },
      mediaIds: [],
    },
  ]);

  await db.shareLinks.create({
    id: 'link-1',
    token: 'a-week-of-it',
    kind: 'view',
    subject: { type: 'grow', id: GROW },
    createdBy: OWNER,
    range: { startsAt: null, endsAt: null },
  });

  // The rest of what an account has, and beside each of them the same thing
  // belonging to somebody else, so that every assertion about what is in the
  // archive has one about what is not.
  await db.cameras.create([
    { id: CAMERA, ownerId: OWNER, kind: 'terpcam_controller', name: 'Tent cam', deviceId: CONTROLLER, spaceId: TENT, createdAt: ORIGIN },
    { id: 'camera-theirs', ownerId: STRANGER, kind: 'rtsp', name: 'Their cam', createdAt: ORIGIN },
  ]);
  await db.alarmRules.create({
    id: 'rule-too-warm',
    deviceId: CONTROLLER,
    name: 'Too warm',
    watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null },
    severity: 'critical',
    createdAt: ORIGIN,
  });
  await db.alerts.create({
    id: 'alert-1',
    ruleId: 'rule-too-warm',
    deviceId: CONTROLLER,
    kind: 'threshold',
    severity: 'critical',
    startedAt: ORIGIN,
  });
  await db.reminders.create({
    id: 'reminder-water',
    subject: { type: 'space', id: TENT },
    kind: 'water',
    label: 'Water',
    everyDays: 3,
    createdBy: OWNER,
  });
  await db.plans.create({
    id: 'plan-1',
    deviceId: CONTROLLER,
    name: 'Spring plan',
    steps: [{ id: 'step-1', name: 'Stretch', stage: 'vegetative', duration: { value: 2, unit: 'weeks' }, settings: { day: { temperature: 26 } } }],
  });

  // What a camera holds: stills, which belong to the camera and to nothing
  // else, and the film made from them. Neither carries a grow or a space, so an
  // export that looked for pictures by grow found none of either.
  const rendered = {
    status: 'ready' as const,
    framesPerSecond: 25,
    watermark: false,
    aspect: '16_9' as const,
    overlays: { dayCounter: false, climate: false, entries: false },
    includeLightsOff: false,
    secondCameraId: null,
    startedAt: ORIGIN,
    endedAt: ENDED,
    error: null,
  };

  await media.storeBytes({ kind: 'still', mime: 'image/jpeg', cameraId: CAMERA, capturedAt: ORIGIN }, Buffer.from('a still'));
  await media.storeBytes({ kind: 'still', mime: 'image/jpeg', cameraId: CAMERA, capturedAt: ENDED }, Buffer.from('another still'));
  await media.storeBytes(
    { kind: 'timelapse', mime: 'video/mp4', cameraId: CAMERA, capturedAt: ORIGIN, endsAt: ENDED, window: 'week', render: rendered },
    Buffer.from('the week of it, as a film'),
  );
  // Queued rather than rendered: a row with no bytes behind it yet.
  await media.storeBytes(
    {
      kind: 'timelapse',
      mime: 'video/mp4',
      cameraId: CAMERA,
      capturedAt: new Date('2026-06-11T12:00:00.000Z'),
      window: 'day',
      render: { ...rendered, status: 'queued', startedAt: null, endedAt: null },
    },
    Buffer.from(''),
  );

  // Somebody else's, in the same database: theirs to export and never ours.
  await db.spaces.create({ id: 'tent-theirs', ownerId: STRANGER, kind: 'tent', name: 'Their tent', roomId: null });
  await db.grows.create({
    id: 'grow-theirs',
    ownerId: STRANGER,
    name: 'Their run',
    type: 'photoperiod',
    slug: 'their-run',
    startedAt: ORIGIN,
    phases: [],
    placements: [],
    measurements: [],
  });
  await media.storeBytes(
    { kind: 'timelapse', mime: 'video/mp4', cameraId: 'camera-theirs', capturedAt: ORIGIN, window: 'week', render: rendered },
    Buffer.from('their week, as a film'),
  );
};

beforeAll(async () => {
  ({ ExportService } = await import('@modules/v1/grow/export.service'));
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

afterEach(() => {
  writeFails = null;
  // The builder wakes itself when an export is asked for; a spec that left that
  // timer behind would keep the run open after its last assertion.
  exports.onApplicationShutdown();
});

beforeEach(async () => {
  await db.reset();
  access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  store = new ImageStore(db.connection);
  media = new MediaService(db.media, db.grows, store);
  exports = new ExportService(
    db.grows,
    db.plants,
    db.entries,
    db.spaces,
    db.devices,
    db.users,
    db.cameras,
    db.alarmRules,
    db.alerts,
    db.reminders,
    db.plans,
    db.memberships,
    media,
    fakeData,
    access,
  );
  await world();
});

describe('the job', () => {
  it('is a media row of its own kind, queued, and about no grow anybody else can reach', async () => {
    const asked = await exports.ask(OWNER, 'grow', GROW, NOW);

    expect(asked.queued).toBe(true);
    expect(mediaShape.parse(asked.media)).toBeTruthy();
    expect(asked.media).toMatchObject({ kind: 'export', mime: 'application/zip', uploadedBy: OWNER, bytes: 0 });
    expect(asked.media.exportJob).toMatchObject({ status: 'queued', scope: 'grow', growId: GROW });
    // It names no grow and no space of its own: that is what keeps a link onto
    // the grow, and the grow's own public address, from reaching it.
    expect(asked.media.growId).toBeNull();
    expect(asked.media.spaceId).toBeNull();
    expect(asked.media.cameraId).toBeNull();
  });

  it('answers the job already in flight rather than starting a second', async () => {
    const first = await exports.ask(OWNER, 'grow', GROW, NOW);
    const again = await exports.ask(OWNER, 'grow', GROW, NOW);

    expect(again.queued).toBe(false);
    expect(again.media.id).toBe(first.media.id);
    expect(await db.media.countDocuments({ kind: 'export' })).toBe(1);
  });

  it('stands in for the next request for an hour, and is built again after that', async () => {
    const first = await exports.ask(OWNER, 'grow', GROW, NOW);
    await exports.drain();

    const soon = await exports.ask(OWNER, 'grow', GROW, new Date(NOW.getTime() + 30 * 60 * 1000));
    expect(soon).toMatchObject({ queued: false, media: { id: first.media.id } });

    const tomorrow = await exports.ask(OWNER, 'grow', GROW, new Date(NOW.getTime() + 25 * 60 * 60 * 1000));
    expect(tomorrow.queued).toBe(true);
    expect(tomorrow.media.id).not.toBe(first.media.id);
  });

  it('records why a build failed rather than leaving the job queued for ever', async () => {
    const asked = await exports.ask(OWNER, 'grow', GROW, NOW);
    jest.spyOn(media, 'fill').mockRejectedValueOnce(new Error('the disk is full'));

    await exports.drain();

    const row = await media.byId(asked.media.id);
    expect(row?.exportJob).toMatchObject({ status: 'failed', error: 'the disk is full' });
    expect(row?.exportJob?.endedAt).toBeInstanceOf(Date);
  });

  // The half of a failed write that arrives as an event on the stream rather
  // than at the writer waiting on it. Nothing listened for that one, so a full
  // disk under one grower's export ended the process and every other request
  // with it; it belongs on the job, like every other reason a build failed.
  it('keeps a failed write on the job rather than letting it end the server', async () => {
    const asked = await exports.ask(OWNER, 'grow', GROW, NOW);
    writeFails = new Error('ENOSPC: no space left on device');

    await exports.drain();

    const row = await media.byId(asked.media.id);
    expect(row?.exportJob).toMatchObject({ status: 'failed', error: 'ENOSPC: no space left on device' });
    expect(row?.bytes).toBe(0);
    // The API is still there to answer the next person.
    await expect(exports.ask(STRANGER, 'account', null, NOW)).resolves.toMatchObject({ queued: true });
  });

  it('waits on a build that is running and starts a new one where the build died', async () => {
    const asked = await exports.ask(OWNER, 'grow', GROW, NOW);
    const renderingSince = (startedAt: Date) =>
      media.setExportJob(asked.media.id, { status: 'rendering', scope: 'grow', growId: GROW, startedAt, endedAt: null, error: null });

    await renderingSince(new Date(NOW.getTime() - 60 * 1000));
    expect(await exports.ask(OWNER, 'grow', GROW, NOW)).toMatchObject({ queued: false, media: { id: asked.media.id } });

    // Nothing is writing this one any more: the server that was went down an
    // hour ago and left the row saying it was.
    await renderingSince(new Date(NOW.getTime() - 60 * 60 * 1000));
    const again = await exports.ask(OWNER, 'grow', GROW, NOW);
    expect(again.queued).toBe(true);
    expect(again.media.id).not.toBe(asked.media.id);
  });

  it('builds an abandoned job again on the next pass rather than waiting to be asked', async () => {
    const asked = await exports.ask(OWNER, 'grow', GROW, NOW);
    await media.setExportJob(asked.media.id, {
      status: 'rendering',
      scope: 'grow',
      growId: GROW,
      startedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      endedAt: null,
      error: null,
    });

    await exports.drain();

    const row = await media.byId(asked.media.id);
    expect(row?.exportJob?.status).toBe('ready');
    expect(row?.bytes).toBeGreaterThan(0);
  });
});

describe('what is in the zip', () => {
  it('holds the grow, its plants, its diary, its readings, its climate and its pictures', async () => {
    const asked = await exports.ask(OWNER, 'grow', GROW, NOW);
    await exports.drain();

    const row = await media.byId(asked.media.id);
    expect(row?.exportJob?.status).toBe('ready');
    expect(row?.bytes).toBeGreaterThan(0);

    const files = await archiveOf(asked.media.id);
    const photo = `photos/${PHOTO_TAKEN.toISOString().slice(0, 10)}-${(await db.media.findOne({ kind: 'photo' }).lean())!.id}.jpg`;
    expect([...files.keys()].sort()).toEqual(['climate.csv', 'diary.csv', 'grow.csv', 'measurements.csv', photo, 'plants.csv'].sort());

    expect(files.get('measurements.csv')!.toString('utf8')).toContain('height,Height,cm,21,Amnesia 1');
    expect(files.get('plants.csv')!.toString('utf8')).toContain('Amnesia 1,Amnesia,active');
    expect(files.get('climate.csv')!.toString('utf8')).toContain(',device-controller,23.5');
    expect(files.get(photo)!.toString('utf8')).toBe('not really a jpeg, but bytes all the same');
  });

  it('quotes a diary line that carries commas and quotes of its own', async () => {
    const asked = await exports.ask(OWNER, 'grow', GROW, NOW);
    await exports.drain();

    const diary = (await archiveOf(asked.media.id)).get('diary.csv')!.toString('utf8');
    expect(diary).toContain('"Topped, ""hard"", above node 5"');
    // The line written in the tent belongs to no grow and is in the account's
    // export rather than in this one.
    expect(diary).not.toContain('entry-in-the-tent');
  });

  it('leaves out a picture whose bytes are gone, and says which', async () => {
    const picture = (await db.media.findOne({ kind: 'photo' }).lean())!;
    await store.delete([picture.id]);

    const asked = await exports.ask(OWNER, 'grow', GROW, NOW);
    await exports.drain();

    // One unreadable photo is one photo missing, not a season lost.
    expect((await media.byId(asked.media.id))?.exportJob?.status).toBe('ready');
    const files = await archiveOf(asked.media.id);
    expect([...files.keys()].sort()).toEqual(['climate.csv', 'diary.csv', 'grow.csv', 'measurements.csv', 'photos/missing.csv', 'plants.csv'].sort());
    expect(files.get('photos/missing.csv')!.toString('utf8')).toContain(picture.id);
  });

  (canUnzip ? it : it.skip)("opens in a reader that shares none of the writer's assumptions", async () => {
    const asked = await exports.ask(OWNER, 'grow', GROW, NOW);
    await exports.drain();

    const directory = await mkdtemp(join(tmpdir(), 'export-spec-'));
    const file = join(directory, 'export.zip');
    try {
      await writeFile(file, await media.download(asked.media.id));
      execFileSync('unzip', ['-t', file], { stdio: 'ignore' });

      const listed = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
      expect(listed.sort()).toEqual([...(await archiveOf(asked.media.id)).keys()].sort());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('exports the whole account as its own rows and a folder per grow', async () => {
    const asked = await exports.ask(OWNER, 'account', null, NOW);
    await exports.drain();

    const files = await archiveOf(asked.media.id);
    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        'account.json',
        'account.csv',
        'spaces.csv',
        'devices.csv',
        'cameras.csv',
        'alarms.csv',
        'alerts.csv',
        'tasks.csv',
        'plans.csv',
        'diary.csv',
        `climate/${CONTROLLER}.csv`,
        'grows/spring-run-3/diary.csv',
        'grows/spring-run-3/climate.csv',
      ]),
    );
    expect(files.get('account.csv')!.toString('utf8')).toContain('owner,owner@test.invalid');
    expect(files.get('diary.csv')!.toString('utf8')).toContain('entry-in-the-tent');
    expect(files.get('grows/spring-run-3/diary.csv')!.toString('utf8')).toContain('entry-measure');
  });

  it('hands over everything the privacy screen promises: the settings, the hardware, the alarms, the tasks and the plans', async () => {
    const asked = await exports.ask(OWNER, 'account', null, NOW);
    await exports.drain();

    const files = await archiveOf(asked.media.id);

    // The settings are JSON because they are nested, and the two secrets of an
    // account are in none of it.
    const settings = JSON.parse(files.get('account.json')!.toString('utf8'));
    expect(settings).toMatchObject({ handle: 'owner', email: 'owner@test.invalid', privacy: { hideWeights: false }, retention: {} });
    expect(files.get('account.json')!.toString('utf8')).not.toContain('passwordHash');
    expect(files.get('account.json')!.toString('utf8')).not.toContain('activationCode');

    expect(files.get('spaces.csv')!.toString('utf8')).toContain('Tent 1,tent');
    // A tent says who it is shared with, which is half of what a tent is now.
    expect(files.get('spaces.csv')!.toString('utf8')).toContain('mia');
    expect(files.get('cameras.csv')!.toString('utf8')).toContain('Tent cam,terpcam_controller');
    expect(files.get('alarms.csv')!.toString('utf8')).toContain('Too warm,');
    expect(files.get('alarms.csv')!.toString('utf8')).toContain('reading,temperature,,,30');
    expect(files.get('alerts.csv')!.toString('utf8')).toContain('threshold,critical');
    expect(files.get('tasks.csv')!.toString('utf8')).toContain('Water,water,Tent 1,3');
    expect(files.get('plans.csv')!.toString('utf8')).toContain('Spring plan,');
    expect(files.get('plans.csv')!.toString('utf8')).toContain('Stretch,vegetative,,2 weeks');
    // A device that never belonged to a grow would otherwise have no climate
    // anywhere in the archive.
    expect(files.get(`climate/${CONTROLLER}.csv`)!.toString('utf8')).toContain(`,${CONTROLLER},23.5`);
  });

  /**
   * The films were the half of "export everything" that was in no export at
   * all: a film belongs to its camera, and every query the builder had asked
   * for pictures by grow.
   */
  it('carries every finished film of every camera the account owns, and none of a stranger´s', async () => {
    const asked = await exports.ask(OWNER, 'account', null, NOW);
    await exports.drain();

    const files = await archiveOf(asked.media.id);
    const films = [...files.keys()].filter(name => name.startsWith('films/'));

    expect(films).toHaveLength(1);
    expect(files.get(films[0])!.toString('utf8')).toBe('the week of it, as a film');
    // A film still waiting for the composer has no bytes behind it, so it is
    // not a file; and a stranger's is not this account's to be handed.
    expect([...files.values()].map(body => body.toString('utf8'))).not.toContain('their week, as a film');
  });

  /**
   * The stills are the one thing the zip cannot carry, so it says so in a
   * figure rather than by their absence. A grower counting their pictures back
   * is owed the difference, which is the rule the missing list already follows.
   */
  it('counts the single stills it does not carry, per camera, and says why in the zip itself', async () => {
    const asked = await exports.ask(OWNER, 'account', null, NOW);
    await exports.drain();

    const files = await archiveOf(asked.media.id);
    const stills = files.get('stills.csv')!.toString('utf8');

    expect(stills).toContain('Tent cam,2,');
    expect(stills).not.toContain('Their cam');
    expect(files.get('README.txt')!.toString('utf8')).toContain('stills.csv');

    // The bytes of a still stay in the app, which is what the figure is about.
    expect([...files.values()].map(body => body.toString('utf8'))).not.toContain('a still');
  });

  it('holds nothing of anybody else´s, however much of it sits in the same database', async () => {
    const asked = await exports.ask(OWNER, 'account', null, NOW);
    await exports.drain();

    const files = await archiveOf(asked.media.id);
    const everything = [...files.entries()].map(([name, body]) => `${name}\n${body.toString('utf8')}`).join('\n');

    // A stranger's grow, their tent and their camera are each one query away
    // from this account's own, and the boundary is ownership rather than
    // reach.
    expect([...files.keys()].filter(name => name.startsWith('grows/'))).toEqual(expect.not.arrayContaining([expect.stringContaining('their-run')]));
    expect(everything).not.toContain('grow-theirs');
    expect(everything).not.toContain('Their tent');
    expect(everything).not.toContain('camera-theirs');
    expect(everything).not.toContain('Their cam');
  });

  it('is not widened by a membership: what this account may manage is not what it owns', async () => {
    // The member may read, log in and manage the owner's tent and everything
    // standing in it, and owns none of it.
    const asked = await exports.ask(MEMBER, 'account', null, NOW);
    await exports.drain();

    const files = await archiveOf(asked.media.id);
    const everything = [...files.entries()].map(([name, body]) => `${name}\n${body.toString('utf8')}`).join('\n');

    expect(files.get('account.json')!.toString('utf8')).toContain('member@test.invalid');
    expect([...files.keys()].filter(name => name.startsWith('grows/'))).toEqual([]);
    expect(everything).not.toContain('Tent 1');
    expect(everything).not.toContain('Tent cam');
    expect(everything).not.toContain('Spring plan');
    // Not even the line the member wrote themselves in somebody else's tent:
    // it is on the owner's timeline, and the owner is who exports it.
    expect(everything).not.toContain('entry-in-the-tent');
  });
});

describe('whose export it is', () => {
  it('is readable by the account that asked for it', async () => {
    const asked = await exports.ask(OWNER, 'grow', GROW, NOW);

    await expect(access.access(session(OWNER), subjectRef('media', asked.media.id), 'view')).resolves.toMatchObject({ grantee: 'owner' });
  });

  it('tells a member, a stranger, a link holder and a demo session nothing, not even that it exists', async () => {
    const asked = await exports.ask(OWNER, 'grow', GROW, NOW);
    const subject = subjectRef('media', asked.media.id);

    // The member may manage the grow and the link reaches every picture of it;
    // an export is neither the grow's nor a picture of it.
    await expect(access.access(session(MEMBER), subject, 'view')).resolves.toBeNull();
    await expect(access.access(session(STRANGER), subject, 'view')).resolves.toBeNull();
    await expect(access.access(visitor('a-week-of-it'), subject, 'view')).resolves.toBeNull();
    await expect(access.access(demo(), subject, 'view')).resolves.toBeNull();
  });

  it('is found only by the account that asked for it, so one job id says nothing about another', async () => {
    await exports.ask(OWNER, 'grow', GROW, NOW);

    const asStranger = await exports.ask(STRANGER, 'grow', GROW, NOW);
    expect(asStranger.queued).toBe(true);
    expect(await db.media.countDocuments({ kind: 'export' })).toBe(2);
  });
});
