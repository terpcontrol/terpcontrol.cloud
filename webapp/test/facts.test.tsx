import { render } from '@testing-library/react';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { Device, Entry } from '@fg2/shared-types/v1';
import { silenceOf } from '@/screens/start/attention';
import { stageOn } from '@/screens/start/stage';
import { tickedLabel } from '@/screens/tasks/tasks';
import { warningOf } from '@/ui/entries';
import { factsOf, unbroken } from '@/ui/fact-text';
import { Facts } from '@/ui/Facts';

/**
 * The small rules the fixes to Start are made of, each as arithmetic: facts
 * set side by side, a figure bound to its unit, which line of a summary is a
 * warning, what a tick says, when a place waits for its first values, and the
 * stage a device's settings say its place is on.
 */

describe('facts side by side', () => {
  it('reads as the sentence it is drawn from, with a dot between two facts and none before the first', () => {
    const { container } = render(<Facts facts={['24.3 °C', '66 %', null, 'Light 80 %']} />);

    expect(container.textContent).toBe('24.3 °C · 66 % · Light 80 %');
    // Every fact is one piece, which is what keeps a label with its value when the row breaks.
    expect(container.firstElementChild!.children).toHaveLength(3);
  });

  it('keeps a row inside a row together as one fact', () => {
    const { container } = render(<Facts facts={[<Facts key="day" facts={['Day 25 °C', '60 %']} />, 'Night 21 °C']} />);

    expect(container.textContent).toBe('Day 25 °C · 60 % · Night 21 °C');
    expect(container.firstElementChild!.children).toHaveLength(2);
  });

  it('takes a sentence apart at its dots', () => {
    expect(factsOf('Mothers too dry · 38 % humidity · since 00:56')).toEqual(['Mothers too dry', '38 % humidity', 'since 00:56']);
    expect(factsOf('All on target.')).toEqual(['All on target.']);
  });

  it('binds a figure to the unit after it, and leaves a figure before a word to break as words do', () => {
    expect(unbroken('Temperature 11.5 °C too high')).toBe('Temperature 11.5 °C too high');
    expect(unbroken('38 % · 900 ppm · 1.07 kPa · 15 Min')).toBe('38 % · 900 ppm · 1.07 kPa · 15 Min');
    expect(unbroken('2 Tage überfällig')).toBe('2 Tage überfällig');
    expect(unbroken('since 03:06 today')).toBe('since 03:06 today');
  });
});

describe('which line of a summary is a warning', () => {
  const line = (kind: Entry['kind'], severity: Entry['severity']) => ({ kind, severity });

  it('is an alarm that was raised, by how grave its rule says it is', () => {
    expect(warningOf(line('alarm', 'warning'))).toBe('warning');
    expect(warningOf(line('alarm', 'critical'))).toBe('critical');
  });

  it('is not an alarm that is over, nor a restart, a plan step or maintenance - whatever the device sent them with', () => {
    expect(warningOf(line('alarm', 'info'))).toBeNull();
    expect(warningOf(line('system', 'warning'))).toBeNull();
    expect(warningOf(line('plan', 'warning'))).toBeNull();
    expect(warningOf(line('visit', 'critical'))).toBeNull();
    expect(warningOf(line('note', null))).toBeNull();
  });
});

describe('what a tick says', () => {
  const t = ((key: string, values?: { label?: string }) => (key === 'tasks.tickedOff' ? `Done · ${values?.label}` : 'Step confirmed')) as never;

  it('names the task, and where on a screen that lists several places', () => {
    expect(tickedLabel(t, { label: 'Clean the filter' })).toBe('Done · Clean the filter');
    expect(tickedLabel(t, { label: 'Clean the filter' }, 'Tent 2')).toBe('Done · Clean the filter · Tent 2');
  });

  it('says a step of the plan was confirmed rather than done', () => {
    expect(tickedLabel(t, { label: 'Late flower', source: 'plan_step' })).toBe('Step confirmed · Late flower');
  });
});

describe('a place with no value to show', () => {
  const now = DateTime.fromISO('2026-11-12T11:00:00.000Z');
  const heard = (lastSeenAt: string | null) => ({ state: { lastSeenAt } });
  const value = { metric: 'temperature' as const, value: 25, measuredAt: now.toISO()!, state: 'live' as const };

  it('waits for its first values where nothing was ever heard, or a device is there and has not measured yet', () => {
    expect(silenceOf([], [heard(null)], now)).toEqual({ waiting: true });
    expect(silenceOf([], [heard(now.minus({ seconds: 20 }).toISO())], now)).toEqual({ waiting: true });
  });

  it('is silent since a device was last heard, where that is long enough ago for its values to have left the live read', () => {
    const since = now.minus({ days: 40 }).toISO()!;
    expect(silenceOf([], [heard(null), heard(since)], now)).toEqual({ waiting: false, since });
  });

  it('says nothing of a place that has values, or whose devices this reader is not told', () => {
    expect(silenceOf([value], [heard(null)], now)).toBeNull();
    expect(silenceOf([], [], now)).toBeNull();
  });
});

describe('the stage a device´s settings say its place is on', () => {
  const device = (configuration: Record<string, unknown>, control: Record<string, unknown> = {}): Device =>
    ({
      id: 'device-1',
      type: 'controller',
      configuration: { daynight: { day: 6 * 3600, night: 24 * 3600 }, ...configuration },
      control: { running: true, drying: false, mode: 'standard', energySaving: false, ...control },
      state: { hardware: {} },
    }) as unknown as Device;
  const climate = (dayT: number, dayH: number, nightT: number, nightH: number) => ({
    day: { temperature: dayT, humidity: dayH },
    night: { temperature: nightT, humidity: nightH },
  });

  it('is the stage whose climate the day´s and the night´s figures are', () => {
    expect(stageOn(device(climate(24, 70, 21, 65)))).toBe('seedling');
    expect(stageOn(device(climate(26, 62, 22, 58)))).toBe('vegetative');
    // The figures say flower although the day is still eighteen hours long: the preset was applied, the light not yet turned.
    expect(stageOn(device(climate(25, 50, 20, 50)))).toBe('flowering');
  });

  it('is germination or drying where the device runs that mode, whatever figures it holds', () => {
    expect(stageOn(device(climate(26, 62, 22, 58), { mode: 'germination' }))).toBe('germination');
    expect(stageOn(device(climate(26, 62, 22, 58), { drying: true }))).toBe('drying');
  });

  /** A factory-fresh controller's twelve hours of light said "Blüte", and one tap recorded a grow on its first day as flowering. */
  it('says no stage where somebody has moved the figures since, whatever the length of the day', () => {
    expect(stageOn(device({ ...climate(25, 60, 21, 55), daynight: { day: 6 * 3600, night: 18 * 3600 } }))).toBeNull();
    expect(stageOn(device(climate(25, 60, 21, 55)))).toBeNull();
  });

  it('says nothing of a device that holds no climate, and of none', () => {
    expect(stageOn({ ...device({}), configuration: null } as unknown as Device)).toBeNull();
    expect(stageOn(null)).toBeNull();
  });
});
