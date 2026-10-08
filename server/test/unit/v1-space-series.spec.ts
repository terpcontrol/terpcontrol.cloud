import type { DeviceSeries, Metric } from '@fg2/shared-types/v1';
import { spaceSeries } from '@fg2/shared-types/v1-schemas';
import { AccessService, subjectRef } from '@common/v1/access.service';
import { AccessContext, Grant } from '@common/v1/access.types';
import { ProblemException } from '@common/v1/problem';
import { DataService, DeviceHistory, SeriesRequest } from '@modules/data/data.service';
import { SpaceLiveService } from '@modules/v1/space/space-live.service';
import { SpaceSeriesQuery, SpaceSeriesService } from '@modules/v1/timeline/space-series.service';
import { admin, session, visitor } from './support/callers';
import { isLit, seriesOf, switchingsOf } from './support/fake-data';
import { accessOn, spacesOn } from './support/services';
import { useV1TestDatabase } from './support/v1-database';

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

const db = useV1TestDatabase();
let access: AccessService;
let service: SpaceSeriesService;
let reads: SeriesRequest[];

const VALUES: Partial<Record<Metric, number>> = { temperature: 24, humidity: 55, vpd: 1.1, leafTemperature: 22, lux: 30000, ppfd: 450 };

const fakeData = {
  history: async (deviceId: string, request: SeriesRequest, levels = false): Promise<DeviceHistory> => {
    const series = await fakeData.series(deviceId, request);
    const outputs = switchingsOf(request, (output, at) => (output === 'light' ? isLit(at) : null)).map(one =>
      levels && one.output === 'light' ? { ...one, levels: [{ measuredAt: request.endsAt.toISOString(), value: 70 }] } : one,
    );
    return { series, outputs, lastSampleAt: request.endsAt.toISOString() };
  },
  series: async (deviceId: string, request: SeriesRequest): Promise<DeviceSeries> => {
    reads.push(request);

    return seriesOf(deviceId, request, {
      metric: metric => VALUES[metric] ?? null,
      output: (output, at) => (output === 'light' ? (isLit(at) ? 1 : 0) : null),
    });
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

beforeEach(async () => {
  await db.reset();
  reads = [];
  access = accessOn(db);
  const places = spacesOn(db, access);
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
    // The charts draw how hard the lamp ran, not only when: the read asks for its level.
    expect(answer.outputs[0].level).toEqual({ unit: 'percent', points: [{ measuredAt: NOW.toISOString(), value: 70 }] });
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
    const answer = await readAs(admin('user-support'), { ...window(6), metrics: ['temperature'] });

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
