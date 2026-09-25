import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { alarmLineText } from '@/i18n/alarm-line';

/**
 * An alarm's diary line is stored as the server's English prose; the reader
 * gets it in their own words, with the reading rounded and written in their
 * decimals - the way the alert card writes the same instant.
 */
beforeAll(async () => {
  const [en, de] = await Promise.all(
    ['en', 'de'].map(async language => JSON.parse(await readFile(resolve(process.cwd(), `public/assets/i18n/${language}.json`), 'utf8'))),
  );
  await i18next.init({
    lng: 'de',
    resources: { en: { translation: en }, de: { translation: de } },
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  await i18next.changeLanguage('de');
});

describe('an alarm line', () => {
  it('writes a threshold alarm in German decimals, with the edge it crossed', () => {
    expect(alarmLineText(i18next, 'P9 warm fan (temperature), value=21.841, upper threshold=21, lower threshold=n/a', true)).toBe(
      'P9 warm fan · Temperatur 21,8 °C › 21 °C',
    );
  });

  it('says what an episode ended on and the worst of it', () => {
    expect(alarmLineText(i18next, 'My Alarm (humidity), value=64.98688, upper threshold=65, lower threshold=50, extreme value=66.3621', false)).toBe(
      'My Alarm · Luftfeuchte 65 % · Extremwert 66 %',
    );
  });

  it('says an output rule as the output going on and off', () => {
    expect(alarmLineText(i18next, 'My Alarm (dehumidifier), value=1', true)).toBe('My Alarm · Entfeuchter an');
    expect(alarmLineText(i18next, 'My Alarm (dehumidifier), value=0', false)).toBe('My Alarm · Entfeuchter aus');
  });

  it('says a silence as how long it had lasted when the alarm was raised, not as an age that stops counting', async () => {
    expect(alarmLineText(i18next, 'Device offline, last heard 5 d 6 h ago', true)).toBe('Gerät offline · 5 T 6 Std ohne Meldung');
    expect(alarmLineText(i18next, 'Device offline, back after 3 h 20 min', false)).toBe('Gerät offline · wieder da nach 3 Std 20 Min');

    await i18next.changeLanguage('en');
    expect(alarmLineText(i18next, 'Device offline, last heard 5 d 6 h ago', true)).toBe('Device offline · silent for 5 d 6 h');
  });

  it('leaves a line of another shape to be shown as it came', () => {
    expect(alarmLineText(i18next, 'Lens', true)).toBeNull();
  });
});
