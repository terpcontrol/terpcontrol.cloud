import { Component } from '@angular/core';
import { KoerperBasis } from './koerper-basis';

/** A timelapse. */
@Component({
  selector: 'app-film-koerper',
  template: `
    <app-fakt label="zelt.feld.zeitraum" [wert]="zeitraum"></app-fakt>
    <app-fakt label="zelt.feld.aufgenommen" [wert]="aufgenommen"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class FilmKoerperComponent extends KoerperBasis {
  get zeitraum(): string | null {
    return this.schluesselwort('zelt.filmDauer', 'dauer');
  }

  get aufgenommen(): string | null {
    return this.ding?.t ? new Date(this.ding.t).toLocaleString() : null;
  }
}
