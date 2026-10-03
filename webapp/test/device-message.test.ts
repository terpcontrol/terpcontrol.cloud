import i18next, { type i18n as I18n } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { entryDetail, entryHeadline, resolveDeviceMessage } from '@/i18n/device-message';

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

  it('says a change of settings in the words of the controls, and keeps a figure it does not know as it came', () => {
    const message = {
      key: 'message-device-configuration-updated',
      params: ['day.temperature: 25 → 26.5\nlights.maintenanceOn: false → 1\nworkmode: small → full\nfans.mystery: 3 → 4'],
    };

    expect(resolveDeviceMessage(i18n, message, 'title')).toBe('Settings changed');
    expect(resolveDeviceMessage(i18n, message, 'text')).toContain(
      'Day temperature: 25 °C → 26.5 °C\nLight on during maintenance: off → on\nOperation: standard → standard with energy saving\nfans.mystery: 3 → 4',
    );
  });

  /**
   * 24 hours is written as a day that never ends and 0 hours as a light going
   * off the second it comes on: their two times apart read "Light off at
   * 09:00" for a lamp that never goes off, and the same words for one that
   * never comes on.
   */
  it('says a change of the light plan as one line, 24 and 0 hours included, on the account´s clock of the day it was written', () => {
    const text = (params: string[], context = {}) =>
      resolveDeviceMessage(i18n, { key: 'message-device-configuration-updated', params }, 'text', context);
    const berlin = { zone: 'Europe/Berlin', at: '2026-10-03T09:48:22.000Z' };

    expect(text(['daynight.day: 25200 → 198001\ndaynight.night: 68400 → 198000'], berlin)).toContain(
      'Light plan: Light on 09:00–21:00 · 12 h → Light on round the clock · 24 h',
    );
    expect(text(['daynight.day: 25200 → 25200\ndaynight.night: 68400 → 25200'], berlin)).toContain(
      'Light plan: Light on 09:00–21:00 · 12 h → Light off round the clock · 0 h',
    );
    // In winter the same seconds were an hour earlier on the wall.
    expect(text(['daynight.day: 25200 → 28800\ndaynight.night: 68400 → 72000'], { zone: 'Europe/Berlin', at: '2026-01-10T12:00:00.000Z' })).toContain(
      'Light plan: Light on 08:00–20:00 · 12 h → Light on 09:00–21:00 · 12 h',
    );
    // An older line with one of the two times says the other as it can.
    expect(text(['daynight.night: 68400 → 198000'], berlin)).toContain('Light off at: 21:00 → on round the clock');
  });

  it('names what a drying room or a germination holds by the mode, where the server wrote the mode beside the line', () => {
    const text = (params: string[]) => resolveDeviceMessage(i18n, { key: 'message-device-configuration-updated', params }, 'text');

    expect(text(['night.humidity: 58 → 60\nnight.temperature: 18 → 19', 'dry'])).toContain(
      'Drying humidity: 58 % → 60 %\nDrying temperature: 18 °C → 19 °C',
    );
    expect(text(['night.temperature: 20 → 24', 'breed'])).toContain('Germination temperature: 20 °C → 24 °C');
    // The humidity a humidifier holds in germination, where the grower lets it.
    expect(text(['night.humidity: 55 → 75', 'breed'])).toContain('Germination humidity: 55 % → 75 %');
    expect(text(['night.temperature: 20 → 24'])).toContain('Night temperature: 20 °C → 24 °C');
  });

  it('says what was chosen about the humidity in germination, which leaves no figure of its own', () => {
    const text = (params: string[]) => resolveDeviceMessage(i18n, { key: 'message-device-configuration-updated', params }, 'text');

    expect(text(['germination.warnTooHumid: false → true\ngermination.humidifierHolds: true → false', 'breed'])).toContain(
      'Germination · warn when it gets too humid: off → on\nGermination · hold the humidity with the humidifier: on → off',
    );
    expect(resolveDeviceMessage(i18n, { key: 'message-device-configuration-updated', params: ['workmode: small → dry', 'dry'] }, 'title')).toBe(
      'Drying started',
    );
  });

  it('names a change of the work mode alone in its title', () => {
    const titled = (line: string) => resolveDeviceMessage(i18n, { key: 'message-device-configuration-updated', params: [line] }, 'title');

    expect(titled('workmode: small → off')).toBe('Control switched off');
    expect(titled('workmode: off → full')).toBe('Control switched on');
    expect(titled('workmode: full → dry')).toBe('Drying started');
    expect(titled('workmode: small → full')).toBe('Energy saving on');
    expect(titled('workmode: small → breed')).toBe('Operating mode: germination');
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

  it('names the builds of an update with the arrow, and an unknown one in words', () => {
    const message = { key: 'message-firmware-update-complete-with-ids', params: ['unknown -> 0.0.0'] };

    expect(resolveDeviceMessage(i18n, message, 'text')).toBe("Your device's firmware update was completed: an unknown build → 0.0.0");
  });

  it('says a whole picture is missing without reciting the telemetry in the headline', () => {
    const message = { key: 'message-cam-capture', params: ['incomplete res=2 bytes=14328 got=22/22 soi=2 eoi=-1'] };

    expect(resolveDeviceMessage(i18n, message, 'title')).toBe('Camera picture incomplete');
    expect(resolveDeviceMessage(i18n, message, 'text')).toContain('res=2');
  });

  /**
   * Four of the keys a device writes carry the whole of what to do about them in
   * the text and take no parameter, so a rule that suppressed the body of every
   * parameterless message silenced the advice on 70,314 of one account's lines.
   * "Connection problem" on its own is a row a grower can do nothing with.
   */
  it('keeps the sentence that says what to do about a message that takes no parameter', () => {
    const line = { source: 'device' as const, text: null, message: { key: 'message-buffer-overflow', params: [] } };

    expect(entryHeadline(i18n, line)).toBe('Connection problem');
    expect(entryDetail(i18n, line)).toContain('check your internet connection or wifi');
  });

  /** A mark left by a line written elsewhere says what it is in its title; its text is that again. */
  it('says nothing under a mark whose text is its own title at greater length', () => {
    const plants = { source: 'device' as const, text: null, message: { key: 'message-diary-plant-log', params: [] } };
    const sensor = { source: 'device' as const, text: null, message: { key: 'message-ext-sensor-fail', params: [] } };

    expect(entryHeadline(i18n, plants)).toBe('Plant log entry');
    expect(entryDetail(i18n, plants)).toBeNull();
    // Its two halves differ by a word, so only being named keeps it quiet.
    expect(entryDetail(i18n, sensor)).toBeNull();
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

/**
 * The lines that came over with no key at all. The old app let a device line
 * carry a free-form title, and the migration kept it by joining it to the body
 * with a blank line - so the whole of both lands in the headline, and 38,228 of
 * the 68,023 unkeyed machine lines in the restored production database say
 * their own title twice, 138 of one fridge's 253 alarm rows among them.
 *
 * Nothing here is translated, so the catalogue is not needed and is not given.
 */
describe('a machine´s line that carries its own title', () => {
  const machine = (text: string) => ({ source: 'device' as const, text, message: null });
  const untranslated = null as unknown as I18n;

  it('draws the title once and what it said under it', () => {
    const line = machine('Alarm fridge running long resolved\n\nAlarm fridge running long resolved: Sensor dehumidifier, value: 1');

    expect(entryHeadline(untranslated, line)).toBe('Alarm fridge running long resolved');
    expect(entryDetail(untranslated, line)).toBe('Sensor dehumidifier, value: 1');
  });

  it('keeps a body that only begins like its title, rather than cutting a sentence in half', () => {
    const line = machine('Alarm\n\nAlarm was raised at 04:12 and stood for an hour');

    expect(entryHeadline(untranslated, line)).toBe('Alarm');
    expect(entryDetail(untranslated, line)).toBe('Alarm was raised at 04:12 and stood for an hour');
  });

  it('cuts at the first blank line only, so a body of several paragraphs stays whole', () => {
    const line = machine('Webcam error\n\nffmpeg failed\n\nRetried three times');

    expect(entryHeadline(untranslated, line)).toBe('Webcam error');
    expect(entryDetail(untranslated, line)).toBe('ffmpeg failed\n\nRetried three times');
  });

  it('leaves a line of one paragraph as the whole headline, with nothing under it', () => {
    const line = machine('Device configuration has been updated');

    expect(entryHeadline(untranslated, line)).toBe('Device configuration has been updated');
    expect(entryDetail(untranslated, line)).toBeNull();
  });

  it('never cuts up what a person typed', () => {
    const typed = { source: 'human' as const, text: 'Umgetopft\n\nUmgetopft: beide in 11 l', message: null };

    expect(entryHeadline(untranslated, typed)).toBe('Umgetopft\n\nUmgetopft: beide in 11 l');
    expect(entryDetail(untranslated, typed)).toBeNull();
  });
});
