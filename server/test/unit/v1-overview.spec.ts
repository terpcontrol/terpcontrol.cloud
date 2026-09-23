import type { DeviceSeries, Metric, OutputMetric, SeriesPoint, Setpoints } from '@fg2/shared-types/v1';
import { spaceOverview } from '@fg2/shared-types/v1-schemas';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { DataService, LiveReading } from '@modules/data/data.service';
import { DevicesService } from '@modules/v1/device/devices.service';
import { verdictOf } from '@modules/v1/overview/climate-verdict';
import { OverviewService } from '@modules/v1/overview/overview.service';
import { SpaceLiveService } from '@modules/v1/space/space-live.service';
import { SpacesService } from '@modules/v1/space/spaces.service';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The tent page's landing tab.
 *
 * Two things are asserted here. The verdict is arithmetic over a window of
 * points and is asserted as arithmetic: the share of the time inside the band,
 * the runs that left it, day and night judged against their own targets, and how
 * often each actuator came on. Everything else is the read model - what the page
 * says, and who is allowed to be told it - which is asserted through `access()`
 * exactly as the route reaches it, because the answer a share link gets is the
 * part most easily got wrong.
 *
 * The world is a room with a tent in it, a controller and a plug in the tent, a
 * camera, two grows standing there and one that has moved out, a member, a
 * stranger, and a link that was given out for one week of it.
 */

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';

const ROOM = 'room-1';
const TENT = 'tent-1';
const CONTROLLER = 'device-controller';
const PLUG = 'device-plug';
const CAMERA = 'camera-1';
const QUIET_CAMERA = 'camera-2';
const GROW = 'grow-spring';
const SECOND_GROW = 'grow-autumn';

const NOW = new Date('2026-06-10T12:00:00.000Z');
const STARTED_AT = new Date('2026-05-08T08:00:00.000Z');
const PLACED_AT = new Date('2026-05-29T08:00:00.000Z');

/** The owner grows in Berlin, so "today" starts at 22:00 UTC the evening before. */
const TIMEZONE = 'Europe/Berlin';

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });
const visitor = (shareToken: string): AccessContext => ({ userId: null, isAdmin: false, isDemo: false, shareToken });
const tourist = (): AccessContext => ({ userId: null, isAdmin: false, isDemo: true, shareToken: null });

let db: V1TestDatabase;
let access: AccessService;
let overview: OverviewService;
let readings: Record<string, LiveReading>;
let series: DeviceSeries | null;

const at = (secondsAgo: number): string => new Date(NOW.getTime() - secondsAgo * 1000).toISOString();

const reading = (values: Record<string, [number, number]>, isDay: boolean | null = true): LiveReading => ({
  metrics: Object.fromEntries(
    Object.entries(values).map(([name, [value, secondsAgo]]) => [
      name,
      { value, measuredAt: at(secondsAgo), state: secondsAgo < 120 ? 'live' : 'stale' },
    ]),
  ),
  outputs: {},
  isDay,
  lightOn: isDay,
});

const fakeData = {
  live: async (deviceId: string) => readings[deviceId] ?? { metrics: {}, outputs: {}, isDay: null, lightOn: null },
  series: async () => series,
} as unknown as DataService;

const build = (): OverviewService => {
  access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  const devices = new DevicesService(db.devices, db.claimCodes, db.spaces, db.memberships, db.cameras, db.plans, db.alarmRules, access);
  const places = new SpacesService(db.spaces, db.memberships, db.invites, db.shareLinks, db.devices, db.cameras, db.grows, devices, access);

  return new OverviewService(
    db.grows,
    db.plants,
    db.cameras,
    db.entries,
    db.media,
    db.alerts,
    db.alarmRules,
    db.reminders,
    db.users,
    places,
    new SpaceLiveService(db.devices, db.cameras, fakeData),
    fakeData,
  );
};

/** Exactly what the route does: the guard decides, and the answer is built from what it decided. */
const readAs = async (ctx: AccessContext) => {
  const grant: Grant = await access.require(ctx, subjectRef('space', TENT), 'view');
  return overview.read(grant, TENT, NOW);
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

const still = (id: string, cameraId: string, capturedAt: string) => ({
  id,
  kind: 'still',
  mime: 'image/jpeg',
  bytes: 1000,
  cameraId,
  capturedAt: new Date(capturedAt),
});

const phase = {
  id: 'phase-1',
  stage: 'flowering',
  preset: 'late_flowering',
  startedAt: STARTED_AT,
  source: 'preset',
  plantIds: null,
  deviceId: CONTROLLER,
  targets: null,
  setBy: null,
};

const world = async (): Promise<void> => {
  await db.users.create([
    { id: OWNER, email: 'owner@test.invalid', handle: 'owner', passwordHash: 'x', preferences: { timezone: TIMEZONE } },
    { id: MEMBER, email: 'member@test.invalid', handle: 'mia', passwordHash: 'x' },
    { id: STRANGER, email: 'stranger@test.invalid', handle: 'greenthumb', passwordHash: 'x' },
  ]);

  await db.spaces.create([
    { id: ROOM, ownerId: OWNER, kind: 'room', name: 'The room', roomId: null },
    { id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent 1', roomId: ROOM },
  ]);
  await db.memberships.create({ id: 'membership-member', spaceId: TENT, userId: MEMBER, role: 'can_log' });

  await db.devices.create([
    {
      id: CONTROLLER,
      type: 'controller',
      ownerId: OWNER,
      spaceId: TENT,
      configuration: { day: { temperature: 25, humidity: 50 }, night: { temperature: 20, humidity: 55 } },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    { id: PLUG, type: 'plug', ownerId: OWNER, spaceId: TENT, configuration: null, createdAt: new Date('2026-01-02T00:00:00.000Z') },
  ]);
  readings = {
    [CONTROLLER]: reading({ temperature: [25.1, 20], humidity: [55, 20], co2: [1010, 20] }),
    // The plug's thermometer reported later, and aims at nothing.
    [PLUG]: reading({ temperature: [25.4, 5] }, null),
  };

  await db.cameras.create([
    { id: CAMERA, ownerId: OWNER, kind: 'terpcam_controller', deviceId: CONTROLLER, spaceId: TENT, name: 'Cam 1', state: { lastStillAt: NOW } },
    { id: QUIET_CAMERA, ownerId: OWNER, kind: 'rtsp', spaceId: TENT, name: 'Cam 2', state: { lastStillAt: new Date('2026-06-01T09:00:00.000Z') } },
  ]);
  await db.media.create([
    // Before midnight in Berlin, so yesterday's.
    still('still-yesterday', CAMERA, '2026-06-09T21:00:00.000Z'),
    still('still-01', CAMERA, '2026-06-09T23:00:00.000Z'),
    // The same two-hour slot as the one before it, so only the first is shown.
    still('still-01b', CAMERA, '2026-06-09T23:30:00.000Z'),
    still('still-05', CAMERA, '2026-06-10T03:00:00.000Z'),
    still('still-13', CAMERA, '2026-06-10T11:00:00.000Z'),
  ]);

  await db.grows.create([
    {
      id: GROW,
      ownerId: OWNER,
      name: 'Spring run #3',
      type: 'photoperiod',
      phases: [phase],
      placements: [
        { id: 'placement-elsewhere', spaceId: 'tent-2', startedAt: STARTED_AT, endedAt: PLACED_AT, plantIds: null },
        { id: 'placement-here', spaceId: TENT, startedAt: PLACED_AT, endedAt: null, plantIds: null },
      ],
      // What this grow calls the readings its lines carry, which is the only
      // place the name and the unit of a key exist.
      measurements: [{ key: 'height', name: 'Height', unit: 'cm', perPlant: false, targetMin: null, targetMax: 90, chart: true }],
      slug: 'spring-run-3',
      startedAt: STARTED_AT,
      endedAt: null,
    },
    {
      id: SECOND_GROW,
      ownerId: OWNER,
      name: 'Autumn starters',
      type: 'autoflower',
      phases: [{ ...phase, id: 'phase-2', stage: 'seedling', preset: null, source: 'human', setBy: OWNER, startedAt: PLACED_AT }],
      placements: [{ id: 'placement-second', spaceId: TENT, startedAt: PLACED_AT, endedAt: null, plantIds: null }],
      slug: 'autumn-starters',
      startedAt: PLACED_AT,
      endedAt: null,
    },
    {
      id: 'grow-moved-out',
      ownerId: OWNER,
      name: 'Last winter',
      type: 'photoperiod',
      phases: [{ ...phase, id: 'phase-3' }],
      placements: [{ id: 'placement-closed', spaceId: TENT, startedAt: STARTED_AT, endedAt: PLACED_AT, plantIds: null }],
      slug: 'last-winter',
      startedAt: STARTED_AT,
      endedAt: null,
    },
  ]);
  await db.plants.create([
    { id: 'plant-1', growId: GROW, strain: 'Amnesia', label: 'Amnesia 1', status: 'active', createdAt: STARTED_AT },
    { id: 'plant-2', growId: GROW, strain: 'Amnesia', label: 'Amnesia 2', status: 'active', createdAt: STARTED_AT },
    { id: 'plant-3', growId: GROW, strain: 'Gelato', label: 'Gelato 1', status: 'active', createdAt: new Date(STARTED_AT.getTime() + 1) },
  ]);

  await db.entries.create([
    entry({ id: 'entry-old', growId: GROW, occurredAt: new Date('2026-05-30T12:00:00.000Z'), text: 'Topped' }),
    entry({ id: 'entry-new', growId: GROW, authorId: MEMBER, occurredAt: new Date('2026-06-09T19:40:00.000Z'), text: 'Defoliated lower fan leaves' }),
    entry({
      id: 'entry-space',
      spaceId: TENT,
      source: 'device',
      authorId: null,
      deviceId: CONTROLLER,
      occurredAt: new Date('2026-06-10T06:00:00.000Z'),
    }),
  ]);

  await db.reminders.create({
    id: 'reminder-water',
    subject: { type: 'grow', id: GROW },
    kind: 'water',
    label: 'Water Spring run #3',
    everyDays: 2,
    onceAt: null,
    assigneeId: MEMBER,
    defaults: { kind: 'water', readings: [{ key: 'volume', value: 2, plantId: null }] },
    createdBy: OWNER,
    createdAt: new Date('2026-06-08T09:00:00.000Z'),
  });
};

beforeAll(async () => {
  db = await startV1TestDatabase();
});

afterAll(async () => {
  await db.stop();
});

beforeEach(async () => {
  await db.reset();
  series = null;
  overview = build();
  await world();
});

describe('what the tent reads right now', () => {
  it('answers the shape the contract describes, field for field', async () => {
    series = {
      deviceId: CONTROLLER,
      startsAt: new Date(NOW.getTime() - 3600 * 1000).toISOString(),
      endsAt: NOW.toISOString(),
      stepSeconds: 600,
      metrics: [{ metric: 'temperature', points: [{ measuredAt: NOW.toISOString(), value: 25.1 }] }],
      outputs: [{ output: 'light', points: [{ measuredAt: NOW.toISOString(), value: 1 }] }],
    };

    expect(spaceOverview.safeParse(await readAs(session(OWNER))).error?.issues ?? []).toEqual([]);
  });

  it('answers the live half the way `/live` answers it: the newest value, the target from the device that holds one', async () => {
    const page = await readAs(session(OWNER));

    expect(page).toMatchObject({ spaceId: TENT, name: 'Tent 1', kind: 'tent', roomId: ROOM, deviceIds: [CONTROLLER, PLUG] });
    expect(page.values.map(value => [value.metric, value.value, value.state])).toEqual([
      ['temperature', 25.4, 'live'],
      ['humidity', 55, 'live'],
      ['co2', 1010, 'live'],
    ]);
    expect(page.setpoints).toEqual([
      { metric: 'temperature', value: 25, band: 1 },
      { metric: 'humidity', value: 50, band: 5 },
    ]);
  });

  it('drops the CO2 target at night, which is when nothing is aiming at one', async () => {
    await db.devices.updateOne({ id: CONTROLLER }, { $set: { 'configuration.co2': { target: 900 } } });

    // The configuration holds one CO2 target and fills both halves of the cycle
    // from it, faithfully; a controller raises CO2 only while the lamp is on.
    // Saying "in band" against it at three in the morning contradicted the
    // Timeline panel two taps away, which draws no night band for it at all.
    expect((await readAs(session(OWNER))).setpoints.map(one => one.metric)).toEqual(['temperature', 'humidity', 'co2']);

    readings[CONTROLLER] = reading({ temperature: [20.1, 20], humidity: [55, 20], co2: [430, 20] }, false);
    expect((await readAs(session(OWNER))).setpoints.map(one => one.metric)).toEqual(['temperature', 'humidity']);
  });

  it('states both halves of the cycle, which is what the header says and the verdict judges against', async () => {
    const page = await readAs(session(OWNER));

    expect(page.targets).toEqual({
      day: [
        { metric: 'temperature', value: 25, band: 1 },
        { metric: 'humidity', value: 50, band: 5 },
      ],
      night: [
        { metric: 'temperature', value: 20, band: 1 },
        { metric: 'humidity', value: 55, band: 5 },
      ],
    });
  });

  it('has no targets where nothing in the space holds one', async () => {
    await db.devices.updateOne({ id: CONTROLLER }, { $set: { configuration: null } });

    const page = await readAs(session(OWNER));
    expect(page.targets).toBeNull();
    expect(page.verdict).toMatchObject({ deviceId: null, rating: null, inBandFraction: null, metrics: [], actuators: [] });
  });
});

describe('what grows here', () => {
  it('lists every grow standing here and not the one that moved out, newest first', async () => {
    const page = await readAs(session(OWNER));

    expect(page.grows.map(grow => grow.growId)).toEqual([SECOND_GROW, GROW]);
  });

  /**
   * The latest lines under the cards carry readings of these grows' own
   * measurements, and a key is not a name: the wording travels with the answer
   * so the tent says what the week card the reading was written on says.
   */
  it('says what each grow here calls its readings, and nothing else about them', async () => {
    const page = await readAs(session(OWNER));

    expect(page.readingNames).toContainEqual({ growId: GROW, readings: [{ key: 'height', name: 'Height', unit: 'cm' }] });
    expect(JSON.stringify(page.readingNames)).not.toContain('targetMax');
  });

  it('counts the days of the grow and the days it has stood in this tent', async () => {
    const page = await readAs(session(OWNER));
    const grow = page.grows.find(one => one.growId === GROW);

    expect(grow).toMatchObject({
      name: 'Spring run #3',
      dayNumber: 34,
      weekNumber: 5,
      stage: 'flowering',
      preset: 'late_flowering',
      isAuto: true,
      plantCount: 3,
      strains: ['Amnesia', 'Gelato'],
      placedOnDay: 22,
      placedAt: PLACED_AT.toISOString(),
    });
  });

  it('hides the plant count from a reader the owner hides counts from', async () => {
    await db.users.updateOne({ id: OWNER }, { $set: { privacy: { hideWeights: true, hideCounts: true }, isDemo: true } });
    await db.spaces.updateOne({ id: TENT }, { $set: { isDemo: true } });

    const page = await readAs(tourist());
    expect(page.grows.map(grow => grow.plantCount)).toEqual([null, null]);
  });
});

describe('what is due', () => {
  it('carries what a completion would be written with, so Done needs nothing else read', async () => {
    const page = await readAs(session(OWNER));

    expect(page.dueTasks).toEqual([
      {
        id: 'reminder-water:2026-06-10',
        kind: 'water',
        label: 'Water Spring run #3',
        dueAt: '2026-06-10T09:00:00.000Z',
        subject: { type: 'grow', id: GROW },
        assigneeId: MEMBER,
        defaults: { kind: 'water', readings: [{ key: 'volume', value: 2, plantId: null }] },
      },
    ]);
    expect(page.people).toEqual(expect.arrayContaining([{ id: MEMBER, handle: 'mia' }]));
  });
});

describe('the day´s pictures', () => {
  it('spans the day in the tent´s own time zone rather than answering the last few minutes of it', async () => {
    const page = await readAs(session(OWNER));
    const cam = page.cameras.find(camera => camera.cameraId === CAMERA);

    expect(cam?.name).toBe('Cam 1');
    expect(cam?.stills.map(picture => picture.mediaId)).toEqual(['still-01', 'still-05', 'still-13']);
  });

  it('says when a camera that took nothing today last delivered', async () => {
    const page = await readAs(session(OWNER));
    const quiet = page.cameras.find(camera => camera.cameraId === QUIET_CAMERA);

    expect(quiet).toEqual({ cameraId: QUIET_CAMERA, name: 'Cam 2', lastStillAt: '2026-06-01T09:00:00.000Z', stills: [] });
  });
});

describe('who may read it', () => {
  const linkFor = async (over: Record<string, unknown>): Promise<string> => {
    await db.shareLinks.create({
      id: 'link-1',
      token: 'secret-token',
      kind: 'view',
      subject: { type: 'space', id: TENT },
      range: { startsAt: new Date('2026-05-25T00:00:00.000Z'), endsAt: new Date('2026-06-08T00:00:00.000Z') },
      includeCameras: true,
      createdBy: OWNER,
      expiresAt: null,
      revokedAt: null,
      ...over,
    });
    return 'secret-token';
  };

  it('is read by a member of the tent', async () => {
    expect((await readAs(session(MEMBER))).spaceId).toBe(TENT);
  });

  it('is not there at all for somebody with nothing to do with the tent', async () => {
    await expect(readAs(session(STRANGER))).rejects.toMatchObject({ problem: { status: 404, code: 'space_not_found' } });
  });

  it('answers a link only what its window covers', async () => {
    const token = await linkFor({});
    const page = await readAs(visitor(token));

    // The week the link was given out for: the older entry, and neither the one
    // written after it nor the day's pictures, which are outside it.
    expect(page.entries.map(line => line.id)).toEqual(['entry-old']);
    expect(page.cameras.flatMap(camera => camera.stills)).toEqual([]);
    expect(page.verdict.endsAt).toBe('2026-06-08T00:00:00.000Z');
  });

  it('answers a link that does not include pictures no cameras at all', async () => {
    const token = await linkFor({ includeCameras: false, range: { startsAt: null, endsAt: null } });

    expect((await readAs(visitor(token))).cameras).toEqual([]);
  });

  /**
   * A window that has closed has no "now" in it. What the tent reads this
   * minute, what its controller is aiming for and when its camera last fired
   * are all dated after the window - and the verdict and the entries beside
   * them have been clamped since the page was written, so answering the live
   * half was the rule applied unevenly inside one method.
   */
  it('answers a link with a closed window the tent as it was, and nothing of the tent as it is', async () => {
    const page = await readAs(visitor(await linkFor({})));

    expect(page.values).toEqual([]);
    expect(page.setpoints).toEqual([]);
    expect(page.targets).toBeNull();
    expect(page.cameras.every(camera => camera.lastStillAt === null)).toBe(true);
    // 25.4 is the plug's temperature this minute and 1010 the CO2; neither is
    // a fact about the fortnight the link was made for.
    expect(JSON.stringify(page)).not.toContain('25.4');
    expect(JSON.stringify(page)).not.toContain('1010');
  });

  it('answers a link with no end the tent as it is, which is what sharing a running grow means', async () => {
    const token = await linkFor({ range: { startsAt: null, endsAt: null } });
    const page = await readAs(visitor(token));

    expect(page.values.map(value => value.metric)).toEqual(['temperature', 'humidity', 'co2']);
    expect(page.targets).not.toBeNull();
    expect(page.cameras.some(camera => camera.lastStillAt !== null)).toBe(true);
  });

  it('lists the grows that stood here during the window rather than the ones standing here now', async () => {
    await db.grows.create({
      id: 'grow-arrived-later',
      ownerId: OWNER,
      name: 'Moved in last week',
      type: 'autoflower',
      phases: [{ ...phase, id: 'phase-4', startedAt: new Date('2026-06-09T08:00:00.000Z') }],
      placements: [{ id: 'placement-later', spaceId: TENT, startedAt: new Date('2026-06-09T08:00:00.000Z'), endedAt: null, plantIds: null }],
      slug: 'moved-in-last-week',
      startedAt: new Date('2026-06-09T08:00:00.000Z'),
      endedAt: null,
    });

    const mine = await readAs(session(OWNER));
    const theirs = await readAs(visitor(await linkFor({})));

    expect(mine.grows.map(grow => grow.growId)).toContain('grow-arrived-later');
    // Not its name, not its strains, not that it exists.
    expect(theirs.grows.map(grow => grow.growId)).not.toContain('grow-arrived-later');
    expect(JSON.stringify(theirs)).not.toContain('Moved in last week');
    // The grow that stood here during the window and has since moved on is
    // what the link was sent to show.
    expect(theirs.grows.map(grow => grow.growId)).toContain('grow-moved-out');
  });

  it('counts the days of a grow up to the end of the window rather than up to today', async () => {
    const mine = await readAs(session(OWNER));
    const theirs = await readAs(visitor(await linkFor({})));

    expect(mine.grows.find(grow => grow.growId === GROW)?.dayNumber).toBe(34);
    // The window closed on 8 June, two days into the diary this reader has not seen.
    expect(theirs.grows.find(grow => grow.growId === GROW)?.dayNumber).toBe(31);
  });

  it('names no device and no room to somebody who was sent a link', async () => {
    const mine = await readAs(session(OWNER));
    const theirs = await readAs(visitor(await linkFor({})));

    expect(mine).toMatchObject({ roomId: ROOM, deviceIds: [CONTROLLER, PLUG] });
    expect(theirs).toMatchObject({ roomId: null, deviceIds: null });
    expect(theirs.verdict.deviceId).toBeNull();
    expect(JSON.stringify(theirs)).not.toContain(CONTROLLER);
    expect(JSON.stringify(theirs)).not.toContain(PLUG);
    expect(JSON.stringify(theirs)).not.toContain(ROOM);
  });

  /**
   * Every other path takes the quiet direction when it cannot read the owner's
   * settings; this one used to take the loud one, and an admin deleting a user
   * row leaves their grows standing, so it was reachable.
   */
  it('hides everything where the owner´s settings cannot be read at all', async () => {
    const token = await linkFor({});
    const known = await readAs(visitor(token));
    expect(known.grows.map(grow => grow.plantCount)).not.toContain(null);

    await db.users.deleteOne({ id: OWNER });

    const unknown = await readAs(visitor(token));
    expect(unknown.grows.every(grow => grow.plantCount === null)).toBe(true);
    expect(unknown.grows.every(grow => grow.stageGroups.every(group => group.plantCount === null))).toBe(true);
  });
});

describe('the 24 h verdict', () => {
  const STEP = 600;
  const START = new Date('2026-06-10T10:00:00.000Z');

  const points = (values: (number | null)[], stepSeconds: number): SeriesPoint[] =>
    values.map((value, index) => ({ measuredAt: new Date(START.getTime() + index * stepSeconds * 1000).toISOString(), value }));

  const seriesOf = (
    metrics: Partial<Record<Metric, (number | null)[]>>,
    outputs: Partial<Record<OutputMetric, (number | null)[]>>,
    stepSeconds = STEP,
  ): DeviceSeries => ({
    deviceId: CONTROLLER,
    startsAt: START.toISOString(),
    endsAt: new Date(START.getTime() + 12 * stepSeconds * 1000).toISOString(),
    stepSeconds,
    metrics: Object.entries(metrics).map(([name, values]) => ({ metric: name as Metric, points: points(values, stepSeconds) })),
    outputs: Object.entries(outputs).map(([name, values]) => ({ output: name as OutputMetric, points: points(values, stepSeconds) })),
  });

  const targets: Setpoints = { day: { temperature: 25, humidity: 50 }, night: { temperature: 20, humidity: 55 }, active: 'day' };
  const window = { startsAt: START, endsAt: new Date(START.getTime() + 12 * STEP * 1000) };

  /** Six windows lit and six dark; the night runs two windows three degrees over its own target. */
  const day = [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0];
  const temperature = [25, 25, 25, 25, 25, 25, 20, 20, 23, 23, 20, 20];
  const humidity = [50, 50, 50, 50, 50, 50, 55, 55, 55, 55, 55, 55];

  it('tells day from night by the light and holds each half against its own band', () => {
    const verdict = verdictOf(seriesOf({ temperature, humidity }, { light: day }), targets, window);
    const warm = verdict.metrics.find(row => row.metric === 'temperature');

    expect(warm).toMatchObject({
      rating: 'watch',
      dayBand: { low: 24, high: 26 },
      nightBand: { low: 19, high: 21 },
      minValue: 20,
      maxValue: 25,
      inBandSeconds: 10 * STEP,
      outOfBandSeconds: 2 * STEP,
    });
    // 23 °C is in the day's band and out of the night's, which is the whole point.
    expect(verdict.metrics.find(row => row.metric === 'humidity')).toMatchObject({ rating: 'good', outOfBandSeconds: 0 });
  });

  it('names the run that left the band, with its side, its extreme and when it ran', () => {
    const verdict = verdictOf(seriesOf({ temperature }, { light: day }), targets, window);

    expect(verdict.metrics[0].excursions).toEqual([
      {
        startedAt: '2026-06-10T11:20:00.000Z',
        endedAt: '2026-06-10T11:30:00.000Z',
        above: true,
        extremeValue: 23,
      },
    ]);
  });

  it('leaves an excursion open that had not ended when the window did', () => {
    const verdict = verdictOf(seriesOf({ temperature: [25, 25, 25, 25, 25, 25, 20, 20, 20, 20, 23, 23] }, { light: day }), targets, window);

    expect(verdict.metrics[0].excursions).toEqual([expect.objectContaining({ endedAt: null, above: true })]);
  });

  it('does not name a blip the controller´s own hysteresis makes, but still counts its time', () => {
    const blip = seriesOf({ temperature: [25, 25, 28, 25, 25, 25, 25, 25, 25, 25, 25, 25] }, { light: Array(12).fill(1) }, 120);
    const verdict = verdictOf(blip, targets, window);

    expect(verdict.metrics[0].excursions).toEqual([]);
    expect(verdict.metrics[0].outOfBandSeconds).toBe(120);
  });

  it('says the share of the time the tent held its band, and the worst of the metrics as the headline', () => {
    const verdict = verdictOf(seriesOf({ temperature, humidity }, { light: day }), targets, window);

    expect(verdict.rating).toBe('watch');
    expect(verdict.inBandFraction).toBeCloseTo(22 / 24, 5);
    expect(verdict).toMatchObject({ deviceId: CONTROLLER, forSeconds: 12 * STEP, stepSeconds: STEP });
  });

  it('counts how often each actuator came on, and says nothing about one the device never wrote', () => {
    const verdict = verdictOf(
      seriesOf({ temperature }, { light: day, dehumidifier: [0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0], heater: Array(12).fill(null) }),
      targets,
      window,
    );

    expect(verdict.actuators).toEqual([
      { output: 'light', runCount: 1, forSeconds: 6 * STEP },
      { output: 'dehumidifier', runCount: 2, forSeconds: 3 * STEP },
    ]);
  });

  it('falls back to the half the device says it is in where nothing drives a light', () => {
    const verdict = verdictOf(seriesOf({ temperature }, {}), { ...targets, active: 'night' }, window);

    // Judged as night throughout: the six windows at 25 °C are then the excursion.
    expect(verdict.metrics[0]).toMatchObject({ outOfBandSeconds: 8 * STEP, inBandSeconds: 4 * STEP });
  });

  it('holds CO2 against a band only while the light is on, because that is the only time a controller raises it', () => {
    const co2 = [1100, 1100, 1100, 1100, 1100, 1100, 450, 450, 450, 450, 450, 450];
    const verdict = verdictOf(seriesOf({ co2 }, { light: day }), { ...targets, day: { co2: 1100 }, night: { co2: 1100 } }, window);

    expect(verdict.metrics[0]).toMatchObject({ metric: 'co2', dayBand: { low: 900, high: 1300 }, nightBand: null, outOfBandSeconds: 0 });
  });

  describe('a device that does not fill every window', () => {
    // Five minutes of silence is still a device that is there; the age at which
    // a value counts as offline is where a gap becomes an absence.
    const sparse = (values: (number | null)[], light: (number | null)[]) => seriesOf({ temperature: values }, { light }, 120);
    const lit = (length: number) => Array(length).fill(1);

    it('carries a run across the windows a sparse device leaves empty', () => {
      const verdict = verdictOf(sparse([28, 28, null, null, null, null, 28, 28, 25, 25, 25, 25], lit(12)), targets, window);

      expect(verdict.metrics[0].excursions).toEqual([
        expect.objectContaining({ startedAt: '2026-06-10T10:00:00.000Z', endedAt: '2026-06-10T10:14:00.000Z' }),
      ]);
    });

    it('ends a run where the device was away for longer than a value stays fresh', () => {
      const away = [28, 28, 28, 28, 28, null, null, null, null, null, null, 28, 28, 28, 28, 28];
      const verdict = verdictOf(sparse(away, lit(away.length)), targets, window);

      expect(verdict.metrics[0].excursions).toHaveLength(2);
    });

    it('keeps an output on until a reading says otherwise, so a count is not one per sample', () => {
      const lamp = [90, null, null, null, null, null, null, null, 90, null, 0, null];
      const verdict = verdictOf(sparse(Array(12).fill(25), lamp), targets, window);

      expect(verdict.actuators).toEqual([{ output: 'light', runCount: 1, forSeconds: 2 * 120 }]);
    });

    it('reads the light across the gaps rather than calling every empty window night', () => {
      const verdict = verdictOf(sparse(Array(12).fill(25), [null, null, 1, null, null, null, 1, null, null, null, 1, null]), targets, window);

      expect(verdict.metrics[0]).toMatchObject({ rating: 'good', outOfBandSeconds: 0 });
    });
  });

  it('carries the window as a line, so the panel needs no read of its own', () => {
    const verdict = verdictOf(seriesOf({ temperature }, { light: day }), targets, window);

    expect(verdict.trend).toMatchObject({ metric: 'temperature', stepSeconds: STEP });
    expect(verdict.trend?.points).toHaveLength(12);
  });

  it('is empty where there is nothing to read it from, rather than a verdict nobody can stand behind', () => {
    expect(verdictOf(null, null, window)).toMatchObject({ deviceId: null, rating: null, inBandFraction: null, metrics: [], trend: null });
  });
});
