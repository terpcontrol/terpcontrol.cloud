import type { SpaceTimeline } from '@fg2/shared-types/v1';
import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { plotOption } from '@/charts/series';
import type { ChartPalette } from '@/charts/tokens';
import {
  csvFor,
  nearestPoint,
  offeredOf,
  panelsOf,
  quietSince,
  shareOf,
  shownOf,
  slicesOf,
  stateAt,
  stripsOf,
  type Shown,
} from '@/screens/timeline/model';
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
    ...panelsOf(t, data, strips, { shown, one: false, vpdHalf: 'all', measured: [], compared: null, restUnderLast: false, ...over }),
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

  it('reads a humidity to the tenth the sensor delivers', () => {
    const [, humidity] = drawn(answer()).panels;
    expect(humidity.curves[0].written(56.04)).toBe('56.0');
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
    const { series } = plotOption(palette, drawn(answer()).panels[2].plot) as { series: { showSymbol: boolean }[] };
    expect(series.at(-1)!.showSymbol).toBe(true);
  });
});

describe('the table', () => {
  it('holds every curve drawn with its lowest and highest, and every output as the state it held', () => {
    const { panels, strips } = drawn(answer(), ['temperature', 'outputs']);
    const [head, ...rows] = csvFor(t, panels, strips, FROM, FROM + 24 * HOUR, 'UTC').split('\n');

    expect(head).toBe(
      '"Time","Temperature (°C)","Temperature · low (°C)","Temperature · high (°C)","Light (on/off)","Heater (on/off)","Dehumidifier (on/off)","Fan (on/off)"',
    );
    // The window of the door: the mean, and what it flattened.
    expect(rows.find(row => row.startsWith('2026-11-12T03:00:00'))).toBe('2026-11-12T03:00:00.000Z,24.8,19.4,25.3,1,0,0,1');
    // Past the last thing heard of the lamp its column is empty rather than "off".
    expect(rows.at(-1)).toBe('2026-11-12T14:00:00.000Z,24.8,24.8,24.8,,0,0,1');
  });
});
