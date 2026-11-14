import i18next, { type i18n as I18n } from 'i18next';
import { Settings } from 'luxon';
import { initReactI18next } from 'react-i18next';
import { readStored, writeStored } from '@/ui/stored';

/**
 * Both catalogues, loaded as they are. They are the ones the Angular app wrote
 * and the ones a device's log keys live in, so nothing is converted: i18next
 * interpolates `{{value}}` exactly as ngx-translate did.
 *
 * They are fetched rather than bundled - a hundred kilobytes of text that the
 * service worker precaches, so a reload offline still has words.
 */

export const LANGUAGES = ['en', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];

const FALLBACK_LANGUAGE: Language = 'en';

/** The translate function as the helpers outside a component take it: `t` from `useTranslation`, or i18next's own. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The language chosen in this browser, and the account's as this browser last read it - for the first frame of one that chose none. */
const STORAGE_KEY = 'terp.language';
const ACCOUNT_KEY = 'terp.language.account';

const known = (tag: string | null): Language | null => ((LANGUAGES as readonly unknown[]).includes(tag) ? (tag as Language) : null);

/**
 * Dates follow the language, not the browser: Luxon formats with the browser's
 * locale unless told otherwise, and a German grower on an English phone would
 * read German prose with English month names. Every `toFormat` and
 * `toLocaleString` picks the default up, so it is set in the two places the
 * language is decided and nowhere else.
 */
const followLanguage = (language: Language): void => {
  Settings.defaultLocale = language;
};

const catalogue = async (language: Language): Promise<Record<string, unknown>> => {
  const response = await fetch(`/assets/i18n/${language}.json`);
  if (!response.ok) throw new Error(`catalogue ${language}: ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
};

/** A choice made in this browser, else the account's, else what the browser itself speaks. */
const preferredLanguage = (): Language =>
  known(readStored(STORAGE_KEY)) ??
  known(readStored(ACCOUNT_KEY)) ??
  navigator.languages.map(tag => known(tag.split('-')[0])).find(tag => tag !== null) ??
  FALLBACK_LANGUAGE;

/** Fetches the catalogues the session does not hold yet: every language, or the one named. */
export const loadCatalogues = async (languages: readonly Language[] = LANGUAGES): Promise<void> => {
  const missing = languages.filter(language => !i18next.hasResourceBundle(language, 'translation'));
  await Promise.all(missing.map(async language => i18next.addResourceBundle(language, 'translation', await catalogue(language))));
};

export const setLanguage = async (language: Language, key = STORAGE_KEY): Promise<void> => {
  writeStored(key, language);
  // Fetched before the switch, so no screen renders a moment of missing keys.
  await loadCatalogues([language]);
  // Before the switch, so the render the switch triggers already formats its dates in the new language.
  followLanguage(language);
  await i18next.changeLanguage(language);
  document.documentElement.lang = language;
};

/** The account's language, taken by a browser nobody chose one in; whether it was, which leaves the caller nothing to tell the account. */
export const followAccount = (language: string): boolean => {
  const kept = known(language);
  if (!kept || known(readStored(STORAGE_KEY))) return false;
  void setLanguage(kept, ACCOUNT_KEY);
  return true;
};

export const initI18n = async (): Promise<typeof i18next> => {
  const language = preferredLanguage();
  followLanguage(language);
  const [active, fallback] = await Promise.all([catalogue(language), language === FALLBACK_LANGUAGE ? null : catalogue(FALLBACK_LANGUAGE)]);

  await i18next.use(initReactI18next).init({
    lng: language,
    fallbackLng: FALLBACK_LANGUAGE,
    resources: {
      [language]: { translation: active },
      ...(fallback ? { [FALLBACK_LANGUAGE]: { translation: fallback } } : {}),
    },
    // The catalogues' keys contain colons (`message-device-booted:POWERON-text`),
    // which i18next would otherwise read as a namespace separator.
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });

  document.documentElement.lang = language;
  return i18next;
};

/**
 * Whether a text the app stored is this key in any loaded language. A reason
 * written from here is written in the language of whoever wrote it, and stays
 * ours after somebody reads it in the other one.
 */
export const saidInAnyLanguage = (i18n: I18n, key: string, text: string | null | undefined, params: Record<string, unknown> = {}): boolean =>
  text != null && Object.keys(i18n.store?.data ?? {}).some(language => i18n.getFixedT(language)(key, params) === text);
