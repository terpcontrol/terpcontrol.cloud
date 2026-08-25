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

    const uebersetzt = this.translate.instant(text.key, this.params(text.params));
    // `instant` hands the key back when the bundle has no entry. Printing that
    // at a reader is worse than printing what the device actually said.
    return uebersetzt === text.key ? text.ersatz ?? '' : uebersetzt;
  }

  private params(params: Record<string, TextParam> | undefined): Record<string, unknown> | undefined {
    if (!params) return undefined;

    return Object.fromEntries(
      Object.entries(params).map(([name, wert]) => [name, typeof wert === 'object' ? this.text(wert) : wert]),
    );
  }
}
