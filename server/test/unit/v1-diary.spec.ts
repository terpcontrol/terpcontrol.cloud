import type { DeviceSeries, Metric, OutputMetric, SeriesPoint } from '@fg2/shared-types/v1';
import { AccessService } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { ProblemException } from '@common/v1/problem';
import { DataService } from '@modules/data/data.service';
import { EntriesService } from '@modules/v1/diary/entries.service';
import { GrowClimateService } from '@modules/v1/diary/grow-climate.service';
import { GrowReportService } from '@modules/v1/diary/report.service';
import { GrowWeeksService } from '@modules/v1/diary/weeks.service';
import { GrowsService } from '@modules/v1/grow/grows.service';
import { PhaseWriterService } from '@modules/v1/phase/phase-writer.service';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * Reading the diary: the timeline, the week cards the grow page is made of, and
 * the report that tells a grow as chapters.
 *
 * Three things can go wrong and each is checked on its own. The arithmetic - a
 * week's day range, which week of the stage it is, the day and night averages,
 * the hours of light, what a reading changed by - is checked against fixed dates
 * and canned points, because nobody can see a day counted wrongly in the data.
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

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });
const anonymous: AccessContext = { userId: null, isAdmin: false, isDemo: false, shareToken: null };

let db: V1TestDatabase;
let entries: EntriesService;
let weeks: GrowWeeksService;
let report: GrowReportService;
let access: AccessService;

/** What the fake store answers with. A test that cares about the climate replaces it. */
let canned: (deviceId: string, startsAt: Date, endsAt: Date) => { temperature: number; humidity: number; co2: number | null };

/** Which devices were read, and over which windows: the cost of an answer is part of what is asserted. */
let readWindows: { deviceId: string; startsAt: Date; endsAt: Date }[];

const STEP_SECONDS = 900;
const WINDOWS_PER_DAY = DAY_MS / 1000 / STEP_SECONDS;

/**
 * A controller that runs twelve hours of light a day: the first half of every
 * day lit and the second dark, measured every fifteen minutes. That is what
 * makes the day and the night halves of the answer two different figures.
 */
const fakeData = {
  series: async (deviceId: string, request: { startsAt: Date; endsAt: Date; metrics: readonly Metric[]; outputs?: readonly OutputMetric[] }) => {
    readWindows.push({ deviceId, startsAt: request.startsAt, endsAt: request.endsAt });

    const count = Math.max(0, Math.round((request.endsAt.getTime() - request.startsAt.getTime()) / 1000 / STEP_SECONDS));
    const at = (index: number): { measuredAt: string; isDay: boolean } => ({
      measuredAt: new Date(request.startsAt.getTime() + index * STEP_SECONDS * 1000).toISOString(),
      isDay: index % WINDOWS_PER_DAY < WINDOWS_PER_DAY / 2,
    });

    const points = (value: (isDay: boolean) => number | null): SeriesPoint[] =>
      Array.from({ length: count }, (_, index) => {
        const window = at(index);
        return { measuredAt: window.measuredAt, value: value(window.isDay) };
      });

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
} as unknown as DataService;

const build = (): void => {
  access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  const writer = new EntryWriterService(db.entries);
  const grows = new GrowsService(
    db.grows,
    db.plants,
    db.devices,
    db.memberships,
    db.spaces,
    db.users,
    access,
    new PhaseWriterService(db.grows, writer),
    writer,
    null,
  );
  const climate = new GrowClimateService(db.devices, fakeData);

  entries = new EntriesService(db.entries, db.devices, access, grows);
  weeks = new GrowWeeksService(db.entries, db.cameras, db.media, db.reminders, db.users, grows, climate);
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
    { id: CONTROLLER, type: 'controller', ownerId: OWNER, spaceId: TENT, configuration: { day: { temperature: 25 }, night: { temperature: 20 } } },
    // A plug measures and steers nothing, so it is not read for a week's climate.
    { id: PLUG, type: 'plug', ownerId: OWNER, spaceId: TENT, configuration: null },
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
        { key: 'height', name: 'Height', unit: 'cm', perPlant: false, target: null, chart: true },
        { key: 'ph', name: 'pH', unit: '', perPlant: false, target: null, chart: true },
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
      values: { kind: 'water', readings: [{ key: 'height', value: 58, plantId: null }] },
    }),
    entry({ id: 'entry-note-5', growId: GROW, occurredAt: onDay(31), text: 'Smells good' }),
    entry({ id: 'entry-fed', growId: GROW, kind: 'feed', occurredAt: onDay(30), values: { kind: 'feed', readings: [] } }),
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
    entry({ id: 'entry-watered-veg', growId: GROW, kind: 'water', occurredAt: onDay(10), values: { kind: 'water', readings: [] } }),
    // In the tent but not of the grow: a line of the space itself and one of a device standing in it.
    entry({ id: 'entry-space', spaceId: TENT, kind: 'note', occurredAt: onDay(29), text: 'Wiped the walls' }),
    entry({ id: 'entry-device', deviceId: PLUG, kind: 'system', source: 'device', authorId: null, occurredAt: onDay(28) }),
    // Somebody else's tent entirely.
    entry({ id: 'entry-stranger', growId: OTHER_GROW, spaceId: OTHER_TENT, kind: 'note', occurredAt: onDay(33), text: 'Not yours' }),
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

    const reader: AccessContext = { ...anonymous, shareToken: 'the-token' };
    const page = await entries.list(reader, { growId: GROW, startsAt: ORIGIN.toISOString() });

    expect(page.items.map(line => line.id)).toEqual(['entry-note-5', 'entry-fed', 'entry-booted']);
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

  it('strips the weights and the plant scope from a reader the owner hides them from', async () => {
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

    expect(seen).toMatchObject({ plantIds: [], values: { kind: 'harvest', wetWeightG: null, dryWeightG: null } });
    expect(own).toMatchObject({ plantIds: [PLANT], values: { kind: 'harvest', wetWeightG: 480, dryWeightG: 96 } });
  });
});

// ---------------------------------------------------------------------------
// The week cards
// ---------------------------------------------------------------------------

describe('a week card', () => {
  const weekFive = async (ctx: AccessContext = session(OWNER)) => {
    const page = await weeks.page(GROW, await grantFor(ctx), {}, NOW);
    return page.items[0];
  };

  it('counts weeks and days from the day the grow started, newest first', async () => {
    const page = await weeks.page(GROW, await grantFor(session(OWNER)), {}, NOW);

    expect(page.items.map(week => week.weekNumber)).toEqual([5, 4, 3, 2, 1]);
    expect(page.items[0]).toMatchObject({ weekNumber: 5, dayFrom: 29, dayTo: 35, startsAt: onDay(29, 0).toISOString() });
    // The week the grow is in stops now rather than on its seventh day.
    expect(page.items[0].endsAt).toBe(NOW.toISOString());
  });

  it('names the week after the phase the grow was in, and says which week of that phase it is', async () => {
    const page = await weeks.page(GROW, await grantFor(session(OWNER)), {}, NOW);

    expect(page.items.map(week => [week.weekNumber, week.stage, week.stageWeek])).toEqual([
      [5, 'flowering', 2],
      [4, 'flowering', 1],
      [3, 'vegetative', 2],
      [2, 'vegetative', 1],
      [1, 'seedling', 1],
    ]);
  });

  /** Week 4 rather than week 5: a whole week divides evenly, and the week the grow is in stops part-way through a day. */
  it('tells the day and the night apart by the light, and says how long it was on', async () => {
    const page = await weeks.page(GROW, await grantFor(session(OWNER)), {}, NOW);

    expect(page.items[1].climate).toEqual([
      { metric: 'temperature', minValue: 20.6, maxValue: 25, averageValue: 22.8, dayAverage: 25, nightAverage: 20.6 },
      { metric: 'humidity', minValue: 54, maxValue: 54, averageValue: 54, dayAverage: 54, nightAverage: 54 },
    ]);
    expect(page.items[1].lightHours).toBe(12);
  });

  it('reads the climate of the controllers of the tent and of nothing else, one window per week, and says which', async () => {
    const page = await weeks.page(GROW, await grantFor(session(OWNER)), { limit: 2 }, NOW);

    expect(readWindows.map(read => read.deviceId)).toEqual([CONTROLLER, CONTROLLER]);
    expect(readWindows.map(read => read.startsAt.toISOString())).toEqual([onDay(29, 0).toISOString(), onDay(22, 0).toISOString()]);
    expect(page.items.map(week => week.deviceIds)).toEqual([[CONTROLLER], [CONTROLLER]]);
  });

  it('names no controller for a grow with no fixed place, so the card can say why it has no averages', async () => {
    await db.grows.updateOne({ id: GROW }, { $set: { 'placements.$[].spaceId': null } });

    const week = await weekFive();

    expect(week.deviceIds).toEqual([]);
    expect(week.climate).toEqual([]);
    expect(readWindows).toEqual([]);
  });

  it('carries the scheme´s row for the week with the grow´s strength on it, and how many feeds the week wants', async () => {
    await db.grows.updateOne({ id: GROW }, { $set: { 'scheme.strength': 0.5 } });

    expect((await weekFive()).feeding).toEqual({
      amounts: [{ productKey: 'bio-bloom', name: 'Bio·Bloom', value: 1, unit: 'ml/l' }],
      plannedCount: 3,
    });
  });

  it('takes how many feeds a week wants from the grow´s own rhythm', async () => {
    await db.reminders.create({
      id: 'reminder-feed',
      subject: { type: 'grow', id: GROW },
      kind: 'feed',
      label: 'Feed',
      everyDays: 2,
      onceAt: null,
      assigneeId: null,
      createdBy: OWNER,
      createdAt: ORIGIN,
    });

    expect((await weekFive()).feeding?.plannedCount).toBe(3);
    expect((await weekFive()).feedCount).toBe(1);
  });

  it('states where a measurement stood and by how much it moved since the week before', async () => {
    expect((await weekFive()).readings).toEqual([{ key: 'height', value: 58, change: 6, measuredAt: onDay(32).toISOString() }]);
  });

  it('counts the waterings and the feeds of the week and carries its diary, the device´s lines left out', async () => {
    const week = await weekFive();

    expect({ waterCount: week.waterCount, feedCount: week.feedCount, entryCount: week.entryCount }).toEqual({
      waterCount: 1,
      feedCount: 1,
      entryCount: 4,
    });
    expect(week.entries.map(line => line.id)).toEqual(['entry-defoliated', 'entry-watered', 'entry-note-5', 'entry-fed']);
  });

  it('names everyone its cards name, so a line can say who wrote it', async () => {
    const page = await weeks.page(GROW, await grantFor(session(OWNER)), {}, NOW);

    expect(page.people).toEqual(
      expect.arrayContaining([
        { id: MEMBER, handle: 'mia' },
        { id: OWNER, handle: 'owner' },
      ]),
    );
  });

  it('has seven days, each with the still taken nearest midday', async () => {
    // The grow's days begin at 08:00, so midday falls four hours into each of them.
    await db.media.create([
      // Two on day 30: the nearer one to midday wins.
      { id: 'still-near', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: onDay(30, 4.2) },
      { id: 'still-far', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: onDay(30, 5.4) },
      // Hours away from midday on day 31, so that day keeps its slot empty.
      { id: 'still-off', kind: 'still', mime: 'image/jpeg', bytes: 1, cameraId: CAMERA, capturedAt: onDay(31, 18) },
    ]);

    const week = await weekFive();

    expect(week.days.map(day => day.dayNumber)).toEqual([29, 30, 31, 32, 33, 34, 35]);
    expect(week.days.map(day => day.mediaId)).toEqual([null, 'still-near', null, null, null, null, null]);
    expect(week.days[1]).toMatchObject({ cameraId: CAMERA, capturedAt: onDay(30, 4.2).toISOString() });
  });

  it('pages, and continues after the week the cursor names', async () => {
    const first = await weeks.page(GROW, await grantFor(session(OWNER)), { limit: 2 }, NOW);
    const second = await weeks.page(GROW, await grantFor(session(OWNER)), { limit: 2, cursor: first.nextCursor ?? undefined }, NOW);

    expect(first.items.map(week => week.weekNumber)).toEqual([5, 4]);
    expect(second.items.map(week => week.weekNumber)).toEqual([3, 2]);
  });

  it('answers only the weeks a share link´s range reaches into', async () => {
    await db.shareLinks.create({
      id: 'share-3',
      token: 'weeks-token',
      kind: 'view',
      subject: { type: 'grow', id: GROW },
      range: { startsAt: onDay(15, 0), endsAt: onDay(23, 0) },
      includeCameras: true,
      createdBy: OWNER,
      expiresAt: null,
      revokedAt: null,
    });

    const page = await weeks.page(GROW, await grantFor({ ...anonymous, shareToken: 'weeks-token' }), {}, NOW);

    expect(page.items.map(week => week.weekNumber)).toEqual([4, 3]);
  });

  it('is refused to a stranger, like the grow itself', async () => {
    await expect(access.access(session(STRANGER), { type: 'grow', id: GROW }, 'view')).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The report
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

  it('counts the whole grow above the chapters, the device´s lines left out', async () => {
    const answer = await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(answer.totals).toEqual({ entryCount: 7, waterCount: 2, feedCount: 1, photoCount: 0 });
  });

  it('adds the harvest up and strips the weights from a reader the owner hides them from', async () => {
    await db.plants.updateOne({ id: PLANT }, { $set: { harvest: { harvestedAt: onDay(34), wetWeightG: 480, dryWeightG: 96 } } });
    await db.users.updateOne({ id: OWNER }, { $set: { privacy: { hideWeights: true, hideCounts: true } } });
    await db.grows.updateOne({ id: GROW }, { $set: { visibility: 'public' } });

    const own = await report.read(GROW, await grantFor(session(OWNER)), NOW);
    const seen = await report.read(GROW, await grantFor(anonymous), NOW);

    expect(own.harvest).toMatchObject({ wetWeightG: 480, dryWeightG: 96 });
    expect(own.plantCount).toBe(2);
    expect(seen.harvest).toMatchObject({ harvestedAt: onDay(34).toISOString(), wetWeightG: null, dryWeightG: null });
    expect(seen.plantCount).toBeNull();
  });

  it('reads one window per chapter rather than one per week', async () => {
    await report.read(GROW, await grantFor(session(OWNER)), NOW);

    expect(readWindows).toHaveLength(3);
  });
});
