import type { CardValue, SpaceTimeline } from '@fg2/shared-types/v1';
import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { csvOf, plotOption } from '@/charts/series';
import type { ChartPalette } from '@/charts/tokens';
import {
  csvFor,
  drawnBefore,
  extremesOf,
  levelsOf,
  nearestPoint,
  offeredOf,
  panelsOf,
  quietSince,
  shareOf,
  shownOf,
  slicesOf,
  stateAt,
  stateNow,
  stripsOf,
  type Shown,
} from '@/screens/timeline/model';
import { DateTime } from 'luxon';
import { meanStamp, stepWords, windowLabel } from '@/screens/timeline/labels';
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
      level: { unit: 'percent', points: [{ measuredAt: at(8), value: 60 }] },
    },
    { output: 'dehumidifier', deviceId: 'device-1', spans: [{ startsAt: at(12), endsAt: at(12.15) }], heardUntil: at(24) },
    {
      output: 'light',
      deviceId: 'device-1',
      spans: [
        { startsAt: at(0), endsAt: at(6) },
        { startsAt: at(12), endsAt: at(20) },
      ],
      heardUntil: at(20),
      level: { unit: 'percent', points: [{ measuredAt: at(20), value: 65 }] },
    },
    { output: 'fan', deviceId: 'device-1', spans: [{ startsAt: at(0), endsAt: at(24) }], heardUntil: at(24) },
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

  it('says what an output is doing as the device last said it: its live level in per cent, on or off where it only switches', () => {
    expect(stateNow('light', 65)).toEqual({ on: true, level: 65 });
    expect(stateNow('heater', 0.62)).toEqual({ on: true, level: 62 });
    expect(stateNow('dehumidifier', 1)).toEqual({ on: true, level: null });
    expect(stateNow('light', 0)).toEqual({ on: false, level: 0 });
    expect(stateNow('fan', null)).toBeNull();
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

  it('tints a slice by the share of it the output ran, and leaves blank what nobody heard', () => {
    const light = stripsOf(t, answer()).find(strip => strip.output === 'light')!;
    const slices = slicesOf(light, FROM, FROM + 24 * HOUR, 24);

    expect(slices.slice(0, 7)).toEqual([1, 1, 1, 1, 1, 1, 0]);
    expect(slices[12]).toBe(1);
    // Heard until 20:00 into the window: after that it is not "off", it is unknown.
    expect(slices.slice(20)).toEqual([null, null, null, null]);
    expect(shareOf(light, FROM, FROM + 24 * HOUR)).toBeCloseTo(14 / 20, 6);
  });

  it('shows a run of nine minutes in a day as a share of its slice rather than losing it', () => {
    const dehumidifier = stripsOf(t, answer()).find(strip => strip.output === 'dehumidifier')!;
    const slices = slicesOf(dehumidifier, FROM, FROM + 24 * HOUR, 24);

    expect(slices[12]).toBeCloseTo(0.15, 6);
    expect(slices.filter(share => share)).toHaveLength(1);
  });

  it('fills a slice to the level its output ran at, where it says one, and whole where it only switches', () => {
    const { strips } = drawn(answer());
    const heater = strips.find(strip => strip.output === 'heater')!;
    const levels = levelsOf(heater, FROM, FROM + 24 * HOUR, HOUR, 24)!;

    // The level stamped 08:00 stands for the hour before it.
    expect(levels[7]).toBe(0.6);
    expect(levels[3]).toBeNull();
    expect(
      levelsOf(
        strips.find(strip => strip.output === 'dehumidifier')!,
        FROM,
        FROM + 24 * HOUR,
        HOUR,
        24,
      ),
    ).toBeNull();
  });

  it('reads an output at the cursor: its level where it says one, on or off, nothing past the last thing heard', () => {
    const [light, heater] = stripsOf(t, answer());

    expect(stateAt(heater, FROM + 7.5 * HOUR, HOUR)).toEqual({ on: true, level: 60 });
    expect(stateAt(heater, FROM + 9 * HOUR, HOUR)).toEqual({ on: false, level: null });
    expect(stateAt(light, FROM + 19.5 * HOUR, HOUR)).toEqual({ on: true, level: 65 });
    expect(stateAt(light, FROM + 21 * HOUR, HOUR)).toBeNull();
  });
});

describe('the cursor', () => {
  const points = [
    [1000, 20],
    [2000, 21],
    [3000, null],
    [9000, 25],
  ] as const;

  it('reads the point nearest to it, which is where its dot sits on the line', () => {
    expect(nearestPoint(points, 1400, 1500)).toEqual([1000, 20]);
    expect(nearestPoint(points, 1600, 1500)).toEqual([2000, 21]);
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
    const table = csvFor(t, panels, strips, { from: FROM, to: FROM + 24 * HOUR, stepMs: HOUR }, 'UTC', false);
    const [head, ...rows] = table.slice(1).split('\n');

    // The mark a spreadsheet reads the encoding by, so "°C" arrives as that.
    expect(table.charCodeAt(0)).toBe(0xfeff);
    // An output with a level is written as that level in per cent; one that only switches as the state it held.
    expect(head).toBe(
      '"Time","Temperature (°C)","Temperature · low (°C)","Temperature · high (°C)","Light (%)","Heater (%)","Dehumidifier (on/off)","Fan (on/off)"',
    );
    // The window of the door: the mean, and what it flattened - every figure of a column with the same decimals.
    expect(rows.find(row => row.startsWith('2026-11-12T03:00:00'))).toBe('2026-11-12T03:00:00.000Z,24.8,19.4,25.3,65,0,0,1');
    // The hour the heater ran at 60 %.
    expect(rows.find(row => row.startsWith('2026-11-11T22:00:00'))).toContain(',60,');
    // Past the last thing heard of the lamp its column is empty rather than "off".
    expect(rows.at(-1)).toBe('2026-11-12T14:00:00.000Z,24.8,24.8,24.8,,0,0,1');
    // No instant at which nothing is said is a row.
    expect(rows.every(row => /[^,]/.test(row.slice(row.indexOf(',') + 1)))).toBe(true);
  });

  it('says of the deficit`s column that it is worked out', () => {
    const { panels } = drawn(answer(), ['vpd']);
    expect(
      csvFor(t, panels, [], { from: FROM, to: FROM + 24 * HOUR, stepMs: HOUR }, 'UTC', false)
        .slice(1)
        .split('\n')[0],
    ).toBe('"Time","VPD, worked out from temperature and humidity (kPa)"');
  });

  it('is written with semicolons and decimal commas where figures are written with a comma, so a spreadsheet there reads columns', () => {
    const table = csvOf(
      [
        { label: 'Temperatur (°C)', points: [[FROM, 24.8]] },
        { label: 'Licht', holds: true, points: [[FROM, 1]] },
      ],
      'UTC',
      'Zeit',
      true,
    );

    expect(table.slice(1).split('\n')).toEqual(['"Zeit";"Temperatur (°C)";"Licht"', '2026-11-11T14:30:00.000Z;24,8;1']);
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

  it('says of a mean that it is one, and over which stretch', () => {
    const window = { from: Date.parse('2026-11-12T00:00:00Z'), to: Date.parse('2026-11-12T12:00:00Z') };
    expect(meanStamp(t, Date.parse('2026-11-12T03:10:30Z'), window, 180, 'UTC')).toBe('mean 03:09–03:12');
    // Finer than a minute, the stretch is told to the second.
    expect(meanStamp(t, Date.parse('2026-11-12T03:10:22.500Z'), window, 45, 'UTC')).toBe('mean 03:10:00–03:10:45');
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
