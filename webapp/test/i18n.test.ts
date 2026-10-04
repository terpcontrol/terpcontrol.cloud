import i18next from 'i18next';
import { DateTime, Settings } from 'luxon';
import { initReactI18next } from 'react-i18next';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '@/i18n/i18n';

/**
 * The dates follow the language the app is in, not the one the browser
 * speaks. A German grower on an English phone chose German on the Appearance
 * page and is owed German month names on every screen; Luxon would otherwise
 * format with the browser's locale, and the catalogue alone cannot fix that.
 */

const wasDefault = Settings.defaultLocale;

beforeAll(async () => {
  // Both bundles are already here, so the switch fetches nothing.
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: {} }, de: { translation: {} } },
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });
});

afterAll(() => {
  Settings.defaultLocale = wasDefault;
});

describe('the dates follow the language', () => {
  it('formats a date in German once the app is switched to German, and in English once it is switched back', async () => {
    const day = '2026-10-22';

    // Whether the abbreviation carries a full stop is the ICU build's decision,
    // and Node's differs from the browser's; that the month is German is not.
    await setLanguage('de');
    expect(DateTime.fromISO(day).toFormat('d LLL yyyy')).toMatch(/^22 Okt\.? 2026$/);
    expect(DateTime.fromISO(day).toLocaleString(DateTime.DATE_MED)).toMatch(/^22\. Okt\.? 2026$/);
    expect(document.documentElement.lang).toBe('de');

    await setLanguage('en');
    expect(DateTime.fromISO(day).toFormat('d LLL yyyy')).toBe('22 Oct 2026');
    expect(document.documentElement.lang).toBe('en');
  });
});
