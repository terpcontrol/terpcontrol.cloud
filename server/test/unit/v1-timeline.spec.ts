import type { DeviceSeries, Metric, OutputMetric, TimelineRange } from '@fg2/shared-types/v1';
import { spaceTimeline } from '@fg2/shared-types/v1-schemas';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { DataService, SeriesRequest } from '@modules/data/data.service';
import { DevicesService } from '@modules/v1/device/devices.service';
import { SpaceLiveService } from '@modules/v1/space/space-live.service';
import { SpacesService } from '@modules/v1/space/spaces.service';
import { TimelineService } from '@modules/v1/timeline/timeline.service';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The Timeline tab: one answer per range chip.
 *
 * What is asserted here is what the screen is drawn from. The window a chip
 * means and what the points come to are arithmetic and are asserted as
 * arithmetic - the bands a window spanning two phases carries, the gap a device
 * that went quiet leaves, the night worked out from the lamp rather than from
 * the clock. The rest is the read model and who is allowed to be told it, which
 * is asserted through `access()` exactly as the route reaches it, because the
 * answer a link gets is the part most easily got wrong.
 *
 * The world is a tent in a room with a controller, a plug and a camera in it, a
 * grow that moved in and changed phase overnight, a second tent with nothing in
 * it at all, a member, a stranger, and a link that was given out for one week.
 */

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';

const ROOM = 'room-1';
const TENT = 'tent-1';
const BARE = 'tent-2';
const CONTROLLER = 'device-controller';
const PLUG = 'device-plug';
const CAMERA = 'camera-1';
const GROW = 'grow-spring';

const NOW = new Date('2026-06-10T12:00:00.000Z');
/** Day 1, and therefore what every day number on the screen is counted from. */
const ORIGIN = new Date('2026-05-08T08:00:00.000Z');
/** Overnight, so a 24 h window ending at noon has the grow in two phases. */
const FLOWERING_FROM = new Date('2026-06-10T00:00:00.000Z');

/** The step a 24 h window is read at: wide enough to be one query, narrow enough to be a curve. */
const DAY_STEP_SECONDS = 180;

/** How many stills the camera took, which is what the slider thins. */
const STILLS = 96;

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });
const visitor = (shareToken: string): AccessContext => ({ userId: null, isAdmin: false, isDemo: false, shareToken });

let db: V1TestDatabase;
let access: AccessService;
let timeline: TimelineService;

/** What each device reported at an instant, or null for an instant it said nothing at. */
type Reading = { metrics?: Partial<Record<Metric, number>>; outputs?: Partial<Record<OutputMetric, number>> };
let reports: Record<string, (at: Date) => Reading | null>;
let reads: SeriesRequest[];

/** The lamp's own day: on from six in the morning until six in the evening. */
const isLit = (at: Date): boolean => at.getUTCHours() >= 6 && at.getUTCHours() < 18;

/** The stretch the controller was unreachable for, which is what leaves a gap in the curve. */
let quietFrom: Date | null = null;
let quietUntil: Date | null = null;

/** How often the controller says anything at all. Zero is every window; a backfilled history is far slower than that. */
let sampleEverySeconds = 0;

/** What the tent measures. A test takes CO2 away to make the third panel disappear. */
let sensed: Metric[] = ['temperature', 'humidity', 'co2'];

const controllerReport = (at: Date): Reading | null => {
  if (quietFrom && quietUntil && at >= quietFrom && at < quietUntil) return null;
  if (sampleEverySeconds && at.getTime() % (sampleEverySeconds * 1000) !== 0) return null;

  const lit = isLit(at);
  const readings: Partial<Record<Metric, number>> = {
    // Deliberately unroundable: a window is a mean, and a mean is seventeen
    // digits of which one is a measurement.
    temperature: lit ? 24.799999999999997 : 20.049999999999997,
    humidity: lit ? 55 : 62,
    co2: lit ? 910 : 430,
  };

  return {
    metrics: Object.fromEntries(sensed.map(metric => [metric, readings[metric]])),
    outputs: { light: lit ? 1 : 0, heater: lit ? 0 : 1, dehumidifier: 0 },
  };
};

const fakeData = {
  series: async (deviceId: string, request: SeriesRequest): Promise<DeviceSeries> => {
    reads.push(request);
    const step = (request.stepSeconds ?? 60) * 1000;
    const report = reports[deviceId];
    const instants: Date[] = [];
    for (let at = request.startsAt.getTime(); at < request.endsAt.getTime(); at += step) instants.push(new Date(at));

    const valueAt = (at: Date, pick: (reading: Reading) => number | undefined): number | null => {
      const reading = report ? report(at) : null;
      return reading ? (pick(reading) ?? null) : null;
    };

    return {
      deviceId,
      startsAt: request.startsAt.toISOString(),
      endsAt: request.endsAt.toISOString(),
      stepSeconds: request.stepSeconds ?? 60,
      metrics: request.metrics.map(metric => ({
        metric,
        points: instants.map(at => ({ measuredAt: at.toISOString(), value: valueAt(at, reading => reading.metrics?.[metric]) })),
      })),
      outputs: (request.outputs ?? []).map(output => ({
        output,
        points: instants.map(at => ({ measuredAt: at.toISOString(), value: valueAt(at, reading => reading.outputs?.[output]) })),
      })),
    };
  },
  live: async () => ({ metrics: {}, isDay: null, lightOn: null }),
} as unknown as DataService;

const build = (): TimelineService => {
  access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  const devices = new DevicesService(db.devices, db.claimCodes, db.spaces, db.memberships, db.cameras, db.plans, db.alarmRules, access);
  const places = new SpacesService(db.spaces, db.memberships, db.invites, db.shareLinks, db.devices, db.cameras, db.grows, devices, access);

  return new TimelineService(
    db.grows,
    db.cameras,
    db.entries,
    db.media,
    db.alerts,
    db.alarmRules,
    db.users,
    places,
    new SpaceLiveService(db.devices, db.cameras, fakeData),
    fakeData,
  );
};

/** Exactly what the route does: the guard decides, and the answer is built from what it decided. */
const readAs = async (ctx: AccessContext, asked: { range: TimelineRange; growId?: string; at?: Date } = { range: '24h' }, spaceId = TENT) => {
  const grant: Grant = await access.require(ctx, subjectRef('space', spaceId), 'view');
  return timeline.read(grant, spaceId, asked, NOW);
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

const still = (id: string, capturedAt: string) => ({
  id,
  kind: 'still',
  mime: 'image/jpeg',
  bytes: 1000,
  cameraId: CAMERA,
  capturedAt: new Date(capturedAt),
});

const world = async (): Promise<void> => {
  await db.users.create([
    { id: OWNER, email: 'owner@test.invalid', handle: 'owner', passwordHash: 'x' },
    { id: MEMBER, email: 'member@test.invalid', handle: 'mia', passwordHash: 'x' },
    { id: STRANGER, email: 'stranger@test.invalid', handle: 'greenthumb', passwordHash: 'x' },
  ]);

  await db.spaces.create([
    { id: ROOM, ownerId: OWNER, kind: 'room', name: 'The room', roomId: null },
    { id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent 1', roomId: ROOM },
    { id: BARE, ownerId: OWNER, kind: 'tent', name: 'Tent 2', roomId: null },
  ]);
  await db.memberships.create({ id: 'membership-member', spaceId: TENT, userId: MEMBER, role: 'can_log' });

  await db.devices.create([
    {
      id: CONTROLLER,
      type: 'controller',
      ownerId: OWNER,
      spaceId: TENT,
      configuration: { day: { temperature: 27, humidity: 40 }, night: { temperature: 22, humidity: 45 }, co2: { target: 1100 } },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    { id: PLUG, type: 'plug', ownerId: OWNER, spaceId: TENT, configuration: null, createdAt: new Date('2026-01-02T00:00:00.000Z') },
  ]);

  await db.cameras.create({
    id: CAMERA,
    ownerId: OWNER,
    kind: 'terpcam_controller',
    deviceId: CONTROLLER,
    spaceId: TENT,
    name: 'Cam 1',
    state: { lastStillAt: NOW },
  });
  // One every five minutes over the last eight hours: far more than a slider has steps.
  await db.media.create(
    Array.from({ length: STILLS }, (_, index) =>
      still(`still-${String(index).padStart(2, '0')}`, new Date(NOW.getTime() - (STILLS - index) * 5 * 60 * 1000).toISOString()),
    ),
  );

  await db.grows.create({
    id: GROW,
    ownerId: OWNER,
    name: 'Spring run #3',
    type: 'photoperiod',
    phases: [
      {
        id: 'phase-veg',
        stage: 'vegetative',
        preset: null,
        startedAt: ORIGIN,
        source: 'preset',
        plantIds: null,
        deviceId: CONTROLLER,
        targets: { day: { temperature: 24, humidity: 60 }, night: { temperature: 20, humidity: 65 }, co2: 800 },
        setBy: null,
      },
      {
        id: 'phase-flower',
        stage: 'flowering',
        preset: 'late_flowering',
        startedAt: FLOWERING_FROM,
        source: 'human',
        plantIds: null,
        deviceId: CONTROLLER,
        targets: { day: { temperature: 26, humidity: 45 }, night: { temperature: 21, humidity: 50 }, co2: 900 },
        setBy: OWNER,
      },
      // A split: four plants drying in the fridge. It is told in the rail and
      // never by giving the tent a second timeline.
      {
        id: 'phase-split',
        stage: 'drying',
        preset: null,
        startedAt: new Date('2026-06-10T06:00:00.000Z'),
        source: 'human',
        plantIds: ['plant-1'],
        deviceId: null,
        targets: null,
        setBy: OWNER,
      },
    ],
    placements: [{ id: 'placement-here', spaceId: TENT, startedAt: ORIGIN, endedAt: null, plantIds: null }],
    // What this grow calls the readings its lines carry, which is the only place
    // the name and the unit of a key exist.
    measurements: [{ key: 'height', name: 'Height', unit: 'cm', perPlant: false, targetMin: null, targetMax: 90, chart: true }],
    slug: 'spring-run-3',
    startedAt: ORIGIN,
    endedAt: null,
  });

  await db.entries.create([
    entry({ id: 'entry-before', growId: GROW, occurredAt: new Date('2026-06-01T09:00:00.000Z'), kind: 'water' }),
    entry({ id: 'entry-water', growId: GROW, occurredAt: new Date('2026-06-09T18:00:00.000Z'), kind: 'water' }),
    entry({ id: 'entry-training', growId: GROW, authorId: MEMBER, occurredAt: new Date('2026-06-10T08:00:00.000Z'), kind: 'training' }),
    entry({
      id: 'entry-space',
      spaceId: TENT,
      source: 'device',
      authorId: null,
      deviceId: CONTROLLER,
      occurredAt: new Date('2026-06-10T09:00:00.000Z'),
    }),
    // What the machines wrote about the tent, which the rail carries for the
    // people who own it and for nobody else.
    entry({ id: 'entry-system', spaceId: TENT, source: 'device', authorId: null, kind: 'system', occurredAt: new Date('2026-06-10T09:30:00.000Z') }),
    entry({ id: 'entry-plan', spaceId: TENT, source: 'plan', authorId: null, kind: 'plan', occurredAt: new Date('2026-06-10T09:45:00.000Z') }),
  ]);

  await db.alarmRules.create({
    id: 'rule-humidity',
    deviceId: CONTROLLER,
    name: 'Humidity too high',
    watch: { kind: 'reading', metric: 'humidity', upper: 70 },
  });
  await db.alerts.create([
    // Open before the window began and still open: the span covers the whole of it.
    {
      id: 'alert-open',
      ruleId: 'rule-humidity',
      deviceId: CONTROLLER,
      kind: 'threshold',
      severity: 'warning',
      startedAt: new Date('2026-06-08T10:00:00.000Z'),
      resolvedAt: null,
      value: 78,
      extremeValue: 81,
    },
    {
      id: 'alert-inside',
      ruleId: null,
      spaceId: TENT,
      kind: 'offline',
      severity: 'critical',
      startedAt: new Date('2026-06-10T02:00:00.000Z'),
      resolvedAt: new Date('2026-06-10T06:00:00.000Z'),
      value: null,
      extremeValue: null,
    },
    {
      id: 'alert-over',
      ruleId: null,
      spaceId: TENT,
      kind: 'threshold',
      severity: 'info',
      startedAt: new Date('2026-06-01T02:00:00.000Z'),
      resolvedAt: new Date('2026-06-01T03:00:00.000Z'),
      value: 1,
      extremeValue: 1,
    },
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
  reports = { [CONTROLLER]: controllerReport };
  reads = [];
  sensed = ['temperature', 'humidity', 'co2'];
  quietFrom = null;
  quietUntil = null;
  sampleEverySeconds = 0;
  timeline = build();
  await world();
});

describe('the window a range chip names', () => {
  it('answers the shape the contract describes, field for field', async () => {
    expect(spaceTimeline.safeParse(await readAs(session(OWNER))).error?.issues ?? []).toEqual([]);
  });

  it('reads the last 24 hours at a step a curve can be drawn from, and says which days they are', async () => {
    const page = await readAs(session(OWNER));

    expect(page).toMatchObject({
      spaceId: TENT,
      name: 'Tent 1',
      kind: 'tent',
      range: '24h',
      growId: GROW,
      startsAt: '2026-06-09T12:00:00.000Z',
      endsAt: NOW.toISOString(),
      stepSeconds: DAY_STEP_SECONDS,
      dayFrom: 33,
      dayTo: 34,
      deviceIds: [CONTROLLER, PLUG],
    });
  });

  it('reads a phase as the stretch of the grow the instant falls in', async () => {
    const page = await readAs(session(OWNER), { range: 'phase', growId: GROW });

    expect(page).toMatchObject({ startsAt: FLOWERING_FROM.toISOString(), endsAt: NOW.toISOString(), dayFrom: 33, dayTo: 34 });
  });

  it('reads a whole grow for the same number of queries as a day, at a coarser step', async () => {
    const day = await readAs(session(OWNER));
    const dayReads = reads.length;
    reads = [];
    const grow = await readAs(session(OWNER), { range: 'grow', growId: GROW });

    expect(reads.length).toBe(dayReads);
    expect(grow.startsAt).toBe(ORIGIN.toISOString());
    expect(grow.stepSeconds).toBeGreaterThan(day.stepSeconds);
    expect(grow.panels[0].points.length).toBeLessThanOrEqual(day.panels[0].points.length);
  });

  it('refuses a phase or a grow that names no grow: a tent may hold two at once', async () => {
    await expect(readAs(session(OWNER), { range: 'phase' })).rejects.toMatchObject({ problem: { status: 400, code: 'grow_required' } });
  });

  it('ends the window where the request points rather than at now', async () => {
    const page = await readAs(session(OWNER), { range: '24h', at: new Date('2026-06-08T12:00:00.000Z') });

    expect(page).toMatchObject({ startsAt: '2026-06-07T12:00:00.000Z', endsAt: '2026-06-08T12:00:00.000Z', dayFrom: 31, dayTo: 32 });
  });

  it('takes its bands from the grow standing here now and not from one that has moved out', async () => {
    await db.grows.updateOne({ id: GROW }, { $set: { 'placements.0.endedAt': new Date('2026-06-10T06:00:00.000Z') } });
    const page = await readAs(session(OWNER));

    expect(page.growId).toBeNull();
    // Gone from the tent and not from its history: the week it stood here is
    // still what the rail is of.
    expect(page.events.map(line => line.id)).toContain('entry-water');
  });

  it('refuses a grow that has never stood here', async () => {
    await db.grows.create({
      id: 'grow-elsewhere',
      ownerId: OWNER,
      name: 'Somebody else´s',
      type: 'photoperiod',
      phases: [],
      placements: [{ id: 'placement-elsewhere', spaceId: BARE, startedAt: ORIGIN, endedAt: null, plantIds: null }],
      slug: 'elsewhere',
      startedAt: ORIGIN,
      endedAt: null,
    });

    await expect(readAs(session(OWNER), { range: 'grow', growId: 'grow-elsewhere' })).rejects.toMatchObject({
      problem: { status: 404, code: 'grow_not_found' },
    });
  });
});

describe('the stacked panels', () => {
  it('stacks temperature, humidity and CO2 and nothing else: VPD belongs to the charting view', async () => {
    const page = await readAs(session(OWNER));

    expect(page.panels.map(panel => panel.metric)).toEqual(['temperature', 'humidity', 'co2']);
  });

  it('leaves the CO2 panel out altogether where nothing in the tent measures it', async () => {
    sensed = ['temperature', 'humidity'];

    expect((await readAs(session(OWNER))).panels.map(panel => panel.metric)).toEqual(['temperature', 'humidity']);
  });

  it('rounds a window to what the sensor can say rather than to what the mean came to', async () => {
    const page = await readAs(session(OWNER));
    const values = new Set(page.panels[0].points.flatMap(point => (point.value === null ? [] : [point.value])));

    expect([...values].sort((one, other) => one - other)).toEqual([20, 24.8]);
  });

  it('breaks the curve where the device went quiet rather than joining across it', async () => {
    quietFrom = new Date('2026-06-10T02:00:00.000Z');
    quietUntil = new Date('2026-06-10T06:00:00.000Z');
    const points = (await readAs(session(OWNER))).panels[0].points;
    const breaks = points.filter(point => point.value === null);
    const lastHeard = new Date(quietFrom.getTime() - DAY_STEP_SECONDS * 1000);

    // One break, the instant after the last thing the device said, and the line
    // picks up again where it came back.
    expect(breaks).toEqual([{ measuredAt: new Date(lastHeard.getTime() + 1).toISOString(), value: null }]);
    expect(points[points.indexOf(breaks[0]) - 1].measuredAt).toBe(lastHeard.toISOString());
    expect(points[points.indexOf(breaks[0]) + 1].measuredAt).toBe(quietUntil.toISOString());
  });

  it('answers the windows something was read in and not the empty ones between them', async () => {
    // A backfilled history: one sample an hour, into windows of three minutes.
    sampleEverySeconds = 3600;
    const points = (await readAs(session(OWNER))).panels[0].points;

    expect(points).toHaveLength(24);
    // Nothing missing, so nothing to break at: an hourly history draws a line
    // rather than twenty-four readings no two of which are neighbours.
    expect(points.every(point => point.value !== null)).toBe(true);
  });
});

describe('the band that applied', () => {
  const bandsOf = async (metric: Metric) => (await readAs(session(OWNER))).panels.find(panel => panel.metric === metric)?.targets ?? [];

  it('carries two bands where the window spans two phases rather than one average', async () => {
    const targets = await bandsOf('temperature');

    expect(targets).toEqual([
      {
        startsAt: '2026-06-09T12:00:00.000Z',
        endsAt: FLOWERING_FROM.toISOString(),
        phaseId: 'phase-veg',
        stage: 'vegetative',
        day: { setpoint: 24, band: { low: 23, high: 25 } },
        night: { setpoint: 20, band: { low: 19, high: 21 } },
      },
      {
        startsAt: FLOWERING_FROM.toISOString(),
        endsAt: NOW.toISOString(),
        phaseId: 'phase-flower',
        stage: 'flowering',
        day: { setpoint: 26, band: { low: 25, high: 27 } },
        night: { setpoint: 21, band: { low: 20, high: 22 } },
      },
    ]);
  });

  it('gives CO2 no band in the dark half: a tent falling back to fresh air is the plants breathing', async () => {
    const targets = await bandsOf('co2');

    expect(targets.map(target => [target.day?.setpoint, target.night])).toEqual([
      [800, null],
      [900, null],
    ]);
  });

  it('falls back to what the controller is configured with where nothing grows here', async () => {
    await db.grows.deleteMany({});
    const page = await readAs(session(OWNER));

    expect(page.growId).toBeNull();
    expect(page.dayFrom).toBeNull();
    expect(page.panels[0].targets).toEqual([
      {
        startsAt: '2026-06-09T12:00:00.000Z',
        endsAt: NOW.toISOString(),
        phaseId: null,
        stage: null,
        day: { setpoint: 27, band: { low: 26, high: 28 } },
        night: { setpoint: 22, band: { low: 21, high: 23 } },
      },
    ]);
  });
});

describe('the night, the lanes and the alarms', () => {
  it('works the night out from the lamp rather than from the clock', async () => {
    const page = await readAs(session(OWNER));

    // The window opens in the afternoon with the lamp on, so the one night in
    // it is the one that runs from six in the evening to six in the morning.
    expect(page.nights).toEqual([{ startsAt: '2026-06-09T18:00:00.000Z', endsAt: '2026-06-10T06:00:00.000Z' }]);
  });

  it('draws an output as the stretches it ran for rather than as samples', async () => {
    const page = await readAs(session(OWNER));
    const heater = page.outputs.find(lane => lane.output === 'heater');

    expect(heater).toEqual({
      output: 'heater',
      deviceId: CONTROLLER,
      spans: [{ startsAt: '2026-06-09T18:00:00.000Z', endsAt: '2026-06-10T06:00:00.000Z' }],
    });
    // Reported and never on: a lane of its own, with nothing in it.
    expect(page.outputs.find(lane => lane.output === 'dehumidifier')?.spans).toEqual([]);
    // Said nothing about at all: no lane rather than an empty one.
    expect(page.outputs.map(lane => lane.output)).not.toContain('fan');
  });

  it('stops the night and the lanes where the device went quiet instead of running them through it', async () => {
    quietFrom = new Date('2026-06-10T02:00:00.000Z');
    quietUntil = new Date('2026-06-10T06:00:00.000Z');
    const lastHeard = new Date(quietFrom.getTime() - DAY_STEP_SECONDS * 1000).toISOString();
    const page = await readAs(session(OWNER));

    // Nobody said anything about the lamp for four hours, and the lamp was on
    // again by the time anybody did: the night ends where it was last heard.
    expect(page.nights).toEqual([{ startsAt: '2026-06-09T18:00:00.000Z', endsAt: lastHeard }]);
    expect(page.outputs.find(lane => lane.output === 'heater')?.spans).toEqual([{ startsAt: '2026-06-09T18:00:00.000Z', endsAt: lastHeard }]);
  });

  it('starts the first run where the device turned up, and at the edge of the window where it was already there', async () => {
    const opens = '2026-06-09T12:00:00.000Z';
    const lit = { startsAt: opens, endsAt: '2026-06-09T18:00:00.000Z' };
    const lightOf = async () => (await readAs(session(OWNER))).outputs.find(lane => lane.output === 'light')?.spans[0];

    // Reporting from the first instant of the window: the lamp was on before it
    // opened, so the run is drawn from the edge.
    expect(await lightOf()).toEqual(lit);

    // Nothing for the first half hour: the lamp is only known to have been on
    // from where the device turned up, and that is where the run starts.
    quietFrom = new Date(opens);
    quietUntil = new Date('2026-06-09T12:30:00.000Z');
    expect(await lightOf()).toEqual({ ...lit, startsAt: quietUntil.toISOString() });
  });

  it('keeps a lane whole across the gaps a device that reports slowly leaves between its samples', async () => {
    sampleEverySeconds = 20 * 60;
    const page = await readAs(session(OWNER));

    // Nineteen empty windows between every two samples are this device's
    // rhythm, not a silence: the lamp did not switch nineteen times.
    expect(page.nights).toEqual([{ startsAt: '2026-06-09T18:00:00.000Z', endsAt: '2026-06-10T06:00:00.000Z' }]);
    expect(page.outputs.find(lane => lane.output === 'heater')?.spans).toEqual([
      { startsAt: '2026-06-09T18:00:00.000Z', endsAt: '2026-06-10T06:00:00.000Z' },
    ]);
  });

  it('carries an alarm that was open across the whole window, with the metric its rule watched', async () => {
    const page = await readAs(session(OWNER));

    expect(page.alarms).toEqual([
      {
        alertId: 'alert-open',
        kind: 'threshold',
        severity: 'warning',
        metric: 'humidity',
        startedAt: '2026-06-08T10:00:00.000Z',
        endedAt: null,
        value: 78,
        extremeValue: 81,
      },
      {
        alertId: 'alert-inside',
        kind: 'offline',
        severity: 'critical',
        metric: null,
        startedAt: '2026-06-10T02:00:00.000Z',
        endedAt: '2026-06-10T06:00:00.000Z',
        value: null,
        extremeValue: null,
      },
    ]);
  });
});

describe('the rail and the frames', () => {
  it('carries everything the space recorded, the machines´ own lines included, oldest first, and names who wrote it', async () => {
    const page = await readAs(session(OWNER));

    expect(page.events.map(line => line.id)).toEqual(['entry-water', 'entry-training', 'entry-space', 'entry-system', 'entry-plan']);
    expect(page.people).toEqual(expect.arrayContaining([{ id: MEMBER, handle: 'mia' }]));
  });

  /**
   * The net over a machine's lines is its own, so a device that fails a capture
   * every half minute can only ever crowd out other machine lines. Under one net
   * over both, these 520 would spend the whole of it and the oldest thing on the
   * rail - the note somebody wrote - would be the line that fell off.
   */
  it('does not let a device´s chatter push what a person wrote off the far end', async () => {
    const chatter = Array.from({ length: 520 }, (_, index) =>
      entry({
        id: `entry-chatter-${index}`,
        spaceId: TENT,
        source: 'device',
        authorId: null,
        deviceId: CONTROLLER,
        kind: 'system',
        occurredAt: new Date(new Date('2026-06-10T00:00:00.000Z').getTime() + index * 60_000),
      }),
    );
    await db.entries.insertMany(chatter);

    const page = await readAs(session(OWNER));

    expect(page.events.filter(line => line.kind !== 'system' && line.kind !== 'plan').map(line => line.id)).toEqual([
      'entry-water',
      'entry-training',
      'entry-space',
    ]);
    expect(page.events.filter(line => line.kind === 'system' || line.kind === 'plan')).toHaveLength(200);
  });

  /**
   * A rail carries the lines of every grow that has stood here, so naming a
   * reading cannot be a read of "the" grow. The names ride on the answer, keyed
   * by the grow each line belongs to, and the band the measurement is aimed at
   * stays behind - a link is served this answer too.
   */
  it('says what each grow here calls its readings, and nothing else about them', async () => {
    const page = await readAs(session(OWNER));

    expect(page.readingNames).toEqual([{ growId: GROW, readings: [{ key: 'height', name: 'Height', unit: 'cm' }] }]);
    expect(JSON.stringify(page.readingNames)).not.toContain('targetMax');
  });

  it('thins the frames to what a slider can step through rather than answering every still', async () => {
    const page = await readAs(session(OWNER));
    const frames = page.cameras[0].frames;

    expect(page.cameras[0]).toMatchObject({ cameraId: CAMERA, name: 'Cam 1' });
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThan(STILLS);
    // Oldest first, which is the order the slider steps through them in.
    const order = [...frames].sort((one, other) => one.capturedAt.localeCompare(other.capturedAt));
    expect(frames).toEqual(order);
  });

  it('has no cameras in a space with none', async () => {
    await db.cameras.deleteMany({});

    expect((await readAs(session(OWNER))).cameras).toEqual([]);
  });
});

describe('a space with no controller', () => {
  it('answers the rail and says plainly that there are no series', async () => {
    await db.entries.create(entry({ id: 'entry-bare', spaceId: BARE, occurredAt: new Date('2026-06-10T07:00:00.000Z') }));
    const page = await readAs(session(OWNER), { range: '24h' }, BARE);

    expect(page).toMatchObject({ spaceId: BARE, deviceIds: [], stepSeconds: 0, panels: [], nights: [], outputs: [], cameras: [] });
    expect(page.events.map(line => line.id)).toEqual(['entry-bare']);
  });
});

describe('who may read it', () => {
  const linkFor = async (over: Record<string, unknown>): Promise<string> => {
    await db.shareLinks.create({
      id: 'link-1',
      token: 'secret-token',
      kind: 'view',
      subject: { type: 'space', id: TENT },
      range: { startsAt: new Date('2026-06-03T00:00:00.000Z'), endsAt: new Date('2026-06-10T00:00:00.000Z') },
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

  it('clamps every range to the link´s own window, however wide a range was asked for', async () => {
    const token = await linkFor({});
    const page = await readAs(visitor(token), { range: 'grow', growId: GROW });

    expect(page).toMatchObject({ startsAt: '2026-06-03T00:00:00.000Z', endsAt: '2026-06-10T00:00:00.000Z' });
    // The flowering phase begins where the link's window ends, so the week it
    // was given out for is one phase and one band.
    expect(page.panels[0].targets.map(target => target.phaseId)).toEqual(['phase-veg']);
    expect(page.events.map(line => line.id)).toEqual(['entry-water']);
    expect(page.alarms.map(alarm => alarm.alertId)).toEqual(['alert-open']);
    expect(page.cameras[0].frames).toEqual([]);
  });

  it('counts a rolling range back from the end of the link´s window rather than from now', async () => {
    const token = await linkFor({});
    const page = await readAs(visitor(token), { range: '24h' });

    // The link closed before the day the chip means, so `24 h` is the last day
    // of the window it was given out for - and not an empty answer, or a refusal.
    expect(page).toMatchObject({ startsAt: '2026-06-09T00:00:00.000Z', endsAt: '2026-06-10T00:00:00.000Z' });
    expect(page.panels[0].points.length).toBeGreaterThan(0);
    expect(page.panels[0].points.every(point => point.measuredAt <= page.endsAt)).toBe(true);
  });

  it('answers an empty window where the link and the range have nothing in common', async () => {
    const token = await linkFor({ range: { startsAt: new Date('2026-05-01T00:00:00.000Z'), endsAt: new Date('2026-05-02T00:00:00.000Z') } });
    const page = await readAs(visitor(token), { range: 'grow', growId: GROW });

    // The link's week ended before the grow began: nothing at all, rather than
    // the store being asked about a window of no width.
    expect(page).toMatchObject({ startsAt: page.endsAt, panels: [], nights: [], outputs: [], events: [] });
  });

  it('opens nothing but its own subject', async () => {
    const token = await linkFor({ subject: { type: 'space', id: BARE } });

    await expect(readAs(visitor(token))).rejects.toMatchObject({ problem: { status: 404, code: 'space_not_found' } });
  });

  it('answers a link that does not include pictures no cameras at all', async () => {
    const token = await linkFor({ includeCameras: false, range: { startsAt: null, endsAt: null } });

    expect((await readAs(visitor(token))).cameras).toEqual([]);
  });

  /**
   * A machine's line carries its own diagnostics verbatim - what a capture
   * failed at, which socket was addressed, how many bytes came back - which is
   * the inside of somebody's flat rather than the story of their grow. Widening
   * the rail for the people who own the tent must not widen what they hand out
   * with a link.
   */
  it('keeps the rail diary-only for a link, whose reader gains nothing from the widening', async () => {
    const token = await linkFor({ range: { startsAt: null, endsAt: null } });

    const page = await readAs(visitor(token));

    expect(page.events.map(line => line.id)).toEqual(['entry-water', 'entry-training', 'entry-space']);
    expect(page.events.some(line => line.kind === 'system' || line.kind === 'plan')).toBe(false);
  });
});
