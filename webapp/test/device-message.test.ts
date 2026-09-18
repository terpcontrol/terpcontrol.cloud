import i18next, { type i18n as I18n } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveDeviceMessage } from '@/i18n/device-message';

/**
 * The catalogue is the one the devices have always written into, so this reads
 * the real file rather than a fixture: a key that is renamed there has to fail
 * here.
 */
describe('device messages against the shipped catalogue', () => {
  let i18n: I18n;

  beforeAll(async () => {
    const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
    i18n = i18next.createInstance();
    await i18n.init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
  });

  it('reads a key with no parameter', () => {
    expect(resolveDeviceMessage(i18n, { key: 'message-co2-low', params: [] }, 'title')).toBe('Low CO2');
  });

  it('prefers the wording written for that exact parameter', () => {
    const text = resolveDeviceMessage(i18n, { key: 'message-device-booted', params: ['BROWNOUT'] }, 'text');
    expect(text).toContain('brownout');
  });

  it('falls back to the generic wording and interpolates the parameter', () => {
    const text = resolveDeviceMessage(i18n, { key: 'message-maintenance-mode-activated', params: ['30'] }, 'text');
    expect(text).toContain('30 minutes');
  });

  it('shows an unknown key as it came rather than as a blank', () => {
    expect(resolveDeviceMessage(i18n, { key: 'message-something-new', params: ['7'] }, 'title')).toBe('message-something-new:7');
  });
});
