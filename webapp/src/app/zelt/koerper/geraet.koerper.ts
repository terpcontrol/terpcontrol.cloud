import { Component } from '@angular/core';
import { formatTimeAgo } from 'src/app/util/time-ago';
import { KoerperBasis } from './koerper-basis';

/** A device bound to the tent. This body exists only when a device does - §6: absent, not disabled. */
@Component({
  selector: 'app-geraet-koerper',
  template: `
    <app-fakt label="zelt.feld.geraetetyp" [wert]="typ"></app-fakt>
    <app-fakt label="zelt.feld.firmware" [wert]="firmware"></app-fakt>
    <app-fakt label="zelt.feld.zuletztGesehen" [wert]="zuletztGesehen"></app-fakt>
    <app-fakt label="zelt.feld.gebundenSeit" [wert]="gebundenSeit"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class GeraetKoerperComponent extends KoerperBasis {
  get typ(): string | null {
    return this.schluesselwort('zelt.geraetetyp', 'typ');
  }

  get firmware(): string | null {
    return this.wort('firmware');
  }

  get zuletztGesehen(): string | null {
    const t = this.zahl('zuletzt_gesehen');
    return t === null ? null : formatTimeAgo(t);
  }

  get gebundenSeit(): string | null {
    return this.ding?.t ? formatTimeAgo(this.ding.t) : null;
  }
}
