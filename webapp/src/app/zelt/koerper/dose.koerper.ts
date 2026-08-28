import { Component } from '@angular/core';
import { KoerperBasis } from './koerper-basis';

/**
 * One smart socket. One Ding per socket and not per role: several may carry the
 * same role and switch together, and each is its own piece of hardware.
 */
@Component({
  selector: 'app-dose-koerper',
  template: `
    <app-fakt label="zelt.feld.rolle" [wert]="rolle"></app-fakt>
    <app-fakt label="zelt.feld.dose" [wert]="dose"></app-fakt>
    <app-fakt label="zelt.feld.ip" [wert]="ip"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class DoseKoerperComponent extends KoerperBasis {
  get rolle(): string | null {
    return this.schluesselwort('auxDevices.sockets.roles', 'rolle');
  }

  get dose(): string | null {
    const slot = this.zahl('slot');
    // A device that reports no table addresses its one output by role and says
    // so with -1; there is no socket number to print.
    return slot === null || slot < 0 ? null : String(slot + 1);
  }

  get ip(): string | null {
    return this.wort('ip');
  }
}
