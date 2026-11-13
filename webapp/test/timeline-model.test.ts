import type { CardValue, SpaceTimeline } from '@fg2/shared-types/v1';
import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { csvOf, plotOption } from '@/charts/series';
import type { ChartPalette } from '@/charts/tokens';
import {
  blocksOf,
  csvFor,
  drawnBefore,
  extremesOf,
  figureAt,
  nearestPoint,
  offeredOf,
  panelsOf,
  quietSince,
  restOf,
  shareOf,
  shownOf,
  stripsOf,
  type Shown,
} from '@/screens/timeline/model';
import { DateTime } from 'luxon';
import { axisEnds, meanStamp, stepWords, windowLabel } from '@/screens/timeline/labels';
import { translate } from './translations';

/**
 * What one answer comes to on Verlauf, as arithmetic: which curves are drawn,
 * that a point keeps its window's lowest and highest, under which curve an
 * output's strip stands, and what a cursor reads.
 */

const FROM = Date.parse('2026-11-11T14:30:00.000Z');
const HOUR = 3600_000;
const at = (hours: number): string => new Date(FROM + hours * HOUR).toISOString();
const window = { startsAt: at(0), endsAt: at(24) };
const band = {
  ...window,
  phaseId: null,
  stage: null,
  day: { setpoint: 25, band: { low: 24, high: 26 } },
  night: { setpoint: 21, band: { low: 20, high: 22 } },
};

/** An output's points for the first hours of the day, each closing its hour: the samples heard, those it ran in, its mean level. */
const counted = (hours: number, said: (hour: number) => [number, number, number | null]): NonNullable<SpaceTimeline['outputs'][number]['points']> =>
  Array.from({ length: hours }, (_, index) => {
    const [heard, on, level] = said(index + 1);
    return { measuredAt: at(index + 1), heard, on, level };
  });

/** A day at an hour to the point. At 03:00 a door stood open for forty seconds: the mean barely moved, the extremes did. */
const answer = (over: Partial<SpaceTimeline> = {}): SpaceTimeline => ({
  spaceId: 'space-1',
  name: 'Tent 1',
  kind: 'tent',
  range: '24h',
  growId: null,
  dayFrom: null,
  dayTo: null,
  ...window,
  stepSeconds: 3600,
  deviceIds: ['device-1'],
  deviceId: 'device-1',
  reading: null,
  lastReadingAt: null,
  panels: [
    {
      metric: 'temperature',
      points: Array.from({ length: 24 }, (_, hour) => ({ measuredAt: at(hour + 1), value: 24.8, ...(hour === 12 ? { min: 19.4, max: 25.3 } : {}) })),
      targets: [band],
    },
    {
      metric: 'humidity',
      points: Array.from({ length: 24 }, (_, hour) => ({ measuredAt: at(hour + 1), value: 56.04, ...(hour === 12 ? { min: 54.2, max: 71.5 } : {}) })),
      targets: [],
    },
    { metric: 'vpd', points: Array.from({ length: 24 }, (_, hour) => ({ measuredAt: at(hour + 1), value: 1.31 })), targets: [] },
    { metric: 'co2', points: Array.from({ length: 24 }, (_, hour) => ({ measuredAt: at(hour + 1), value: 820 })), targets: [] },
  ],
  nights: [{ startsAt: at(6), endsAt: at(12) }],
  transitions: [],
  alarms: [
    {
      alertId: 'alert-1',
      kind: 'threshold',
      severity: 'warning',
      metric: 'humidity',
      startedAt: at(12),
      endedAt: null,
      value: 71,
      extremeValue: 71.5,
    },
  ],
  outputs: [
    {
      output: 'heater',
      deviceId: 'device-1',
      spans: [{ startsAt: at(7), endsAt: at(8) }],
      heardUntil: at(24),
      // At 60 % through the hour before 08:00 into the window, and off in every other.
      points: counted(24, hour => (hour === 8 ? [12, 12, 60] : [12, 0, 0])),
    },
    {
      output: 'dehumidifier',
      deviceId: 'device-1',
      spans: [{ startsAt: at(12), endsAt: at(12.15) }],
      heardUntil: at(24),
      // Nine minutes of one hour: three samples of twenty.
      points: counted(24, hour => [20, hour === 13 ? 3 : 0, null]),
    },
    {
      output: 'light',
      deviceId: 'device-1',
      spans: [
        { startsAt: at(0), endsAt: at(6) },
        { startsAt: at(12), endsAt: at(20) },
      ],
      heardUntil: at(20),
      // Heard for twenty hours of the day, lit at 65 % for fourteen of them.
      points: counted(20, hour => (hour <= 6 || hour > 12 ? [12, 12, 65] : [12, 0, 0])),
    },
    {
      output: 'fan',
      deviceId: 'device-1',
      spans: [{ startsAt: at(0), endsAt: at(24) }],
      heardUntil: at(24),
      points: counted(24, () => [12, 12, null]),
    },
  ],
  events: [],
  deviceChanges: [],
  machineEvents: { shown: 0, total: 0 },
  grows: [],
  readingNames: [],
  cameras: [],
  people: [],
  ...over,
});

const t = i18next.t.bind(i18next);
const drawn = (data: SpaceTimeline, keys: string[] | null = null, over: Partial<Parameters<typeof panelsOf>[3]> = {}) => {
  const shown = shownOf(keys, offeredOf(data, []), null);
  const strips = stripsOf(t, data);
  return {
    shown,
    strips,
    ...panelsOf(t, data, strips, { shown, one: false, vpdHalf: 'all', measured: [], compared: null, now: null, restUnderLast: false, ...over }),
  };
};

beforeAll(() => translate());

describe('what is drawn', () => {
  it('opens on temperature, humidity and VPD, with the strips and the diary, and leaves the rest to a tick', () => {
    const { shown } = drawn(answer());

    expect(shown).toMatchObject<Partial<Shown>>({
      metrics: ['temperature', 'humidity', 'vpd'],
      light: true,
      outputs: true,
      diary: true,
      machine: false,
    });
  });

  it('always draws the reading a link was about', () => {
    expect(shownOf(null, offeredOf(answer(), []), 'co2').metrics).toEqual(['temperature', 'humidity', 'vpd', 'co2']);
    expect(shownOf(['temperature'], offeredOf(answer(), []), 'light').light).toBe(true);
  });

  it('draws only what the place has of what the address ticks', () => {
    expect(shownOf(['co2', 'leafTemperature', 'm.runoff', 'machine'], offeredOf(answer(), []), null)).toMatchObject({
      metrics: ['co2'],
      measurements: [],
      light: false,
      outputs: false,
      diary: false,
      machine: false,
    });
  });

  it('opens a place that measures none of the first three on what it does measure', () => {
    const fan = answer({ panels: answer().panels.filter(panel => panel.metric === 'co2') });
    expect(shownOf(null, offeredOf(fan, []), null).metrics).toEqual(['co2']);
  });
});

describe('a panel', () => {
  it('says the lowest and the highest sample of the window, not of its means', () => {
    const [temperature, humidity] = drawn(answer()).panels;

    expect([temperature.curves[0].low, temperature.curves[0].high]).toEqual([19.4, 25.3]);
    expect([humidity.curves[0].low, humidity.curves[0].high]).toEqual([54.2, 71.5]);
    // The scale holds the extremes and the band, so neither is cut off.
    expect(temperature.curves[0].line.scale.low).toBeLessThanOrEqual(19.4);
    expect(temperature.curves[0].line.scale.high).toBeGreaterThanOrEqual(26);
  });

  it('draws each point at the middle of the window it is the mean of', () => {
    const [temperature] = drawn(answer()).panels;
    expect(temperature.curves[0].points[0][0]).toBe(FROM + 0.5 * HOUR);
  });

  it('reads a humidity to the tenth the sensor delivers, and every other reading as every screen writes it', () => {
    const [temperature, humidity, vpd] = drawn(answer()).panels;
    expect([temperature.curves[0].written(24.84), humidity.curves[0].written(74.6), vpd.curves[0].written(1.306)]).toEqual(['24.8', '74.6', '1.31']);
  });

  it('stands a single sample at its own time, to the second, and a mean in the middle of its window', () => {
    expect(drawnBefore(5)).toBe(5000);
    expect(drawnBefore(180)).toBe(90_000);
    // Read at five seconds, the sample written at 03:10:00 is stamped 03:10:05 by the store and drawn at 03:10:00.
    const fine = answer({
      stepSeconds: 5,
      panels: [{ metric: 'temperature', points: [{ measuredAt: '2026-11-12T03:10:05.000Z', value: 19.4 }], targets: [] }],
    });
    expect(drawn(fine).panels[0].curves[0].points[0][0]).toBe(Date.parse('2026-11-12T03:10:00.000Z'));
  });

  it('closes a curve of a window that ends now with the device`s last reading: "jetzt" is that reading on every range', () => {
    const reading = (metric: CardValue['metric'], value: number, measuredAt: string): CardValue =>
      ({ metric, value, measuredAt, state: 'live' }) as CardValue;
    const now = { values: [reading('temperature', 25.6, at(23.99)), reading('humidity', 57.2, at(23.99))], silentSince: null };
    const [temperature, humidity, vpd] = drawn(answer(), null, { now }).panels;

    expect(temperature.curves[0].points.at(-1)).toEqual([FROM + 23.99 * HOUR, 25.6]);
    expect(temperature.curves[0].lastAt).toBe(FROM + 23.99 * HOUR);
    expect(nearestPoint(humidity.curves[0].points, FROM + 24 * HOUR, 5_400_000)?.[1]).toBe(57.2);
    // A reading the place does not have now closes nothing, and a window that ended is left as it was measured.
    expect(vpd.curves[0].lastAt).toBeNull();
    expect(drawn(answer()).panels[0].curves[0].lastAt).toBeNull();
  });

  it('ends on a silent device`s last reading whatever half of its window that fell in, and not on the window`s mean', () => {
    // The device stopped twelve minutes into the hour whose mean is drawn at its half: the reading takes that mean's place.
    const stopped = FROM + 20.2 * HOUR;
    const quiet = answer({
      panels: [{ metric: 'temperature', points: [19, 20, 21].map(hour => ({ measuredAt: at(hour), value: 24.8 })), targets: [] }],
    });
    const now = {
      values: [{ metric: 'temperature', value: 23.9, measuredAt: new Date(stopped).toISOString(), state: 'offline' } as CardValue],
      silentSince: stopped,
    };
    const [curve] = drawn(quiet, null, { now }).panels[0].curves;

    expect(curve.points.map(point => point[0])).toEqual([FROM + 18.5 * HOUR, FROM + 19.5 * HOUR, stopped]);
    expect(nearestPoint(curve.points, stopped, 5_400_000)).toEqual([stopped, 23.9]);
    // A curve whose means run on past a reading is ahead of it - the live read is the older of the two - and ends on its own.
    const older = { values: [{ metric: 'temperature', value: 23.9, measuredAt: at(10), state: 'live' } as CardValue], silentSince: null };
    expect(drawn(answer(), null, { now: older }).panels[0].curves[0].lastAt).toBeNull();
  });

  it('ends the band and the night where the device stopped reporting by the offline rule, at its last reading', () => {
    const lastHeard = FROM + 16.3 * HOUR;
    const now = {
      values: [{ metric: 'temperature', value: 24.1, measuredAt: new Date(lastHeard).toISOString(), state: 'offline' } as CardValue],
      silentSince: lastHeard,
    };
    const [temperature] = drawn(answer(), null, { now }).panels;

    expect(Math.max(...temperature.plot.bands.map(band => band.to))).toBe(lastHeard);
  });

  it('says beside a deficit`s low and high what they are of beyond three days: means over five minutes', () => {
    const week = answer({ startsAt: at(-144), endsAt: at(24) });
    expect(drawn(week).panels.map(panel => panel.curves[0].of)).toEqual([undefined, undefined, 'of 5-min means']);
    // Inside three days they are of samples, as temperature's and humidity's are on every range.
    expect(drawn(answer()).panels[2].curves[0].of).toBeUndefined();
  });

  it('says the low and high of the window as the answer has them: the reading that closes the curve is "now" and no part of them', () => {
    const now = { values: [{ metric: 'vpd', value: 1.9, measuredAt: at(23.99), state: 'live' } as CardValue], silentSince: null };
    expect(drawn(answer(), null, { now }).panels[2].curves[0]).toMatchObject({ low: 1.31, high: 1.31 });
    // Where the points carry extremes they are what is read, and a point without any is its own.
    expect(
      extremesOf([
        [0, 20, 19, 22],
        [1, 21],
        [2, null],
      ]),
    ).toEqual({ low: 19, high: 22 });
  });

  it('carries the band that was aimed at by day and by night, and the alarm on its own reading', () => {
    const [temperature, humidity] = drawn(answer()).panels;

    expect(temperature.plot.bands.map(one => [one.low, one.high])).toEqual([
      [24, 26],
      [20, 22],
      [24, 26],
    ]);
    expect(temperature.plot.alarms).toEqual([]);
    // An alarm still open is shaded to the end of the window.
    expect(humidity.plot.alarms).toEqual([{ from: FROM + 12 * HOUR, to: FROM + 24 * HOUR }]);
  });

  it('stops the band and the night where the place fell silent: nothing is known after that', () => {
    const silent = answer();
    silent.panels = silent.panels.map(panel => ({ ...panel, points: [...panel.points.slice(0, 8), { measuredAt: at(8.001), value: null }] }));
    const [temperature] = drawn(silent).panels;

    expect(temperature.plot.bands.at(-1)!.to).toBe(FROM + 8 * HOUR);
    expect(temperature.plot.nights).toEqual([{ from: FROM + 6 * HOUR, to: FROM + 8 * HOUR }]);
  });

  it('puts all curves into one picture, each against its own scale, without a band to misread', () => {
    const { panels } = drawn(answer(), null, { one: true });

    expect(panels).toHaveLength(1);
    expect(panels[0].curves.map(curve => curve.key)).toEqual(['temperature', 'humidity', 'vpd']);
    expect(panels[0].plot.bands).toEqual([]);
    expect(new Set(panels[0].plot.lines.map(line => line.scale.high)).size).toBe(3);
  });

  it('breaks a VPD line at the half that was not asked for', () => {
    const { panels } = drawn(answer(), null, { vpdHalf: 'night' });
    const vpd = panels.find(panel => panel.key === 'vpd')!.curves[0];

    expect(vpd.points.filter(point => point[1] !== null)).toHaveLength(6);
    expect(vpd.high).toBe(1.31);
  });

  it('lays another run over as a dashed line on the same scale, moved onto this window', () => {
    const other = answer({
      startsAt: at(-240),
      endsAt: at(-216),
      panels: [{ metric: 'temperature', points: [{ measuredAt: at(-239), value: 22 }], targets: [] }],
    });
    const [temperature] = drawn(answer(), null, { compared: { data: other, shift: 240 * HOUR } }).panels;

    expect(temperature.plot.lines[1]).toMatchObject({ dashed: true, scale: temperature.curves[0].line.scale, points: [[FROM + 0.5 * HOUR, 22]] });
    // The scale holds what is laid over as well: a place ten degrees warmer is on the plot, not above it.
    const hot = { ...other, panels: [{ metric: 'temperature' as const, points: [{ measuredAt: at(-239), value: 34 }], targets: [] }] };
    expect(drawn(answer(), null, { compared: { data: hot, shift: 240 * HOUR } }).panels[0].curves[0].line.scale.high).toBeGreaterThanOrEqual(34);
  });
});

describe('the strips', () => {
  it('stand under the curve they act on, and the rest with the light', () => {
    const { panels, rest } = drawn(answer());

    expect(panels.map(panel => [panel.key, panel.strips.map(strip => strip.name)])).toEqual([
      ['temperature', ['Heater']],
      ['humidity', ['Dehumidifier']],
      ['vpd', []],
    ]);
    expect(rest.map(strip => strip.output)).toEqual(['light', 'fan']);
  });

  it('stand under the last panel beside the rail, where the picture has no card for them', () => {
    const { panels, rest } = drawn(answer(), null, { restUnderLast: true });

    expect(rest).toEqual([]);
    expect(panels.at(-1)!.strips.map(strip => strip.output)).toEqual(['light', 'fan']);
  });

  it('go with their tick, and an output whose curve is not drawn joins the rest', () => {
    expect(drawn(answer(), ['temperature', 'outputs']).rest.map(strip => strip.output)).toEqual(['dehumidifier', 'fan']);
    expect(drawn(answer(), ['temperature', 'light']).panels[0].strips).toEqual([]);
  });

  it('calls a fridge`s dehumidifier its compressor', () => {
    const fridge = answer({ outputs: [{ output: 'dehumidifier', deviceId: null, fridge: true, spans: [], heardUntil: at(24) }] });
    expect(stripsOf(t, fridge)[0].name).toBe('Compressor');
  });

  it('draws a strip from its points, neighbours that say the same as one block, and leaves blank what nobody heard', () => {
    const light = stripsOf(t, answer()).find(strip => strip.output === 'light')!;
    const blocks = blocksOf(light, FROM, FROM + 24 * HOUR, HOUR);

    expect(blocks.map(block => [Math.round(block.from * 24), Math.round(block.to * 24), block.share, block.level])).toEqual([
      [0, 6, 1, 65],
      [6, 12, 0, 0],
      // Heard until 20:00 into the window: after that it is not "off", it is unknown, and no block stands there.
      [12, 20, 1, 65],
    ]);
    expect(shareOf(light)).toBeCloseTo(14 / 20, 6);
  });

  it('draws a run of nine minutes in a day as the share of its point, and a switch with no level', () => {
    const dehumidifier = stripsOf(t, answer()).find(strip => strip.output === 'dehumidifier')!;
    const ran = blocksOf(dehumidifier, FROM, FROM + 24 * HOUR, HOUR).filter(block => block.share > 0);

    expect(ran).toEqual([{ from: 12 / 24, to: 13 / 24, share: 0.15, level: null }]);
  });

  it('counts a valve that pulses five seconds every two minutes as open in one sample of twenty-four, not all day', () => {
    // Its runs, each rounded out to the grain it was found at, join into one that covers the day.
    const valve = stripsOf(
      t,
      answer({
        outputs: [
          {
            output: 'co2',
            deviceId: null,
            spans: [{ startsAt: at(0), endsAt: at(24) }],
            heardUntil: at(24),
            points: counted(24, () => [720, 30, null]),
          },
        ],
      }),
    )[0];

    expect(shareOf(valve)).toBeCloseTo(1 / 24, 6);
    expect(blocksOf(valve, FROM, FROM + 24 * HOUR, HOUR)).toEqual([{ from: 0, to: 1, share: 1 / 24, level: null }]);
    expect(figureAt(valve, FROM + 3.5 * HOUR, HOUR)).toEqual({ share: 1 / 24, level: null });
  });

  it('says "on x % of the time" of the samples heard, not of the window', () => {
    // Heard for six hours of the day, lit in half of the samples: half, not an eighth.
    const light = { points: [1, 2, 3, 4, 5, 6].map(hour => [FROM + hour * HOUR, 12, hour <= 3 ? 12 : 0, hour <= 3 ? 65 : 0] as const) };
    expect(shareOf(light)).toBe(0.5);
    // A device that came eighteen hours into the day and was lit ever since was on all of the time it reported.
    expect(shareOf({ points: [19, 20, 21, 22, 23, 24].map(hour => [FROM + hour * HOUR, 12, 12, 65] as const) })).toBe(1);
    expect(shareOf({ points: [] })).toBeNull();
  });

  it('counts two devices that drive the same output together', () => {
    const lane = (heard: number, on: number, level: number) => ({
      output: 'heater' as const,
      deviceId: null,
      spans: [],
      heardUntil: at(24),
      points: [{ measuredAt: at(1), heard, on, level }],
    });
    expect(stripsOf(t, answer({ outputs: [lane(12, 12, 60), lane(4, 0, 0)] }))[0].points).toEqual([[FROM + HOUR, 16, 12, 45]]);
  });

  it('reads an output over the point the cursor falls into: its mean level, the share it ran, nothing where nobody heard', () => {
    const [light, heater, dehumidifier] = stripsOf(t, answer());

    expect(figureAt(heater, FROM + 7.5 * HOUR, HOUR)).toEqual({ share: 1, level: 60 });
    // Heard and off, which is a figure: 0 %.
    expect(figureAt(heater, FROM + 9 * HOUR, HOUR)).toEqual({ share: 0, level: 0 });
    expect(figureAt(dehumidifier, FROM + 12.5 * HOUR, HOUR)).toEqual({ share: 0.15, level: null });
    expect(figureAt(light, FROM + 19.5 * HOUR, HOUR)).toEqual({ share: 1, level: 65 });
    // Past the last thing heard there is no point, and nothing is said - not "off".
    expect(figureAt(light, FROM + 21 * HOUR, HOUR)).toBeNull();
    // A silence in the middle of the window is the same nothing.
    const gapped = { points: light.points.filter(([end]) => end <= FROM + 3 * HOUR || end > FROM + 9 * HOUR) };
    expect(figureAt(gapped, FROM + 5.5 * HOUR, HOUR)).toBeNull();
    // The first point after it has the samples it has.
    expect(figureAt(gapped, FROM + 9.5 * HOUR, HOUR)).toEqual({ share: 0, level: 0 });
  });
});

describe('the cursor', () => {
  const points = [
    [1000, 20],
    [2000, 21],
    [3000, null],
    [9000, 25],
  ] as const;

  it('rests on the last thing that was heard: the device`s reading, else the last drawn point, else the window`s end', () => {
    const TO = FROM + 24 * HOUR;
    const reading: CardValue = { metric: 'temperature', value: 20.5, measuredAt: at(23.9), state: 'stale' };
    const now = { values: [reading], silentSince: FROM + 23.9 * HOUR };

    // A window that holds the reading ends its curves on it, six minutes old or six seconds.
    const live = drawn(answer(), ['temperature'], { now });
    expect(restOf(live.panels, live.strips, TO, HOUR)).toBe(FROM + 23.9 * HOUR);
    // One that ended in the past rests on its last point, drawn in the middle of the hour it is the mean of.
    const past = drawn(answer(), ['temperature']);
    expect(restOf(past.panels, past.strips, TO, HOUR)).toBe(FROM + 23.5 * HOUR);
    // A curve that broke off earlier rests where it broke off, not at the end of the window.
    const broke = answer({ panels: [{ metric: 'temperature', points: [1, 2, 3].map(hour => ({ measuredAt: at(hour), value: 24 })), targets: [] }] });
    expect(restOf(drawn(broke, ['temperature']).panels, [], TO, HOUR)).toBe(FROM + 2.5 * HOUR);
    // Outputs alone: where the last of them was heard - the lamp fell silent at 20:00, the others did not.
    const outputs = drawn(answer({ panels: [] }), ['outputs', 'light']);
    expect(restOf(outputs.panels, outputs.strips, TO, HOUR)).toBe(FROM + 23.5 * HOUR);
    expect(restOf([], [], TO, HOUR)).toBe(TO);
  });

  it('reads the point nearest to it, which is where its dot sits on the line', () => {
    expect(nearestPoint(points, 1400, 1500)).toEqual([1000, 20]);
    expect(nearestPoint(points, 1600, 1500)).toEqual([2000, 21]);
  });

  it('reads the nearer point anywhere on a line between two points, however far apart an hourly history leaves them', () => {
    const hourly = [
      [0, 20],
      [HOUR, 22],
      [HOUR + 1, null],
      [3 * HOUR, 25],
    ] as const;
    // Twenty minutes from the one and forty from the other, with three minutes of reach: on the line, so the nearer.
    expect(nearestPoint(hourly, 20 * 60_000, 270_000)).toEqual([0, 20]);
    expect(nearestPoint(hourly, 45 * 60_000, 270_000)).toEqual([HOUR, 22]);
    // Across the break no line is drawn, and nothing is read.
    expect(nearestPoint(hourly, 2 * HOUR, 270_000)).toBeNull();
  });

  it('reads nothing across a silence', () => {
    expect(nearestPoint(points, 5500, 1500)).toBeNull();
  });

  it('rests on the last point drawn where the place has gone quiet', () => {
    const quiet = answer({
      panels: [
        {
          metric: 'temperature',
          points: [
            { measuredAt: at(3), value: 24 },
            { measuredAt: at(3.001), value: null },
          ],
          targets: [],
        },
      ],
    });

    expect(quietSince(quiet)).toBe(FROM + 2.5 * HOUR);
    expect(quietSince(answer())).toBeNull();
  });
});

describe('the picture a plot comes to', () => {
  const palette = new Proxy({}, { get: (_, token) => `#${String(token)}` }) as ChartPalette;

  it('lays the stretch between lowest and highest behind the line as a stack of its own', () => {
    const [temperature] = drawn(answer()).panels;
    const { series } = plotOption(palette, temperature.plot) as {
      series: { stack?: string; data: [number, number | null][]; areaStyle?: object; showSymbol?: boolean }[];
    };

    expect(series.map(one => one.stack)).toEqual(['temperature', 'temperature', undefined]);
    // The low, and above it how far the high lies: nothing where a window held one sample.
    expect(series[0].data[12][1]).toBe(19.4);
    expect(series[1].data[12][1]).toBeCloseTo(5.9, 6);
    expect(series[1].data[0][1]).toBe(0);
    expect(series[1].areaStyle).toBeDefined();
  });

  it('draws every point as a dot once they are few enough to tell apart', () => {
    const { series } = plotOption(palette, drawn(answer()).panels[2].plot) as { series: { symbol: string }[] };
    expect(series.at(-1)!.symbol).toBe('circle');
  });

  it('draws a reading with a silence on either side as a dot, in a line too long to dot throughout', () => {
    const points = [
      ...Array.from({ length: 200 }, (_, index) => [index * 1000, 20] as const),
      [200_000, null] as const,
      [900_000, 21] as const,
      [901_000, null] as const,
    ];
    const { series } = plotOption(palette, {
      from: 0,
      to: 1_000_000,
      nights: [],
      bands: [],
      alarms: [],
      lines: [{ key: 'a', colour: 'ink', shape: 'line', points, scale: { low: 0, high: 30 } }],
    }) as {
      series: { symbol: string; data: unknown[] }[];
    };

    expect(series[0].symbol).toBe('none');
    expect(series[0].data[201]).toEqual({ value: [900_000, 21], symbol: 'circle' });
    expect(series[0].data[5]).toEqual([5000, 20]);
  });
});

describe('the table', () => {
  it('holds every curve drawn with its lowest and highest, and every output as the state it held', () => {
    const { panels, strips } = drawn(answer(), ['temperature', 'outputs']);
    const table = csvFor(t, panels, strips, HOUR, null, new Map(), 'UTC', false);
    const [head, ...rows] = table.slice(1).split('\n');

    // The mark a spreadsheet reads the encoding by, so "°C" arrives as that.
    expect(table.charCodeAt(0)).toBe(0xfeff);
    // Every output as what the samples of each point's window came to, in per cent: its mean level, and for one
    // that only switches the share of them it ran in.
    expect(head).toBe(
      '"Time","Temperature (°C)","Temperature · low (°C)","Temperature · high (°C)","Light (%)","Heater (%)","Dehumidifier (%)","Fan (%)"',
    );
    // One row per drawn point and no other: a switching adds none.
    expect(rows).toHaveLength(24);
    // The window of the door: the mean, what it flattened, the lamp at 65 %, the dehumidifier on for nine minutes of the hour.
    expect(rows.find(row => row.startsWith('2026-11-12T03:00:00'))).toBe('2026-11-12T03:00:00.000Z,24.8,19.4,25.3,65,0,15,100');
    // The hour the heater ran at 60 %.
    expect(rows.find(row => row.startsWith('2026-11-11T22:00:00'))).toContain(',60,');
    // Past the last thing heard of the lamp its cell is empty rather than "0".
    expect(rows.at(-1)).toBe('2026-11-12T14:00:00.000Z,24.8,24.8,24.8,,0,0,100');
  });

  it('ends on the device`s last reading, with what that reading says of every output - as the card does', () => {
    const reading: CardValue = { metric: 'temperature', value: 20.3, measuredAt: at(23.9), state: 'live' };
    const { panels, strips } = drawn(answer(), ['temperature', 'outputs', 'light'], { now: { values: [reading], silentSince: null } });
    // The heater at 59 % and the fan running in that one sample; the lamp dark, the dehumidifier off.
    const said = new Map([
      ['light', { share: 0, level: 0 }],
      ['heater', { share: 1, level: 59 }],
      ['dehumidifier', { share: 0, level: null }],
      ['fan', { share: 1, level: null }],
    ] as const);
    const rows = csvFor(t, panels, strips, HOUR, FROM + 23.9 * HOUR, said, 'UTC', false)
      .slice(1)
      .split('\n')
      .slice(1);

    // The last row is the reading's own instant, and its outputs are the reading's.
    expect(rows.at(-1)).toBe('2026-11-12T14:24:00.000Z,20.3,20.3,20.3,0,59,0,100');
    // The row before it is a mean, and its outputs are what the samples of its hour came to.
    expect(rows.at(-2)).toBe('2026-11-12T14:00:00.000Z,24.8,24.8,24.8,,0,0,100');
  });

  it('writes no row after the last reading: an output nobody measured is not "0" there', () => {
    // The curve ends at 20:30; the strips are answered to the window's end.
    const quiet = answer({
      panels: [{ metric: 'temperature', points: [1, 2, 3, 4, 5, 6].map(hour => ({ measuredAt: at(hour), value: 24.8 })), targets: [] }],
    });
    const { panels, strips } = drawn(quiet, ['temperature', 'outputs', 'light']);
    const rows = csvFor(t, panels, strips, HOUR, null, new Map(), 'UTC', false).slice(1).split('\n').slice(1);

    expect(rows).toHaveLength(6);
    expect(rows.at(-1)!.startsWith('2026-11-11T20:00:00')).toBe(true);
  });

  it('says of the deficit`s column that it is worked out', () => {
    const { panels } = drawn(answer(), ['vpd']);
    expect(csvFor(t, panels, [], HOUR, null, new Map(), 'UTC', false).slice(1).split('\n')[0]).toBe(
      '"Time","VPD, worked out from temperature and humidity (kPa)"',
    );
  });

  it('is written with semicolons and decimal commas where figures are written with a comma, so a spreadsheet there reads columns', () => {
    const table = csvOf(
      [
        { label: 'Temperatur (°C)', points: [[FROM, 24.8]] },
        { label: 'Licht (%)', decimals: 0, points: [[FROM, 100]] },
      ],
      'UTC',
      'Zeit',
      true,
    );

    expect(table.slice(1).split('\n')).toEqual(['"Zeit";"Temperatur (°C)";"Licht (%)"', '2026-11-11T14:30:00.000Z;24,8;100']);
  });
});

describe('how the page says when', () => {
  const now = DateTime.fromISO('2026-11-12T15:30:00.000Z');
  const day = (iso: string) => ({ from: Date.parse(`${iso}T00:00:00.000Z`), to: Date.parse(`${iso}T00:00:00.000Z`) + 24 * HOUR });

  it('calls a whole day of the calendar that day, and not its two midnights', () => {
    expect(windowLabel(t, day('2026-08-11'), false, now, 'UTC')).toBe('Tue, 11 Aug');
    expect(windowLabel(t, day('2026-11-11'), false, now, 'UTC')).toBe('Yesterday');
    // Today is shown up to now.
    expect(windowLabel(t, { from: day('2026-11-12').from, to: now.toMillis() }, true, now, 'UTC')).toBe('Today to now');
    // Any other stretch keeps its two ends.
    expect(windowLabel(t, { from: Date.parse('2026-11-12T03:00:00Z'), to: Date.parse('2026-11-12T03:20:00Z') }, false, now, 'UTC')).toBe(
      'Today 03:00 to 03:20',
    );
  });

  it('names both ends of an axis as the lines between them name a day', () => {
    const from = Date.parse('2026-11-10T06:57:00Z');
    // By the clock up to a day and a half, by weekday and day up to eight days, by the date past that.
    expect(axisEnds(t, { from, to: from + 24 * HOUR }, false, 'UTC')).toEqual(['06:57', '06:57']);
    expect(axisEnds(t, { from, to: from + 72 * HOUR }, false, 'UTC')).toEqual(['Tue 10', 'Fri 13']);
    expect(axisEnds(t, { from, to: from + 72 * HOUR }, true, 'UTC')).toEqual(['Tue 10', 'now']);
    expect(axisEnds(t, { from, to: from + 30 * 24 * HOUR }, false, 'UTC')).toEqual(['10 Nov', '10 Dec']);
  });

  it('says of a mean that it is one, and over which stretch', () => {
    const window = { from: Date.parse('2026-11-12T00:00:00Z'), to: Date.parse('2026-11-12T12:00:00Z') };
    expect(meanStamp(t, Date.parse('2026-11-12T03:10:30Z'), window, 180, 'UTC')).toBe('mean 03:09–03:12');
    // Finer than a minute, the stretch is told to the second.
    expect(meanStamp(t, Date.parse('2026-11-12T03:10:22.500Z'), window, 45, 'UTC')).toBe('mean 03:10:00–03:10:45');
  });

  it('says a step in seconds below two minutes and in whole minutes from there', () => {
    expect([90, 150, 600].map(step => stepWords(t, step))).toEqual(['every 90 s', 'every 3 min', 'every 10 min']);
  });

  it('says how far apart the points are in the unit that fits', () => {
    expect([5, 180, 5400, 16_200, 86_400, 198_720].map(step => stepWords(t, step))).toEqual([
      'every 5 s',
      'every 3 min',
      'every 1.5 h',
      'every 4.5 h',
      'every day',
      'every 2.3 days',
    ]);
  });
});
