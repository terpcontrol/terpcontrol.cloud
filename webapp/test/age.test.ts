import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ageLabel, countdownLabel, isStale, spanLabel, valueAge } from '@/ui/age';

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

/**
 * A countdown is the mirror of an age, and is rounded the other way round.
 * Flooring an age is honest - four and a half days ago did happen four days ago
 * - while flooring what is left promises less of it than there is: a seven-day
 * step read "6 d left" in the minute it began, a whole day short of the length
 * printed on the line above it.
 */
describe('how much of a span is still to run', () => {
  it('rounds up where an age of the very same length rounds down', () => {
    expect(countdownLabel(7 * 86_400 - 25 * 60)).toBe('7 d');
    expect(spanLabel(7 * 86_400 - 25 * 60)).toBe('6 d');
  });

  it('carries the unit when the rounding fills it, rather than saying "60 min"', () => {
    expect(countdownLabel(59 * 60 + 30)).toBe('1 h');
    expect(countdownLabel(23 * 3600 + 59 * 60)).toBe('1 d');
  });

  it('says a whole number of its unit exactly', () => {
    expect(countdownLabel(7 * 86_400)).toBe('7 d');
    expect(countdownLabel(2 * 3600)).toBe('2 h');
    expect(countdownLabel(45)).toBe('45 s');
  });
});

/**
 * German had a day as "T" on the grow screens and as "d" in every age beside
 * them, and an hour as "h", "Std" and "Std.". An age is written with the
 * catalogue's own abbreviation, so both halves of a screen say one thing.
 */
describe('an age in German', () => {
  const now = DateTime.fromISO('2026-09-18T12:00:00Z');
  const ago = (seconds: number) => now.minus({ seconds }).toISO();

  it('writes each unit the way the German catalogue does', async () => {
    const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/de.json'), 'utf8'));
    await i18next.init({ lng: 'de', resources: { de: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });

    expect(ageLabel(ago(4 * 60), now)).toBe('4 Min');
    expect(ageLabel(ago(2 * 3600), now)).toBe('2 Std');
    expect(ageLabel(ago(5 * 86_400), now)).toBe('5 T');
    expect(countdownLabel(7 * 86_400)).toBe('7 T');
    expect(translation.grow.days_other).toBe('{{count}} T');
  });
});
