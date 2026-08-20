import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import localeEn from '@angular/common/locales/en';

const SUPPORTED_LOCALES: Record<string, string> = {
  de: 'de-DE',
  en: 'en-US',
};

registerLocaleData(localeDe, 'de-DE');
registerLocaleData(localeEn, 'en-US');

/**
 * The locale every date and number in the app is formatted with. It follows
 * the same browser language the translations do, so a German UI never renders
 * an American date.
 */
export function resolveAppLocale(): string {
  const language = (navigator.language || 'en').split('-')[0].toLowerCase();
  return SUPPORTED_LOCALES[language] ?? SUPPORTED_LOCALES['en'];
}
