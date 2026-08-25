import { Component } from '@angular/core';
import { KoerperBasis } from './koerper-basis';

/** A person who writes into this tent. */
@Component({
  selector: 'app-mensch-koerper',
  template: `
    <app-fakt label="zelt.feld.dabeiSeit" [wert]="dabeiSeit"></app-fakt>
    <app-fakt label="zelt.feld.schluessel" [wert]="schluessel"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class MenschKoerperComponent extends KoerperBasis {
  get dabeiSeit(): string | null {
    return this.ding?.t ? new Date(this.ding.t).toLocaleDateString() : null;
  }

  get schluessel(): string | null {
    const aktiv = this.ding?.d?.['schluessel_aktiv'];
    return typeof aktiv === 'boolean' ? this.translate.instant(aktiv ? 'zelt.schluessel.aktiv' : 'zelt.schluessel.inaktiv') : null;
  }
}
