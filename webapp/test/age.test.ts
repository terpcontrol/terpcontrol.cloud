import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { ageLabel } from '@/ui/age';

describe('the age beside a value', () => {
  const now = DateTime.fromISO('2026-09-18T12:00:00Z');
  const ago = (seconds: number) => now.minus({ seconds }).toISO();

  it('counts in the unit that fits', () => {
    expect(ageLabel(ago(20), now)).toBe('20 s');
    expect(ageLabel(ago(4 * 60), now)).toBe('4 min');
    expect(ageLabel(ago(2 * 3600), now)).toBe('2 h');
    expect(ageLabel(ago(3 * 86_400), now)).toBe('3 d');
  });

  it('says so when a metric was never reported', () => {
    expect(ageLabel(null, now)).toBe('—');
  });
});
