import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

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

export const FALLBACK_LANGUAGE: Language = 'en';

const STORAGE_KEY = 'terp.language';

const catalogue = async (language: Language): Promise<Record<string, unknown>> => {
  const response = await fetch(`/assets/i18n/${language}.json`);
  if (!response.ok) throw new Error(`catalogue ${language}: ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
};

export const preferredLanguage = (): Language => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (LANGUAGES as readonly string[]).includes(stored)) return stored as Language;
  } catch {
    // No stored preference is no problem; the browser's answer is next.
  }
  const fromBrowser = navigator.languages.map(tag => tag.split('-')[0]).find(tag => (LANGUAGES as readonly string[]).includes(tag));
  return (fromBrowser as Language) ?? FALLBACK_LANGUAGE;
};

export const setLanguage = async (language: Language): Promise<void> => {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // The choice then lasts as long as the tab, which is better than refusing it.
  }
  // Fetched before the switch, so no screen renders a moment of missing keys.
  if (!i18next.hasResourceBundle(language, 'translation')) {
    i18next.addResourceBundle(language, 'translation', await catalogue(language));
  }
  await i18next.changeLanguage(language);
  document.documentElement.lang = language;
};

export const initI18n = async (): Promise<typeof i18next> => {
  const language = preferredLanguage();
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
