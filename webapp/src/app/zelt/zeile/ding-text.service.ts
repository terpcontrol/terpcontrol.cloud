import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { LogTranslateService } from 'src/app/services/log-translate.service';
import type { Text, TextParam } from 'src/app/util/ding-text';

/**
 * Turns the language-free descriptors of `ding-text.ts` into words. It is split
 * out so the art-to-text mapping stays a pure function that can be read and
 * tested without a TestBed, and so the three ways a string can reach the app -
 * ours, a device's `message-*` key, and something a human typed - are resolved
 * in exactly one place.
 */
@Injectable({
  providedIn: 'root',
})
export class DingTextService {
  constructor(private translate: TranslateService, private logs: LogTranslateService) {}

  public text(text: Text | null): string {
    if (!text) return '';
    if (text.roh !== undefined) return text.roh;
    if (text.logSchluessel !== undefined) return this.logs.getEntryTitle({ title: text.logSchluessel });
    if (!text.key) return text.ersatz ?? '';

    // `ersatz` rides along as an interpolation parameter: it is what the device
    // actually said, and `TerpMissingTranslationHandler` prints it instead of
    // the key when the bundle has no entry. The equality check this used to do
    // cannot tell a missing key from a bundle that legitimately says the key.
    const params = { ...this.params(text.params), ...(text.ersatz ? { ersatz: text.ersatz } : {}) };
    const uebersetzt = this.translate.instant(text.key, params);
    // With no handler configured - a test bed, a bundle that failed to load -
    // `instant` still hands the key back, and printing that at a reader is
    // worse than printing what the device actually said.
    return uebersetzt === text.key ? text.ersatz ?? '' : uebersetzt;
  }

  private params(params: Record<string, TextParam> | undefined): Record<string, unknown> | undefined {
    if (!params) return undefined;

    return Object.fromEntries(
      Object.entries(params).map(([name, wert]) => [name, typeof wert === 'object' ? this.text(wert) : wert]),
    );
  }
}
