import { Component } from '@angular/core';
import { formatTimeAgo } from 'src/app/util/time-ago';
import { KoerperBasis } from './koerper-basis';

/** The tent's camera. */
@Component({
  selector: 'app-kamera-koerper',
  template: `
    <app-fakt label="zelt.feld.letztesBild" [wert]="letztesBild"></app-fakt>
    <app-fakt label="zelt.feld.gekoppeltSeit" [wert]="gekoppeltSeit"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class KameraKoerperComponent extends KoerperBasis {
  get letztesBild(): string | null {
    const t = this.zahl('letztes_bild_t');
    return t === null ? null : formatTimeAgo(t);
  }

  get gekoppeltSeit(): string | null {
    return this.ding?.t ? formatTimeAgo(this.ding.t) : null;
  }
}
