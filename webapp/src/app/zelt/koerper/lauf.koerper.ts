import { Component } from '@angular/core';
import { tagNummer } from 'src/app/util/zelt-tag';
import { datumText } from 'src/app/util/datum';
import { KoerperBasis } from './koerper-basis';

/** One run in this tent - `Tag 1` to `Ernte`, and how it went. */
@Component({
  selector: 'app-lauf-koerper',
  template: `
    <app-fakt label="zelt.feld.laufNummer" [wert]="nummer"></app-fakt>
    <app-fakt label="zelt.feld.begonnen" [wert]="begonnen"></app-fakt>
    <app-fakt label="zelt.feld.laufTage" [wert]="tage"></app-fakt>
    <app-fakt label="zelt.feld.ernteGramm" [wert]="ernte"></app-fakt>
    <p class="koerper-text" *ngIf="notiz">{{ notiz }}</p>
  `,
  styleUrls: ['./koerper.scss'],
})
export class LaufKoerperComponent extends KoerperBasis {
  get nummer(): string | null {
    const nummer = this.zahl('nummer');
    return nummer === null ? null : String(nummer);
  }

  get begonnen(): string | null {
    return this.ding?.t ? datumText(this.ding.t) : null;
  }

  get tage(): string | null {
    if (!this.ding?.t || !this.zelt) return null;
    return String(tagNummer(this.zelt.zeitzone, this.ding.t, this.ding.t_ende ?? Date.now()));
  }

  get ernte(): string | null {
    return this.messwert('ernte_g', this.translate.instant('zelt.einheit.gramm'), 0);
  }

  get notiz(): string | null {
    return this.wort('ertrag_notiz');
  }
}
