import { jest } from '@jest/globals';
import { crc32, inflateRawSync } from 'node:zlib';
import type { DeviceSeries } from '@fg2/shared-types/v1';
import { media as mediaShape } from '@fg2/shared-types/v1-schemas';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext } from '@common/v1/access.types';
import { ImageStore } from '@database/image-store';
import { DataService, SeriesRequest } from '@modules/data/data.service';
import { MediaService } from '@modules/v1/camera/media.service';
import { ExportService } from '@modules/v1/grow/export.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * Exporting: the job, the zip it leaves behind, and the fact that the zip is
 * nobody's but the person who asked for it.
 *
 * The archive is read back here rather than taken on trust. It is written by
 * hand - there is no zip library in this server - so the spec walks the central
 * directory, inflates what was deflated and checks the checksum the archive
 * claims against the bytes that come out. A reader that disagreed with the
 * writer would otherwise only be discovered by a grower whose export will not
 * open.
 */

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';

const TENT = 'tent-1';
const CONTROLLER = 'device-controller';
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
let media: MediaService;
let exports: ExportService;

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
    measurements: [{ key: 'height', name: 'Height', unit: 'cm', perPlant: true, target: null, chart: true }],
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
};

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

afterEach(() => {
  // The builder wakes itself when an export is asked for; a spec that left that
  // timer behind would keep the run open after its last assertion.
  exports.onApplicationShutdown();
});

beforeEach(async () => {
  await db.reset();
  access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  media = new MediaService(db.media, new ImageStore(db.connection));
  exports = new ExportService(db.grows, db.plants, db.entries, db.spaces, db.devices, db.users, media, fakeData);
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

  it('exports the whole account as its own rows and a folder per grow', async () => {
    const asked = await exports.ask(OWNER, 'account', null, NOW);
    await exports.drain();

    const files = await archiveOf(asked.media.id);
    expect([...files.keys()]).toEqual(
      expect.arrayContaining([
        'account.csv',
        'spaces.csv',
        'devices.csv',
        'diary.csv',
        'grows/spring-run-3/diary.csv',
        'grows/spring-run-3/climate.csv',
      ]),
    );
    expect(files.get('account.csv')!.toString('utf8')).toContain('owner,owner@test.invalid');
    expect(files.get('diary.csv')!.toString('utf8')).toContain('entry-in-the-tent');
    expect(files.get('grows/spring-run-3/diary.csv')!.toString('utf8')).toContain('entry-measure');
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
