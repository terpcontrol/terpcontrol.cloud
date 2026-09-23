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

  /**
   * A key 506 restored entries carry, 77 of them on one grower's fridge. The
   * firmware of today closes an update with the `-with-ids` key beside it, so
   * the bare one is migrated wording and nothing was going to rewrite it.
   */
  it('spells a finished firmware update the way its own sibling key spells it', () => {
    const message = { key: 'message-firmware-update-complete', params: [] };

    expect(resolveDeviceMessage(i18n, message, 'title')).toBe(
      resolveDeviceMessage(i18n, { key: 'message-firmware-update-complete-with-ids', params: [] }, 'title'),
    );
    expect(resolveDeviceMessage(i18n, message, 'title')).toBe('Firmware update complete');
    expect(resolveDeviceMessage(i18n, message, 'text')).toBe("Your device's firmware update was completed");
  });

  it('says a whole picture is missing without reciting the telemetry in the headline', () => {
    const message = { key: 'message-cam-capture', params: ['incomplete res=2 bytes=14328 got=22/22 soi=2 eoi=-1'] };

    expect(resolveDeviceMessage(i18n, message, 'title')).toBe('Camera picture incomplete');
    expect(resolveDeviceMessage(i18n, message, 'text')).toContain('res=2');
  });
});

/**
 * Showing a key as it came is the net under a firmware newer than the app, not
 * a resting state: the fallback fired on the home card and fourteen times on a
 * tent page of the restored production data, because three keys the shipped
 * firmware sends had never been written down.
 *
 * The server's table is the list of what firmware sends, so it is read here
 * rather than copied - a key added to it without words in both catalogues fails
 * the build instead of reaching somebody's home screen as a slug. It is read as
 * text because a test of the webapp cannot import from the server's build.
 */
describe('every key the firmware sends', () => {
  const both = ['en', 'de'] as const;

  it('has a title and a body in every language the app ships', async () => {
    const table = await readFile(resolve(process.cwd(), '../server/src/common/v1/device-messages.ts'), 'utf8');
    const keys = [...table.matchAll(/'(message-[a-z0-9-]+)': OF_THE_/g)].map(found => found[1]);
    expect(keys.length).toBeGreaterThan(10);

    for (const language of both) {
      const catalogue = JSON.parse(await readFile(resolve(process.cwd(), `public/assets/i18n/${language}.json`), 'utf8')) as Record<string, unknown>;
      const missing = keys.flatMap(key =>
        ['title', 'text'].filter(part => typeof catalogue[`${key}-${part}`] !== 'string').map(part => `${key}-${part}`),
      );

      expect({ language, missing }).toEqual({ language, missing: [] });
    }
  });
});

/**
 * A headline is a label, and the strips it is read in set the labels of a tent
 * beside one another: "Verbindungsproblem. · vor 3 d · Gerät" reads as a
 * sentence gone wrong next to "Gerät hat neu gestartet" and "Alarm ausgelöst".
 * Which titles end in a stop is a decision the English catalogue already made,
 * one key at a time, and the German is a translation of those labels rather than
 * a second set of them - so the one that disagreed disagreed by accident.
 */
describe('the punctuation of a title, across the two catalogues', () => {
  const terminal = (wording: string): string => (/[.!?]$/.test(wording) ? wording.slice(-1) : '');

  it('ends a German title wherever its English twin ends, and nowhere else', async () => {
    const read = async (language: string) =>
      JSON.parse(await readFile(resolve(process.cwd(), `public/assets/i18n/${language}.json`), 'utf8')) as Record<string, unknown>;
    const [english, german] = await Promise.all([read('en'), read('de')]);

    const titles = Object.keys(english).filter(key => key.startsWith('message-') && key.endsWith('-title'));
    expect(titles.length).toBeGreaterThan(20);

    const differing = titles.filter(key => typeof german[key] === 'string' && terminal(german[key] as string) !== terminal(english[key] as string));
    expect(differing).toEqual([]);
  });
});
