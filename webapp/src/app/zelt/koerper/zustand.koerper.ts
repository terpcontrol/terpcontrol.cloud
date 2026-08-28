import { Component } from '@angular/core';
import { KoerperBasis } from './koerper-basis';

/** The Zettel on the tent door: something a member left for whoever comes next. */
@Component({
  selector: 'app-zustand-koerper',
  template: `
    <p class="koerper-text" *ngIf="text">{{ text }}</p>
    <app-fakt label="zelt.feld.status" [wert]="status"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class ZustandKoerperComponent extends KoerperBasis {
  get text(): string | null {
    return this.wort('text');
  }

  get status(): string {
    const offen = this.ding?.t_ende === null && !this.wort('geschlossen_von');
    return this.translate.instant(offen ? 'zelt.zustand.offen' : 'zelt.zustand.erledigt');
  }
}
