import { Component } from '@angular/core';
import { KoerperBasis } from './koerper-basis';

/**
 * A setpoint and where it came from. A target is a thing, so targets have a
 * history - and a hand target has no device behind it, which is what keeps the
 * line continuous across an upgrade.
 */
@Component({
  selector: 'app-ziel-koerper',
  template: `
    <app-fakt label="zelt.feld.zielwert" [wert]="wert"></app-fakt>
    <app-fakt label="zelt.feld.giltAb" [wert]="giltAb"></app-fakt>
    <app-fakt label="zelt.feld.herkunft" [wert]="herkunft"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class ZielKoerperComponent extends KoerperBasis {
  get wert(): string | null {
    const roh = this.ding?.d?.['wert'];
    return typeof roh === 'number' || typeof roh === 'string' ? String(roh) : null;
  }

  get giltAb(): string | null {
    return this.ding?.t ? new Date(this.ding.t).toLocaleString() : null;
  }

  get herkunft(): string | null {
    return this.schluesselwort('zelt.zielQuelle', 'quelle');
  }
}
