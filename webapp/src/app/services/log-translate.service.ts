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
 * The lookup always falls back to the original string when no matching key
 * exists, so free-form text (e.g. `raw` diary entries) renders unchanged
 * without needing to be special-cased here.
 */
@Injectable({ providedIn: 'root' })
export class LogTranslateService {
  constructor(private translate: TranslateService) {}

  getEntryTitle(entry: TranslatableLogEntry | undefined | null): string {
    const title = entry?.title || '';
    if (!title) {
      return '';
    }
    return this.translateLogText(title, 'title');
  }

  getEntryMessage(entry: TranslatableLogEntry | undefined | null): string {
    const message = entry?.message || '';
    if (!message) {
      return '';
    }
    return this.translateLogText(message, 'text');
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
    return keyedTranslation !== fallbackKey ? keyedTranslation : value;
  }
}

