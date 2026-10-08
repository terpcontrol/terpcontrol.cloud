import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';

/** A shipped catalogue, read from where the app fetches it. */
export const catalogue = async (language: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(resolve(process.cwd(), `public/assets/i18n/${language}.json`), 'utf8')) as Record<string, unknown>;

/** i18next with the shipped catalogues of `languages`, speaking `lng`. */
export const translate = async (languages: string[] = ['en'], lng = 'en'): Promise<void> => {
  const resources = Object.fromEntries(await Promise.all(languages.map(async language => [language, { translation: await catalogue(language) }])));
  await i18next.use(initReactI18next).init({ lng, resources, nsSeparator: false, interpolation: { escapeValue: false } });
};
