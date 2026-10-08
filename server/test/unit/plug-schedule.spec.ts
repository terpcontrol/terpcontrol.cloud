import { FIRMWARE_LIGHTS_OFF, FIRMWARE_LIGHTS_ON, isDayAt, plugScheduleOf } from '@fg2/shared-types/v1-schemas/day-night.js';

/**
 * A smart plug's day, as its firmware decides `state.is_day` (`checkDayCycle`
 * in `plug.cpp`): the two times of its document compared with the UTC time of
 * day, strictly, a window past midnight wrapping round it and two equal times
 * never being day - and only a schedule at all where `usedaynight` says the
 * plug acts on it.
 */

const HOUR = 3600;

const plug = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  workmode: 'dehumidify',
  usedaynight: true,
  daynight: { day: 6 * HOUR, night: 18 * HOUR },
  ...over,
});

/** Whether the plug calls this second of the UTC clock day; null where it keeps no schedule. */
const dayAt = (configuration: Record<string, unknown> | null, seconds: number, type = 'plug'): boolean | null => {
  const schedule = plugScheduleOf(type, configuration);
  return schedule ? isDayAt(schedule, seconds) : null;
};

describe('a plug´s day and night', () => {
  it('is day strictly between the two times', () => {
    expect(dayAt(plug(), 6 * HOUR)).toBe(false);
    expect(dayAt(plug(), 6 * HOUR + 1)).toBe(true);
    expect(dayAt(plug(), 12 * HOUR)).toBe(true);
    expect(dayAt(plug(), 18 * HOUR - 1)).toBe(true);
    expect(dayAt(plug(), 18 * HOUR)).toBe(false);
    expect(dayAt(plug(), 0)).toBe(false);
  });

  it('runs a window past midnight UTC round it', () => {
    const late = plug({ daynight: { day: 20 * HOUR, night: 8 * HOUR } });

    expect(dayAt(late, 20 * HOUR)).toBe(false);
    expect(dayAt(late, 23 * HOUR)).toBe(true);
    expect(dayAt(late, 0)).toBe(true);
    expect(dayAt(late, 8 * HOUR - 1)).toBe(true);
    expect(dayAt(late, 8 * HOUR)).toBe(false);
    expect(dayAt(late, 12 * HOUR)).toBe(false);
  });

  it('is never day with both times the same', () => {
    const dark = plug({ daynight: { day: 6 * HOUR, night: 6 * HOUR } });

    for (const seconds of [0, 6 * HOUR, 6 * HOUR + 1, 12 * HOUR, 24 * HOUR - 1]) expect(dayAt(dark, seconds)).toBe(false);
  });

  it('takes the firmware´s 06:00 to 22:00 UTC where the document states no times', () => {
    expect(plugScheduleOf('plug', { usedaynight: true })).toEqual({ day: FIRMWARE_LIGHTS_ON, night: FIRMWARE_LIGHTS_OFF });
    expect(plugScheduleOf('plug', { usedaynight: true, daynight: { night: 20 * HOUR } })).toEqual({ day: 6 * HOUR, night: 20 * HOUR });
  });

  it('decides nothing in any work mode where the plug does not use its schedule', () => {
    // The firmware's default: every output holds the day's switch points round the clock.
    expect(dayAt(plug({ usedaynight: undefined }), 12 * HOUR)).toBeNull();
    expect(dayAt(plug({ usedaynight: false }), 12 * HOUR)).toBeNull();
    expect(dayAt(plug({ usedaynight: 0 }), 12 * HOUR)).toBeNull();
    expect(dayAt(null, 12 * HOUR)).toBeNull();
  });

  it('reads the switch as the firmware reads a flag, whatever mode the plug is in', () => {
    expect(dayAt(plug({ usedaynight: 1 }), 12 * HOUR)).toBe(true);
    expect(dayAt(plug({ workmode: 'timer' }), 12 * HOUR)).toBe(true);
    expect(dayAt(plug({ workmode: 'off' }), 3 * HOUR)).toBe(false);
  });

  it('is no plug´s schedule on any other hardware', () => {
    for (const type of ['fridge', 'controller', 'fan', 'light']) expect(dayAt(plug(), 12 * HOUR, type)).toBeNull();
  });
});
