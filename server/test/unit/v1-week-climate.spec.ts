import type { Metric, SeriesPoint } from '@fg2/shared-types/v1';
import { DeviceHistory } from '@modules/data/data.service';
import { summariseClimate } from '@modules/v1/diary/week-climate';

/**
 * What a stretch of a grow's climate came to, as a week card and a report
 * chapter state it.
 *
 * The arithmetic is here rather than in the diary spec because the cases worth
 * pinning are the ones a fixture of a well-behaved week cannot show: a lamp on a
 * dimmer, a stretch the device was barely heard in, and a week so old that its
 * raw samples have been summarised away. All three used to answer a figure, and
 * two of them answered twenty-four hours of light.
 */

const DEVICE = 'device-1';
const STEP_SECONDS = 900;
const STEP_MS = STEP_SECONDS * 1000;
const WINDOWS_A_DAY = (24 * 60 * 60 * 1000) / STEP_MS;

const FROM = Date.parse('2026-08-01T00:00:00.000Z');

interface Window {
  /** What the light output averaged over the window, on the 0-100 scale a device writes it on. */
  light: number | null;
  temperature: number;
  lit: boolean;
}

/**
 * One device's answer over a stretch of whole windows: the curve, stamped at the
 * end of each window as the store stamps it, and beside it the switchings, each
 * stamped where the state began.
 */
const heard = (windows: Window[], knownFromIndex = 0): DeviceHistory => {
  const points = (value: (window: Window) => number | null): SeriesPoint[] =>
    windows.map((window, index) => ({ measuredAt: new Date(FROM + (index + 1) * STEP_MS).toISOString(), value: value(window) }));

  return {
    series: {
      deviceId: DEVICE,
      startsAt: new Date(FROM).toISOString(),
      endsAt: new Date(FROM + windows.length * STEP_MS).toISOString(),
      stepSeconds: STEP_SECONDS,
      metrics: [{ metric: 'temperature' as Metric, points: points(window => window.temperature) }],
      outputs: [{ output: 'light', points: points(window => window.light) }],
    },
    outputs: [
      {
        output: 'light',
        switchings: windows.flatMap((window, index, all) =>
          index >= knownFromIndex && (index === knownFromIndex || window.lit !== all[index - 1].lit)
            ? [{ at: new Date(FROM + index * STEP_MS).toISOString(), on: window.lit }]
            : [],
        ),
      },
    ],
  };
};

/** A week on 12/12 with the lamp at whatever brightness, measured every quarter of an hour. */
const aWeekAt = (brightness: number): Window[] =>
  Array.from({ length: 7 * WINDOWS_A_DAY }, (_, index) => {
    const lit = index % WINDOWS_A_DAY < WINDOWS_A_DAY / 2;

    return { lit, light: lit ? brightness : 0, temperature: lit ? 25 : 20 };
  });

describe('how long the light was on', () => {
  it('is what the lamp ran for, whatever it was dimmed to', () => {
    // A lamp at 60 % averages 60 over a lit window and a lamp at 100 averages
    // 100; both are on for twelve hours, and no threshold on the average can
    // say so for both.
    expect(summariseClimate([heard(aWeekAt(100))], null).lightHours).toBe(12);
    expect(summariseClimate([heard(aWeekAt(60))], null).lightHours).toBe(12);
    expect(summariseClimate([heard(aWeekAt(3))], null).lightHours).toBe(12);
  });

  it('is refused where the device was heard for less than a day of the stretch', () => {
    // The last two hours of a grow that ended at teatime, the lamp on for the
    // last seven minutes of them. Stated per day, that handful of windows used
    // to read as a week lit around the clock.
    const ending: Window[] = [
      { lit: false, light: 0, temperature: 24 },
      { lit: true, light: 48, temperature: 25 },
    ];

    expect(summariseClimate([heard(ending)], null).lightHours).toBeNull();
    // What was measured is still stated: it is the figure per day that cannot
    // be had from two windows, not the average of them.
    expect(summariseClimate([heard(ending)], null).climate[0]).toMatchObject({ metric: 'temperature', averageValue: 24.5 });
  });

  it('is refused for a stretch whose raw samples have been summarised away, rather than read off the daily mean', () => {
    const week = aWeekAt(100);
    const summarised: DeviceHistory = { ...heard(week), outputs: [{ output: 'light', switchings: [] }] };

    expect(summariseClimate([summarised], null).lightHours).toBeNull();
    // And with nothing to tell the halves apart, the stretch has one average
    // rather than two: a daily mean of a brightness says how bright, not how
    // long, so neither half can be worked out from it.
    expect(summariseClimate([summarised], null).climate[0]).toMatchObject({ averageValue: 22.5, dayAverage: null, nightAverage: null });
  });

  it('is the fullest answer among the controllers of one tent rather than their sum', () => {
    const half = aWeekAt(100).map(window => ({ ...window, lit: false, light: 0 }));

    expect(summariseClimate([heard(aWeekAt(100)), heard(half)], null).lightHours).toBe(12);
  });
});

describe('the day and the night', () => {
  it('are told apart by what the lamp did, not by the clock', () => {
    const summary = summariseClimate([heard(aWeekAt(100))], null);

    expect(summary.climate[0]).toMatchObject({ metric: 'temperature', dayAverage: 25, nightAverage: 20, averageValue: 22.5 });
  });

  it('leave out a window the lamp switched inside, whose air is a mean of both halves', () => {
    const windows: Window[] = [
      { lit: true, light: 100, temperature: 25 },
      { lit: true, light: 50, temperature: 22 },
    ];
    // The lamp went off half way through the second window, so that window's
    // reading is neither a day figure nor a night one.
    const switched: DeviceHistory = {
      ...heard(windows),
      outputs: [
        {
          output: 'light',
          switchings: [
            { at: new Date(FROM).toISOString(), on: true },
            { at: new Date(FROM + 1.5 * STEP_MS).toISOString(), on: false },
          ],
        },
      ],
    };

    expect(summariseClimate([switched], null).climate[0]).toMatchObject({ dayAverage: 25, nightAverage: null, averageValue: 23.5 });
  });

  it('leave out a window the device said nothing about the light in', () => {
    // The lamp is known to be on throughout; the window in the middle was not
    // reported, so its reading counts towards neither half.
    const windows = aWeekAt(100).map((window, index) => (index === 3 ? { ...window, light: null } : window));
    const summary = summariseClimate([heard(windows)], null);

    expect(summary.climate[0].dayAverage).toBe(25);
    // Twelve hours of light a day, less the quarter of an hour nobody heard.
    expect(summary.lightHours).toBeCloseTo(12, 1);
  });
});
