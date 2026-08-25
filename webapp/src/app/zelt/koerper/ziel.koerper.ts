import { Component } from '@angular/core';
import { datumZeitText } from 'src/app/util/datum';
import { zahlText } from 'src/app/util/zahl';
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
    <app-fakt label="zelt.feld.gesetzt" [wert]="gesetzt"></app-fakt>
    <app-fakt label="zelt.feld.herkunft" [wert]="herkunft"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class ZielKoerperComponent extends KoerperBasis {
  get wert(): string | null {
    const roh = this.ding?.d?.['wert'];
    if (typeof roh === 'number') return zahlText(roh, 2);
    return typeof roh === 'string' ? roh : null;
  }

  get gesetzt(): string | null {
    return this.ding?.t ? datumZeitText(this.ding.t) : null;
  }

  get herkunft(): string | null {
    return this.schluesselwort('zelt.zielQuelle', 'quelle');
  }
}
