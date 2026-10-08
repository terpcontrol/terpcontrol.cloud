import { vapourPressureDeficit } from '@fg2/shared-types/v1-schemas/vpd.js';
import { DEFAULT_DEVICE_SETTINGS } from '@database/schemas/v1/devices.schema';
import { CameraDaylight } from '@modules/data/camera-daylight.port';
import { DataService } from '@modules/data/data.service';
import { FluxRow, vpdOf } from '@modules/data/flux';

/**
 * Which leaf offset a VPD reading takes. The cycle a series is read against
 * comes from the lamp's switchings on a five-minute grain, which counts the
 * lamp on for a whole grain once any sample in it was lit - so a minute the
 * device itself reported dark took the day offset, and the chart answered a
 * VPD that neither the device nor the Overview gave.
 */
describe('the half of the cycle a VPD reading takes', () => {
  const factors = DEFAULT_DEVICE_SETTINGS;
  const vpd = (air: number, leaf: number, rh: number) => parseFloat(vapourPressureDeficit(air, leaf, rh).toFixed(2));
  const reading = (light: number | null, isDay: boolean | null) => ({
    temperature: 20,
    humidity: 20,
    leafTemperature: null,
    lux: null,
    light,
    isDay,
  });

  it('is night where the reading´s own lamp level is zero, whatever the cycle around it says', () => {
    expect(vpdOf(reading(0, true), factors)).toBe(vpd(20, 20, 20));
  });

  it('follows the cycle where the lamp was lit during the reading', () => {
    expect(vpdOf(reading(40, true), factors)).toBe(vpd(20, 18, 20));
    expect(vpdOf(reading(40, false), factors)).toBe(vpd(20, 20, 20));
  });

  it('follows the cycle where the device reports no lamp at all', () => {
    expect(vpdOf(reading(null, true), factors)).toBe(vpd(20, 18, 20));
  });
});

/**
 * A smart plug has no lamp and says nothing of its day, so its VPD took the
 * night's offset round the clock. Its own schedule decides where it keeps one,
 * as its firmware does; else the stills of the cameras where it stands; else
 * the night, as before (ADR 0006).
 */
describe('the half of the day a plug´s VPD takes', () => {
  const HOUR = 3600;
  const DEVICE = 'sim-plug-1';
  const SPACE = 'space-1';
  const factors = DEFAULT_DEVICE_SETTINGS;
  const DAY_VPD = parseFloat(vapourPressureDeficit(25, 23, 60).toFixed(2));
  const NIGHT_VPD = parseFloat(vapourPressureDeficit(25, 25, 60).toFixed(2));

  /** A plug that doses CO2 by day only, lit 06:00-18:00 UTC by its schedule. */
  const scheduled = { workmode: 'co2', usedaynight: true, daynight: { day: 6 * HOUR, night: 18 * HOUR } };

  /** The windows of half an hour from 05:00 to 07:00 UTC, each with the same air. */
  const startsAt = new Date('2026-01-20T05:00:00.000Z');
  const endsAt = new Date('2026-01-20T07:00:00.000Z');
  const stamps = [1, 2, 3, 4].map(half => new Date(startsAt.getTime() + half * 1800_000).toISOString());

  const store = (device: Record<string, unknown>, daylight: CameraDaylight | null = null, liveAt = '2026-01-20T12:00:00.000Z'): DataService => {
    const devices = { findOne: () => ({ lean: () => Promise.resolve({ settings: factors, ...device }) }) };
    const data = new DataService(devices as never, { url: 'http://influx.invalid', token: 'x', org: 'org', bucket: 'bucket' } as never, daylight);
    (data as unknown as { read: (query: string) => Promise<FluxRow[]> }).read = query =>
      Promise.resolve(
        query.includes('difference(') || query.includes('status_daily')
          ? []
          : query.includes('last()')
            ? [
                { _time: liveAt, _field: 'temperature', _value: 25 },
                { _time: liveAt, _field: 'humidity', _value: 60 },
              ]
            : stamps.flatMap(stamp => [
                { _time: stamp, _field: 'temperature', _value: 25 },
                { _time: stamp, _field: 'humidity', _value: 60 },
              ]),
      );
    return data;
  };

  const vpdOver = async (data: DataService): Promise<(number | null)[]> =>
    (await data.series(DEVICE, { metrics: ['vpd'], startsAt, endsAt, stepSeconds: 1800 })).metrics[0].points.map(point => point.value);

  const liveVpd = async (data: DataService): Promise<number | null> => (await data.live(DEVICE)).metrics.vpd?.value ?? null;

  /** Cameras that saw the day from 06:10 UTC on, and remember which instants they were asked about. */
  const cameras = (): CameraDaylight & { asked: number[] } => {
    const asked: number[] = [];
    return {
      asked,
      dayIn: () =>
        Promise.resolve((at: number) => {
          asked.push(at);
          return at >= Date.parse('2026-01-20T06:10:00.000Z');
        }),
    };
  };

  it('follows the plug´s own schedule, window by window and live', async () => {
    expect(await vpdOver(store({ type: 'plug', configuration: scheduled }))).toEqual([NIGHT_VPD, NIGHT_VPD, DAY_VPD, DAY_VPD]);
    expect(await liveVpd(store({ type: 'plug', configuration: scheduled }))).toBe(DAY_VPD);
    expect(await liveVpd(store({ type: 'plug', configuration: scheduled }, null, '2026-01-20T20:00:00.000Z'))).toBe(NIGHT_VPD);
  });

  it('asks the cameras where the plug stands only where it keeps no schedule, at the middle of each window', async () => {
    const seen = cameras();
    const plug = store({ type: 'plug', spaceId: SPACE, configuration: { ...scheduled, usedaynight: false } }, seen);

    // The window from 06:00 to 06:30 is read at 06:15, after the cameras turned to colour.
    expect(await vpdOver(plug)).toEqual([NIGHT_VPD, NIGHT_VPD, DAY_VPD, DAY_VPD]);
    expect(seen.asked.map(at => new Date(at).toISOString().slice(11, 16))).toEqual(['05:15', '05:45', '06:15', '06:45']);
    expect(await liveVpd(plug)).toBe(DAY_VPD);

    const kept = cameras();
    expect(await vpdOver(store({ type: 'plug', spaceId: SPACE, configuration: scheduled }, kept))).toEqual([NIGHT_VPD, NIGHT_VPD, DAY_VPD, DAY_VPD]);
    expect(kept.asked).toEqual([]);
  });

  it('takes the night where neither says anything, as before', async () => {
    const silent: CameraDaylight = { dayIn: () => Promise.resolve(() => null) };

    expect(await vpdOver(store({ type: 'plug', spaceId: SPACE, configuration: {} }, silent))).toEqual([NIGHT_VPD, NIGHT_VPD, NIGHT_VPD, NIGHT_VPD]);
    expect(await liveVpd(store({ type: 'plug', spaceId: null, configuration: {} }, cameras()))).toBe(NIGHT_VPD);
  });

  it('leaves every other device to its lamp, whatever the cameras say', async () => {
    const seen = cameras();
    expect(await vpdOver(store({ type: 'controller', spaceId: SPACE, configuration: scheduled }, seen))).toEqual([
      NIGHT_VPD,
      NIGHT_VPD,
      NIGHT_VPD,
      NIGHT_VPD,
    ]);
    expect(await liveVpd(store({ type: 'fan', spaceId: SPACE, configuration: scheduled }, seen))).toBe(NIGHT_VPD);
    expect(seen.asked).toEqual([]);
  });
});
