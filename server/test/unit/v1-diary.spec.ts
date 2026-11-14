import type { DeviceSeries, Metric, OutputMetric, SeriesPoint } from '@fg2/shared-types/v1';
import { AccessService } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { ProblemException } from '@common/v1/problem';
import { DataService, DeviceHistory } from '@modules/data/data.service';
import { EntriesService } from '@modules/v1/diary/entries.service';
import { GrowClimateService } from '@modules/v1/diary/grow-climate.service';
import { GrowReportService } from '@modules/v1/diary/report.service';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { anonymous, session, visitor } from './support/callers';
import { accessOn, growsOn } from './support/services';
import { useV1TestDatabase } from './support/v1-database';
import { standingIn } from './support/placed';

/**
 * Reading the diary: the timeline, and the report that tells a grow as
 * chapters. The diary by the day has a suite of its own (`v1-grow-diary`).
 *
 * Three things can go wrong and each is checked on its own. The arithmetic - a
 * chapter's day range, the day and night averages, the hours of light - is
 * checked against fixed dates and canned points, because nobody can see a day
 * counted wrongly in the data.
 * Who may read what is checked through `access()` for every kind of caller,
 * because a list that decided per row is how a second page hands out somebody
 * else's tent. And what is hidden is checked through the serialiser, because a
 * weight stripped from the grow screen and not from the timeline is still out.
 *
 * The world is one tent with a controller and a camera, a grow that has been
 * through three phases, a second grow in a second tent that nothing here should
 * ever reach, and the four kinds of caller.
 */

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';

const TENT = 'space-tent';
const OTHER_TENT = 'space-other';
const CONTROLLER = 'device-controller';
const PLUG = 'device-plug';
const CAMERA = 'camera-1';
const GROW = 'grow-spring';
const OTHER_GROW = 'grow-other';
const PLANT = 'plant-1';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Day 1 begins here, so day 34 is 10 June and week 5 is days 29 to 35 - the grow the screens were drawn from. */
const ORIGIN = new Date('2026-05-08T08:00:00.000Z');
const NOW = new Date('2026-06-10T12:00:00.000Z');

const onDay = (dayNumber: number, hours = 10): Date => new Date(ORIGIN.getTime() + (dayNumber - 1) * DAY_MS + hours * 3600 * 1000);

const db = useV1TestDatabase();
let entries: EntriesService;
let report: GrowReportService;
let access: AccessService;

/** What the fake store answers with. A test that cares about the climate replaces it. */
let canned: (deviceId: string, startsAt: Date, endsAt: Date) => { temperature: number; humidity: number; co2: number | null };

/** Which devices were read, and over which windows: the cost of an answer is part of what is asserted. */
let readWindows: { deviceId: string; startsAt: Date; endsAt: Date }[];

const STEP_SECONDS = 900;
const WINDOWS_PER_DAY = DAY_MS / 1000 / STEP_SECONDS;

interface FakeRequest {
  startsAt: Date;
  endsAt: Date;
  metrics: readonly Metric[];
  outputs?: readonly OutputMetric[];
}

/** Which windows a stretch is made of, and which half of the cycle each of them is in. */
const windowsIn = (request: FakeRequest): { startsAt: number; isDay: boolean }[] => {
  const count = Math.max(0, Math.round((request.endsAt.getTime() - request.startsAt.getTime()) / 1000 / STEP_SECONDS));

  return Array.from({ length: count }, (_, index) => ({
    startsAt: request.startsAt.getTime() + index * STEP_SECONDS * 1000,
    isDay: index % WINDOWS_PER_DAY < WINDOWS_PER_DAY / 2,
  }));
};

/**
 * A controller that runs twelve hours of light a day: the first half of every
 * day lit and the second dark, measured every fifteen minutes. That is what
 * makes the day and the night halves of the answer two different figures.
 *
 * The two answers are stamped the way the store stamps them: an aggregated
 * window carries the instant it ends at, and a switching the instant its state
 * began. Whatever reads them has to lay one over the other, so a fake that
 * stamped both alike would hide the one mistake worth making here.
 */
const fakeData = {
  series: async (deviceId: string, request: FakeRequest) => {
    readWindows.push({ deviceId, startsAt: request.startsAt, endsAt: request.endsAt });

    const points = (value: (isDay: boolean) => number | null): SeriesPoint[] =>
      windowsIn(request).map(window => ({
        measuredAt: new Date(window.startsAt + STEP_SECONDS * 1000).toISOString(),
        value: value(window.isDay),
      }));

    const reading = canned(deviceId, request.startsAt, request.endsAt);

    return {
      deviceId,
      startsAt: request.startsAt.toISOString(),
      endsAt: request.endsAt.toISOString(),
      stepSeconds: STEP_SECONDS,
      metrics: request.metrics.map(metric => ({
        metric,
        points: points(isDay => {
          if (metric === 'temperature') return isDay ? reading.temperature : reading.temperature - 4.4;
          if (metric === 'humidity') return reading.humidity;
          return metric === 'co2' ? reading.co2 : null;
        }),
      })),
      outputs: (request.outputs ?? []).map(output => ({ output, points: points(isDay => (isDay ? 1 : 0)) })),
    } as DeviceSeries;
  },

  history: async (deviceId: string, request: FakeRequest): Promise<DeviceHistory> => ({
    series: await fakeData.series(deviceId, request),
    outputs: (request.outputs ?? []).map(output => ({
      output,
      switchings: windowsIn(request).flatMap((window, index, all) =>
        index === 0 || window.isDay !== all[index - 1].isDay ? [{ at: new Date(window.startsAt).toISOString(), on: window.isDay }] : [],
      ),
    })),
    // What the store answers for when the device last spoke; the fake is heard
    // to the end of the window it was asked about.
    lastSampleAt: new Date(request.endsAt).toISOString(),
  }),
} as unknown as DataService;

const build = (): void => {
  access = accessOn(db);
  const grows = growsOn(db, access);
  const climate = new GrowClimateService(db.devices, db.targetChanges, fakeData);

  entries = new EntriesService(db.entries, db.devices, access, grows);
  report = new GrowReportService(db.entries, db.cameras, db.media, db.users, grows, climate);
};

const entry = (over: Partial<EntryDocument>): EntryDocument =>
  ({
    id: `entry-${Math.random()}`,
    createdAt: NOW,
    kind: 'note',
    occurredAt: NOW,
    source: 'human',
    authorId: OWNER,
    growId: null,
    spaceId: null,
    deviceId: null,
    plantIds: [],
    cameraId: null,
    taskId: null,
    alertId: null,
    severity: null,
    text: null,
    message: null,
    values: { kind: 'note' },
    mediaIds: [],
    undoUntil: null,
    ...over,
  }) as EntryDocument;

const phase = (id: string, stage: string, dayNumber: number, over: Record<string, unknown> = {}) => ({
  id,
  stage,
  preset: null,
  startedAt: onDay(dayNumber, 0),
  source: 'human',
  plantIds: null,
  deviceId: CONTROLLER,
  targets: { day: { temperature: 25, humidity: 55 }, night: { temperature: 20, humidity: 56 }, co2: null },
  setBy: OWNER,
  ...over,
});

const world = async (): Promise<void> => {
  await db.users.create([
    { id: OWNER, email: 'owner@test.invalid', handle: 'owner', passwordHash: 'x' },
    { id: MEMBER, email: 'member@test.invalid', handle: 'mia', passwordHash: 'x' },
    { id: STRANGER, email: 'stranger@test.invalid', handle: 'greenthumb', passwordHash: 'x' },
  ]);

  await db.spaces.create([
    { id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent 1', roomId: null },
    { id: OTHER_TENT, ownerId: STRANGER, kind: 'tent', name: 'Someone else', roomId: null },
  ]);
  await db.memberships.create({ id: 'membership-1', spaceId: TENT, userId: MEMBER, role: 'can_log' });

  await db.devices.create([
    {
      id: CONTROLLER,
      type: 'controller',
      ownerId: OWNER,
      ...standingIn(TENT),
      configuration: { day: { temperature: 25 }, night: { temperature: 20 } },
    },
    // A plug measures and steers nothing, so it is not read for a week's climate.
    { id: PLUG, type: 'plug', ownerId: OWNER, ...standingIn(TENT), configuration: null },
  ]);
  await db.cameras.create({ id: CAMERA, ownerId: OWNER, kind: 'terpcam_controller', deviceId: CONTROLLER, spaceId: TENT, name: 'Cam 1' });

  await db.grows.create([
    {
      id: GROW,
      ownerId: OWNER,
      name: 'Spring run #3',
      type: 'photoperiod',
      phases: [phase('phase-seedling', 'seedling', 1), phase('phase-veg', 'vegetative', 8), phase('phase-flower', 'flowering', 23)],
      placements: [{ id: 'placement-1', spaceId: TENT, startedAt: ORIGIN, endedAt: null, plantIds: null }],
      scheme: {
        origin: { type: 'asset', assetId: 'biobizz', version: '1' },
        strength: 1,
        waterEc: null,
        plantType: 'soil',
        flipWeek: 4,
        edited: false,
        grid: [{ week: 5, stage: 'flowering', amounts: [{ productKey: 'bio-bloom', name: 'Bio·Bloom', value: 2, unit: 'ml/l' }] }],
      },
      measurements: [
        { key: 'height', name: 'Height', unit: 'cm', perPlant: false, targetMin: null, targetMax: null, chart: true },
        { key: 'ph', name: 'pH', unit: '', perPlant: false, targetMin: null, targetMax: null, chart: true },
      ],
      slug: 'spring-run-3',
      startedAt: ORIGIN,
      endedAt: null,
    },
    {
      id: OTHER_GROW,
      ownerId: STRANGER,
      name: 'Not yours',
      type: 'photoperiod',
      phases: [phase('phase-other', 'vegetative', 1, { deviceId: null })],
      placements: [{ id: 'placement-2', spaceId: OTHER_TENT, startedAt: ORIGIN, endedAt: null, plantIds: null }],
      slug: 'not-yours',
      startedAt: ORIGIN,
      endedAt: null,
    },
  ]);
  await db.plants.create([
    { id: PLANT, growId: GROW, strain: 'Amnesia', label: 'Amnesia 1', status: 'active', createdAt: ORIGIN },
    { id: 'plant-2', growId: GROW, strain: 'Gelato', label: 'Gelato 1', status: 'active', createdAt: new Date(ORIGIN.getTime() + 1) },
  ]);

  await db.entries.create([
    // Week 5: what the card draws.
    entry({ id: 'entry-defoliated', growId: GROW, kind: 'training', occurredAt: onDay(33), text: 'Defoliated lower fan leaves' }),
    entry({
      id: 'entry-watered',
      growId: GROW,
      kind: 'water',
      authorId: MEMBER,
      occurredAt: onDay(32),
      values: { kind: 'water', litres: 4, readings: [{ key: 'height', value: 58, plantId: null }] },
    }),
    entry({ id: 'entry-note-5', growId: GROW, occurredAt: onDay(31), text: 'Smells good' }),
    entry({
      id: 'entry-fed',
      growId: GROW,
      kind: 'feed',
      occurredAt: onDay(30),
      values: { kind: 'feed', litres: 4, schemeWeek: 5, doses: [], readings: [] },
    }),
    // A device's own line, which the diary does not show by default.
    entry({
      id: 'entry-booted',
      growId: GROW,
      spaceId: TENT,
      deviceId: CONTROLLER,
      kind: 'system',
      source: 'device',
      authorId: null,
      occurredAt: onDay(30),
    }),
    // Week 4: the reading this week's height is measured against.
    entry({
      id: 'entry-measured',
      growId: GROW,
      kind: 'measurement',
      occurredAt: onDay(25),
      plantIds: [PLANT],
      values: { kind: 'measurement', readings: [{ key: 'height', value: 52, plantId: PLANT }] },
    }),
    // Week 2, in the vegetative phase.
    entry({ id: 'entry-topped', growId: GROW, kind: 'training', occurredAt: onDay(12), text: 'Topped' }),
    entry({ id: 'entry-watered-veg', growId: GROW, kind: 'water', occurredAt: onDay(10), values: { kind: 'water', litres: 3, readings: [] } }),
    // In the tent but not of the grow: a line of the space itself and one of a device standing in it.
    entry({ id: 'entry-space', spaceId: TENT, kind: 'note', occurredAt: onDay(29), text: 'Wiped the walls' }),
    entry({ id: 'entry-device', deviceId: PLUG, kind: 'system', source: 'device', authorId: null, occurredAt: onDay(28) }),
    // Somebody else's tent entirely.
    entry({ id: 'entry-stranger', growId: OTHER_GROW, spaceId: OTHER_TENT, kind: 'note', occurredAt: onDay(33), text: 'Not yours' }),
  ]);
};

beforeEach(async () => {
  await db.reset();
  readWindows = [];
  canned = () => ({ temperature: 25, humidity: 54, co2: null });
  build();
  await world();
});

const grantFor = async (ctx: AccessContext, growId = GROW): Promise<Grant> => {
  const grant = await access.access(ctx, { type: 'grow', id: growId }, 'view');
  if (!grant) throw new Error('refused');

  return grant;
};

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

describe('the timeline', () => {
  it('is about exactly one thing, and refuses to be about none or several', async () => {
    await expect(entries.list(session(OWNER), {})).rejects.toThrow(ProblemException);
    await expect(entries.list(session(OWNER), { growId: GROW, spaceId: TENT })).rejects.toThrow(ProblemException);
  });

  it('answers a grow´s diary newest first, a device´s line included', async () => {
    const page = await entries.list(session(OWNER), { growId: GROW });

    expect(page.items.map(line => line.id)).toEqual([
      'entry-defoliated',
      'entry-watered',
      'entry-note-5',
      'entry-fed',
      'entry-booted',
      'entry-measured',
      'entry-topped',
      'entry-watered-veg',
    ]);
  });

  it('takes the lines of the devices standing in a space into the space´s own', async () => {
    const page = await entries.list(session(OWNER), { spaceId: TENT });

    expect(page.items.map(line => line.id)).toEqual(['entry-booted', 'entry-space', 'entry-device']);
  });

  it('answers one device´s log and one plant´s history', async () => {
    expect((await entries.list(session(OWNER), { deviceId: PLUG })).items.map(line => line.id)).toEqual(['entry-device']);
    expect((await entries.list(session(OWNER), { plantId: PLANT })).items.map(line => line.id)).toEqual(['entry-measured']);
  });

  it('filters by kind, and refuses a kind that is not one', async () => {
    const page = await entries.list(session(OWNER), { growId: GROW, kinds: 'water,feed' });

    expect(page.items.map(line => line.id)).toEqual(['entry-watered', 'entry-fed', 'entry-watered-veg']);
    await expect(entries.list(session(OWNER), { growId: GROW, kinds: 'gardening' })).rejects.toThrow(ProblemException);
  });

  it('narrows to the range asked for, both ends inside', async () => {
    const page = await entries.list(session(OWNER), { growId: GROW, startsAt: onDay(30).toISOString(), endsAt: onDay(32).toISOString() });

    expect(page.items.map(line => line.id)).toEqual(['entry-watered', 'entry-note-5', 'entry-fed', 'entry-booted']);
  });

  it('continues after the cursor it handed out rather than starting again', async () => {
    const first = await entries.list(session(OWNER), { growId: GROW, limit: 3 });
    const second = await entries.list(session(OWNER), { growId: GROW, limit: 3, cursor: first.nextCursor ?? undefined });

    expect(first.items.map(line => line.id)).toEqual(['entry-defoliated', 'entry-watered', 'entry-note-5']);
    expect(second.items.map(line => line.id)).toEqual(['entry-fed', 'entry-booted', 'entry-measured']);
  });

  /**
   * The rule a second page is where it breaks: the scope of a space is an `$or`
   * and so is the cursor, and merging them would let the cursor replace the
   * scope - which reads right on the first page and hands out everything on the
   * second.
   */
  it('keeps a second page of a space inside that space', async () => {
    const first = await entries.list(session(OWNER), { spaceId: TENT, limit: 1 });
    const second = await entries.list(session(OWNER), { spaceId: TENT, limit: 10, cursor: first.nextCursor ?? undefined });

    expect(second.items.map(line => line.id)).toEqual(['entry-space', 'entry-device']);
    expect(second.items.map(line => line.id)).not.toContain('entry-stranger');
  });
});

describe('who may read a timeline', () => {
  it('answers the owner and a member of the space it stands in', async () => {
    expect((await entries.list(session(OWNER), { growId: GROW })).items.length).toBeGreaterThan(0);
    expect((await entries.list(session(MEMBER), { growId: GROW })).items.length).toBeGreaterThan(0);
  });

  it('tells a stranger there is no such grow rather than refusing them', async () => {
    await expect(entries.list(session(STRANGER), { growId: GROW })).rejects.toMatchObject({ problem: { status: 404 } });
    await expect(entries.list(anonymous, { growId: GROW })).rejects.toMatchObject({ problem: { status: 404 } });
  });

  it('answers a public grow to anybody, for as long as it ran', async () => {
    await db.grows.updateOne({ id: GROW }, { $set: { visibility: 'public', endedAt: onDay(30, 0) } });

    const page = await entries.list(anonymous, { growId: GROW });

    // The grow ended on day 30, and a public read reaches no further.
    expect(page.items.map(line => line.id)).toEqual(['entry-measured', 'entry-topped', 'entry-watered-veg']);
  });

  it('clamps a share link to the window it was made with, whatever is asked for', async () => {
    await db.shareLinks.create({
      id: 'share-1',
      token: 'the-token',
      kind: 'view',
      subject: { type: 'grow', id: GROW },
      range: { startsAt: onDay(29, 0), endsAt: onDay(32, 0) },
      includeCameras: false,
      createdBy: OWNER,
      expiresAt: null,
      revokedAt: null,
    });

    const reader = visitor('the-token');
    const page = await entries.list(reader, { growId: GROW, startsAt: ORIGIN.toISOString() });

    // What people wrote in the window. The line the controller wrote when it restarted is whoever keeps the tent's.
    expect(page.items.map(line => line.id)).toEqual(['entry-note-5', 'entry-fed']);
    await expect(entries.read(reader, 'entry-booted')).rejects.toMatchObject({ problem: { status: 404, code: 'entry_not_found' } });
    expect((await entries.read(reader, 'entry-fed')).id).toBe('entry-fed');
  });

  it('does not point a link that carries no pictures at the camera a line was about', async () => {
    await db.entries.create(entry({ id: 'entry-cam', growId: GROW, cameraId: CAMERA, occurredAt: onDay(30, 1) }));
    await db.shareLinks.create({
      id: 'share-2',
      token: 'no-pictures',
      kind: 'view',
      subject: { type: 'grow', id: GROW },
      range: { startsAt: null, endsAt: null },
      includeCameras: false,
      createdBy: OWNER,
      expiresAt: null,
      revokedAt: null,
    });

    const seen = await entries.list({ ...anonymous, shareToken: 'no-pictures' }, { growId: GROW });
    const own = await entries.list(session(OWNER), { growId: GROW });

    expect(seen.items.find(line => line.id === 'entry-cam')?.cameraId).toBeNull();
    expect(own.items.find(line => line.id === 'entry-cam')?.cameraId).toBe(CAMERA);
  });

  it('strips the weights from a reader the owner hides them from, and names the plants all the same', async () => {
    await db.users.updateOne({ id: OWNER }, { $set: { privacy: { hideWeights: true, hideCounts: true } } });
    await db.grows.updateOne({ id: GROW }, { $set: { visibility: 'public' } });
    await db.entries.create(
      entry({
        id: 'entry-harvest',
        growId: GROW,
        kind: 'harvest',
        plantIds: [PLANT],
        occurredAt: onDay(34),
        values: { kind: 'harvest', wetWeightG: 480, dryWeightG: 96 },
      }),
    );

    const seen = (await entries.list(anonymous, { growId: GROW })).items.find(line => line.id === 'entry-harvest');
    const own = (await entries.list(session(OWNER), { growId: GROW })).items.find(line => line.id === 'entry-harvest');

    // The counts switch hides how many plants there are, not which one a line is about.
    expect(seen).toMatchObject({ plantIds: [PLANT], values: { kind: 'harvest', wetWeightG: null, dryWeightG: null } });
    expect(own).toMatchObject({ plantIds: [PLANT], values: { kind: 'harvest', wetWeightG: 480, dryWeightG: 96 } });
  });

  it('names the plant a reading is of where the owner hides the counts, as the line names its plants', async () => {
    await db.users.updateOne({ id: OWNER }, { $set: { privacy: { hideWeights: false, hideCounts: true } } });
    await db.grows.updateOne({ id: GROW }, { $set: { visibility: 'public' } });

    const seen = (await entries.list(anonymous, { growId: GROW })).items.find(line => line.id === 'entry-measured');

    expect(seen).toMatchObject({ plantIds: [PLANT], values: { kind: 'measurement', readings: [{ key: 'height', value: 52, plantId: PLANT }] } });
  });

  it('does not spell out to a reader from outside which places a move went between', async () => {
    await db.grows.updateOne({ id: GROW }, { $set: { visibility: 'public' } });
    await db.entries.create(
      entry({
        id: 'entry-moved',
        growId: GROW,
        kind: 'move',
        occurredAt: onDay(20),
        values: { kind: 'move', placementId: 'placement-2', spaceId: null, from: 'Cellar tent', to: null },
      }),
    );

    const seen = (await entries.list(anonymous, { growId: GROW })).items.find(line => line.id === 'entry-moved');
    const own = (await entries.list(session(OWNER), { growId: GROW })).items.find(line => line.id === 'entry-moved');

    expect(seen?.values).toEqual({ kind: 'move', placementId: 'placement-2', spaceId: null });
    expect(own?.values).toMatchObject({ from: 'Cellar tent', to: null });
  });

  /**
   * A grant reaches the grow and not each of its lines, so a link that was sent
   * one fortnight of a diary would otherwise hand out every other line of it
   * one id at a time - and the list next door has clamped since it was written.
   */
  it('is not there line by line either, where the line falls outside the window', async () => {
    await db.shareLinks.create({
      id: 'share-one-line',
      token: 'one-fortnight',
      kind: 'view',
      subject: { type: 'grow', id: GROW },
      range: { startsAt: onDay(29, 0), endsAt: onDay(32, 0) },
      includeCameras: false,
      createdBy: OWNER,
      expiresAt: null,
      revokedAt: null,
    });

    const reader = visitor('one-fortnight');

    expect((await entries.read(reader, 'entry-note-5')).id).toBe('entry-note-5');
    // Day 33 and day 12 are both this grow's and neither is inside the window.
    await expect(entries.read(reader, 'entry-defoliated')).rejects.toThrow(ProblemException);
    await expect(entries.read(reader, 'entry-topped')).rejects.toThrow(ProblemException);
    // The owner reads every one of them.
    expect((await entries.read(session(OWNER), 'entry-defoliated')).id).toBe('entry-defoliated');
  });
});

// ---------------------------------------------------------------------------
// The week cards
// ---------------------------------------------------------------------------

describe('the report', () => {
  it('is one chapter per phase of the whole grow, newest first, with its day range', async () => {
    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(answer.phases.map(chapter => [chapter.stage, chapter.dayFrom, chapter.dayTo])).toEqual([
      ['flowering', 23, null],
      ['vegetative', 8, 22],
      ['seedling', 1, 7],
    ]);
    expect(answer.phases[0].dayCount).toBe(12);
    expect(answer.dayCount).toBe(34);
  });

  it('gives the chapters day ranges that tile the grow, whatever hour of the day a phase began at', async () => {
    // A phase begins at whatever minute somebody pressed the button. A chapter
    // that ended on the day the next one started counted that day twice, and
    // six phases then added up to five days more than the grow they belonged to.
    await db.grows.updateOne({ id: GROW }, { $set: { 'phases.1.startedAt': onDay(8, -1), 'phases.2.startedAt': onDay(23, -1) } });

    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(answer.phases.map(chapter => [chapter.dayFrom, chapter.dayTo])).toEqual([
      [23, null],
      [8, 22],
      [1, 7],
    ]);
    expect(answer.phases.reduce((sum, chapter) => sum + chapter.dayCount, 0)).toBe(answer.dayCount);
  });

  it('leaves a split out of the chapters, because it is not what the grow did', async () => {
    await db.grows.updateOne({ id: GROW }, { $push: { phases: { ...phase('phase-drying', 'drying', 30), plantIds: [PLANT] } } });

    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(answer.phases.map(chapter => chapter.stage)).toEqual(['flowering', 'vegetative', 'seedling']);
  });

  it('says how much of a phase sat inside the band its targets set', async () => {
    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    // 25 by day against a target of 25 and 20.6 by night against 20, both
    // inside `TARGET_BAND`, and the humidity inside it in either half.
    expect(answer.phases[0].inBandPercent).toBe(100);

    canned = () => ({ temperature: 29, humidity: 54, co2: null });
    const hot = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    // Four degrees over by day and four and a half over by night: neither half is in.
    expect(hot.phases[0].inBandPercent).toBe(0);

    // The nights alone out of band is neither figure.
    canned = () => ({ temperature: 25, humidity: 70, co2: null });
    const humid = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(humid.phases[0].inBandPercent).toBe(0);
  });

  it('grades no phase that recorded no band, rather than against what the controller runs today', async () => {
    // Every phase of a migrated grow carries `targets: null`, and the fridge
    // they stood in is set for whatever is growing in it now. Judging a
    // January seedling week against a September flowering setpoint states a
    // verdict about how a tent was kept that is really about a number changed
    // last week, so such a phase says how it was kept and nothing about how
    // well.
    await db.grows.updateOne({ id: GROW }, { $set: { 'phases.$[each].targets': null } }, { arrayFilters: [{ 'each.id': { $exists: true } }] });

    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(answer.phases.map(chapter => chapter.inBandPercent)).toEqual([null, null, null]);
    // What it was kept at is still answered: only the grade goes.
    expect(answer.phases[0].climate.length).toBeGreaterThan(0);
  });

  it('grades no stage that is not steered, however the phase was recorded', async () => {
    // Curing happens in a jar. The app's own phase sheet says so when the stage
    // is picked, and a phase entered by hand still snapshots the tent it was
    // entered from - so without this a grow would be marked down for keeping
    // its jars off a flowering band.
    await db.grows.updateOne({ id: GROW }, { $push: { phases: phase('phase-curing', 'curing', 30) } });

    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);
    const curing = answer.phases.find(chapter => chapter.stage === 'curing');

    expect(curing?.inBandPercent).toBeNull();
    expect(answer.phases.find(chapter => chapter.stage === 'flowering')?.inBandPercent).toBe(100);
  });

  it('counts what was done to the plants in each chapter and carries the training itself', async () => {
    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);
    const [flowering, vegetative] = answer.phases;

    expect({ waterCount: flowering.waterCount, feedCount: flowering.feedCount }).toEqual({ waterCount: 1, feedCount: 1 });
    expect(flowering.training.map(line => line.text)).toEqual(['Defoliated lower fan leaves']);
    expect(vegetative.training.map(line => line.text)).toEqual(['Topped']);
  });

  it('says where the plants stood and shows the still nearest the middle of the chapter', async () => {
    await db.media.create({ id: 'still-cover', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: onDay(28, 4) });

    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(answer.phases[0].spaceIds).toEqual([TENT]);
    expect(answer.phases[0].coverMediaId).toBe('still-cover');
  });

  it('covers a chapter the camera saw only in the dark with a photo written into it', async () => {
    await db.media.create({ id: 'still-dark', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: onDay(28, 4), lit: false });
    const chapter = (await report.read(GROW, await grantFor(session(OWNER)), NOW)).phases[0];
    await db.entries.create({
      id: 'entry-photo',
      kind: 'photo',
      source: 'human',
      authorId: OWNER,
      growId: GROW,
      occurredAt: new Date(chapter.startedAt),
      mediaIds: ['photo-phone'],
      values: { kind: 'photo' },
    });

    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(answer.phases[0].coverMediaId).toBe('photo-phone');
  });

  it('says where the plants stood only to somebody who keeps them', async () => {
    await db.grows.updateOne({ id: GROW }, { $set: { visibility: 'public' } });

    const seen = await report.read(GROW, await grantFor(anonymous), NOW);

    expect(seen.phases.every(chapter => chapter.spaceIds === null)).toBe(true);
    expect(JSON.stringify(seen)).not.toContain(TENT);
  });

  it('covers a chapter with nothing where the link was not made to carry pictures', async () => {
    await db.media.create({ id: 'still-cover', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: onDay(28, 4) });
    await db.shareLinks.create({
      id: 'share-report',
      token: 'report-no-pictures',
      kind: 'view',
      subject: { type: 'grow', id: GROW },
      range: { startsAt: null, endsAt: null },
      includeCameras: false,
      createdBy: OWNER,
      expiresAt: null,
      revokedAt: null,
    });

    const seen = await report.read(GROW, await grantFor({ ...anonymous, shareToken: 'report-no-pictures' }), NOW);

    expect(seen.phases.every(chapter => chapter.coverMediaId === null)).toBe(true);
    expect(JSON.stringify(seen)).not.toContain('still-cover');
  });

  it('covers a chapter with a picture from inside the window and never from beyond it', async () => {
    await db.media.create([
      { id: 'still-inside', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: onDay(26, 2) },
      { id: 'still-beyond', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: onDay(28, 21.5) },
    ]);
    await db.shareLinks.create({
      id: 'share-report-window',
      token: 'report-until-day-28',
      kind: 'view',
      subject: { type: 'grow', id: GROW },
      range: { startsAt: null, endsAt: onDay(28, 12) },
      includeCameras: true,
      createdBy: OWNER,
      expiresAt: null,
      revokedAt: null,
    });

    // Each reader's cover is the still nearest the middle of the chapter as far
    // as they can see it. The owner's flowering chapter runs to today and its
    // middle falls late on day 28; through a link that closes at midday on day
    // 28 the same chapter is five days long and its middle is late on day 25, so
    // the two of them are covered by different pictures and a reader is never
    // handed one from outside their window to stand for their own weeks.
    const own = await report.read(GROW, await grantFor(session(OWNER)), NOW);
    const seen = await report.read(GROW, await grantFor({ ...anonymous, shareToken: 'report-until-day-28' }), NOW);

    expect(own.phases[0].coverMediaId).toBe('still-beyond');
    expect(seen.phases[0].coverMediaId).toBe('still-inside');
    expect(JSON.stringify(seen)).not.toContain('still-beyond');
  });

  it('counts the whole grow above the chapters, the device´s lines left out', async () => {
    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(answer.totals).toEqual({ entryCount: 7, waterCount: 2, feedCount: 1, photoCount: 0 });
  });

  it('counts the grower´s entries only: an alarm´s line is told by the diary and is no entry', async () => {
    await db.entries.create([
      entry({ id: 'entry-alarm', growId: GROW, kind: 'alarm', source: 'alarm', authorId: null, occurredAt: onDay(30), values: { kind: 'alarm' } }),
    ]);

    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(answer.totals.entryCount).toBe(7);
  });

  it('counts the pictures the diary carries, whatever kind of line is carrying them', async () => {
    await db.entries.create([
      entry({ id: 'entry-two-shots', growId: GROW, kind: 'note', occurredAt: onDay(31), text: 'The two in front', mediaIds: ['shot-a', 'shot-b'] }),
      entry({
        id: 'entry-watered-shot',
        growId: GROW,
        kind: 'water',
        occurredAt: onDay(30),
        values: { kind: 'water', litres: 2, readings: [] },
        mediaIds: ['shot-c'],
      }),
    ]);

    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(answer.totals.photoCount).toBe(3);
    expect(answer.totals.entryCount).toBe(9);
  });

  it('leaves a camera´s own picture out of the count for a reader who was not given the cameras', async () => {
    await db.entries.create(
      entry({
        id: 'entry-still-logged',
        growId: GROW,
        kind: 'photo',
        cameraId: CAMERA,
        occurredAt: onDay(31),
        values: { kind: 'photo' },
        mediaIds: ['still-logged'],
      }),
    );
    await db.shareLinks.create({
      id: 'share-report-counts',
      token: 'report-counts-no-pictures',
      kind: 'view',
      subject: { type: 'grow', id: GROW },
      range: { startsAt: null, endsAt: null },
      includeCameras: false,
      createdBy: OWNER,
      expiresAt: null,
      revokedAt: null,
    });

    const own = await report.read(GROW, await grantFor(session(OWNER)), NOW);
    const seen = await report.read(GROW, await grantFor({ ...anonymous, shareToken: 'report-counts-no-pictures' }), NOW);

    expect(own.totals.photoCount).toBe(1);
    expect(seen.totals.photoCount).toBe(0);
  });

  /** A harvest as the route writes it: the plants it cut with their shares, and its line with the totals typed in. */
  const harvested = async (
    plantIds: string[],
    day: number,
    wet: number,
    dry: number,
    shares = plantIds.map(() => [wet / plantIds.length, dry / plantIds.length]),
  ) => {
    for (const [index, plantId] of plantIds.entries()) {
      await db.plants.updateOne(
        { id: plantId },
        { $set: { status: 'harvested', harvest: { harvestedAt: onDay(day), wetWeightG: shares[index][0], dryWeightG: shares[index][1] } } },
      );
    }
    await db.entries.create(
      entry({ growId: GROW, kind: 'harvest', plantIds, occurredAt: onDay(day), values: { kind: 'harvest', wetWeightG: wet, dryWeightG: dry } }),
    );
  };

  it('adds the harvest up and strips the weights from a reader the owner hides them from', async () => {
    await harvested([PLANT], 34, 480, 96);
    await db.users.updateOne({ id: OWNER }, { $set: { privacy: { hideWeights: true, hideCounts: true } } });
    await db.grows.updateOne({ id: GROW }, { $set: { visibility: 'public' } });

    const own = await report.read(GROW, await grantFor(session(OWNER)), NOW);
    const seen = await report.read(GROW, await grantFor(anonymous), NOW);

    expect(own.harvest).toMatchObject({ wetWeightG: 480, dryWeightG: 96 });
    expect(own.plantCount).toBe(2);
    expect(seen.harvest).toMatchObject({ harvestedAt: onDay(34).toISOString(), wetWeightG: null, dryWeightG: null });
    expect(seen.plantCount).toBeNull();
  });

  it('names the plants a harvest is of while another still grows, and is the grow´s once the last one is cut', async () => {
    await harvested([PLANT], 34, 480, 96);
    expect((await report.read(GROW, await grantFor(session(OWNER)), NOW)).harvest).toMatchObject({ plantIds: [PLANT], wetWeightG: 480 });

    await harvested(['plant-2'], 35, 20, 4);
    expect((await report.read(GROW, await grantFor(session(OWNER)), NOW)).harvest).toMatchObject({ plantIds: [], wetWeightG: 500, dryWeightG: 100 });
  });

  /**
   * One yield everywhere: what was typed into the harvests' lines. A plant deleted from a harvest of several took its
   * share off the plants' records while the line kept what the scale said, and the Bericht read 95 g over a diary of
   * 145 g.
   */
  it('states what the harvests´ lines were typed with, whatever became of the plants a weight was shared over', async () => {
    // Weighed with a plant deleted since: the line names only the one left, and that one holds half of the weight.
    await harvested([PLANT], 34, 100, 22, [[50, 11]]);
    await harvested(['plant-2'], 35, 45, 9);

    expect((await report.read(GROW, await grantFor(session(OWNER)), NOW)).harvest).toMatchObject({ wetWeightG: 145, dryWeightG: 31 });
  });

  it('reads one window per chapter rather than one per week', async () => {
    await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(readWindows).toHaveLength(3);
  });
});
