import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { ageLabel, isStale, valueAge } from '@/ui/age';

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

/**
 * The verdict a value arrives with was true when the answer was made. A screen
 * that cannot refresh goes on drawing that answer, so the word beside the figure
 * and the dimming behind it are re-read against the clock the reader is looking
 * at it under, and not left as the server last found them.
 */
describe('a value still on the screen after its answer has aged', () => {
  const now = DateTime.fromISO('2026-09-18T12:00:00Z');
  const ago = (seconds: number) => now.minus({ seconds }).toISO();

  it('turns stale and then offline while the answer still calls it live', () => {
    expect(valueAge({ state: 'live', measuredAt: ago(30) }, now)).toBe('live');
    expect(valueAge({ state: 'live', measuredAt: ago(3 * 60) }, now)).toBe('stale');
    expect(valueAge({ state: 'live', measuredAt: ago(12 * 60) }, now)).toBe('offline');
    expect(isStale({ state: 'live', measuredAt: ago(12 * 60) }, now)).toBe(true);
  });

  it('never freshens what the server called old, because the server knows what this side does not', () => {
    expect(valueAge({ state: 'offline', measuredAt: ago(1) }, now)).toBe('offline');
    expect(valueAge({ state: 'stale', measuredAt: ago(1) }, now)).toBe('stale');
  });

  it('is offline when nothing was ever measured, which is what an empty tile is dimmed by', () => {
    expect(valueAge({ state: 'live', measuredAt: null }, now)).toBe('offline');
  });
});
