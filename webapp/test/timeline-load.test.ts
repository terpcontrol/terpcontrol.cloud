import { describe, expect, it } from 'vitest';
import type { TimelineOutputLane } from '@fg2/shared-types/v1';
import { loadOf, sliceAt } from '@/screens/timeline/load';

const FROM = Date.UTC(2026, 9, 1);
const HOUR = 3_600_000;
const at = (hour: number) => new Date(FROM + hour * HOUR).toISOString();
const TO = FROM + 4 * HOUR;

const lane = (rest: Partial<TimelineOutputLane>): TimelineOutputLane => ({
  output: 'dehumidifier',
  deviceId: 'device-1',
  spans: [],
  heardUntil: at(4),
  ...rest,
});

describe('how hard a lane worked', () => {
  it('is the share of each slice a switch ran for', () => {
    // A compressor cycling a quarter of an hour on, three quarters off, through the second hour.
    const spans = [0, 1, 2, 3].map(quarter => ({ startsAt: at(1 + quarter / 4), endsAt: at(1 + quarter / 4 + 1 / 16) }));
    expect(loadOf(lane({ spans }), FROM, TO, 3600)).toEqual([0, 0.25, 0, 0]);
  });

  it('weighs the time it ran by how hard it ran', () => {
    const heater = lane({
      output: 'heater',
      spans: [{ startsAt: at(0), endsAt: at(0.5) }],
      level: { unit: 'percent', points: [{ measuredAt: at(1), value: 40 }] },
    });
    expect(loadOf(heater, FROM, TO, 3600)[0]).toBeCloseTo(0.2);
  });

  it('counts only the time the CO2 valve was open, not what it dosed', () => {
    const valve = lane({
      output: 'co2',
      spans: [{ startsAt: at(0), endsAt: at(1) }],
      level: { unit: 'count', points: [{ measuredAt: at(1), value: 17 }] },
    });
    expect(loadOf(valve, FROM, TO, 3600)[0]).toBe(1);
  });

  it('knows nothing after the device was last heard from, which is not the same as off', () => {
    const quiet = lane({ spans: [{ startsAt: at(0), endsAt: at(2) }], heardUntil: at(2) });
    const load = loadOf(quiet, FROM, TO, 3600);
    expect(load).toEqual([1, 1, null, null]);
    expect(sliceAt(load, FROM, TO, TO)).toBeNull();
  });

  it('cuts a window no finer than the server read it', () => {
    expect(loadOf(lane({}), FROM, TO, 7200)).toHaveLength(2);
    expect(loadOf(lane({}), FROM, FROM + 30 * 24 * HOUR, 60)).toHaveLength(160);
  });
});
