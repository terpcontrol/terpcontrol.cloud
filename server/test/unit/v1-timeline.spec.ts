import type { DeviceLive, DeviceSeries, Metric, OutputMetric, TimelineRange, TimelineSpan } from '@fg2/shared-types/v1';
import { spaceTimeline } from '@fg2/shared-types/v1-schemas';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { DataService, DeviceHistory, OutputHistory, SeriesRequest } from '@modules/data/data.service';
import { FluxRow, switchingsByField } from '@modules/data/flux';
import { DevicesService } from '@modules/v1/device/devices.service';
import { SpaceLiveService } from '@modules/v1/space/space-live.service';
import { SpacesService } from '@modules/v1/space/spaces.service';
import { lanesOf, nightsOf } from '@modules/v1/timeline/timeline-series';
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

/**
 * The newest thing the store holds about a device, whenever it was measured -
 * which is what a window with no curves in it has to be told apart by. Empty
 * stands for a device that has never measured one of the panels' metrics, such
 * as a plug or a fan.
 */
let lastReading: DeviceLive['metrics'] = {};

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

/**
 * How finely the store is taken to look for a switching, which is a grain of
 * its own and not the step the curve is drawn with. The fake keeps them apart
 * because that is the whole of what the second read buys: a window wider than
 * the cycle still answers the cycle.
 */
const SWITCHING_GRAIN_MS = 300 * 1000;

/** What the store answers about the outputs: the state the window opens in, then every switching. */
const fakeSwitchings = (deviceId: string, request: SeriesRequest): OutputHistory[] => {
  const report = reports[deviceId];

  return (request.outputs ?? []).map(output => {
    const switchings: { at: string; on: boolean }[] = [];
    let last: boolean | null = null;

    for (let at = request.startsAt.getTime(); at < request.endsAt.getTime(); at += SWITCHING_GRAIN_MS) {
      const value = report ? report(new Date(at))?.outputs?.[output] : undefined;
      if (value === undefined || value === null) continue;

      const on = value > 0;
      if (on !== last) switchings.push({ at: new Date(at).toISOString(), on });
      last = on;
    }

    return { output, switchings };
  });
};

/**
 * The newest raw sample the fake device wrote, which the store answers from a
 * read of its own. Here it is the newest window anything was reported in: the
 * fake stamps a window at the instant it opens, so the two are the same and the
 * lane is cut exactly where it always was.
 */
const lastSampleOf = (series: DeviceSeries): string | null =>
  [...series.metrics, ...series.outputs]
    .flatMap(one => one.points.flatMap(point => (point.value === null ? [] : [point.measuredAt])))
    .sort()
    .at(-1) ?? null;

const fakeData = {
  history: async (deviceId: string, request: SeriesRequest): Promise<DeviceHistory> => {
    const series = await fakeData.series(deviceId, request);

    return { series, outputs: fakeSwitchings(deviceId, request), lastSampleAt: lastSampleOf(series) };
  },
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
  live: async (deviceId: string) => ({ metrics: reports[deviceId] ? lastReading : {}, outputs: {}, isDay: null, lightOn: null }),
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
  lastReading = {};
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

  it('breaks the curve after the last reading where the tent has been quiet since, rather than carrying it to the edge', async () => {
    quietFrom = new Date('2026-06-10T02:00:00.000Z');
    quietUntil = new Date('2026-06-11T00:00:00.000Z');
    const points = (await readAs(session(OWNER))).panels[0].points;
    const lastHeard = new Date(quietFrom.getTime() - DAY_STEP_SECONDS * 1000);

    // Both screens read a line at the cursor as the last point at or before it,
    // so without this the ten silent hours print the last reading under every
    // clock in them.
    expect(points[points.length - 2]).toEqual({ measuredAt: lastHeard.toISOString(), value: 20 });
    expect(points[points.length - 1]).toEqual({ measuredAt: new Date(lastHeard.getTime() + 1).toISOString(), value: null });
  });

  it('carries the curve to the edge of the window where the tent is still reporting', async () => {
    const points = (await readAs(session(OWNER))).panels[0].points;

    // A device heard from a step ago is not a silence, and a break there would
    // read as one.
    expect(points[points.length - 1].value).not.toBeNull();
  });

  /**
   * A metric with no reading in the window has no panel, which makes an empty
   * stack the answer both for a tent nothing measures in and for one whose
   * controller has been quiet across the window. Only the store knows which,
   * because the fact that settles it lies outside the window.
   */
  describe('what tells an empty stack from a place that does not measure', () => {
    it('answers when the tent last measured, where the window holds no curve at all', async () => {
      const measuredAt = '2026-06-07T09:00:00.000Z';
      // A device that is still standing here and has simply said nothing for days.
      reports = { [CONTROLLER]: () => null };
      lastReading = { temperature: { value: 24, measuredAt, state: 'offline' } };

      const page = await readAs(session(OWNER));
      expect(page.panels).toEqual([]);
      expect(page.lastReadingAt).toBe(measuredAt);
    });

    it('answers nothing for a tent whose devices measure none of these metrics', async () => {
      reports = { [CONTROLLER]: () => null };

      expect((await readAs(session(OWNER))).lastReadingAt).toBeNull();
    });

    it('does not pay the read where the window already has curves to draw', async () => {
      lastReading = { temperature: { value: 24, measuredAt: '2026-06-07T09:00:00.000Z', state: 'offline' } };

      const page = await readAs(session(OWNER));
      expect(page.panels.length).toBeGreaterThan(0);
      expect(page.lastReadingAt).toBeNull();
    });
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

  it('lends the controller´s configuration only to the stretch it is still steering', async () => {
    await db.grows.updateOne({ id: GROW }, { $set: { 'phases.0.targets': null, 'phases.1.targets': null } });

    // The phase that runs to the present borrows what the fridge is set to now,
    // because now and then are the same instant there; the vegetative weeks it
    // handed over to are over, and nothing says what they were aimed at.
    expect((await bandsOf('temperature')).map(one => [one.phaseId, one.day?.setpoint])).toEqual([['phase-flower', 27]]);
  });

  it('draws a grow that has ended against its own snapshots and against nothing else', async () => {
    await db.grows.updateOne({ id: GROW }, { $set: { 'phases.1.targets': null, endedAt: NOW } });

    expect((await bandsOf('temperature')).map(one => [one.phaseId, one.day?.setpoint])).toEqual([['phase-veg', 24]]);
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
      // Still reporting, so everything up to the edge of the window is known.
      heardUntil: '2026-06-10T12:00:00.000Z',
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

  it('says how far anything is known about each lane, so a silence is not drawn as a switched-off machine', async () => {
    quietFrom = new Date('2026-06-10T02:00:00.000Z');
    quietUntil = new Date('2026-06-11T00:00:00.000Z');
    const lastHeard = new Date(quietFrom.getTime() - DAY_STEP_SECONDS * 1000).toISOString();
    const page = await readAs(session(OWNER));

    // Ten hours of the window are past the last thing the controller said. A
    // square wave drawn from the spans alone would lie flat along the bottom
    // across them, which reads as a heater somebody turned off.
    expect(page.outputs.map(lane => lane.heardUntil)).toEqual([lastHeard, lastHeard, lastHeard]);
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
    // And says so: a rail that drew 200 of 522 without a word left the reader to
    // conclude that the rest of the window held nothing.
    expect(page.machineEvents).toEqual({ shown: 200, total: 522 });
  });

  it('counts the machines´ lines as shown where the net did not bite', async () => {
    expect((await readAs(session(OWNER))).machineEvents).toEqual({ shown: 2, total: 2 });
  });

  /**
   * Every other way into a grow's record names the grow standing in the tent
   * now, so a grow that moved out in spring had no address at all - and the rail
   * is the only screen carrying what the tent recorded while it stood there.
   */
  it('names every grow that has stood here, so a rail can be pointed at one that has ended', async () => {
    await db.grows.create({
      id: 'grow-last-winter',
      ownerId: OWNER,
      name: 'Winter run',
      type: 'photoperiod',
      phases: [],
      placements: [{ id: 'placement-was', spaceId: TENT, startedAt: new Date('2025-11-01T00:00:00.000Z'), endedAt: ORIGIN, plantIds: null }],
      measurements: [],
      slug: 'winter-run',
      startedAt: new Date('2025-11-01T00:00:00.000Z'),
      endedAt: ORIGIN,
    });

    const page = await readAs(session(OWNER));

    expect(page.grows.map(one => one.growId)).toEqual([GROW, 'grow-last-winter']);
    expect(page.grows[1]).toMatchObject({ name: 'Winter run', endedAt: ORIGIN.toISOString() });
    // And the server takes that grow, which is what gives those months an address.
    expect((await readAs(session(OWNER), { range: 'grow', growId: 'grow-last-winter' })).growId).toBe('grow-last-winter');
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

  /**
   * The rail draws the newest picture taken by the cursor, and a cursor left
   * alone sits at the end of the window - so the last step has to be the newest
   * picture there is, or the same tent's overview strip names a newer one and
   * the two tabs disagree about what the camera last saw.
   */
  it('ends the walk on the newest picture in the window rather than on the oldest of the last step', async () => {
    const frames = (await readAs(session(OWNER))).cameras[0].frames;
    const newest = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();

    expect(frames.at(-1)).toEqual({ mediaId: `still-${STILLS - 1}`, capturedAt: newest });
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

  it('is not told of a grow that only stood here outside the link´s window', async () => {
    const token = await linkFor({ range: { startsAt: new Date('2026-05-01T00:00:00.000Z'), endsAt: new Date('2026-05-02T00:00:00.000Z') } });

    // The link's week ended before the grow began: that grow is not what it
    // shows, by name or as the tent's default.
    await expect(readAs(visitor(token), { range: 'grow', growId: GROW })).rejects.toMatchObject({ problem: { status: 404, code: 'grow_not_found' } });
    const page = await readAs(visitor(token), { range: '7d' });
    expect(page).toMatchObject({ growId: null, readingNames: [], grows: [], deviceIds: null });
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
    // Nothing was cut, because none was offered; and a stranger shown one grow's
    // week is not handed a list of everything else that has stood in the room.
    expect(page.machineEvents).toEqual({ shown: 0, total: 0 });
    expect(page.grows).toEqual([]);
  });
});

/**
 * The shading of a window wider than the cycle it is shading.
 *
 * A season is read at hours to the window, and a mean of an eighteen-hour lamp
 * over eleven of them never falls low enough to be called off: shaded from the
 * curve, a whole season of nights disappears into one long day. So the shading
 * is not drawn from the curve at all - it is drawn from the switchings the
 * store answers separately, and these are the assertions that what is drawn
 * agrees with the states the device actually kept.
 *
 * The lamp is written as a percentage rather than as a flag, because that is
 * what the firmware sends and it is the other half of the same mistake: half of
 * a scale that runs to a hundred is not half of the time.
 */
describe('the night and the lanes over a window wider than the cycle', () => {
  const OPENS = new Date('2026-01-19T00:00:00.000Z');
  const CLOSES = new Date('2026-08-24T00:00:00.000Z');
  const WINDOW = { startsAt: OPENS, endsAt: CLOSES };

  /** Five minutes, which is the grain the store looks for a switching at. */
  const GRAIN_MS = 300 * 1000;
  /** What 480 windows of a 218-day season comes to: eleven hours to the window, with a whole cycle inside one of them. */
  const STEP_SECONDS = Math.ceil((CLOSES.getTime() - OPENS.getTime()) / 1000 / 480);

  /** Eighteen hours on from five in the morning, at the twenty percent the fixture´s lamp is driven at. */
  const litAt = (at: number): number => (new Date(at).getUTCHours() >= 5 && new Date(at).getUTCHours() < 23 ? 20 : 0);

  const walk = (every: number): number[] => {
    const instants: number[] = [];
    for (let at = OPENS.getTime(); at < CLOSES.getTime(); at += every) instants.push(at);

    return instants;
  };

  /** The stretches the lamp really held a state for, read straight off the same fixture. */
  const stretches = (on: boolean): TimelineSpan[] => {
    const spans: TimelineSpan[] = [];
    let from: number | null = null;

    for (const at of walk(GRAIN_MS)) {
      const holds = litAt(at) > 0 === on;
      if (holds && from === null) from = at;
      if (!holds && from !== null) {
        spans.push({ startsAt: new Date(from).toISOString(), endsAt: new Date(at).toISOString() });
        from = null;
      }
    }
    if (from !== null) spans.push({ startsAt: new Date(from).toISOString(), endsAt: CLOSES.toISOString() });

    return spans;
  };

  /** One device, read the way the route reads it: the curve as means of the window, the states as the switchings behind them. */
  const history = (): DeviceHistory => {
    const step = STEP_SECONDS * 1000;
    const points = walk(step).map(at => {
      const closes = Math.min(at + step, CLOSES.getTime());
      const inside: number[] = [];
      for (let raw = at; raw < closes; raw += GRAIN_MS) inside.push(litAt(raw));

      // Stamped at the end of its window, as `aggregateWindow` stamps a mean.
      return { measuredAt: new Date(closes).toISOString(), value: inside.reduce((sum, one) => sum + one, 0) / inside.length };
    });

    const switchings: { at: string; on: boolean }[] = [];
    for (const at of walk(GRAIN_MS)) {
      const on = litAt(at) > 0;
      if (switchings.length === 0 || switchings[switchings.length - 1].on !== on) switchings.push({ at: new Date(at).toISOString(), on });
    }

    return {
      series: {
        deviceId: CONTROLLER,
        startsAt: OPENS.toISOString(),
        endsAt: CLOSES.toISOString(),
        stepSeconds: STEP_SECONDS,
        metrics: [],
        outputs: [{ output: 'light', points }],
      },
      outputs: [{ output: 'light', switchings }],
      // Still reporting when the window closed, one grain short of its edge.
      lastSampleAt: new Date(CLOSES.getTime() - GRAIN_MS).toISOString(),
    };
  };

  it('shades every night the device kept, and not the one long day a mean of the window would have said', () => {
    const dark = stretches(false);

    // The fixture is exactly the case a mean cannot answer: every window of the
    // curve is a mean of mostly-lit hours, so a threshold low enough to be
    // crossed at all reads the whole season as lit.
    expect(history().series.outputs[0].points.every(point => (point.value ?? 0) > 0.5)).toBe(true);
    expect(dark.length).toBeGreaterThan(200);

    expect(nightsOf([history()], WINDOW)).toEqual(dark);
  });

  it('draws the lamp´s lane as the stretches it ran for, at the same resolution', () => {
    expect(lanesOf([history()], WINDOW)).toEqual([
      { output: 'light', deviceId: CONTROLLER, spans: stretches(true), heardUntil: CLOSES.toISOString() },
    ]);
  });
});

/**
 * One lamp run, one device, one end instant, read at every width the chips come
 * to.
 *
 * The five ranges are five steps over the same record, and what a range decides
 * is how coarsely it is drawn and nothing else. A device whose last burst lands
 * inside a single window after a long silence is the case that put that in
 * doubt: at one step the burst merged with what came before it, at another it
 * stood alone as a point, and a point of no width is a stretch nothing can
 * overlap - so the run, the lane and the chip that offers it vanished at one
 * range and were drawn at the four either side of it.
 */
describe('the same lamp run at every range', () => {
  /** Where the record stops, which is the instant this grow ended. */
  const CLOSES = new Date('2026-08-24T15:31:56.000Z');
  /** The last thing the tent ever switched: the lamp came on six minutes before the end. */
  const LIT_FROM = new Date('2026-08-24T15:25:00.000Z');
  /** The controller reported all through the window until here, and then said nothing all afternoon. */
  const QUIET_FROM = new Date('2026-08-24T07:36:00.000Z');
  /** The burst that closed the record, which is all anybody heard of the lamp running. */
  const SPOKE_AGAIN = new Date('2026-08-24T15:20:00.000Z');

  /** What 480 windows come to over a day, a week, a phase and a whole season, which is what the four chips ask for. */
  const STEPS = [180, 1260, 13110, 39075];

  const windowFor = (stepSeconds: number) => ({ startsAt: new Date(CLOSES.getTime() - stepSeconds * 480 * 1000), endsAt: CLOSES });

  /** Whether the device said anything at all inside one aggregation window. */
  const spokeIn = (opens: number, closes: number): boolean =>
    opens < QUIET_FROM.getTime() || (closes > SPOKE_AGAIN.getTime() && opens < CLOSES.getTime());

  /**
   * One read of one device, stamped the way the store stamps it: an aggregation
   * window carries its own stop instant, so a point at t stands for the stretch
   * of a step ending there and a window nothing was said in comes back null.
   */
  const history = (stepSeconds: number): DeviceHistory => {
    const window = windowFor(stepSeconds);
    const step = stepSeconds * 1000;
    const points = [];
    for (let closes = window.startsAt.getTime() + step; closes <= CLOSES.getTime(); closes += step) {
      points.push({ measuredAt: new Date(closes).toISOString(), value: spokeIn(closes - step, closes) ? 60 : null });
    }

    return {
      series: {
        deviceId: CONTROLLER,
        startsAt: window.startsAt.toISOString(),
        endsAt: CLOSES.toISOString(),
        stepSeconds,
        metrics: [],
        outputs: [{ output: 'light' as const, points }],
      },
      outputs: [
        {
          output: 'light' as const,
          switchings: [
            { at: window.startsAt.toISOString(), on: false },
            { at: LIT_FROM.toISOString(), on: true },
          ],
        },
      ],
      lastSampleAt: CLOSES.toISOString(),
    };
  };

  it.each(STEPS)('draws the run the device really kept when the window is read at %i seconds', step => {
    expect(lanesOf([history(step)], windowFor(step))).toEqual([
      {
        output: 'light',
        deviceId: CONTROLLER,
        spans: [{ startsAt: LIT_FROM.toISOString(), endsAt: CLOSES.toISOString() }],
        heardUntil: CLOSES.toISOString(),
      },
    ]);
  });
});

/**
 * How far a wave may be drawn once the tent has stopped talking.
 *
 * A bucketed series cannot answer this by itself. Its points carry the instant
 * their window closed rather than the instant of the sample inside it, so the
 * last point of a tent that fell silent mid-window stands up to a whole step
 * after the last thing it ever said - an hour and a half at a month to the
 * chart, most of half a day at a season. Drawn to that stamp, the lane claims a
 * lamp state for a stretch nothing was heard across, which is the very claim
 * `heardUntil` exists to prevent.
 */
describe('a lane of a tent that has gone quiet', () => {
  const CLOSES = new Date('2026-09-23T12:00:00.000Z');
  /** A month to 480 windows, which is what the Grow chip of a running grow comes to. */
  const STEP_SECONDS = 5366;
  const OPENS = new Date(CLOSES.getTime() - STEP_SECONDS * 480 * 1000);
  const WINDOW = { startsAt: OPENS, endsAt: CLOSES };

  /** The last thing this tent ever wrote, four days before anybody looked. */
  const LAST_SAMPLE = new Date('2026-09-19T14:07:09.000Z');
  const LIT_FROM = new Date('2026-09-19T06:00:00.000Z');

  const history = (lastSampleAt: string | null): DeviceHistory => {
    const step = STEP_SECONDS * 1000;
    const points = [];
    for (let closes = OPENS.getTime() + step; closes <= CLOSES.getTime(); closes += step) {
      points.push({ measuredAt: new Date(closes).toISOString(), value: closes - step < LAST_SAMPLE.getTime() ? 60 : null });
    }

    return {
      series: {
        deviceId: CONTROLLER,
        startsAt: OPENS.toISOString(),
        endsAt: CLOSES.toISOString(),
        stepSeconds: STEP_SECONDS,
        metrics: [],
        outputs: [{ output: 'light' as const, points }],
      },
      outputs: [
        {
          output: 'light' as const,
          switchings: [
            { at: OPENS.toISOString(), on: false },
            { at: LIT_FROM.toISOString(), on: true },
          ],
        },
      ],
      lastSampleAt,
    };
  };

  it('stops at the last thing the device said rather than at the end of the window that held it', () => {
    const stamped = history(null)
      .series.outputs[0].points.filter(point => point.value !== null)
      .at(-1)!.measuredAt;
    // The bucket the last sample fell in closes well after the sample itself,
    // which is the whole of the error being corrected here.
    expect(new Date(stamped).getTime()).toBeGreaterThan(LAST_SAMPLE.getTime());

    expect(lanesOf([history(LAST_SAMPLE.toISOString())], WINDOW)).toEqual([
      {
        output: 'light',
        deviceId: CONTROLLER,
        spans: [{ startsAt: LIT_FROM.toISOString(), endsAt: LAST_SAMPLE.toISOString() }],
        heardUntil: LAST_SAMPLE.toISOString(),
      },
    ]);
  });

  it('still runs to the edge of the window for a tent that is reporting now', () => {
    const live = history(new Date(CLOSES.getTime() - 30 * 1000).toISOString());
    live.series.outputs[0].points = live.series.outputs[0].points.map(point => ({ ...point, value: 60 }));

    // A live tent must keep the edge it has: cutting at the last sample would
    // open a fresh gap at the right-hand end of every chart being watched.
    expect(lanesOf([live], WINDOW)[0].heardUntil).toBe(CLOSES.toISOString());
  });
});

/**
 * The rows that read comes back as. One query answers two things - the state
 * each field is found in and every switching after it - and both carry the same
 * sign, so the reader has only to put them in order per field.
 */
describe('what the store says an output did', () => {
  it('gathers the opening state and the switchings of each field into one ordered list', () => {
    const rows: FluxRow[] = [
      { _time: '2026-02-01T23:00:00Z', _value: -1, _field: 'out_light' },
      { _time: '2026-02-01T00:00:00Z', _value: 0, _field: 'out_light' },
      { _time: '2026-02-01T05:00:00Z', _value: 1, _field: 'out_light' },
      { _time: '2026-02-01T00:00:00Z', _value: 1, _field: 'out_heater' },
    ];

    expect(switchingsByField(rows).get('out_light')).toEqual([
      { at: '2026-02-01T00:00:00Z', on: false },
      { at: '2026-02-01T05:00:00Z', on: true },
      { at: '2026-02-01T23:00:00Z', on: false },
    ]);
    expect(switchingsByField(rows).get('out_heater')).toEqual([{ at: '2026-02-01T00:00:00Z', on: true }]);
  });

  it('drops a state said twice, which a device whose points carry two owners answers one of per table', () => {
    const rows: FluxRow[] = [
      { _time: '2026-02-01T00:00:00Z', _value: 0, _field: 'out_light' },
      { _time: '2026-02-01T00:00:00Z', _value: 0, _field: 'out_light' },
      { _time: '2026-02-01T05:00:00Z', _value: 1, _field: 'out_light' },
    ];

    // Saying "off" twice would cut the dark stretch into two that touch, which
    // a lane would draw as a switching that never happened.
    expect(switchingsByField(rows).get('out_light')).toEqual([
      { at: '2026-02-01T00:00:00Z', on: false },
      { at: '2026-02-01T05:00:00Z', on: true },
    ]);
  });
});
