import { jest } from '@jest/globals';
import type { DeviceConfiguration, DeviceSeries, Metric, PlanStep, SeriesPoint } from '@fg2/shared-types/v1';
import {
  cycleKindOf,
  cycleOf,
  lightWindowOf,
  lightWindowTimes,
  nightsIn,
  SETTLE_SECONDS,
  transitionsIn,
  type Cycle,
} from '@fg2/shared-types/v1-schemas/day-night.js';
import { EntryWriterService } from '@common/v1/entry-writer.service';
import { StoredDevice } from '@database/schemas/v1/devices.schema';
import { StoredTargetChange } from '@database/schemas/v1/target-changes.schema';
import { heldTo } from '@modules/device-protocol/class-rules';
import { DeviceConfigurationService } from '@modules/device-protocol/device-configuration.service';
import { DevicePublisherService } from '@modules/device-protocol/device-publisher.service';
import { withIdleFiguresKept } from '@modules/device-protocol/idle-figures';
import { withClockTimesMoved } from '@modules/device-protocol/schedule-clock';
import { MqttClientService } from '@modules/mqtt/mqtt-client.service';
import { bandOverRecordAt, settlingOf, type RecordedClimate } from '@modules/v1/device/held-targets';
import { setpointsOf } from '@modules/v1/device/setpoints';
import { summariseClimate } from '@modules/v1/diary/week-climate';
import { verdictOf } from '@modules/v1/overview/climate-verdict';
import { cyclesOf } from '@modules/v1/phase/target-record';
import { settingsSent, stepsOf } from '@modules/v1/plan/plan-steps';
import { liveOfDevice } from '@modules/v1/space/space-live';
import { presetConfiguration } from '@modules/v1/space/climate-presets';
import { nightsOf, targetsOf, transitionsOf } from '@modules/v1/timeline/timeline-series';
import { startV1TestDatabase, V1TestDatabase } from './support/v1-database';

/**
 * Day and night are the device's: its clock window in UTC and its work mode,
 * compared the way the firmware compares them (`day-night.ts`). Everything the
 * server says about which half holds - the live targets, the verdict, the
 * nights a chart is shaded by, the diary's halves - follows from that and never
 * from whether the lamp shines; and every light window it writes is written by
 * one function, so 24 hours is light round the clock, 0 hours is dark, and a
 * light going off at midnight UTC keeps its evening ramp.
 */

const HOUR = 3600;
const at = (iso: string): Date => new Date(iso);

/** A fridge lit 06:00-18:00 UTC with 15-minute ramps it glides its targets along. */
const fridge = (over: Record<string, unknown> = {}): DeviceConfiguration => ({
  workmode: 'small',
  day: { temperature: 25, humidity: 60 },
  night: { temperature: 21, humidity: 55 },
  co2: { target: 1000, sunsetOff: 1 },
  daynight: { day: 6 * HOUR, night: 18 * HOUR, linearChange: 1 },
  lights: { limit: 80, sunrise: 15, sunset: 15 },
  ...over,
});

const controller = (over: Record<string, unknown> = {}): DeviceConfiguration => {
  const { daynight, ...rest } = fridge(over);
  return { ...rest, daynight: { ...(daynight as Record<string, unknown>), linearChange: 0 } };
};

const cycle = (over: Partial<Cycle> = {}): Cycle => ({
  day: 6 * HOUR,
  night: 18 * HOUR,
  workmode: 'small',
  sunrise: 15,
  sunset: 15,
  glides: true,
  ...over,
});

describe('the light window', () => {
  it('reads and writes a photoperiod as the hour the light comes on and the hours it stays on', () => {
    expect(lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 12 })).toEqual({ day: 6 * HOUR, night: 18 * HOUR });
    expect(lightWindowOf(6 * HOUR, 18 * HOUR)).toEqual({ lightsOn: 6 * HOUR, lightHours: 12 });
    // Past midnight UTC: on at 22:00, off at 10:00.
    expect(lightWindowTimes({ lightsOn: 22 * HOUR, lightHours: 12 })).toEqual({ day: 22 * HOUR, night: 10 * HOUR });
    expect(lightWindowOf(22 * HOUR, 10 * HOUR)).toEqual({ lightsOn: 22 * HOUR, lightHours: 12 });
    // Half hours, as a plan step may carry them.
    expect(lightWindowOf(...(Object.values(lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 16.5 })) as [number, number]))).toEqual({
      lightsOn: 6 * HOUR,
      lightHours: 16.5,
    });
  });

  it('writes a light going off at midnight UTC a second before it, which keeps the firmware´s evening ramp', () => {
    expect(lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 18 })).toEqual({ day: 6 * HOUR, night: 86399 });
    expect(lightWindowOf(6 * HOUR, 86399)).toEqual({ lightsOn: 6 * HOUR, lightHours: 18 });
    // An older write of midnight reads the same.
    expect(lightWindowOf(6 * HOUR, 0)).toEqual({ lightsOn: 6 * HOUR, lightHours: 18 });
  });

  it('writes 24 hours as a day that never ends, keeping the hour it came on, and reads the old one-second-short day as 24 hours', () => {
    const always = lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 24 });
    expect(always.night).toBeGreaterThanOrEqual(2 * 24 * HOUR);
    expect(always.day).toBe(always.night + 1);
    expect(lightWindowOf(always.day, always.night)).toEqual({ lightsOn: 6 * HOUR, lightHours: 24 });
    expect(cycleKindOf(cycle(always))).toBe('always_day');

    expect(lightWindowOf(6 * HOUR, 6 * HOUR - 1)).toEqual({ lightsOn: 6 * HOUR, lightHours: 24 });
  });

  it('keeps 0 hours apart from 24: the light comes on and goes off at the same second, which is always night', () => {
    expect(lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 0 })).toEqual({ day: 6 * HOUR, night: 6 * HOUR });
    expect(lightWindowOf(6 * HOUR, 6 * HOUR)).toEqual({ lightsOn: 6 * HOUR, lightHours: 0 });
    expect(cycleKindOf(cycle({ day: 6 * HOUR, night: 6 * HOUR }))).toBe('always_night');
  });

  it('is held to that shape on every write of a fridge or a controller, whoever wrote the times, and left alone otherwise', () => {
    expect((heldTo('controller', controller({ daynight: { day: 6 * HOUR, night: 0 } })).daynight as Record<string, number>).night).toBe(86399);
    const legacy = heldTo('fridge', fridge({ daynight: { day: 6 * HOUR, night: 6 * HOUR - 1, linearChange: 1 } })).daynight as Record<string, number>;
    expect(lightWindowOf(legacy.day, legacy.night)).toEqual({ lightsOn: 6 * HOUR, lightHours: 24 });
    expect(legacy.night).toBeGreaterThanOrEqual(2 * 24 * HOUR);

    // Held already, a document is what it was.
    const held = heldTo('fridge', fridge({ daynight: { ...lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 24 }), linearChange: 1 } }));
    expect(heldTo('fridge', held)).toEqual(held);
    expect(heldTo('controller', controller({ daynight: { day: 6 * HOUR, night: 6 * HOUR } })).daynight).toEqual({
      day: 6 * HOUR,
      night: 6 * HOUR,
      linearChange: 0,
    });
    // A smart socket's own window is its own.
    expect(heldTo('plug', { daynight: { day: 6 * HOUR, night: 0 } })).toEqual({ daynight: { day: 6 * HOUR, night: 0 } });
  });

  it('moves with the clocks as a window: onto midnight UTC and off it again, and 24 hours stays 24 hours', () => {
    // Berlin 08:00 + 16 h is 06:00-22:00 UTC in summer; in winter 07:00-23:00, and
    // with 17 h 07:00 to midnight UTC.
    const summer = { daynight: lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 17 }) };
    expect(summer.daynight).toEqual({ day: 6 * HOUR, night: 23 * HOUR });
    expect(withClockTimesMoved(summer, HOUR).daynight).toEqual({ day: 7 * HOUR, night: 86399 });
    expect(withClockTimesMoved(withClockTimesMoved(summer, HOUR), -HOUR).daynight).toEqual({ day: 6 * HOUR, night: 23 * HOUR });

    const always = { daynight: { ...lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 24 }), linearChange: 1 } };
    const moved = withClockTimesMoved(always, HOUR).daynight as Record<string, number>;
    expect(lightWindowOf(moved.day, moved.night)).toEqual({ lightsOn: 7 * HOUR, lightHours: 24 });
    expect(moved.linearChange).toBe(1);
  });
});

describe('which half holds, by the clock and the work mode', () => {
  it('is the day between on and off and the night otherwise, whatever the lamp is doing', () => {
    // The live reading of the lamp is not even an input: a lamp held off at noon,
    // or set to 0 %, leaves the device holding its day.
    const noon = setpointsOf(controller({ lights: { limit: 0 } }), null, {}, 'controller', at('2026-10-03T12:00:00Z'));
    expect(noon).toMatchObject({
      active: 'day',
      period: 'day',
      cycle: 'schedule',
      since: '2026-10-03T06:00:00.000Z',
      until: '2026-10-03T18:00:00.000Z',
    });
    expect(setpointsOf(controller(), null, {}, 'controller', at('2026-10-03T23:00:00Z'))).toMatchObject({
      active: 'night',
      period: 'night',
      since: '2026-10-03T18:00:00.000Z',
      until: '2026-10-04T06:00:00.000Z',
    });
    // A window past midnight UTC.
    const late = controller({ daynight: { day: 22 * HOUR, night: 10 * HOUR } });
    expect(setpointsOf(late, null, {}, 'controller', at('2026-10-03T02:00:00Z'))?.active).toBe('day');
    expect(setpointsOf(late, null, {}, 'controller', at('2026-10-03T12:00:00Z'))?.active).toBe('night');
  });

  it('holds the night round the clock while drying or germinating, the day with 24 hours of light, and nothing switched off', () => {
    const noon = at('2026-10-03T12:00:00Z');
    expect(setpointsOf(fridge({ workmode: 'dry' }), null, {}, 'fridge', noon)).toMatchObject({
      active: 'night',
      period: 'constant',
      cycle: 'drying',
      since: null,
      until: null,
      transition: null,
      day: {},
      night: { temperature: 21, humidity: 55 },
    });
    expect(setpointsOf(fridge({ workmode: 'breed' }), null, {}, 'fridge', noon)).toMatchObject({
      active: 'night',
      period: 'constant',
      cycle: 'germination',
      night: { temperature: 21 },
    });
    const always = fridge({ daynight: { ...lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 24 }), linearChange: 1 } });
    expect(setpointsOf(always, null, {}, 'fridge', at('2026-10-03T23:00:00Z'))).toMatchObject({
      active: 'day',
      period: 'constant',
      cycle: 'always_day',
    });
    const dark = fridge({ daynight: { day: 6 * HOUR, night: 6 * HOUR, linearChange: 1 } });
    expect(setpointsOf(dark, null, {}, 'fridge', noon)).toMatchObject({ active: 'night', period: 'constant', cycle: 'always_night' });
    expect(setpointsOf(fridge({ workmode: 'off' }), null, {}, 'fridge', noon)).toBeNull();
    // The greenhouse mode runs the clock and holds no humidity; CO2 is dosed by day alone.
    const greenhouse = setpointsOf(fridge({ workmode: 'temp' }), null, {}, 'fridge', noon);
    expect(greenhouse).toMatchObject({ active: 'day', day: { temperature: 25, co2: 1000 } });
    expect(greenhouse?.night).toEqual({ temperature: 21 });
  });

  it('takes an AIR fan´s word for it, from its light sensor', () => {
    const fan = { mode: 3, day: { temperature: 25, humidity: 60 }, night: { temperature: 21, humidity: 55 } };
    expect(setpointsOf(fan, false, {}, 'fan', at('2026-10-03T12:00:00Z'))).toMatchObject({ active: 'night', period: 'night', cycle: 'sensor' });
    expect(setpointsOf(fan, null, {}, 'fan')).toBeNull();
  });
});

describe('the change between the halves', () => {
  it('glides a fridge´s targets along its ramps as its firmware does, and gives the climate an hour to follow', () => {
    const rising = setpointsOf(fridge(), null, {}, 'fridge', at('2026-10-03T06:05:00Z'));
    // A third of the way up the morning ramp: a third of the way from 21 to 25.
    expect(rising?.transition).toEqual({
      from: 'night',
      to: 'day',
      until: '2026-10-03T07:15:00.000Z',
      gliding: true,
      targets: { temperature: 22.3, humidity: 56.7, co2: 1000 },
    });

    const following = setpointsOf(fridge(), null, {}, 'fridge', at('2026-10-03T07:00:00Z'));
    expect(following?.transition).toMatchObject({ gliding: false, targets: { temperature: 25, humidity: 60, co2: 1000 } });
    expect(setpointsOf(fridge(), null, {}, 'fridge', at('2026-10-03T07:16:00Z'))?.transition).toBeNull();

    // The evening ramp is the day's last quarter hour; the night has no CO2 to aim at.
    const setting = setpointsOf(fridge(), null, {}, 'fridge', at('2026-10-03T17:50:00Z'));
    expect(setting).toMatchObject({ active: 'day', transition: { from: 'day', to: 'night', gliding: true, until: '2026-10-03T19:00:00.000Z' } });
    expect(setting?.transition?.targets).toEqual({ temperature: 23.7, humidity: 58.3 });
  });

  it('switches a controller´s targets with the clock, and still gives the climate an hour after the switch', () => {
    expect(setpointsOf(controller(), null, {}, 'controller', at('2026-10-03T17:50:00Z'))?.transition).toBeNull();
    expect(setpointsOf(controller(), null, {}, 'controller', at('2026-10-03T18:30:00Z'))?.transition).toEqual({
      from: 'day',
      to: 'night',
      until: '2026-10-03T19:00:00.000Z',
      gliding: false,
      targets: { temperature: 21, humidity: 55 },
    });
  });

  it('tells a card what it aims at while gliding and the range a reading counts as on target in, and leaves CO2 unjudged meanwhile', () => {
    const device = { id: 'fridge-1', type: 'fridge', configuration: fridge(), state: { hardware: {} } } as unknown as StoredDevice;
    const live = liveOfDevice({ device, reading: { metrics: {}, outputs: {}, isDay: null, lightOn: false } }, at('2026-10-03T06:05:00Z'));

    expect(live.setpoints).toEqual([
      {
        metric: 'temperature',
        value: 22.3,
        band: 1,
        transition: { from: 'night', to: 'day', until: '2026-10-03T07:15:00.000Z', low: 20, high: 26 },
      },
      {
        metric: 'humidity',
        value: 56.7,
        band: expect.any(Number),
        transition: { from: 'night', to: 'day', until: '2026-10-03T07:15:00.000Z', low: expect.any(Number), high: expect.any(Number) },
      },
      {
        metric: 'co2',
        value: 1000,
        band: expect.any(Number),
        transition: { from: 'night', to: 'day', until: '2026-10-03T07:15:00.000Z', low: null, high: null },
      },
    ]);
    // Outside a change a card is what it always was.
    const noon = liveOfDevice({ device, reading: { metrics: {}, outputs: {}, isDay: null, lightOn: false } }, at('2026-10-03T12:00:00Z'));
    expect(noon.setpoints[0]).toEqual({ metric: 'temperature', value: 25, band: 1 });
  });
});

describe('the verdict over a day', () => {
  const STEP = 300;
  const START = Date.parse('2026-10-03T12:00:00Z');
  const COUNT = (12 * HOUR) / STEP;

  const series = (
    value: (instant: number) => number | null,
    metric: Metric = 'temperature',
    light: (instant: number) => number = () => 0,
  ): DeviceSeries => {
    const points = (read: (instant: number) => number | null): SeriesPoint[] =>
      Array.from({ length: COUNT }, (_unused, index) => {
        const ends = START + (index + 1) * STEP * 1000;
        return { measuredAt: new Date(ends).toISOString(), value: read(ends - (STEP * 1000) / 2) };
      });
    return {
      deviceId: 'fridge-1',
      startsAt: new Date(START).toISOString(),
      endsAt: new Date(START + COUNT * STEP * 1000).toISOString(),
      stepSeconds: STEP,
      metrics: [{ metric, points: points(value) }],
      outputs: [{ output: 'light', points: points(light) }],
    };
  };
  const window = { startsAt: new Date(START), endsAt: new Date(START + COUNT * STEP * 1000) };
  const targets = setpointsOf(fridge(), null, {}, 'fridge', new Date(START));

  /** A fridge that takes forty minutes to cool from its day to its night after the switch at 18:00. */
  const cooling = (instant: number): number => {
    const after = (instant - Date.parse('2026-10-03T17:45:00Z')) / 60_000;
    return after <= 0 ? 25 : after >= 55 ? 21 : 25 - (4 * after) / 55;
  };

  it('does not count the evening a fridge needs to reach its night as an excursion', () => {
    const verdict = verdictOf(series(cooling), targets, window, cycleOf('fridge', fridge()));

    expect(verdict.metrics[0]).toMatchObject({ rating: 'good', outOfBandSeconds: 0, excursions: [] });
  });

  it('still names a reading outside both halves´ bands during the change', () => {
    const hot = (instant: number) =>
      instant > Date.parse('2026-10-03T18:05:00Z') && instant < Date.parse('2026-10-03T18:40:00Z') ? 28 : cooling(instant);
    const verdict = verdictOf(series(hot), targets, window, cycleOf('fridge', fridge()));

    expect(verdict.metrics[0].excursions).toEqual([expect.objectContaining({ above: true, extremeValue: 28 })]);
  });

  it('judges the day by the day´s band while the lamp was dark at noon - held off, or at 0 %', () => {
    // 25 °C all afternoon with the lamp off is on target: the fridge holds its day.
    const verdict = verdictOf(
      series(instant => (instant < Date.parse('2026-10-03T17:45:00Z') ? 25 : cooling(instant))),
      targets,
      window,
      cycleOf('fridge', fridge()),
    );
    expect(verdict.metrics[0]).toMatchObject({ outOfBandSeconds: 0 });
  });

  it('judges a drying room against its night all day long', () => {
    const drying = fridge({ workmode: 'dry', night: { temperature: 18, humidity: 58 } });
    const verdict = verdictOf(
      series(() => 18),
      setpointsOf(drying, null, {}, 'fridge', new Date(START)),
      window,
      cycleOf('fridge', drying),
    );

    expect(verdict.metrics[0]).toMatchObject({ dayBand: null, nightBand: { low: 17, high: 19 }, outOfBandSeconds: 0 });
  });

  /**
   * Moving the light from 06:00 to 13:00 at eight in the evening turned the
   * afternoon that had been a day into a night after the fact: the cockpit
   * said "too warm since 12:00" about a fridge that had held its day all
   * afternoon, while the Timeline drew the same afternoon correctly.
   */
  it('judges each window by what the record says was aimed at then, and gives the hour after a change to the climate', () => {
    const targets = { day: { temperature: 25, humidity: 60 }, night: { temperature: 21, humidity: 55 }, co2: 1000 };
    const moved = cycle({ day: 13 * HOUR, night: 1 * HOUR });
    const record: RecordedClimate[] = [
      { at: Date.parse('2026-10-01T00:00:00Z'), targets, cycle: cycle() },
      { at: Date.parse('2026-10-03T20:00:00Z'), targets, cycle: moved },
    ];
    const reading = (instant: number): number => (instant < Date.parse('2026-10-03T17:45:00Z') ? 25 : cooling(instant));
    const now = setpointsOf(fridge({ daynight: { day: 13 * HOUR, night: 1 * HOUR, linearChange: 1 } }), null, {}, 'fridge', window.endsAt);

    const verdict = verdictOf(series(reading), now, window, cycleOf('fridge', fridge({ daynight: { day: 13 * HOUR, night: HOUR } })), record);

    // Nothing before the change, and nothing in the hour after it: the fridge
    // at its night's 21 °C is told it is day again, and is on its way.
    expect(verdict.metrics[0].excursions).toEqual([{ startedAt: '2026-10-03T21:05:00.000Z', endedAt: null, above: false, extremeValue: 21 }]);
  });
});

describe('the hour after a lamp switch, where the record says nothing of the cycle', () => {
  it('judges a row recorded before cycles were by its lamp, and gives the climate the hour after the lamp switched', () => {
    const STEP = 300;
    const START = Date.parse('2026-10-03T12:00:00Z');
    const COUNT = (12 * HOUR) / STEP;
    const read = (value: (instant: number) => number): SeriesPoint[] =>
      Array.from({ length: COUNT }, (_unused, index) => {
        const ends = START + (index + 1) * STEP * 1000;
        return { measuredAt: new Date(ends).toISOString(), value: value(ends - (STEP * 1000) / 2) };
      });
    const off = Date.parse('2026-10-03T18:00:00Z');
    const series: DeviceSeries = {
      deviceId: 'fridge-1',
      startsAt: new Date(START).toISOString(),
      endsAt: new Date(START + COUNT * STEP * 1000).toISOString(),
      stepSeconds: STEP,
      // Cooling from 25 to 21 over forty minutes after the lamp went out.
      metrics: [{ metric: 'temperature', points: read(at => (at < off ? 25 : Math.max(21, 25 - (4 * (at - off)) / (40 * 60_000)))) }],
      outputs: [{ output: 'light', points: read(at => (at < off ? 100 : 0)) }],
    };
    const record: RecordedClimate[] = [
      {
        at: Date.parse('2026-10-01T00:00:00Z'),
        targets: { day: { temperature: 25, humidity: null }, night: { temperature: 21, humidity: null }, co2: null },
        cycle: null,
      },
    ];
    const window = { startsAt: new Date(START), endsAt: new Date(START + COUNT * STEP * 1000) };

    const verdict = verdictOf(series, setpointsOf(fridge(), null, {}, 'fridge', window.endsAt), window, cycleOf('fridge', fridge()), record);
    expect(verdict.metrics[0]).toMatchObject({ outOfBandSeconds: 0, excursions: [] });
  });
});

describe('the hour after a change', () => {
  const targets = (day: number) => ({ day: { temperature: day, humidity: 60 }, night: { temperature: 21, humidity: 55 }, co2: 1000 });
  const CHANGED = Date.parse('2026-10-03T11:24:00Z');

  it('reaches over what held before the change, for an hour, and then holds the new band alone', () => {
    const record: RecordedClimate[] = [
      { at: Date.parse('2026-10-01T00:00:00Z'), targets: targets(20), cycle: cycle() },
      { at: CHANGED, targets: targets(25), cycle: cycle() },
    ];

    expect(bandOverRecordAt(record, 'temperature', CHANGED - 60_000, 'day')).toEqual({ low: 19, high: 21 });
    expect(bandOverRecordAt(record, 'temperature', CHANGED + 10 * 60_000, 'day')).toEqual({ low: 19, high: 26 });
    expect(bandOverRecordAt(record, 'temperature', CHANGED + SETTLE_SECONDS * 1000, 'day')).toEqual({ low: 24, high: 26 });
    // CO2 did not move, and its band stays what it was.
    expect(bandOverRecordAt(record, 'co2', CHANGED + 10 * 60_000, 'day')).toEqual({ low: 800, high: 1200 });
  });

  it('tells the live card it is changing over, and judges a reading on its way from the old figure as on target', () => {
    const rows: RecordedClimate[] = [
      { at: Date.parse('2026-10-01T00:00:00Z'), targets: targets(20), cycle: cycle() },
      { at: CHANGED, targets: targets(25), cycle: cycle() },
    ];
    const settling = settlingOf(rows, CHANGED + 10 * 60_000, ['temperature', 'humidity', 'co2']);
    const device = { id: 'fridge-1', type: 'fridge', configuration: fridge(), state: { hardware: {} } } as unknown as StoredDevice;
    const live = liveOfDevice(
      { device, reading: { metrics: {}, outputs: {}, isDay: null, lightOn: false } },
      new Date(CHANGED + 10 * 60_000),
      settling,
    );

    expect(live.setpoints[0]).toEqual({
      metric: 'temperature',
      value: 25,
      band: 1,
      transition: { from: 'day', to: 'day', until: '2026-10-03T12:24:00.000Z', low: 19, high: 26 },
    });
    // What did not move is judged as it always is.
    expect(live.setpoints[1]).toEqual({ metric: 'humidity', value: 60, band: expect.any(Number), transition: expect.any(Object) });
    expect(live.setpoints[1].transition).toMatchObject({ low: 55, high: 65 });
  });

  it('settles nothing where only the light moved inside the half that holds, or the record was only filled in', () => {
    const moved: RecordedClimate[] = [
      { at: Date.parse('2026-10-01T00:00:00Z'), targets: targets(25), cycle: cycle() },
      { at: CHANGED, targets: targets(25), cycle: cycle({ night: 19 * HOUR }) },
    ];
    const settling = settlingOf(moved, CHANGED + 60_000, ['temperature']);
    expect(setpointsOf(fridge(), null, {}, 'fridge', new Date(CHANGED + 60_000), settling)?.transition).toBeNull();

    const filledIn: RecordedClimate[] = [
      { at: Date.parse('2026-10-01T00:00:00Z'), targets: targets(25), cycle: null },
      { at: CHANGED, targets: targets(25), cycle: cycle() },
    ];
    expect(settlingOf(filledIn, CHANGED + 60_000, ['temperature'])).toBeNull();
  });

  it('settles a change of the work mode as any other: germination´s 24 °C on its way back to a night of 21 °C', () => {
    const rows: RecordedClimate[] = [
      {
        at: Date.parse('2026-10-01T00:00:00Z'),
        targets: { ...targets(25), night: { temperature: 24, humidity: 55 } },
        cycle: cycle({ workmode: 'breed' }),
      },
      { at: Date.parse('2026-10-03T20:00:00Z'), targets: targets(25), cycle: cycle() },
    ];
    const at = Date.parse('2026-10-03T20:10:00Z');

    // Germination held no humidity, so the humidity is not judged until the hour is over.
    expect(bandOverRecordAt(rows, 'temperature', at, 'night')).toEqual({ low: 20, high: 25 });
    expect(bandOverRecordAt(rows, 'humidity', at, 'night')).toBeNull();
  });
});

describe('the bands of a stretch, by the mode it ran in', () => {
  const stretch = (cycleOver: Partial<Cycle> | null) => ({
    startsAt: at('2026-10-03T00:00:00Z'),
    endsAt: at('2026-10-04T00:00:00Z'),
    phaseId: null,
    stage: null,
    targets: { day: { temperature: 25, humidity: 60 }, night: { temperature: 18, humidity: 58 }, co2: 1000 },
    cycle: cycleOver === null ? null : cycle(cycleOver),
  });

  it('draws one band through a drying room, a germination and a light that never changes, and none switched off', () => {
    expect(targetsOf('temperature', [stretch({ workmode: 'dry' })])).toEqual([
      expect.objectContaining({ held: 'drying', day: null, night: { setpoint: 18, band: { low: 17, high: 19 } } }),
    ]);
    expect(targetsOf('humidity', [stretch({ workmode: 'dry' })])).toEqual([expect.objectContaining({ held: 'drying', day: null })]);
    expect(targetsOf('co2', [stretch({ workmode: 'dry' })])).toEqual([]);
    // Germination holds a temperature alone.
    expect(targetsOf('temperature', [stretch({ workmode: 'breed' })])).toEqual([expect.objectContaining({ held: 'germination', day: null })]);
    expect(targetsOf('humidity', [stretch({ workmode: 'breed' })])).toEqual([]);
    // The greenhouse runs the clock and holds no humidity.
    expect(targetsOf('humidity', [stretch({ workmode: 'temp' })])).toEqual([]);
    expect(targetsOf('temperature', [stretch({ workmode: 'off' })])).toEqual([]);
    const always = lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 24 });
    expect(targetsOf('temperature', [stretch(always)])).toEqual([expect.objectContaining({ held: 'always_day', night: null })]);
    expect(targetsOf('co2', [stretch({ day: 6 * HOUR, night: 6 * HOUR })])).toEqual([]);
    // A row recorded before cycles were says nothing, and is drawn as it always was.
    expect(targetsOf('temperature', [stretch(null)])[0]).not.toHaveProperty('held');
  });
});

describe('the nights a chart is shaded by', () => {
  const window = { startsAt: at('2026-10-24T12:00:00Z'), endsAt: at('2026-10-26T12:00:00Z') };
  const row = (iso: string, cycle: Cycle | null): StoredTargetChange => ({ id: iso, deviceId: 'fridge-1', at: at(iso), targets: null, cycle });
  const lamp = {
    series: { deviceId: 'fridge-1', startsAt: '', endsAt: '', stepSeconds: 300, metrics: [], outputs: [{ output: 'light' as const, points: [] }] },
    outputs: [{ output: 'light' as const, switchings: [{ at: '2026-10-24T12:00:00.000Z', on: true }] }],
    lastSampleAt: null,
  };

  it('are the schedule´s, and move with it the night the clocks go back', () => {
    // Berlin 08:00-20:00: 06:00-18:00 UTC in summer, moved at 01:00 UTC on 25 October.
    const cycles = cyclesOf([row('2026-10-01T00:00:00Z', cycle()), row('2026-10-25T01:00:30Z', cycle({ day: 7 * HOUR, night: 19 * HOUR }))], window);

    expect(nightsOf([], window, cycles)).toEqual([
      { startsAt: '2026-10-24T18:00:00.000Z', endsAt: '2026-10-25T07:00:00.000Z' },
      { startsAt: '2026-10-25T19:00:00.000Z', endsAt: '2026-10-26T07:00:00.000Z' },
    ]);
  });

  it('are none while drying or germinating, nor with 24 or 0 hours of light, and the lamp´s where the record does not say', () => {
    const always = lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 24 });
    const never = lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 0 });
    const cycles = cyclesOf(
      [
        row('2026-10-25T00:00:00Z', cycle({ workmode: 'dry' })),
        row('2026-10-25T12:00:00Z', cycle({ workmode: 'breed' })),
        row('2026-10-26T00:00:00Z', cycle(always)),
        row('2026-10-26T06:00:00Z', cycle(never)),
      ],
      window,
    );

    // One climate round the clock has no night to tell from a day; before the
    // first row the record says nothing, and neither does a lamp nobody heard.
    expect(nightsOf([lamp as never], window, cycles)).toEqual([]);
  });

  it('carry the hour after each switch the climate is given to follow', () => {
    const cycles = cyclesOf([row('2026-10-01T00:00:00Z', cycle())], { startsAt: at('2026-10-24T00:00:00Z'), endsAt: at('2026-10-25T00:00:00Z') });

    expect(transitionsOf(cycles)).toEqual([
      { startsAt: '2026-10-24T06:00:00.000Z', endsAt: '2026-10-24T07:15:00.000Z' },
      { startsAt: '2026-10-24T17:45:00.000Z', endsAt: '2026-10-24T19:00:00.000Z' },
    ]);
    expect(SETTLE_SECONDS).toBe(HOUR);
  });

  it('are whole nights of the UTC clock, which no summer time moves', () => {
    const range = { from: Date.parse('2026-03-28T12:00:00Z'), to: Date.parse('2026-03-30T12:00:00Z') };
    expect(nightsIn(cycle({ day: 5 * HOUR, night: 17 * HOUR }), range).map(span => (span.to - span.from) / HOUR / 1000)).toEqual([12, 12]);
    expect(transitionsIn(cycle({ workmode: 'dry' }), range)).toEqual([]);
  });
});

describe('the diary´s day and night', () => {
  const window = { startsAt: at('2026-10-03T00:00:00Z'), endsAt: at('2026-10-04T00:00:00Z') };
  const STEP = 900;

  it('are the schedule´s halves, not the lamp´s', () => {
    // 25 °C in the day, 21 °C at night - and the lamp held off all day long.
    const points = Array.from({ length: (24 * HOUR) / STEP }, (_unused, index) => {
      const ends = window.startsAt.getTime() + (index + 1) * STEP * 1000;
      const hour = new Date(ends - STEP * 500).getUTCHours();
      return { measuredAt: new Date(ends).toISOString(), value: hour >= 6 && hour < 18 ? 25 : 21 };
    });
    const history = {
      series: {
        deviceId: 'fridge-1',
        startsAt: window.startsAt.toISOString(),
        endsAt: window.endsAt.toISOString(),
        stepSeconds: STEP,
        metrics: [{ metric: 'temperature' as const, points }],
        outputs: [{ output: 'light' as const, points: points.map(point => ({ ...point, value: 0 })) }],
      },
      outputs: [{ output: 'light' as const, switchings: [{ at: window.startsAt.toISOString(), on: false }] }],
      lastSampleAt: null,
    };
    const cycles = new Map([
      ['fridge-1', cyclesOf([{ id: 'r', deviceId: 'fridge-1', at: at('2026-10-01T00:00:00Z'), targets: null, cycle: cycle() }], window)],
    ]);

    const summary = summariseClimate([history as never], null, cycles);
    expect(summary.climate[0]).toMatchObject({ metric: 'temperature', dayAverage: 25, nightAverage: 21 });

    // Without the record it is the lamp, as it always was: all night.
    expect(summariseClimate([history as never], null).climate[0]).toMatchObject({ dayAverage: null, nightAverage: 23 });
  });
});

describe('what a preset and a plan step write', () => {
  it('keeps the light-on hour the device has and writes the hours as every window is written', () => {
    const preset = presetConfiguration('vegetative', null, fridge(), true);
    // 06:00 + 18 h ends at midnight UTC.
    expect(preset?.daynight).toEqual({ day: 6 * HOUR, night: 86399, linearChange: 1 });
    // A device on 24 hours keeps its hour when a preset brings a photoperiod back.
    const always = fridge({ daynight: { ...lightWindowTimes({ lightsOn: 8 * HOUR, lightHours: 24 }), linearChange: 1 } });
    expect(presetConfiguration('flowering', null, always, true)?.daynight).toEqual({ day: 8 * HOUR, night: 20 * HOUR, linearChange: 1 });
  });

  const step = (over: Partial<PlanStep>): PlanStep => ({
    id: 'step',
    name: 'Veg',
    stage: null,
    preset: null,
    duration: { value: 1, unit: 'weeks' },
    settings: {},
    lightHours: null,
    waitForConfirmation: false,
    confirmationMessage: null,
    ...over,
  });

  it('keeps the device´s light-on hour unless the step names one, and writes 24 and 0 hours apart', () => {
    const moved = fridge({ daynight: { day: 9 * HOUR, night: 21 * HOUR, linearChange: 1 } });
    expect(settingsSent(step({ lightHours: 18 }), moved).daynight).toEqual({ day: 9 * HOUR, night: 3 * HOUR });
    expect(settingsSent(step({ lightHours: 12, settings: { daynight: { day: 5 * HOUR } } }), moved).daynight).toEqual({
      day: 5 * HOUR,
      night: 17 * HOUR,
    });

    const always = settingsSent(step({ lightHours: 24 }), moved).daynight as Record<string, number>;
    expect(lightWindowOf(always.day, always.night)).toEqual({ lightsOn: 9 * HOUR, lightHours: 24 });
    expect(settingsSent(step({ lightHours: 0 }), moved).daynight).toEqual({ day: 9 * HOUR, night: 9 * HOUR });
    // A step that names no hours leaves the window alone.
    expect(settingsSent(step({ settings: { day: { temperature: 24 } } }), moved)).toEqual({ day: { temperature: 24 } });
  });

  it('stores a step written with both times of day as the hour it sets and the hours it means', () => {
    const [stored] = stepsOf([
      { ...step({}), id: undefined, settings: { day: { temperature: 24 }, daynight: { day: 5 * HOUR, night: 23 * HOUR, linearChange: 1 } } },
    ]);

    expect(stored.settings).toEqual({ day: { temperature: 24 }, daynight: { day: 5 * HOUR, linearChange: 1 } });
    expect(stored.lightHours).toBe(18);
  });
});

describe('the targets a mode leaves alone', () => {
  it('are kept as stored while drying, germinating, in the greenhouse mode, with 24 and with 0 hours of light', () => {
    const before = fridge();
    const sent = (over: Record<string, unknown>) => ({
      ...before,
      day: { temperature: 18, humidity: 58 },
      night: { temperature: 18, humidity: 58 },
      ...over,
    });

    const drying = withIdleFiguresKept({ ...before, workmode: 'dry' }, sent({ workmode: 'dry' }), 'dry');
    expect(drying).toMatchObject({ day: { temperature: 25, humidity: 60 }, night: { temperature: 18, humidity: 58 } });

    const germinating = withIdleFiguresKept({ ...before, workmode: 'breed' }, sent({ workmode: 'breed' }), 'breed');
    expect(germinating).toMatchObject({ day: { temperature: 25, humidity: 60 }, night: { temperature: 18, humidity: 55 } });

    const greenhouse = withIdleFiguresKept({ ...before, workmode: 'temp' }, sent({ workmode: 'temp' }), 'temp');
    expect(greenhouse).toMatchObject({ day: { temperature: 18, humidity: 60 }, night: { temperature: 18, humidity: 55 } });

    const always = { ...(before.daynight as Record<string, unknown>), ...lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 24 }) };
    expect(withIdleFiguresKept(before, sent({ daynight: always }), 'small')).toMatchObject({
      day: { temperature: 18 },
      night: { temperature: 21, humidity: 55 },
    });

    const dark = { ...(before.daynight as Record<string, unknown>), day: 6 * HOUR, night: 6 * HOUR };
    expect(withIdleFiguresKept(before, sent({ daynight: dark, co2: { target: 400 } }), 'small')).toMatchObject({
      day: { temperature: 25, humidity: 60 },
      night: { temperature: 18 },
      co2: { target: 1000 },
    });
  });

  it('are written as sent by a save that ends the mode', () => {
    const ended = withIdleFiguresKept({ ...fridge(), workmode: 'dry' }, { ...fridge(), day: { temperature: 26, humidity: 62 } }, 'small');
    expect(ended).toMatchObject({ day: { temperature: 26, humidity: 62 } });
  });
});

describe('a save of the targets', () => {
  const DEVICE = 'sim-fridge-1';
  let db: V1TestDatabase;
  let configuration: DeviceConfigurationService;

  beforeAll(async () => {
    db = await startV1TestDatabase();
  });

  afterAll(async () => {
    await db.stop();
  });

  beforeEach(async () => {
    await db.reset();
    const mqtt = { canPublish: true, publish: jest.fn(() => true) } as unknown as MqttClientService;
    configuration = new DeviceConfigurationService(
      db.devices,
      db.users,
      db.targetChanges,
      new DevicePublisherService(db.devices, mqtt),
      new EntryWriterService(db.entries),
    );
  });

  it('answers what was stored, keeps the day of a germinating fridge, and tunes a drying room from the humidity it holds', async () => {
    await db.devices.create({ id: DEVICE, type: 'fridge', ownerId: 'user-1', configuration: fridge({ workmode: 'breed' }) });

    const stored = await configuration.replace(
      DEVICE,
      fridge({ workmode: 'breed', day: { temperature: 24, humidity: 55 }, night: { temperature: 24, humidity: 55 } }),
      'user-1',
    );
    expect(stored).toMatchObject({ workmode: 'breed', day: { temperature: 25, humidity: 60 }, night: { temperature: 24, humidity: 55 } });

    await db.devices.updateOne({ id: DEVICE }, { $set: { configuration: fridge({ workmode: 'dry', night: { temperature: 18, humidity: 50 } }) } });
    const drying = await configuration.replace(DEVICE, fridge({ workmode: 'dry', night: { temperature: 18, humidity: 50 } }), 'user-1');
    // 50 % is a dry target, whatever the unused day says.
    expect(drying?.daynight).toMatchObject({ maxDehumidifySeconds: 900, targetHumidityDiff: 0, useLongHumidityAvg: 1 });
  });

  it('records when the cycle moved as well as the targets, and nothing for a write that moved neither', async () => {
    await db.devices.create({ id: DEVICE, type: 'fridge', ownerId: 'user-1', configuration: fridge() });

    await configuration.replace(DEVICE, fridge(), 'user-1');
    await configuration.replace(DEVICE, fridge({ daynight: { day: 8 * HOUR, night: 20 * HOUR, linearChange: 1 } }), 'user-1');

    const rows = await db.targetChanges.find({ deviceId: DEVICE }).lean<StoredTargetChange[]>();
    expect(rows).toHaveLength(1);
    expect(rows[0].cycle).toEqual({ day: 8 * HOUR, night: 20 * HOUR, workmode: 'small', sunrise: 15, sunset: 15, glides: true });
  });

  it('writes both times of the light down whenever one moved, and the mode of a drying room beside its figures', async () => {
    await db.devices.create({ id: DEVICE, type: 'fridge', ownerId: 'user-1', configuration: fridge() });

    // No hours of light moves only the time the light goes off.
    await configuration.replace(
      DEVICE,
      fridge({ daynight: { ...lightWindowTimes({ lightsOn: 6 * HOUR, lightHours: 0 }), linearChange: 1 } }),
      'user-1',
    );
    await db.devices.updateOne({ id: DEVICE }, { $set: { configuration: fridge({ workmode: 'dry', night: { temperature: 18, humidity: 58 } }) } });
    await configuration.replace(DEVICE, fridge({ workmode: 'dry', night: { temperature: 18, humidity: 55 } }), 'user-1');

    const lines = (await db.entries.find({}).sort({ _id: 1 }).lean()).map(entry => entry.message?.params);
    expect(lines).toEqual([['daynight.day: 21600 → 21600\ndaynight.night: 64800 → 21600'], ['night.humidity: 58 → 55', 'dry']]);
  });
});
