import { Component, inject } from '@angular/core';
import { LogTranslateService } from 'src/app/services/log-translate.service';
import { KoerperBasis } from './koerper-basis';

/**
 * Something the device reported. It arrives as a `message-*` key, never as a
 * sentence - the translations live here, so the database never holds a language.
 */
@Component({
  selector: 'app-ereignis-koerper',
  template: `
    <p class="koerper-text" *ngIf="nachricht">{{ nachricht }}</p>
    <app-fakt label="zelt.feld.zeitpunkt" [wert]="zeitpunkt"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class EreignisKoerperComponent extends KoerperBasis {
  private readonly logs = inject(LogTranslateService);

  get nachricht(): string {
    return this.logs.getEntryMessage({
      message: this.wort('nachricht') ?? '',
      title: this.wort('titel') ?? '',
      raw: this.ding?.d?.['roh'] === true,
    });
  }

  get zeitpunkt(): string | null {
    return this.ding?.t ? new Date(this.ding.t).toLocaleString() : null;
  }
}
