import { Component, Input } from '@angular/core';
import type { Messwerte } from '@fg2/shared-types';
import { einheitVon } from 'src/app/util/einheiten';
import { MESSWERT_FELDER, SUBSTRAT_WERTE, Substrat } from './entwurf';

/**
 * §4.2's hand instrument set: a pH pen, a tape measure, a pot on a kitchen
 * scale. One row per instrument, always here, never required - and nothing in
 * it has anything to do with hardware.
 *
 * The values are written straight into the object the sheet holds, so a sheet
 * that decides to send none of them simply finds them all empty.
 */
@Component({
  selector: 'tc-messwerte-feld',
  template: `
    <div class="blatt-messwerte">
      <label class="blatt-messwert" *ngFor="let feld of felder">
        <span class="blatt-messwert-name">{{ 'zelt.mass.' + feld | translate }}</span>
        <input class="blatt-eingabe" type="text" inputmode="decimal" autocomplete="off" [name]="feld" [(ngModel)]="werte[feld]" />
        <span class="blatt-einheit">{{ einheit(feld) }}</span>
      </label>
    </div>
    <div class="blatt-wahl" *ngIf="substratZeigen">
      <span class="blatt-wahl-name">{{ 'zelt.feld.substrat' | translate }}</span>
      <button
        type="button"
        class="blatt-chip"
        *ngFor="let wert of substrate"
        [class.blatt-chip--an]="werte.substrat === wert"
        [attr.aria-pressed]="werte.substrat === wert"
        (click)="substratWaehlen(wert)"
      >
        {{ 'zelt.substrat.' + wert | translate }}
      </button>
    </div>
  `,
  styleUrls: ['./blatt.scss'],
})
export class MesswerteFeldComponent {
  /** The sheet's own object; every field starts empty and stays optional forever. */
  @Input() werte: Partial<Record<keyof Messwerte, unknown>> = {};
  @Input() substratZeigen = false;

  public readonly felder = MESSWERT_FELDER;
  public readonly substrate = SUBSTRAT_WERTE;

  einheit(feld: keyof Messwerte): string {
    return einheitVon(String(feld));
  }

  substratWaehlen(wert: Substrat): void {
    this.werte.substrat = this.werte.substrat === wert ? undefined : wert;
  }
}
