import { Injectable } from '@angular/core';
import { MissingTranslationHandler, MissingTranslationHandlerParams } from '@ngx-translate/core';
import { environment } from 'src/environments/environment';

/**
 * What is printed when a key is not in the bundle.
 *
 * Two kinds of lookup in this product build their key by concatenation - a
 * measure a device invented, a socket role the firmware named, a setpoint key
 * nobody has catalogued - and without a handler ngx-translate hands the key
 * back, so `zelt.mass.lights.limit` lands on the screen as a dotted path.
 *
 * A caller that knows what the thing was actually called passes it as
 * `ersatz`; that is always better than anything this can invent. Everything
 * else falls back to the last segment of the key, which is a word rather than
 * a path.
 */
@Injectable()
export class TerpMissingTranslationHandler implements MissingTranslationHandler {
  handle(params: MissingTranslationHandlerParams): string {
    const ersatz = (params.interpolateParams as Record<string, unknown> | undefined)?.['ersatz'];
    if (typeof ersatz === 'string' && ersatz !== '') return ersatz;

    if (!environment.production) {
      console.warn(`[i18n] missing key: ${params.key}`);
    }

    return lesbar(params.key);
  }
}

/** `zelt.mass.lights.limit` -> `Limit`. Never a dotted path, never an empty row. */
const lesbar = (schluessel: string): string => {
  const letztes = schluessel.split('.').pop() ?? schluessel;
  const wort = letztes.replace(/[_-]+/g, ' ').trim();
  return wort ? wort.charAt(0).toUpperCase() + wort.slice(1) : schluessel;
};
