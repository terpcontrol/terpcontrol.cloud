import type { DeviceSeries, Metric } from '@fg2/shared-types/v1';
import { spaceSeries } from '@fg2/shared-types/v1-schemas';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { ProblemException } from '@common/v1/problem';
import { DataService, DeviceHistory, OutputHistory, SeriesRequest } from '@modules/data/data.service';
import { DevicesService } from '@modules/v1/device/devices.service';
import { SpaceLiveService } from '@modules/v1/space/space-live.service';
import { SpacesService } from '@modules/v1/space/spaces.service';
import { SpaceSeriesQuery, SpaceSeriesService } from '@modules/v1/timeline/space-series.service';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * The charts page of a place: any two instants, at any step, whether or not a
 * grow stands there.
 *
 * The panels, lanes and nights are the Timeline's arithmetic and are asserted
 * there; what is this route's own is the window it was asked for, the step
 * somebody chose, every metric a device reports - leaf, light and VPD among
 * them - the pictures at the cursor, and who is told how much.
 */

const OWNER = 'user-owner';
const STRANGER = 'user-stranger';
const TENT = 'tent-1';
const CONTROLLER = 'device-controller';

const NOW = new Date('2026-06-10T12:00:00.000Z');
const HOUR = 3600 * 1000;

const session = (userId: string): AccessContext => ({ userId, isAdmin: false, isDemo: false, shareToken: null });
const admin = (): AccessContext => ({ userId: 'user-support', isAdmin: true, isDemo: false, shareToken: null });
const visitor = (shareToken: string): AccessContext => ({ userId: null, isAdmin: false, isDemo: false, shareToken });

let db: V1TestDatabase;
let access: AccessService;
let service: SpaceSeriesService;
let reads: SeriesRequest[];

const isLit = (at: Date): boolean => at.getUTCHours() >= 6 && at.getUTCHours() < 18;

const fakeSwitchings = (request: SeriesRequest): OutputHistory[] =>
  (request.outputs ?? []).map(output => {
    if (output !== 'light') return { output, switchings: [] };
    const switchings: { at: string; on: boolean }[] = [];
    let last: boolean | null = null;
    for (let at = request.startsAt.getTime(); at < request.endsAt.getTime(); at += 300 * 1000) {
      const on = isLit(new Date(at));
      if (on !== last) switchings.push({ at: new Date(at).toISOString(), on });
      last = on;
    }
    return { output, switchings };
  });

const VALUES: Partial<Record<Metric, number>> = { temperature: 24, humidity: 55, vpd: 1.1, leafTemperature: 22, lux: 30000, ppfd: 450 };

const fakeData = {
  history: async (deviceId: string, request: SeriesRequest): Promise<DeviceHistory> => {
    const series = await fakeData.series(deviceId, request);
    return { series, outputs: fakeSwitchings(request), lastSampleAt: request.endsAt.toISOString() };
  },
  series: async (deviceId: string, request: SeriesRequest): Promise<DeviceSeries> => {
    reads.push(request);
    const step = (request.stepSeconds ?? 60) * 1000;
    const instants: Date[] = [];
    for (let at = request.startsAt.getTime(); at < request.endsAt.getTime(); at += step) instants.push(new Date(at));

    return {
      deviceId,
      startsAt: request.startsAt.toISOString(),
      endsAt: request.endsAt.toISOString(),
      stepSeconds: request.stepSeconds ?? 60,
      metrics: request.metrics.map(metric => ({
        metric,
        points: instants.map(at => ({ measuredAt: at.toISOString(), value: VALUES[metric] ?? null })),
      })),
      outputs: (request.outputs ?? []).map(output => ({
        output,
        points: instants.map(at => ({ measuredAt: at.toISOString(), value: output === 'light' ? (isLit(at) ? 1 : 0) : null })),
      })),
    };
  },
  live: async () => ({ metrics: {}, outputs: {}, isDay: null, lightOn: null }),
} as unknown as DataService;

const readAs = async (ctx: AccessContext, asked: SpaceSeriesQuery) => {
  const grant: Grant = await access.require(ctx, subjectRef('space', TENT), 'view');
  return service.read(grant, TENT, asked, NOW);
};

const window = (hours: number, endsHoursAgo = 0) => ({
  from: new Date(NOW.getTime() - (hours + endsHoursAgo) * HOUR),
  to: new Date(NOW.getTime() - endsHoursAgo * HOUR),
});

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
  const devices = new DevicesService(db.devices, db.claimCodes, db.spaces, db.memberships, db.cameras, db.plans, db.alarmRules, access);
  const places = new SpacesService(db.spaces, db.memberships, db.invites, db.shareLinks, db.devices, db.cameras, db.grows, devices, access);
  service = new SpaceSeriesService(db.cameras, db.media, db.targetChanges, places, new SpaceLiveService(db.devices, db.cameras, fakeData), fakeData);

  await db.users.create([
    { id: OWNER, email: 'owner@test.invalid', handle: 'owner', passwordHash: 'x' },
    { id: STRANGER, email: 'stranger@test.invalid', handle: 'stranger', passwordHash: 'x' },
  ]);
  await db.spaces.create({ id: TENT, ownerId: OWNER, kind: 'tent', name: 'Tent 1', roomId: null });
  await db.devices.create({
    id: CONTROLLER,
    type: 'controller',
    ownerId: OWNER,
    spaceId: TENT,
    configuration: { day: { temperature: 25, humidity: 55 }, night: { temperature: 20, humidity: 60 } },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  await db.cameras.create({ id: 'camera-1', ownerId: OWNER, kind: 'terpcam_controller', name: 'Tent cam', deviceId: CONTROLLER, spaceId: TENT });
  await db.media.create(
    [1, 2, 30].map(hours => ({
      id: `still-${hours}`,
      kind: 'still',
      mime: 'image/jpeg',
      bytes: 1,
      cameraId: 'camera-1',
      capturedAt: new Date(NOW.getTime() - hours * HOUR),
    })),
  );
  await db.shareLinks.create({ id: 'link-1', token: 'the-tent', kind: 'view', subject: { type: 'space', id: TENT }, createdBy: OWNER, range: {} });
});

describe('a place charted without a grow', () => {
  it('answers the window asked for, with every metric the device reports and the band its targets make', async () => {
    const answer = await readAs(session(OWNER), {
      ...window(6),
      metrics: ['temperature', 'vpd', 'leafTemperature', 'lux', 'ppfd', 'co2'],
      outputs: ['light', 'heater'],
    });

    expect(spaceSeries.parse(answer)).toBeTruthy();
    expect(answer.startsAt).toBe(window(6).from.toISOString());
    expect(answer.endsAt).toBe(NOW.toISOString());
    // A metric nothing measured - CO2 here - has no panel rather than an empty one.
    expect(answer.climate.map(panel => panel.metric)).toEqual(['temperature', 'vpd', 'leafTemperature', 'lux', 'ppfd']);
    expect(answer.climate[0].targets[0].day).toEqual({ setpoint: 25, band: { low: 24, high: 26 } });
    expect(answer.outputs.map(lane => lane.output)).toEqual(['light']);
    expect(answer.deviceIds).toEqual([CONTROLLER]);
  });

  it('keeps a step somebody chose and decides one from the width where nobody did', async () => {
    expect((await readAs(session(OWNER), { ...window(24), stepSeconds: 20, metrics: ['temperature'] })).stepSeconds).toBe(20);
    expect((await readAs(session(OWNER), { ...window(24 * 365), stepSeconds: 60, metrics: ['temperature'] })).stepSeconds).toBe(6308);
    expect((await readAs(session(OWNER), { ...window(1), metrics: ['temperature'] })).stepSeconds).toBe(60);
    expect(reads.map(read => read.stepSeconds)).toEqual([20, 6308, 60]);
  });

  it('reads a week back as well as the last day: the window ends where it was asked to', async () => {
    const answer = await readAs(session(OWNER), { ...window(24, 24 * 7), metrics: ['temperature'] });

    expect(answer.endsAt).toBe(new Date(NOW.getTime() - 24 * 7 * HOUR).toISOString());
    expect(answer.cameras[0].frames).toEqual([]);
  });

  it('carries the camera’s stills inside the window, oldest first', async () => {
    const answer = await readAs(session(OWNER), { ...window(6), metrics: ['temperature'] });

    expect(answer.cameras).toEqual([
      {
        cameraId: 'camera-1',
        name: 'Tent cam',
        frames: [2, 1].map(hours => ({ mediaId: `still-${hours}`, capturedAt: new Date(NOW.getTime() - hours * HOUR).toISOString() })),
      },
    ]);
  });

  it('reads nothing of the store where no line was asked for', async () => {
    const answer = await readAs(session(OWNER), { ...window(6) });

    expect(reads).toEqual([]);
    expect(answer.stepSeconds).toBe(0);
  });

  it('refuses a window of no width', async () => {
    const error = await readAs(session(OWNER), { from: NOW, to: NOW, metrics: ['temperature'] }).catch((caught: unknown) => caught);

    expect((error as ProblemException).problem.code).toBe('range_required');
  });
});

describe('who is told', () => {
  it('shows a support administrator the customer’s place in full', async () => {
    const answer = await readAs(admin(), { ...window(6), metrics: ['temperature'] });

    expect(answer.deviceIds).toEqual([CONTROLLER]);
    expect(answer.cameras).toHaveLength(1);
  });

  it('shows a link the tent and not the hardware or the cameras it was not given', async () => {
    const answer = await readAs(visitor('the-tent'), { ...window(6), metrics: ['temperature'], outputs: ['light'] });

    expect(answer.deviceIds).toBeNull();
    expect(answer.outputs[0].deviceId).toBeNull();
    expect(answer.cameras).toEqual([]);
  });

  it('refuses a stranger', async () => {
    await expect(readAs(session(STRANGER), { ...window(6), metrics: ['temperature'] })).rejects.toThrow();
  });
});
