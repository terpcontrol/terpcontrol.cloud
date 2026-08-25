import { Component } from '@angular/core';
import { tagNummer } from 'src/app/util/zelt-tag';
import { KoerperBasis } from './koerper-basis';

/** A stage of the grow, and how long it has been running. */
@Component({
  selector: 'app-phase-koerper',
  template: `
    <app-fakt label="zelt.feld.stufe" [wert]="stufe"></app-fakt>
    <app-fakt label="zelt.feld.begonnen" [wert]="begonnen"></app-fakt>
    <app-fakt label="zelt.feld.tagInPhase" [wert]="tagInPhase"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class PhaseKoerperComponent extends KoerperBasis {
  get stufe(): string | null {
    return this.schluesselwort('zelt.stufe', 'stufe');
  }

  get begonnen(): string | null {
    return this.ding?.t ? new Date(this.ding.t).toLocaleDateString() : null;
  }

  get tagInPhase(): string | null {
    if (!this.ding?.t || !this.zelt) return null;
    const bis = this.ding.t_ende ?? Date.now();
    return String(tagNummer(this.zelt.zeitzone, this.ding.t, bis));
  }
}
