import i18next from 'i18next';
import { DateTime } from 'luxon';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AlarmWatch } from '@fg2/shared-types/v1';
import { alarmLineParts, ruleTitle } from '@/i18n/alarm-line';
import type { Translate } from '@/i18n/i18n';
import { ruleTitle as onAlarme } from '@/screens/control/alarms/rules';
import { statusText } from '@/screens/start/place';
import { translate } from './translations';

/**
 * An alarm rule has one name in the reader's language wherever it is named.
 * The server stores a stage's rules and its own offline rule under English
 * names; Steuerung › Alarme, Meldungen, Start's sentence and a line of the
 * diary all read them through one function.
 */
beforeAll(() => translate(['de'], 'de'));

const t: Translate = (key, options) => i18next.t(key, options ?? {});
const above = (metric: 'temperature' | 'humidity' | 'co2', upper: number): AlarmWatch => ({ kind: 'reading', metric, upper, lower: null });

describe('what an alarm rule is called', () => {
  it('is one function, the one Steuerung › Alarme names its cards by', () => {
    expect(onAlarme).toBe(ruleTitle);
  });

  it('names a stage´s rule by what it watches, and by the name it is stored under where that is all there is', () => {
    expect(ruleTitle(t, { name: 'Server name', origin: 'preset', watch: above('temperature', 31) })).toBe('Zu warm');
    expect(ruleTitle(t, { name: 'Too hot' })).toBe('Zu warm');
    expect(ruleTitle(t, { name: 'Too cold' })).toBe('Zu kalt');
    expect(ruleTitle(t, { name: 'Too humid' })).toBe('Zu feucht');
    expect(ruleTitle(t, { name: 'CO₂ too high' })).toBe('CO₂ zu hoch');
    expect(ruleTitle(t, { name: 'Device offline' })).toBe('Gerät offline');
    expect(ruleTitle(t, { name: 'Anything', origin: 'always', watch: above('temperature', 0) })).toBe('Gerät offline');
  });

  it('keeps the name somebody gave a rule', () => {
    expect(ruleTitle(t, { name: 'Box soaking' })).toBe('Box soaking');
    expect(ruleTitle(t, { name: 'Zu warm im Zelt', origin: 'human', watch: above('temperature', 31) })).toBe('Zu warm im Zelt');
  });

  it('titles a rule made by one tap like a stage`s: it is stored under a name the catalogue knows, whoever made it', () => {
    // The same name a line of the diary is titled by, so the card, the alert and the line say one thing.
    expect(ruleTitle(t, { name: 'Too hot', origin: 'human', watch: above('temperature', 31) })).toBe('Zu warm');
    expect(ruleTitle(t, { name: 'Too dry', origin: 'human' })).toBe('Zu trocken');
    expect(ruleTitle(t, { name: 'Fridge runs without a break', origin: 'human' })).toBe('Kühlschrank läuft ununterbrochen');
  });

  it('is what a line of the diary and "Zuletzt" call it', () => {
    const line = alarmLineParts(i18next, 'Too hot (temperature), value=36, upper threshold=31, lower threshold=n/a', true);

    expect(line).toMatchObject({ rule: 'Zu warm', limit: 'Temperatur über 31 °C' });
    expect(alarmLineParts(i18next, 'Too humid (humidity), value=58, upper threshold=60, lower threshold=n/a', false)?.rule).toBe('Zu feucht');
  });

  it('is what Start´s sentence calls it', () => {
    const now = DateTime.fromISO('2026-11-12T16:50:00', { zone: 'Europe/Berlin' });
    const alert = {
      alertId: 'a',
      kind: 'threshold' as const,
      severity: 'critical' as const,
      startedAt: '2026-11-12T15:43:00.000Z',
      value: 36,
      metric: 'temperature' as const,
      name: 'Too hot',
    };

    expect(statusText(t, { kind: 'alert', alert, more: 0, critical: false }, now, 'Europe/Berlin')).toMatch(
      /^Zu warm · 36,0\s°C Temperatur · seit 16:43$/,
    );
  });
});
