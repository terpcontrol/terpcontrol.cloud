import { Component } from '@angular/core';
import { KoerperBasis } from './koerper-basis';

/** A plant. Nothing here comes off a sensor - a controller measures the tent, not the plant (§6). */
@Component({
  selector: 'app-pflanze-koerper',
  template: `
    <app-fakt label="zelt.feld.sorte" [wert]="sorte"></app-fakt>
    <app-fakt label="zelt.feld.medium" [wert]="medium"></app-fakt>
    <app-fakt label="zelt.feld.topf" [wert]="topf"></app-fakt>
    <app-fakt label="zelt.feld.quelle" [wert]="quelle"></app-fakt>
    <app-fakt label="zelt.feld.ernteGramm" [wert]="ernte"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class PflanzeKoerperComponent extends KoerperBasis {
  get sorte(): string | null {
    return this.wort('sorte');
  }

  get medium(): string | null {
    return this.schluesselwort('zelt.medium', 'medium');
  }

  get topf(): string | null {
    return this.messwert('topf_l', this.translate.instant('zelt.einheit.liter'), 1);
  }

  get quelle(): string | null {
    return this.schluesselwort('zelt.pflanzeQuelle', 'quelle');
  }

  get ernte(): string | null {
    return this.messwert('ernte_g', this.translate.instant('zelt.einheit.gramm'), 0);
  }
}
