import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import type {DeviceLog} from "@fg2/shared-types";

/**
 * Minimal subset of a device log entry that the translation helpers care
 * about. Kept structural (not a class) so callers can pass DeviceLog,
 * LogEntryViewerLog or any ad-hoc object that has these fields.
 */
export type TranslatableLogEntry = Pick<DeviceLog, 'title' | 'message' | 'raw'>;

/**
 * Centralised translation of device log titles and bodies. Resolves
 * messages of the form `<key>` or `<key>:<value>` against the i18n bundle,
 * with the following lookup order:
 *
 *   1. `<full message>-<suffix>`           (e.g. `message-foo:BAR-title`)
 *   2. `<message-before-colon>-<suffix>`   with `{ value: <part-after-colon> }`
 *   3. the original message string (as a last-resort fallback)
 *
 * Entries flagged as `raw` (free-form user text, e.g. diary entries) bypass
 * translation entirely.
 */
@Injectable({ providedIn: 'root' })
export class LogTranslateService {
  constructor(private translate: TranslateService) {}

  getEntryTitle(entry: TranslatableLogEntry | undefined | null): string {
    const title = entry?.title || '';
    if (!title) {
      return '';
    }
    if (entry?.raw) {
      return title;
    }
    return this.translateLogText(title, 'title');
  }

  getEntryMessage(entry: TranslatableLogEntry | undefined | null): string {
    const message = entry?.message || '';
    if (!message) {
      return '';
    }
    if (entry?.raw) {
      return message;
    }
    return this.translateLogText(message, 'text');
  }

  /**
   * Label for a log category. Categories are technical slugs the server also
   * uses for filtering, so unknown ones fall back to the slug itself rather
   * than leaking a translation key into the UI.
   */
  getCategoryLabel(category: string): string {
    const key = `diary.categories.${category}`;
    const translated = this.translate.instant(key);
    return translated === key ? category : translated;
  }

  private translateLogText(value: string, suffix: 'title' | 'text'): string {
    const directKey = `${value}-${suffix}`;
    const directTranslation = this.translate.instant(directKey);
    if (directTranslation !== directKey) {
      return directTranslation;
    }

    const separatorIndex = value.indexOf(':');
    const baseKey = separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
    const paramValue = separatorIndex >= 0 ? value.slice(separatorIndex + 1) : undefined;
    const fallbackKey = `${baseKey}-${suffix}`;
    const keyedTranslation = this.translate.instant(fallbackKey, { value: paramValue });
    if (keyedTranslation !== fallbackKey) {
      return keyedTranslation;
    }

    return this.translateLegacyText(value, suffix) ?? value;
  }

  /**
   * Entries written before the message keys existed hold their English text
   * verbatim, and they never disappear from a running grow diary. Recognising
   * the known wordings keeps those old events readable in every language.
   */
  private translateLegacyText(value: string, suffix: 'title' | 'text'): string | null {
    for (const legacy of LEGACY_LOG_TEXTS) {
      const match = legacy.pattern.exec(value.trim());
      if (!match) {
        continue;
      }
      const key = `${legacy.key}-${suffix}`;
      const parameter = match.slice(1).filter(Boolean).join(' - ');
      const translated = this.translate.instant(key, { value: parameter });
      if (translated !== key) {
        return translated;
      }
    }
    return null;
  }
}

const LEGACY_LOG_TEXTS: { pattern: RegExp; key: string }[] = [
  { pattern: /^Plant phase change$/i, key: 'message-diary-plant-lifecycle' },
  { pattern: /^Plant log entry$/i, key: 'message-diary-plant-log' },
  { pattern: /^Fridge log entry$/i, key: 'message-diary-fridge-log' },
  { pattern: /^User measurement$/i, key: 'message-diary-measurement' },
  { pattern: /^CO2 cylinder was refilled$/i, key: 'message-diary-co2-refill' },
  {
    pattern: /^Recipe step #?(.+?)\s+(?:is |was )?awaiting confirmation[:.]?\s*(.*)$/i,
    key: 'message-recipe-step-awaiting-confirmation',
  },
  {
    pattern: /^Recipe step #?(.+?)\s+(?:was |has been )?manually activated.*$/i,
    key: 'message-recipe-step-manually-activated',
  },
];

