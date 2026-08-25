import { formatNumber } from '@angular/common';
import { Directive, Input, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import type { Ding, Zelt } from '@fg2/shared-types';
import { resolveAppLocale } from 'src/app/util/locale';

/**
 * What every art-specific body is handed. The Tafel resolves the art to a
 * component and fills these in; nothing below ever asks whether the tent has a
 * device, because a body only ever exists for a Ding that exists.
 */
@Directive()
export abstract class KoerperBasis {
  @Input() ding!: Ding;
  @Input() zelt!: Zelt;
  /** The page's other Dinge, for the few bodies that need a neighbour to make sense. */
  @Input() dinge: readonly Ding[] = [];

  protected readonly translate = inject(TranslateService);

  /** A field of `d`, when it really is a number. */
  protected zahl(feld: string): number | null {
    const wert = this.ding?.d?.[feld];
    return typeof wert === 'number' && Number.isFinite(wert) ? wert : null;
  }

  /** A field of `d`, when it really is a non-empty string. */
  protected wort(feld: string): string | null {
    const wert = this.ding?.d?.[feld];
    return typeof wert === 'string' && wert !== '' ? wert : null;
  }

  /** A number in the reader's language, with its unit. `null` in, `null` out - never `NaN`, never `0`. */
  protected messwert(feld: string, einheit = '', nachkomma = 1): string | null {
    const wert = this.zahl(feld);
    if (wert === null) return null;
    const zahl = formatNumber(wert, resolveAppLocale(), `1.0-${nachkomma}`);
    return einheit ? `${zahl} ${einheit}` : zahl;
  }

  /**
   * A key whose value may not be in the bundle - a socket role the firmware
   * invented, a schema nobody has catalogued. Falls back to what the device
   * actually said rather than printing a translation key at the reader.
   */
  protected schluesselwort(praefix: string, feld: string): string | null {
    const roh = this.wort(feld);
    if (roh === null) return null;
    const uebersetzt = this.translate.instant(`${praefix}.${roh}`);
    return uebersetzt === `${praefix}.${roh}` ? roh : uebersetzt;
  }
}
