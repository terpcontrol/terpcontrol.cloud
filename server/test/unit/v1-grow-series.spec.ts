import type { DeviceSeries, Metric } from '@fg2/shared-types/v1';
import { growSeries } from '@fg2/shared-types/v1-schemas';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { DataService, DeviceHistory, OutputHistory, SeriesRequest } from '@modules/data/data.service';
import { GrowSeriesQuery, GrowSeriesService } from '@modules/v1/grow/grow-series.service';
import { GrowsService } from '@modules/v1/grow/grows.service';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The Charts view: what a line is drawn from, and who is allowed to be told.
 *
 * The climate half is the timeline's arithmetic read through a grow instead of
 * through a tent, so what is asserted here is the part that is this route's
 * own: that a grow that moved is read from both tents, that the band follows
 * the phase, that VPD - which the timeline leaves out on purpose - is
 * answerable, and that the grow's own readings come back as the events they
 * are, with the plant and the line they were written on.
 *
 * The rest is who may look. A link is given a week of a four-week grow, and the
 * assertion is that nothing outside that week reaches it - not a climate point,
 * and not a reading.
 */

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const STRANGER = 'user-stranger';

const TENT = 'tent-1';
const FRIDGE = 'fridge-1';
const CONTROLLER = 'device-controller';
const CHILLER = 'device-chiller';
const GROW = 'grow-spring';

const NOW = new Date('2026-06-10T12:00:00.000Z');
/** Day 1. */
const ORIGIN = new Date('2026-05-13T12:00:00.000Z');
/** The grow flips overnight, so a 24 h window ending at noon spans two phases. */
const FLOWERING_FROM = new Date('2026-06-10T00:00:00.000Z');
/** The week the link was given, which ends long before the window a chip would ask for. */
const LINK_FROM = new Date('2026-05-20T00:00:00.000Z');
const LINK_TO = new Date('2026-05-27T00:00:00.000Z');

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });
const visitor = (shareToken: string): AccessContext => ({ userId: null, isAdmin: false, isDemo: false, shareToken });
const demo = (): AccessContext => ({ userId: null, isAdmin: false, isDemo: true, shareToken: null });

let db: V1TestDatabase;
let access: AccessService;
let series: GrowSeriesService;
let reads: SeriesRequest[];

const isLit = (at: Date): boolean => at.getUTCHours() >= 6 && at.getUTCHours() < 18;

/** The store looks for a switching at a grain of its own, far finer than the step a wide window is drawn with. */
const SWITCHING_GRAIN_MS = 300 * 1000;

/** What the store answers about the outputs: the state the window opens in, then every switching. */
const fakeSwitchings = (deviceId: string, request: SeriesRequest): OutputHistory[] =>
  (request.outputs ?? []).map(output => {
    if (deviceId !== CONTROLLER || output !== 'light') return { output, switchings: [] };

    const switchings: { at: string; on: boolean }[] = [];
    let last: boolean | null = null;
    for (let at = request.startsAt.getTime(); at < request.endsAt.getTime(); at += SWITCHING_GRAIN_MS) {
      const on = isLit(new Date(at));
      if (on !== last) switchings.push({ at: new Date(at).toISOString(), on });
      last = on;
    }

    return { output, switchings };
  });

/** Both devices report; only the controller drives a lamp. */
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
    const instants: Date[] = [];
    for (let at = request.startsAt.getTime(); at < request.endsAt.getTime(); at += step) instants.push(new Date(at));

    const metric = (name: Metric, at: Date): number =>
      name === 'vpd' ? (isLit(at) ? 1.2 : 0.8) : name === 'humidity' ? 55 : name === 'co2' ? 900 : isLit(at) ? 24.8 : 20;

    return {
      deviceId,
      startsAt: request.startsAt.toISOString(),
      endsAt: request.endsAt.toISOString(),
      stepSeconds: request.stepSeconds ?? 60,
      metrics: request.metrics.map(name => ({
        metric: name,
        points: instants.map(at => ({ measuredAt: at.toISOString(), value: metric(name, at) })),
      })),
      outputs: (request.outputs ?? []).map(output => ({
        output,
        points: instants.map(at => ({
          measuredAt: at.toISOString(),
          value: deviceId === CONTROLLER && output === 'light' ? (isLit(at) ? 1 : 0) : null,
        })),
      })),
    };
  },
} as unknown as DataService;

/** Exactly what the route does: the guard decides, and the answer is built from what it decided. */
const readAs = async (ctx: AccessContext, asked: GrowSeriesQuery) => {
  const grant: Grant = await access.require(ctx, subjectRef('grow', GROW), 'view');
  return series.read(grant, GROW, asked, await growsService().redaction(grant), NOW);
};

const growsService = (): GrowsService =>
  new GrowsService(
    db.grows,
    db.plants,
    db.devices,
    db.memberships,
    db.spaces,
    db.users,
    db.shareLinks,
    db.entries,
    access,
    null as never,
    null as never,
  );

const reading = (at: Date, readings: { key: string; value: number; plantId: string | null }[], kind = 'measurement'): EntryDocument =>
  ({
    id: `entry-${at.toISOString()}-${kind}`,
    createdAt: at,
    kind,
    occurredAt: at,
    source: 'human',
    authorId: OWNER,
    growId: GROW,
    spaceId: null,
    deviceId: null,
    plantIds: [],
    cameraId: null,
    taskId: null,
    alertId: null,
    severity: null,
    text: null,
    message: null,
    values: kind === 'measurement' ? { kind: 'measurement', readings } : { kind: 'water', litres: 2, readings },
    mediaIds: [],
    undoUntil: null,
  }) as unknown as EntryDocument;

const world = async (): Promise<void> => {
  await db.users.create([
    { id: OWNER, email: 'owner@test.invalid', handle: 'owner', passwordHash: 'x', privacy: { hideWeights: true, hideCounts: true } },
    { id: MEMBER, email: 'member@test.invalid', handle: 'mia', passwordHash: 'x' },
    { id: STRANGER, email: 'stranger@test.invalid', handle: 'greenthumb', passwordHash: 'x' },
  ]);

  await db.spaces.create([
    { id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent 1', roomId: null },
    { id: FRIDGE, ownerId: OWNER, kind: 'fridge', name: 'The fridge', roomId: null },
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
    { id: CHILLER, type: 'fridge', ownerId: OWNER, spaceId: FRIDGE, configuration: null, createdAt: new Date('2026-01-02T00:00:00.000Z') },
  ]);

  await db.grows.create({
    id: GROW,
    ownerId: OWNER,
    name: 'Spring run #3',
    type: 'photoperiod',
    slug: 'spring-run-3',
    startedAt: ORIGIN,
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
    ],
    placements: [{ id: 'placement-1', spaceId: TENT, startedAt: ORIGIN, endedAt: null, plantIds: null }],
    measurements: [
      { key: 'height', name: 'Height', unit: 'cm', perPlant: true, targetMin: null, targetMax: null, chart: true },
      { key: 'ec_in', name: 'EC · input', unit: 'mS/cm', perPlant: false, targetMin: 1.6, targetMax: 1.6, chart: true },
    ],
  });
  await db.plants.create([
    { id: 'plant-1', growId: GROW, strain: 'Amnesia', label: 'Amnesia 1', status: 'active', createdAt: ORIGIN },
    { id: 'plant-2', growId: GROW, strain: 'Gelato', label: 'Gelato 1', status: 'active', createdAt: ORIGIN },
  ]);

  await db.entries.create([
    // Inside the link's week, and outside it on either side.
    reading(new Date('2026-05-15T09:00:00.000Z'), [{ key: 'height', value: 12, plantId: 'plant-1' }]),
    reading(new Date('2026-05-22T09:00:00.000Z'), [
      { key: 'height', value: 21, plantId: 'plant-1' },
      { key: 'height', value: 19, plantId: 'plant-2' },
    ]),
    reading(new Date('2026-05-23T09:00:00.000Z'), [{ key: 'ec_in', value: 1.4, plantId: null }], 'water'),
    reading(new Date('2026-06-09T09:00:00.000Z'), [{ key: 'height', value: 64, plantId: 'plant-1' }]),
  ]);

  await db.shareLinks.create({
    id: 'link-1',
    token: 'a-week-of-it',
    kind: 'view',
    subject: { type: 'grow', id: GROW },
    createdBy: OWNER,
    range: { startsAt: LINK_FROM, endsAt: LINK_TO },
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
  reads = [];
  access = new AccessService(db.spaces, db.grows, db.plants, db.devices, db.cameras, db.entries, db.media, db.memberships, db.shareLinks);
  series = new GrowSeriesService(db.devices, db.entries, growsService(), fakeData);
  await world();
});

describe('what a chart is drawn from', () => {
  it('answers a panel per metric asked for, VPD included', async () => {
    const answer = await readAs(session(OWNER), { range: '24h', metrics: ['temperature', 'vpd'] });

    expect(growSeries.parse(answer)).toBeTruthy();
    expect(answer.climate.map(panel => panel.metric)).toEqual(['temperature', 'vpd']);
    expect(answer.climate[0].points.length).toBeGreaterThan(100);
    // The timeline stacks three panels and leaves VPD out; the Charts view does not.
    expect(answer.climate[1].points.some(point => point.value === 1.2)).toBe(true);
  });

  it('carries the band of every phase the window spans, and none for a metric nothing aims at', async () => {
    const answer = await readAs(session(OWNER), { range: '24h', metrics: ['temperature', 'vpd'] });

    const bands = answer.climate[0].targets;
    expect(bands.map(band => band.stage)).toEqual(['vegetative', 'flowering']);
    expect(bands[1].day).toEqual({ setpoint: 26, band: { low: 25, high: 27 } });
    // Nothing aims a controller at a VPD, so its panel carries no band at all.
    expect(answer.climate[1].targets).toEqual([]);
  });

  it('shades the night from the lamp and lanes the outputs that were asked for', async () => {
    const answer = await readAs(session(OWNER), { range: '24h', metrics: [], outputs: ['light'] });

    expect(answer.outputs.map(lane => lane.output)).toEqual(['light']);
    expect(answer.nights.length).toBeGreaterThan(0);
    expect(answer.climate).toEqual([]);
  });

  it('reads the tents the grow stood in, and reads nothing at all when no line wants a device', async () => {
    await db.grows.updateOne(
      { id: GROW },
      { $set: { placements: [{ id: 'placement-1', spaceId: TENT, startedAt: ORIGIN, endedAt: null, plantIds: null }] } },
    );
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    await db.grows.updateOne(
      { id: GROW },
      { $push: { placements: { id: 'placement-2', spaceId: FRIDGE, startedAt: yesterday, endedAt: null, plantIds: ['plant-2'] } } },
    );

    const both = await readAs(session(OWNER), { range: '24h', metrics: ['temperature'] });
    expect(both.deviceIds).toEqual([CONTROLLER, CHILLER]);

    const nothing = await readAs(session(OWNER), { range: '24h', measurements: ['height'] });
    expect(nothing.deviceIds).toEqual([]);
    expect(nothing.stepSeconds).toBe(0);
    expect(reads).toHaveLength(2);
  });

  it('answers a measurement as the readings it is, with the plant and the entry each was written on', async () => {
    const answer = await readAs(session(OWNER), { range: 'grow', measurements: ['height', 'ec_in'] });

    expect(answer.measurements.map(one => one.key)).toEqual(['height', 'ec_in']);
    expect(answer.measurements[0].points.map(point => point.value)).toEqual([12, 21, 19, 64]);
    expect(answer.measurements[0].points[1]).toMatchObject({ plantId: 'plant-1', entryId: expect.any(String) });
    // A reading written while watering is a reading: the week card counts it, so this does too.
    expect(answer.measurements[1].points.map(point => point.value)).toEqual([1.4]);
  });

  it('counts the days of the grow and says where day one was, which is what day-of-grow is plotted from', async () => {
    const answer = await readAs(session(OWNER), { range: 'grow', metrics: ['temperature'] });

    expect(answer.originAt).toBe(ORIGIN.toISOString());
    expect(answer.dayFrom).toBe(1);
    // The last instant inside the window, not the first outside it: the grow is
    // exactly twenty-eight days old, and day 29 begins where the window ends.
    expect(answer.dayTo).toBe(28);
  });

  it('counts a rolling chip back from the day a finished grow ended rather than from today', async () => {
    const ended = new Date('2026-06-03T12:00:00.000Z');
    await db.grows.updateOne({ id: GROW }, { $set: { endedAt: ended } });

    const answer = await readAs(session(OWNER), { range: '24h', metrics: ['temperature'] });

    // A week after the harvest, "the last 24 hours" of this grow is still its
    // last day. Counting back from now would print a day number past the one
    // every other screen of the same grow gives it, over an empty panel.
    expect(answer.endsAt).toBe(ended.toISOString());
    // Day 21 of 21, because the grow's own day turns at noon and the window is
    // exactly one of them; without the clamp it read day 27-28 of a 21-day grow.
    expect([answer.dayFrom, answer.dayTo]).toEqual([21, 21]);
    // And the panel has something in it, which is the other half of the fault:
    // a window wholly after the harvest could only ever be empty.
    expect(answer.deviceIds).toEqual([CONTROLLER]);
    expect(answer.climate[0].points.length).toBeGreaterThan(0);
  });

  it('counts a rolling chip back from now while the grow is still running', async () => {
    const answer = await readAs(session(OWNER), { range: '24h', metrics: ['temperature'] });

    expect(answer.endsAt).toBe(NOW.toISOString());
  });

  it('refuses a key the grow does not measure, and a custom range missing an end', async () => {
    await expect(readAs(session(OWNER), { range: 'grow', measurements: ['girth'] })).rejects.toMatchObject({
      problem: { status: 400, code: 'measurement_not_defined' },
    });
    await expect(readAs(session(OWNER), { range: 'custom', from: NOW })).rejects.toMatchObject({
      problem: { status: 400, code: 'range_required' },
    });
  });

  it('answers a custom range as the two instants it names', async () => {
    const answer = await readAs(session(OWNER), { range: 'custom', from: LINK_FROM, to: LINK_TO, metrics: ['temperature'] });

    expect(answer.startsAt).toBe(LINK_FROM.toISOString());
    expect(answer.endsAt).toBe(LINK_TO.toISOString());
  });

  it('counts a custom window inside the grow´s own calendar at both ends', async () => {
    await db.grows.updateOne({ id: GROW }, { $set: { endedAt: new Date('2026-06-03T12:00:00.000Z') } });

    // A window straddling the origin keeps the day it can honestly draw: the
    // counter floors at day 1 where it reaches back before the grow began.
    const before = await readAs(session(OWNER), {
      range: 'custom',
      from: new Date('2026-05-01T00:00:00.000Z'),
      to: new Date('2026-05-15T00:00:00.000Z'),
      metrics: ['temperature'],
    });
    expect([before.dayFrom, before.dayTo]).toEqual([1, 2]);

    // And now it stops at the other end as well. This grow lasted 22 days, and
    // a window running a fortnight past its harvest used to be answered "day
    // 19-38" - a figure no other screen of the same grow will ever print.
    const after = await readAs(session(OWNER), {
      range: 'custom',
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-20T00:00:00.000Z'),
      metrics: ['temperature'],
    });
    expect([after.dayFrom, after.dayTo]).toEqual([19, 22]);
  });

  it('names no day at all for a window the grow´s calendar does not reach', async () => {
    await db.grows.updateOne({ id: GROW }, { $set: { endedAt: new Date('2026-06-03T12:00:00.000Z') } });

    const long = await readAs(session(OWNER), {
      range: 'custom',
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-05T00:00:00.000Z'),
      metrics: ['temperature'],
    });
    expect([long.dayFrom, long.dayTo]).toEqual([null, null]);

    const early = await readAs(session(OWNER), {
      range: 'custom',
      from: new Date('2026-02-01T00:00:00.000Z'),
      to: new Date('2026-02-05T00:00:00.000Z'),
      metrics: ['temperature'],
    });
    expect([early.dayFrom, early.dayTo]).toEqual([null, null]);
  });

  it('counts a running grow´s window up to today and no further', async () => {
    // Today is day 29 of this one, and a window running a fortnight past now
    // stops there rather than reaching day 42.
    const ahead = await readAs(session(OWNER), {
      range: 'custom',
      from: new Date('2026-06-09T00:00:00.000Z'),
      to: new Date('2026-06-24T00:00:00.000Z'),
      metrics: ['temperature'],
    });

    expect([ahead.dayFrom, ahead.dayTo]).toEqual([27, 29]);
  });
});

describe('who is told', () => {
  it('gives a member the whole grow', async () => {
    const answer = await readAs(session(MEMBER), { range: 'grow', measurements: ['height'] });

    expect(answer.measurements[0].points).toHaveLength(4);
    expect(answer.measurements[0].points[1].plantId).toBe('plant-1');
  });

  it('clamps a link to its own week and lets nothing outside it through', async () => {
    const answer = await readAs(visitor('a-week-of-it'), { range: 'grow', metrics: ['temperature'], measurements: ['height', 'ec_in'] });

    expect(answer.startsAt).toBe(LINK_FROM.toISOString());
    expect(answer.endsAt).toBe(LINK_TO.toISOString());
    // The reading of 15 May and the one of 9 June are both outside the week;
    // neither is in the answer, and neither is a climate point from outside it.
    expect(answer.measurements[0].points.map(point => point.value)).toEqual([21, 19]);
    expect(answer.measurements[0].points.some(point => point.value === 12 || point.value === 64)).toBe(false);
    for (const point of answer.climate[0].points) {
      expect(new Date(point.measuredAt).getTime()).toBeGreaterThanOrEqual(LINK_FROM.getTime());
      expect(new Date(point.measuredAt).getTime()).toBeLessThanOrEqual(LINK_TO.getTime());
    }
  });

  it('tells a link holder nothing about which plant a reading was taken on', async () => {
    const answer = await readAs(visitor('a-week-of-it'), { range: 'grow', measurements: ['height'] });

    // The owner hides plant counts, and a reading naming its plant is a count
    // told one reading at a time.
    expect(answer.measurements[0].points.every(point => point.plantId === null)).toBe(true);
  });

  it('answers a stranger and a demo session nothing at all', async () => {
    await expect(access.access(session(STRANGER), subjectRef('grow', GROW), 'view')).resolves.toBeNull();
    await expect(access.access(demo(), subjectRef('grow', GROW), 'view')).resolves.toBeNull();
  });
});
