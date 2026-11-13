import type { DeviceLive, DeviceSeries, Metric, OutputMetric, TimelineRange, TimelineSpan } from '@fg2/shared-types/v1';
import { spaceTimeline } from '@fg2/shared-types/v1-schemas';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { movedTo } from '@common/v1/device-placements';
import { DataService, DeviceHistory, SeriesRequest } from '@modules/data/data.service';
import { FluxRow, switchingsByField } from '@modules/data/flux';
import { SpaceLiveService } from '@modules/v1/space/space-live.service';
import { lanesOf, nightsOf, panelsOf, readingOf } from '@modules/v1/timeline/timeline-series';
import { TimelineService } from '@modules/v1/timeline/timeline.service';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { session, visitor } from './support/callers';
import { isLit, lastSampleOf, seriesOf, SWITCHING_GRAIN_MS, switchingsOf } from './support/fake-data';
import { accessOn, spacesOn } from './support/services';
import { useV1TestDatabase } from './support/v1-database';
import { standingIn } from './support/placed';

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

const db = useV1TestDatabase();
let access: AccessService;
let timeline: TimelineService;

/** What each device reported at an instant, or null for an instant it said nothing at. */
type Reading = { metrics?: Partial<Record<Metric, number>>; outputs?: Partial<Record<OutputMetric, number>> };
let reports: Record<string, (at: Date) => Reading | null>;
let reads: SeriesRequest[];

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
/** The devices a live reading was asked of, in order. */
let liveAsked: string[] = [];

const controllerReport = (at: Date): Reading | null => {
  if (quietFrom && quietUntil && at >= quietFrom && at < quietUntil) return null;
  if (sampleEverySeconds && at.getTime() % (sampleEverySeconds * 1000) !== 0) return null;

  const lit = isLit(at);
  const readings: Partial<Record<Metric, number>> = {
    // Deliberately unroundable: a window is a mean, and a mean is seventeen
    // digits of which one is a measurement.
    temperature: lit ? 24.799999999999997 : 20.049999999999997,
    humidity: lit ? 55 : 62,
    vpd: lit ? 1.31 : 0.89,
    co2: lit ? 910 : 430,
    leafTemperature: lit ? 22.9 : 19.8,
    lux: lit ? 41_250 : 0,
  };

  return {
    metrics: Object.fromEntries(sensed.map(metric => [metric, readings[metric]])),
    outputs: { light: lit ? 1 : 0, heater: lit ? 0 : 1, dehumidifier: 0 },
  };
};

const fakeData = {
  history: async (deviceId: string, request: SeriesRequest): Promise<DeviceHistory> => {
    const series = await fakeData.series(deviceId, request);
    const outputs = switchingsOf(request, (output, at) => {
      const value = reports[deviceId]?.(at)?.outputs?.[output];
      return value === undefined || value === null ? null : value > 0;
    });

    return { series, outputs, lastSampleAt: lastSampleOf(series) };
  },
  series: async (deviceId: string, request: SeriesRequest): Promise<DeviceSeries> => {
    reads.push(request);
    const report = reports[deviceId];
    const valueAt = (at: Date, pick: (reading: Reading) => number | undefined): number | null => {
      const reading = report ? report(at) : null;
      return reading ? (pick(reading) ?? null) : null;
    };

    return seriesOf(deviceId, request, {
      metric: (metric, at) => valueAt(at, reading => reading.metrics?.[metric]),
      output: (output, at) => valueAt(at, reading => reading.outputs?.[output]),
    });
  },
  live: async (deviceId: string) => {
    liveAsked.push(deviceId);
    return { metrics: reports[deviceId] ? lastReading : {}, outputs: {}, isDay: null, lightOn: null };
  },
} as unknown as DataService;

const build = (): TimelineService => {
  access = accessOn(db);
  const places = spacesOn(db, access);

  return new TimelineService(
    db.grows,
    db.cameras,
    db.entries,
    db.media,
    db.alerts,
    db.alarmRules,
    db.users,
    db.targetChanges,
    places,
    new SpaceLiveService(db.devices, db.cameras, fakeData),
    fakeData,
  );
};

/** Exactly what the route does: the guard decides, and the answer is built from what it decided. */
const readAs = async (ctx: AccessContext, asked: Parameters<TimelineService['read']>[2] = { range: '24h' }, spaceId = TENT) => {
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
      ...standingIn(TENT),
      configuration: { day: { temperature: 27, humidity: 40 }, night: { temperature: 22, humidity: 45 }, co2: { target: 1100 } },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    { id: PLUG, type: 'plug', ownerId: OWNER, ...standingIn(TENT), configuration: null, createdAt: new Date('2026-01-02T00:00:00.000Z') },
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

    expect(page).toMatchObject({ startsAt: FLOWERING_FROM.toISOString(), endsAt: NOW.toISOString(), dayFrom: 34, dayTo: 34 });
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

  // A place with nothing growing in it has no phase to ask for, so a month is
  // what it gets instead - read at the same few hundred windows as a day.
  it('reads the last 30 days for the same number of queries as a day, at an hour and a half a point', async () => {
    const day = await readAs(session(OWNER));
    const dayReads = reads.length;
    reads = [];
    const month = await readAs(session(OWNER), { range: '30d' });

    expect(reads.length).toBe(dayReads);
    expect(month).toMatchObject({ range: '30d', startsAt: '2026-05-11T12:00:00.000Z', endsAt: NOW.toISOString(), stepSeconds: 5400 });
    expect(month.panels[0].points.length).toBeLessThanOrEqual(day.panels[0].points.length);
    // Sixteen points to a day still tells every night of the month apart.
    expect(month.nights.length).toBeGreaterThanOrEqual(29);
  });

  it('refuses a phase or a grow that names no grow: a tent may hold two at once', async () => {
    await expect(readAs(session(OWNER), { range: 'phase' })).rejects.toMatchObject({ problem: { status: 400, code: 'grow_required' } });
  });

  it('ends the window where the request points rather than at now', async () => {
    const page = await readAs(session(OWNER), { range: '24h', at: new Date('2026-06-08T12:00:00.000Z') });

    expect(page).toMatchObject({ startsAt: '2026-06-07T12:00:00.000Z', endsAt: '2026-06-08T12:00:00.000Z', dayFrom: 31, dayTo: 32 });
  });

  it('takes a window named outright - stepped back to, zoomed into - and still counts the grow´s days across it', async () => {
    const window = { startsAt: new Date('2026-06-08T03:00:00.000Z'), endsAt: new Date('2026-06-08T03:20:00.000Z') };
    const page = await readAs(session(OWNER), { range: 'grow', growId: GROW, window });

    expect(page).toMatchObject({
      range: 'grow',
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      dayFrom: 32,
      dayTo: 32,
    });
    // Twenty minutes are read at every sample a device sends.
    expect(page.stepSeconds).toBe(5);
    expect(page.panels[0].points).toHaveLength(240);
  });

  it('reads a window wider than three days at a whole number of five minutes, asked for or not', async () => {
    const wide = (days: number) => ({ startsAt: new Date(NOW.getTime() - days * 24 * 3600_000), endsAt: NOW });
    const stepOf = async (days: number, stepSeconds?: number) =>
      (await readAs(session(OWNER), { range: '24h', window: wide(days), stepSeconds })).stepSeconds;

    // Three days and six hours are 541 s to the point by their 480 windows: two grains of five minutes instead.
    expect([await stepOf(3.25), await stepOf(7), await stepOf(30)]).toEqual([600, 1500, 5400]);
    // A minute asked over a week is five; an hour asked stays an hour.
    expect([await stepOf(7, 60), await stepOf(7, 3600)]).toEqual([300, 3600]);
    // Inside three days nothing changes: a step somebody chose is kept.
    expect(await stepOf(2, 60)).toBe(60);
  });

  it('answers the last reading of the device its curves are of, for every reader the same', async () => {
    lastReading = {
      temperature: { value: 24.7, measuredAt: '2026-06-10T11:59:55.000Z', state: 'live' },
      humidity: { value: 53.4, measuredAt: '2026-06-10T11:59:55.000Z', state: 'live' },
    };
    const owner = (await readAs(session(OWNER))).reading;

    expect(owner).toMatchObject({ measuredAt: '2026-06-10T11:59:55.000Z', outputs: [] });
    expect(owner!.values.map(one => [one.metric, one.value])).toEqual([
      ['temperature', 24.7],
      ['humidity', 53.4],
    ]);
    // A level in per cent where the output has one, on or off where it only switches.
    expect(
      readingOf(
        {
          metrics: lastReading,
          outputs: {
            light: { value: 65, measuredAt: 'x', state: 'live' },
            heater: { value: 0.62, measuredAt: 'x', state: 'live' },
            dehumidifier: { value: 0, measuredAt: 'x', state: 'live' },
          },
        } as never,
        ['temperature'],
      )?.outputs,
    ).toEqual([
      { output: 'light', on: true, level: 65 },
      { output: 'heater', on: true, level: 62 },
      { output: 'dehumidifier', on: false, level: null },
    ]);
  });

  it('ends a window named into the future now, where the measuring ends', async () => {
    const today = { startsAt: new Date(NOW.getTime() - 6 * 3600_000), endsAt: new Date(NOW.getTime() + 18 * 3600_000) };
    const page = await readAs(session(OWNER), { range: '24h', window: today });

    expect(page).toMatchObject({ startsAt: today.startsAt.toISOString(), endsAt: NOW.toISOString() });
    // Six hours, read as six hours and not as a day of which three quarters are empty.
    expect(page.stepSeconds).toBe(45);
  });

  it('reads at the five seconds a device reports in for as long as that fits, and never between two samples', async () => {
    const wide = (minutes: number) => ({ startsAt: new Date(NOW.getTime() - minutes * 60_000), endsAt: NOW });
    const stepOf = async (minutes: number) => (await readAs(session(OWNER), { range: '24h', window: wide(minutes) })).stepSeconds;

    expect([await stepOf(5), await stepOf(40), await stepOf(60), await stepOf(90), await stepOf(6 * 60), await stepOf(8 * 60)]).toEqual([
      5, 5, 10, 15, 45, 60,
    ]);
    // A step somebody chose is kept, down to the same five seconds.
    expect((await readAs(session(OWNER), { range: '24h', window: wide(60), stepSeconds: 1 })).stepSeconds).toBe(5);
    expect((await readAs(session(OWNER), { range: '24h', stepSeconds: 600 })).stepSeconds).toBe(600);
  });

  it('asks the store for each window´s lowest and highest beside its mean', async () => {
    await readAs(session(OWNER));

    expect(reads.every(read => read.extremes === true)).toBe(true);
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
  it('stacks temperature, humidity and CO2 for a caller that names no panels', async () => {
    const page = await readAs(session(OWNER));

    expect(page.panels.map(panel => panel.metric)).toEqual(['temperature', 'humidity', 'co2']);
  });

  it('answers the panels a caller names, VPD among them, in the order it named them', async () => {
    sensed = ['temperature', 'humidity', 'vpd'];
    const page = await readAs(session(OWNER), { range: '24h', metrics: ['vpd', 'temperature', 'co2'] });

    expect(page.panels.map(panel => panel.metric)).toEqual(['vpd', 'temperature']);
    expect(reads.at(-1)?.metrics).toEqual(['vpd', 'temperature', 'co2']);
  });

  it('says the lowest and the highest of each window as the device read them, never bent towards the mean', () => {
    const at = '2026-06-10T11:57:00.000Z';
    const one = (point: { value: number; min?: number; max?: number }): DeviceSeries => ({
      deviceId: 'a',
      startsAt: '2026-06-10T11:00:00.000Z',
      endsAt: NOW.toISOString(),
      stepSeconds: DAY_STEP_SECONDS,
      metrics: [{ metric: 'humidity', points: [{ measuredAt: at, ...point }] }],
      outputs: [],
    });

    // A door open for forty seconds: the sensor saw 71.5 %, the three-minute mean barely moved.
    expect(panelsOf(one({ value: 56.04, min: 54.96, max: 71.52 }), [], ['humidity'])[0].points).toEqual([
      { measuredAt: at, value: 56, min: 55, max: 71.5 },
    ]);
    // A window of one sample has no extremes to tell from its value.
    expect(panelsOf(one({ value: 56 }), [], ['humidity'])[0].points).toEqual([{ measuredAt: at, value: 56 }]);
    // A deficit of 1.04 in every sample beside a mean that came to 1.05 stays the figure that occurred.
    expect(panelsOf(one({ value: 56.3, min: 56.1, max: 56.1 }), [], ['humidity'])[0].points[0]).toMatchObject({ min: 56.1, max: 56.1 });
    // Nothing measures: no panel.
    expect(panelsOf(null, [], ['humidity'])).toEqual([]);
  });

  it('stacks the leaf and the light under them where a canopy sensor measures them, with no band to miss', async () => {
    sensed = ['temperature', 'humidity', 'co2', 'leafTemperature', 'lux'];
    const page = await readAs(session(OWNER));

    expect(page.panels.map(panel => panel.metric)).toEqual(['temperature', 'humidity', 'co2', 'leafTemperature', 'lux']);
    expect(page.panels.slice(3).map(panel => panel.targets)).toEqual([[], []]);
    expect(new Set(page.panels[4].points.map(point => point.value))).toEqual(new Set([0, 41_250]));
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

  it('breaks a month after the last reading too, where the tent went quiet this morning', async () => {
    quietFrom = new Date(NOW.getTime() - 4 * 3600 * 1000);
    quietUntil = new Date(NOW.getTime() + 24 * 3600 * 1000);
    const points = (await readAs(session(OWNER), { range: '30d' })).panels[0].points;

    // Four of a month's windows are six hours: held to those, the morning's
    // figures stood under the afternoon's clock on a screen that said offline.
    expect(points.at(-2)!.value).not.toBeNull();
    expect(points.at(-1)!.value).toBeNull();
  });

  it('breaks a month at six hours nobody reported, as a week does: a window with no reading is a silence at every width', async () => {
    quietFrom = new Date(NOW.getTime() - 54 * 3600 * 1000);
    quietUntil = new Date(NOW.getTime() - 48 * 3600 * 1000);

    for (const range of ['7d', '30d'] as const) {
      const points = (await readAs(session(OWNER), { range })).panels[0].points;
      const breaks = points.filter(point => point.value === null);
      // Four of a month's windows are six hours, and held to those the month drew its line through the morning.
      expect(breaks).toHaveLength(1);
      expect(new Date(breaks[0].measuredAt).getTime()).toBeLessThan(quietUntil.getTime());
    }
  });

  it('carries a month to the edge of the window where the tent is still reporting', async () => {
    const points = (await readAs(session(OWNER), { range: '30d' })).panels[0].points;

    expect(points.at(-1)!.value).not.toBeNull();
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

describe('one climate of several', () => {
  const FRIDGE_MODULE = 'device-fridge-module';

  beforeEach(async () => {
    await db.devices.create({
      id: FRIDGE_MODULE,
      type: 'fridge',
      ownerId: OWNER,
      ...standingIn(TENT),
      configuration: { day: { temperature: 18, humidity: 60 }, night: { temperature: 16, humidity: 60 } },
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    reports = { ...reports, [FRIDGE_MODULE]: () => ({ metrics: { temperature: 18 }, outputs: {} }) };
  });

  const temperatures = async (deviceId?: string) =>
    (await readAs(session(OWNER), { range: '24h', ...(deviceId ? { deviceId } : {}) })).panels
      .find(panel => panel.metric === 'temperature')!
      .points.flatMap(point => (point.value === null ? [] : [point.value]));

  it('draws the place´s own device, the one asked for where one is, and never a mean of the two', async () => {
    const own = await temperatures();
    const fridge = await temperatures(FRIDGE_MODULE);

    expect(new Set(fridge)).toEqual(new Set([18]));
    // The controller alone, as Start reads it - not one figure between a tent and a fridge.
    expect(own).toEqual(await temperatures(CONTROLLER));
    expect(own.every(value => value !== 18)).toBe(true);
    expect((await readAs(session(OWNER), { range: '24h' })).deviceId).toBe(CONTROLLER);
    expect((await readAs(session(OWNER), { range: '24h', deviceId: FRIDGE_MODULE })).deviceId).toBe(FRIDGE_MODULE);
  });

  it('stands under a device`s curves its own outputs and not another climate`s: a fridge`s compressor is no part of the tent`s air', async () => {
    reports = { ...reports, [FRIDGE_MODULE]: () => ({ metrics: { temperature: 18 }, outputs: { dehumidifier: 1 } }) };
    const lanesOf = async (deviceId?: string) =>
      (await readAs(session(OWNER), { range: '24h', ...(deviceId ? { deviceId } : {}) })).outputs.map(lane => lane.deviceId);

    expect(new Set(await lanesOf())).toEqual(new Set([CONTROLLER]));
    expect(new Set(await lanesOf(FRIDGE_MODULE))).toEqual(new Set([FRIDGE_MODULE]));
    // Both still stand in the place, whichever is drawn.
    expect((await readAs(session(OWNER), { range: '24h' })).deviceIds).toEqual(expect.arrayContaining([CONTROLLER, FRIDGE_MODULE]));
  });

  it('dates a window without curves by the device its curves are of, not by another climate that spoke later', async () => {
    // Nothing measured in the window by either; each is asked for its own last reading, and only the drawn one's counts.
    reports = { [CONTROLLER]: () => null, [FRIDGE_MODULE]: () => null };
    liveAsked = [];
    await readAs(session(OWNER), { range: '24h' });
    expect(new Set(liveAsked)).toEqual(new Set([CONTROLLER]));

    liveAsked = [];
    await readAs(session(OWNER), { range: '24h', deviceId: FRIDGE_MODULE });
    expect(new Set(liveAsked)).toEqual(new Set([FRIDGE_MODULE]));
  });

  it('shows the camera of the controller it is paired to beside that climate only', async () => {
    expect((await readAs(session(OWNER), { range: '24h', deviceId: CONTROLLER })).cameras.map(camera => camera.cameraId)).toEqual([CAMERA]);
    expect((await readAs(session(OWNER), { range: '24h', deviceId: FRIDGE_MODULE })).cameras).toEqual([]);
    expect((await readAs(session(OWNER), { range: '24h' })).cameras.map(camera => camera.cameraId)).toEqual([CAMERA]);
  });

  it('answers a device that does not stand here as one that does not exist', async () => {
    await expect(readAs(session(OWNER), { range: '24h', deviceId: 'device-elsewhere' })).rejects.toMatchObject({
      problem: { status: 404, code: 'device_not_here' },
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

  describe('the record of what the controller aimed at', () => {
    /** What the controller is configured with now, which is what the cockpit judges the tent against. */
    const NOW_AIMED = { day: { temperature: 27, humidity: 40 }, night: { temperature: 22, humidity: 45 }, co2: 1100 };
    const FLOWER_AIMED = { day: { temperature: 26, humidity: 45 }, night: { temperature: 21, humidity: 50 }, co2: 900 };
    const aimed = (temperature: number) => ({ day: { temperature, humidity: 50 }, night: { temperature: temperature - 4, humidity: 55 }, co2: 900 });

    const recorded = (...rows: [string, object][]) =>
      db.targetChanges.create(rows.map(([at, targets], index) => ({ id: `change-${index}`, deviceId: CONTROLLER, at: new Date(at), targets })));
    const setpoints = async (asked?: { range: TimelineRange; at?: Date }) =>
      ((await readAs(session(OWNER), asked)).panels.find(panel => panel.metric === 'temperature')?.targets ?? []).map(one => [
        one.startsAt,
        one.phaseId,
        one.day?.setpoint,
      ]);

    it('draws the band from the record over a phase´s snapshot, so the present is what the cockpit judges against', async () => {
      // The tent was put on another climate this morning, a phase that began
      // overnight: from then on the snapshot is not what the controller holds.
      await recorded(['2026-06-01T00:00:00.000Z', aimed(24)], [FLOWERING_FROM.toISOString(), FLOWER_AIMED], ['2026-06-10T09:00:00.000Z', NOW_AIMED]);

      // The hour after each change is a stretch of its own, its band reaching
      // over what was aimed at just before: 24 °C before flower, 26 °C before this morning.
      expect(await setpoints()).toEqual([
        ['2026-06-09T12:00:00.000Z', 'phase-veg', 24],
        [FLOWERING_FROM.toISOString(), 'phase-flower', 26],
        ['2026-06-10T01:00:00.000Z', 'phase-flower', 26],
        ['2026-06-10T09:00:00.000Z', 'phase-flower', 27],
        ['2026-06-10T10:00:00.000Z', 'phase-flower', 27],
      ]);
      const bands = (await readAs(session(OWNER))).panels.find(panel => panel.metric === 'temperature')?.targets ?? [];
      expect(bands.map(one => [one.settling ?? false, one.day?.band])).toEqual([
        [false, { low: 23, high: 25 }],
        [true, { low: 23, high: 27 }],
        [false, { low: 25, high: 27 }],
        [true, { low: 25, high: 28 }],
        [false, { low: 26, high: 28 }],
      ]);
    });

    it('keeps a phase´s snapshot for the part of the window the record does not reach back to', async () => {
      await recorded(['2026-06-10T09:00:00.000Z', NOW_AIMED]);

      expect(await setpoints()).toEqual([
        ['2026-06-09T12:00:00.000Z', 'phase-veg', 24],
        [FLOWERING_FROM.toISOString(), 'phase-flower', 26],
        ['2026-06-10T09:00:00.000Z', 'phase-flower', 27],
      ]);
    });

    it('draws no seam where the record only confirms what the phase took down', async () => {
      await recorded(['2026-06-10T03:00:00.000Z', FLOWER_AIMED]);

      expect(await setpoints()).toEqual([
        ['2026-06-09T12:00:00.000Z', 'phase-veg', 24],
        [FLOWERING_FROM.toISOString(), 'phase-flower', 26],
      ]);
    });

    it('reads only the record of the device the band is the targets of', async () => {
      await db.targetChanges.create({ id: 'change-plug', deviceId: PLUG, at: new Date('2026-06-10T09:00:00.000Z'), targets: aimed(30) });

      expect((await setpoints()).map(([, , setpoint]) => setpoint)).toEqual([24, 26]);
    });

    it('borrows the first thing the record knows rather than today´s figures where nothing grows here', async () => {
      await db.grows.deleteMany({});
      await recorded(['2026-06-10T06:00:00.000Z', aimed(25)], ['2026-06-10T10:00:00.000Z', NOW_AIMED]);

      expect(await setpoints()).toEqual([
        ['2026-06-09T12:00:00.000Z', null, 25],
        ['2026-06-10T10:00:00.000Z', null, 27],
        ['2026-06-10T11:00:00.000Z', null, 27],
      ]);
      // A week back the record has not begun yet, and its first row is still
      // nearer to that week than this morning's change.
      expect(await setpoints({ range: '24h', at: new Date('2026-06-05T12:00:00.000Z') })).toEqual([['2026-06-04T12:00:00.000Z', null, 25]]);
    });
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
        // The configuration says how the controller holds them: by its schedule.
        held: 'schedule',
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

    // Nobody said anything about the lamp for four hours: the night ends where it was last heard. It is picked
    // up with the window the first point after the silence stands for, the step before the lamp is found lit.
    const back = { startsAt: new Date(quietUntil.getTime() - DAY_STEP_SECONDS * 1000).toISOString(), endsAt: quietUntil.toISOString() };
    expect(page.nights).toEqual([{ startsAt: '2026-06-09T18:00:00.000Z', endsAt: lastHeard }, back]);
    expect(page.outputs.find(lane => lane.output === 'heater')?.spans).toEqual([{ startsAt: '2026-06-09T18:00:00.000Z', endsAt: lastHeard }, back]);
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
    // from where the device turned up - the window its first point stands for - and that is where the run starts.
    quietFrom = new Date(opens);
    quietUntil = new Date('2026-06-09T12:30:00.000Z');
    expect(await lightOf()).toEqual({ ...lit, startsAt: new Date(quietUntil.getTime() - DAY_STEP_SECONDS * 1000).toISOString() });
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

  it('answers a link neither an alarm nor a line a device wrote: the climate, and what people wrote', async () => {
    await db.entries.create([
      entry({
        id: 'entry-alarm',
        kind: 'alarm',
        source: 'alarm',
        authorId: null,
        spaceId: TENT,
        growId: GROW,
        alertId: 'alert-open',
        occurredAt: new Date('2026-06-05T10:00:00.000Z'),
        message: { key: 'message-alarm-triggered', params: ['Too humid (humidity), value=71'] },
        values: { kind: 'alarm' },
      }),
      entry({ id: 'entry-written', growId: GROW, occurredAt: new Date('2026-06-05T11:00:00.000Z') }),
    ]);
    const token = await linkFor({});

    const theirs = await readAs(visitor(token), { range: '7d' });
    const mine = await readAs(session(OWNER), { range: '7d' });

    expect(theirs.events.map(line => line.id)).toContain('entry-written');
    expect(theirs.events.every(line => line.source === 'human')).toBe(true);
    expect(theirs.alarms).toEqual([]);
    expect(JSON.stringify(theirs)).not.toMatch(/alert-open|entry-alarm/);
    // Whoever keeps the tent reads the alarm, as a line and on its lane.
    expect(mine.events.map(line => line.id)).toContain('entry-alarm');
  });

  it('keeps a link inside its own window and its own cut when it names a window and a step outright', async () => {
    await db.entries.create([
      entry({
        id: 'entry-restart',
        kind: 'system',
        source: 'device',
        authorId: null,
        spaceId: TENT,
        deviceId: CONTROLLER,
        occurredAt: new Date('2026-06-09T10:00:00.000Z'),
        message: { key: 'message-device-restarted', params: [] },
        values: { kind: 'system' },
      }),
      entry({ id: 'entry-inside', growId: GROW, occurredAt: new Date('2026-06-09T11:00:00.000Z') }),
      entry({ id: 'entry-after', growId: GROW, occurredAt: new Date('2026-06-10T09:00:00.000Z') }),
    ]);
    const token = await linkFor({});
    const asked = {
      range: '24h' as const,
      window: { startsAt: new Date('2026-06-09T06:00:00.000Z'), endsAt: new Date('2026-06-10T12:00:00.000Z') },
      stepSeconds: 60,
      metrics: ['temperature', 'vpd'] as Metric[],
    };

    const theirs = await readAs(visitor(token), asked);

    // The window ends where the link's does, whatever was named.
    expect(theirs).toMatchObject({ startsAt: '2026-06-09T06:00:00.000Z', endsAt: '2026-06-10T00:00:00.000Z', stepSeconds: 60 });
    expect(theirs.events.map(line => line.id)).toContain('entry-inside');
    expect(theirs.events.map(line => line.id)).not.toContain('entry-after');
    expect(theirs.events.every(line => line.source === 'human')).toBe(true);
    expect(theirs.alarms).toEqual([]);
    expect(theirs.machineEvents).toEqual({ shown: 0, total: 0 });
    expect(theirs.deviceIds).toBeNull();
    expect(theirs.outputs.every(lane => lane.deviceId === null)).toBe(true);
    expect(theirs.grows).toEqual([]);
    expect(JSON.stringify(theirs)).not.toMatch(/entry-restart|device-controller|alert-/);
    // Whoever keeps the tent reads the restart in the same window.
    expect((await readAs(session(OWNER), asked)).events.map(line => line.id)).toContain('entry-restart');
  });

  it('clamps every range to the link´s own window, however wide a range was asked for', async () => {
    const token = await linkFor({});
    const page = await readAs(visitor(token), { range: 'grow', growId: GROW });

    expect(page).toMatchObject({ startsAt: '2026-06-03T00:00:00.000Z', endsAt: '2026-06-10T00:00:00.000Z' });
    // The tent and not the hardware in it: no device ids, and none on the lanes either.
    expect(page.deviceIds).toBeNull();
    expect(page.outputs.length).toBeGreaterThan(0);
    expect(page.outputs.every(lane => lane.deviceId === null)).toBe(true);
    // The flowering phase begins where the link's window ends, so the week it
    // was given out for is one phase and one band.
    expect(page.panels[0].targets.map(target => target.phaseId)).toEqual(['phase-veg']);
    expect(page.events.map(line => line.id)).toEqual(['entry-water']);
    // An alarm open across the window is the keeper's to know of, not the link's.
    expect(page.alarms).toEqual([]);
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

    // What people wrote; the line the controller wrote about the tent is not among them.
    expect(page.events.map(line => line.id)).toEqual(['entry-water', 'entry-training']);
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

    for (const at of walk(SWITCHING_GRAIN_MS)) {
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
      for (let raw = at; raw < closes; raw += SWITCHING_GRAIN_MS) inside.push(litAt(raw));

      // Stamped at the end of its window, as `aggregateWindow` stamps a mean.
      return { measuredAt: new Date(closes).toISOString(), value: inside.reduce((sum, one) => sum + one, 0) / inside.length };
    });

    return {
      series: {
        deviceId: CONTROLLER,
        startsAt: OPENS.toISOString(),
        endsAt: CLOSES.toISOString(),
        stepSeconds: STEP_SECONDS,
        metrics: [],
        outputs: [{ output: 'light', points }],
      },
      outputs: switchingsOf({ ...WINDOW, metrics: [], outputs: ['light'] }, (_, at) => litAt(at.getTime()) > 0),
      // Still reporting when the window closed, one grain short of its edge.
      lastSampleAt: new Date(CLOSES.getTime() - SWITCHING_GRAIN_MS).toISOString(),
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

  it('shades an AIR fan´s place by the night the fan reports, where no lamp is there to say it', () => {
    const lamp = history();
    // The same cycle, reported by a fan as its own day rather than switched as a lamp: the fan has no light output at all.
    const fan: DeviceHistory = {
      series: { ...lamp.series, outputs: [{ output: 'fan', points: lamp.series.outputs[0].points }] },
      outputs: [{ output: 'fan', switchings: [] }],
      lastSampleAt: lamp.lastSampleAt,
      days: lamp.outputs[0].switchings,
    };

    expect(nightsOf([fan], WINDOW)).toEqual(stretches(false));
    // A lamp in the same place still answers first, and a fan that said nothing of its day shades nothing.
    expect(nightsOf([fan, lamp], WINDOW)).toEqual(stretches(false));
    expect(nightsOf([{ ...fan, days: undefined }], WINDOW)).toEqual([]);
  });

  it('draws the lamp´s lane as the stretches it ran for, at the same resolution', () => {
    expect(lanesOf([history()], WINDOW)).toEqual([
      { output: 'light', deviceId: CONTROLLER, spans: stretches(true), heardUntil: CLOSES.toISOString() },
    ]);
  });

  it('says what the samples of each output came to, point by drawn point, where the read counted them', () => {
    const lamp = history();
    const at = (minutes: number) => new Date(OPENS.getTime() + minutes * 60_000).toISOString();
    const read: DeviceHistory = {
      ...lamp,
      outputs: [
        {
          ...lamp.outputs[0],
          figures: [
            { measuredAt: at(10), heard: 6, on: 6, mean: 62.44 },
            // Lit in two samples of six at 70 %: the mean of all six, the dark ones counting as 0.
            { measuredAt: at(20), heard: 6, on: 2, mean: 70 / 3 },
          ],
        },
        {
          output: 'heater',
          switchings: lamp.outputs[0].switchings,
          figures: [
            { measuredAt: at(10), heard: 6, on: 2, mean: 0.8 / 3 },
            { measuredAt: at(20), heard: 6, on: 6, mean: 1.2 },
          ],
        },
        // A valve that pulsed in one sample of twenty-four: its ticks are no share of anything.
        { output: 'co2', switchings: lamp.outputs[0].switchings, figures: [{ measuredAt: at(10), heard: 24, on: 1, mean: 145.8 }] },
        { output: 'dehumidifier', switchings: lamp.outputs[0].switchings, figures: [{ measuredAt: at(10), heard: 6, on: 2, mean: 1 / 3 }] },
        // Not counted: the read did not ask.
        { output: 'fan', switchings: lamp.outputs[0].switchings },
      ],
    };

    const lanes = lanesOf([read], WINDOW);

    expect(lanes.map(lane => [lane.output, lane.points])).toEqual([
      [
        'light',
        [
          { measuredAt: at(10), heard: 6, on: 6, level: 62.4 },
          { measuredAt: at(20), heard: 6, on: 2, level: 23.3 },
        ],
      ],
      // The heater's demand is a fraction of one, and never more than all of it.
      [
        'heater',
        [
          { measuredAt: at(10), heard: 6, on: 2, level: 26.7 },
          { measuredAt: at(20), heard: 6, on: 6, level: 100 },
        ],
      ],
      ['co2', [{ measuredAt: at(10), heard: 24, on: 1, level: null }]],
      ['dehumidifier', [{ measuredAt: at(10), heard: 6, on: 2, level: null }]],
      ['fan', undefined],
    ]);
    expect('points' in lanes[4]).toBe(false);
    expect('level' in lanes[0]).toBe(false);
  });

  it('says a lane is a fridge module´s, to a link as well, so its dehumidifier can be called the compressor', () => {
    expect(lanesOf([history()], WINDOW, true, new Set([CONTROLLER]))[0]).toMatchObject({ output: 'light', deviceId: null, fridge: true });
    expect('fridge' in lanesOf([history()], WINDOW, true, new Set(['another-device']))[0]).toBe(false);
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

  it('does not say the lamp is on for the hours after its device went quiet this morning, however wide the windows', () => {
    // Quiet for three hours of a month read at an hour and a half to the window: four of those windows are six
    // hours, and held to them the lane ran to "now" under a pill that said offline.
    const morning = new Date(CLOSES.getTime() - 3 * 3600 * 1000);
    const quiet = history(morning.toISOString());
    quiet.series.outputs[0].points = quiet.series.outputs[0].points.map(point => ({ ...point, value: 60 }));

    expect(lanesOf([quiet], WINDOW)[0].heardUntil).toBe(morning.toISOString());
    expect(lanesOf([quiet], WINDOW)[0].spans.at(-1)!.endsAt).toBe(morning.toISOString());
  });

  it('reads the lamp of each device over its own stay, so the nights before a change of the measuring device are drawn', () => {
    // The device before held the first half of the window and was dark throughout; the one after it the second, lit.
    const half = new Date((OPENS.getTime() + CLOSES.getTime()) / 2);
    const stay = (deviceId: string, from: Date, to: Date, on: boolean): DeviceHistory => ({
      series: {
        deviceId,
        startsAt: from.toISOString(),
        endsAt: to.toISOString(),
        stepSeconds: STEP_SECONDS,
        metrics: [],
        outputs: [
          {
            output: 'light' as const,
            points: Array.from({ length: Math.floor((to.getTime() - from.getTime()) / (STEP_SECONDS * 1000)) }, (_, index) => ({
              measuredAt: new Date(from.getTime() + (index + 1) * STEP_SECONDS * 1000).toISOString(),
              value: on ? 60 : 0,
            })),
          },
        ],
      },
      outputs: [{ output: 'light' as const, switchings: [{ at: from.toISOString(), on }] }],
      lastSampleAt: new Date(to.getTime() - 5000).toISOString(),
    });
    const nights = nightsOf([stay('new', half, CLOSES, true), stay('old', OPENS, half, false)], WINDOW);

    expect(nights).toHaveLength(1);
    expect(nights[0].startsAt).toBe(OPENS.toISOString());
    // The first device's night ends where its stay does, give or take the last window it was heard in.
    expect(Math.abs(Date.parse(nights[0].endsAt) - half.getTime())).toBeLessThanOrEqual(STEP_SECONDS * 1000);
  });

  it('begins the state a window is found in where the window begins, not at the first grain a sample fell into', () => {
    // A window named from 22:01:13 by night: the store stamps the opening state 22:01:15, the first grain
    // anything was written in, and a night that began there left two seconds of day in a window of darkness.
    const found = history(new Date(CLOSES.getTime() - 5000).toISOString());
    found.series.outputs[0].points = found.series.outputs[0].points.map(point => ({ ...point, value: 0 }));
    found.outputs[0].switchings = [{ at: new Date(OPENS.getTime() + 2000).toISOString(), on: false }];

    expect(nightsOf([found], WINDOW)).toEqual([{ startsAt: OPENS.toISOString(), endsAt: CLOSES.toISOString() }]);
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

describe('a place whose devices changed', () => {
  const OLD = 'device-old';
  const NEW = 'device-new';
  /** The old controller was taken out twelve hours ago and the new one put in at the same moment. */
  const SWAPPED = new Date(NOW.getTime() - 12 * 60 * 60 * 1000);
  const configuration = { day: { temperature: 27, humidity: 40 }, night: { temperature: 22, humidity: 45 } };

  beforeEach(async () => {
    await db.devices.create([
      {
        id: OLD,
        type: 'controller',
        ownerId: OWNER,
        spaceId: null,
        placements: [{ spaceId: BARE, startedAt: new Date(0), endedAt: SWAPPED }],
        configuration,
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
      },
      { id: NEW, type: 'controller', ownerId: OWNER, ...standingIn(BARE, SWAPPED), configuration, createdAt: new Date('2026-01-04T00:00:00.000Z') },
    ]);
    reports = {
      ...reports,
      [OLD]: () => ({ metrics: { temperature: 20 }, outputs: { heater: 1 } }),
      [NEW]: () => ({ metrics: { temperature: 26 }, outputs: { heater: 1 } }),
    };
  });

  const temperatures = (page: Awaited<ReturnType<typeof readAs>>) =>
    page.panels[0].points.flatMap(point => (point.value === null ? [] : [{ at: Date.parse(point.measuredAt), value: point.value }]));

  it('draws the device that held the place before, up to the change, and the one standing there from it', async () => {
    const page = await readAs(session(OWNER), { range: '24h', metrics: ['temperature'] }, BARE);
    const drawn = temperatures(page);

    expect(page.deviceId).toBe(NEW);
    expect(new Set(drawn.filter(point => point.at < SWAPPED.getTime()).map(point => point.value))).toEqual(new Set([20]));
    expect(new Set(drawn.filter(point => point.at > SWAPPED.getTime()).map(point => point.value))).toEqual(new Set([26]));
    // The one that left was asked only about its stay. The new one came straight out of its box, so what it measured
    // before it was put here is read too - and gives way to the device that held the place then.
    expect(reads.map(read => [read.startsAt.toISOString(), read.endsAt.toISOString()]).sort()).toEqual(
      [
        [new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(), SWAPPED.toISOString()],
        [new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(), NOW.toISOString()],
      ].sort(),
    );
    // What switched under the curve is each device's own, the one that left included.
    expect(page.outputs.filter(lane => lane.output === 'heater').map(lane => lane.deviceId)).toEqual([NEW, OLD]);
  });

  it('draws nothing from where a device stood before it came', async () => {
    await db.devices.deleteOne({ id: OLD });
    await db.devices.updateOne(
      { id: NEW },
      {
        $set: {
          placements: [
            { spaceId: TENT, startedAt: new Date(0), endedAt: SWAPPED },
            { spaceId: BARE, startedAt: SWAPPED, endedAt: null },
          ],
        },
      },
    );
    const drawn = temperatures(await readAs(session(OWNER), { range: '24h', metrics: ['temperature'] }, BARE));

    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every(point => point.at >= SWAPPED.getTime() && point.value === 26)).toBe(true);
    expect(reads.map(read => read.startsAt.toISOString())).toEqual([SWAPPED.toISOString()]);
  });

  it('draws what a device measured before it was first put anywhere, where nothing else held the place', async () => {
    await db.devices.deleteOne({ id: OLD });
    const drawn = temperatures(await readAs(session(OWNER), { range: '24h', metrics: ['temperature'] }, BARE));

    expect(drawn.some(point => point.at < SWAPPED.getTime())).toBe(true);
    expect(new Set(drawn.map(point => point.value))).toEqual(new Set([26]));
  });

  it('shows a device that has left alone when it is asked for, and refuses one that never stood there', async () => {
    const page = await readAs(session(OWNER), { range: '24h', metrics: ['temperature'], deviceId: OLD }, BARE);

    expect(page.deviceId).toBe(OLD);
    expect(new Set(temperatures(page).map(point => point.value))).toEqual(new Set([20]));
    await expect(readAs(session(OWNER), { range: '24h', deviceId: CONTROLLER }, BARE)).rejects.toMatchObject({
      problem: { code: 'device_not_here' },
    });
  });

  it('does not take a second climate standing beside the first for its past', async () => {
    // Both stand there now; the newer one came twelve hours ago and is not the place's own climate.
    await db.devices.updateOne({ id: OLD }, { $set: standingIn(BARE) });
    const drawn = temperatures(await readAs(session(OWNER), { range: '24h', metrics: ['temperature'] }, BARE));

    expect(new Set(drawn.map(point => point.value))).toEqual(new Set([20]));
  });

  it('bands the stretch before the change by what the device that left aimed at', async () => {
    await db.targetChanges.create([
      {
        id: 'aim-old',
        deviceId: OLD,
        at: new Date(0),
        targets: { day: { temperature: 21, humidity: 50 }, night: { temperature: 21, humidity: 50 } },
        cycle: null,
      },
      // Recorded while it stood somewhere else, long before it came here.
      {
        id: 'aim-new',
        deviceId: NEW,
        at: new Date(0),
        targets: { day: { temperature: 27, humidity: 40 }, night: { temperature: 27, humidity: 40 } },
        cycle: null,
      },
    ]);
    const page = await readAs(session(OWNER), { range: '24h', metrics: ['temperature'] }, BARE);
    const aimed = page.panels[0].targets.map(stretch => ({ from: Date.parse(stretch.startsAt), setpoint: stretch.day?.setpoint }));

    expect(aimed[0]).toEqual({ from: NOW.getTime() - 24 * 60 * 60 * 1000, setpoint: 21 });
    expect(aimed.filter(stretch => stretch.from < SWAPPED.getTime()).every(stretch => stretch.setpoint === 21)).toBe(true);
    expect(aimed.filter(stretch => stretch.from >= SWAPPED.getTime()).map(stretch => stretch.setpoint)).toEqual([27, 27]);
    // The new device was put in at the change: the hour after it is its climate settling, as after any change.
    expect(page.panels[0].targets.find(stretch => stretch.startsAt === SWAPPED.toISOString())?.settling).toBe(true);
  });

  it('says when the device that measures changed - not beside one device asked for, and not to a reader from outside', async () => {
    await db.devices.updateOne({ id: NEW }, { $set: { name: 'Controller B' } });
    await db.shareLinks.create({
      id: 'link-bare',
      token: 'bare-token',
      kind: 'view',
      subject: { type: 'space', id: BARE },
      range: { startsAt: null, endsAt: null },
      includeCameras: false,
      createdBy: OWNER,
      expiresAt: null,
      revokedAt: null,
    });

    expect((await readAs(session(OWNER), { range: '24h' }, BARE)).deviceChanges).toEqual([
      { kind: 'device', at: SWAPPED.toISOString(), name: 'Controller B', type: 'controller' },
    ]);
    expect((await readAs(session(OWNER), { range: '24h', deviceId: NEW }, BARE)).deviceChanges).toEqual([]);
    expect((await readAs(visitor('bare-token'), { range: '24h' }, BARE)).deviceChanges).toEqual([]);
  });

  it('tells no change where the move was taken back inside five minutes: no placement is left of it', async () => {
    const back = new Date(SWAPPED.getTime() + 2 * 60 * 1000);
    const old = movedTo(movedTo([{ spaceId: BARE, startedAt: new Date(0), endedAt: null }], null, SWAPPED), BARE, back);
    const tried = movedTo(movedTo([], BARE, SWAPPED), null, back);
    await db.devices.updateOne({ id: OLD }, { $set: { spaceId: BARE, placements: old } });
    await db.devices.updateOne({ id: NEW }, { $set: { spaceId: null, placements: tried } });
    const page = await readAs(session(OWNER), { range: '24h', metrics: ['temperature'] }, BARE);

    expect(tried).toEqual([]);
    expect(page.deviceChanges).toEqual([]);
    expect(page.deviceId).toBe(OLD);
  });

  it('runs each device`s strip over its own stay: none before it came, none after it left', async () => {
    const page = await readAs(session(OWNER), { range: '24h' }, BARE);
    const heater = (deviceId: string) => page.outputs.find(lane => lane.output === 'heater' && lane.deviceId === deviceId)!;

    // The new one is in its first placement and so is read from before it came; while the old one held the place
    // its heater was no part of this place.
    expect(heater(NEW).spans).toEqual([{ startsAt: SWAPPED.toISOString(), endsAt: NOW.toISOString() }]);
    expect(heater(OLD).spans.at(-1)!.endsAt).toBe(SWAPPED.toISOString());
    expect(heater(OLD).heardUntil).toBe(SWAPPED.toISOString());
  });

  it('does not begin a strip a step early: the one point of a device that just came stands for a month`s hour and a half', () => {
    const window = { startsAt: new Date(NOW.getTime() - 30 * 24 * 3600 * 1000), endsAt: NOW };
    const came = new Date(NOW.getTime() - 20 * 60 * 1000);
    const point = { measuredAt: NOW.toISOString(), value: 1 };
    const history: DeviceHistory = {
      series: {
        deviceId: NEW,
        startsAt: came.toISOString(),
        endsAt: NOW.toISOString(),
        stepSeconds: 5400,
        metrics: [],
        outputs: [{ output: 'heater', points: [point] }],
      },
      outputs: [{ output: 'heater', switchings: [{ at: came.toISOString(), on: true }] }],
      lastSampleAt: new Date(NOW.getTime() - 5000).toISOString(),
    };

    expect(lanesOf([history], window)[0].spans).toEqual([{ startsAt: came.toISOString(), endsAt: NOW.toISOString() }]);
  });

  it('counts an alarm for the place it was raised in, not for wherever its device stands since', async () => {
    await db.alerts.create([
      // Raised by the old controller in the tent it went to, after it left here.
      { id: 'alert-elsewhere', deviceId: OLD, spaceId: TENT, kind: 'offline', severity: 'critical', startedAt: new Date(NOW.getTime() - 3600_000) },
      // Raised here by the new one.
      { id: 'alert-here', deviceId: NEW, spaceId: BARE, kind: 'offline', severity: 'critical', startedAt: new Date(NOW.getTime() - 1800_000) },
      // Naming no place: by the device, inside its stay - the old one's after it left is not this place's.
      { id: 'alert-unplaced', deviceId: OLD, kind: 'offline', severity: 'critical', startedAt: new Date(NOW.getTime() - 900_000) },
    ]);

    expect((await readAs(session(OWNER), { range: '24h' }, BARE)).alarms.map(alarm => alarm.alertId)).toEqual(['alert-here']);
  });
});
