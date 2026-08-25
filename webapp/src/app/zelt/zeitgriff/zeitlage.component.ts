import { DatePipe } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';
import type { Ding, Zelt } from '@fg2/shared-types';
import { dingName, dingWert } from 'src/app/util/ding-text';
import { resolveAppLocale } from 'src/app/util/locale';
import { Messung } from 'src/app/util/messquellen';
import { Zeitlage, zeitlage } from 'src/app/util/vergleich';
import { DingTextService } from '../zeile/ding-text.service';

/**
 * Where the cursor is standing, in words. It has exactly two states and they
 * are the inverse of a mode (M3): **motion collapses, rest unfolds.**
 *
 * While a thumb is on the handle it is a two-line scrub header at a reserved
 * height, so the rows under the thumb cannot reflow while it moves. On release
 * it unfolds into the three lines that only mean something once you have
 * deliberately stopped - `Damals galt:`, `Lief:` and `Dinge ±2 Std:`.
 *
 * `Damals galt:` is the last-known-value carry-forward printed as prose, and it
 * is why a tent that has never seen a device can still say what was true on a
 * Tuesday in July: somebody said so once, in June. `Lief:` is the one line that
 * needs hardware, and with none it is **absent** rather than replaced by a
 * lookalike.
 */
@Component({
  selector: 'tc-zeitlage',
  templateUrl: './zeitlage.component.html',
  styleUrls: ['./zeitlage.component.scss'],
})
export class ZeitlageComponent implements OnChanges {
  @Input() zelt!: Zelt;
  @Input() dinge: readonly Ding[] = [];
  @Input() messungen: readonly Messung[] = [];
  @Input() moment = 0;
  /** True while the handle is moving. Everything else about this component follows from it. */
  @Input() zieht = false;

  public lage: Zeitlage | null = null;
  public werte: string[] = [];
  public zaehlung: string[] = [];
  public damals: string[] = [];
  public lief: string[] = [];
  public nahe: string[] = [];

  private readonly datum = new DatePipe(resolveAppLocale());

  constructor(private texte: DingTextService) {}

  ngOnChanges(): void {
    if (!this.zelt || !this.moment) {
      this.lage = null;
      return;
    }

    const lage = zeitlage({ zelt: this.zelt, dinge: this.dinge, messungen: this.messungen, moment: this.moment });
    this.lage = lage;
    // `{{mass}} {{wert}} {{einheit}}` leaves a space behind a unitless measure.
    this.werte = lage.werte.map(text => this.texte.text(text).trim());
    this.zaehlung = lage.zaehlung.map(text => this.texte.text(text));
    this.damals = lage.damals.map(text => this.texte.text(text));
    this.lief = lage.lief.map(text => this.texte.text(text));
    this.nahe = lage.nahe.map(ding => this.dingSatz(ding));
  }

  get zeit(): string {
    return this.datum.transform(this.moment, 'EEE dd.MM. HH:mm') ?? '';
  }

  /** `Gabe 2,0 l (19:40)` - the same words the row would use, on one line. */
  private dingSatz(ding: Ding): string {
    const name = this.texte.text(dingName(ding));
    const wert = this.texte.text(dingWert(ding));
    const uhr = this.datum.transform(ding.t, 'HH:mm') ?? '';
    return [name, wert].filter(Boolean).join(' ') + (uhr ? ` (${uhr})` : '');
  }
}
