import { DateTime, Settings } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ticksFor, timeTicks } from '@/charts/ticks';

const ZONE = 'Europe/Berlin';
const DAY_DE = "d'.' LLL";
const local = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toMillis();
const labels = (from: string, to: string, most: number) => timeTicks(local(from), local(to), ZONE, most, DAY_DE).map(tick => tick.label);

describe('the gridlines of a chart over time', () => {
  let before: string;
  beforeAll(() => {
    before = Settings.defaultLocale;
    Settings.defaultLocale = 'de';
  });
  afterAll(() => {
    Settings.defaultLocale = before;
  });

  it('cuts a rolling day at the hours a clock turns over, and names midnight by its weekday', () => {
    expect(labels('2026-10-01T14:51', '2026-10-02T14:51', 4)).toEqual(['18:00', 'Fr', '06:00', '12:00']);
  });

  it('counts a week by its days on a wide plot and by every other date on a narrow one', () => {
    expect(labels('2026-09-25T14:52', '2026-10-02T14:52', 8)).toEqual(['Sa 26.', 'So 27.', 'Mo 28.', 'Di 29.', 'Mi 30.', 'Do 1.', 'Fr 2.']);
    expect(labels('2026-09-25T14:52', '2026-10-02T14:52', 4)).toEqual(['26. Sep', '28. Sep', '30. Sep', '2. Okt']);
  });

  it('falls on the account´s midnight, whatever zone the browser is in', () => {
    for (const tick of timeTicks(local('2026-09-25T14:52'), local('2026-10-02T14:52'), ZONE, 8, DAY_DE)) {
      expect(DateTime.fromMillis(tick.at, { zone: ZONE }).toFormat('HH:mm')).toBe('00:00');
    }
  });

  it('writes months over a season and the year where it turns', () => {
    expect(labels('2025-11-10T00:00', '2026-04-20T00:00', 6)).toEqual(['Dez', '2026', 'Feb', 'Mär', 'Apr']);
  });

  it('leaves out a line hard against either end, and gives a narrow plot at least two', () => {
    expect(labels('2026-10-02T11:59', '2026-10-02T13:01', 3)).toEqual(['12:30']);
    expect(labels('2026-10-02T11:40', '2026-10-02T13:20', 2)).toEqual(['12:00', '13:00']);
    expect(ticksFor(0)).toBe(2);
    expect(ticksFor(320)).toBe(4);
    expect(ticksFor(5000)).toBe(10);
  });
});
