import { Component } from '@angular/core';
import type { Messwerte } from '@fg2/shared-types';
import { KeyedCache } from 'src/app/util/keyed-cache';
import { Messzeile, messzeilen } from 'src/app/util/messquellen';
import { KoerperBasis } from './koerper-basis';

/**
 * A note, and the hand instrument set that rides along with it. The readings
 * are shown through the same provenance rule the diff table uses, so a pH
 * written down here is a `(von Hand)` row wherever it turns up.
 */
@Component({
  selector: 'app-notiz-koerper',
  template: `
    <p class="koerper-text" *ngIf="text">{{ text }}</p>
    <div class="fakt" *ngFor="let zeile of messwerte; trackBy: trackZeile">
      <span class="fakt-label">
        {{ 'zelt.mass.' + zeile.mass | translate }}
        <span class="fakt-herkunft" *ngIf="zeile.herkunftZeigen">{{ 'zelt.werte.vonHand' | translate }}</span>
      </span>
      <span class="fakt-wert">{{ zeile.wert }}</span>
    </div>
  `,
  styleUrls: ['./koerper.scss'],
})
export class NotizKoerperComponent extends KoerperBasis {
  private readonly messwerteCache = new KeyedCache<Messzeile[]>();

  get text(): string | null {
    return this.wort('text');
  }

  get messwerte(): Messzeile[] {
    const roh = (this.ding?.d?.['messwerte'] as Messwerte | undefined) ?? {};
    return this.messwerteCache.get(`${this.ding?.ding_id}:${JSON.stringify(roh)}`, () =>
      messzeilen(
        Object.entries(roh)
          .filter(([, wert]) => typeof wert === 'number')
          .map(([mass, wert]) => ({ mass: mass, herkunft: { quelle: 'hand' as const }, wert: wert as number, t: this.ding.t })),
      ),
    );
  }

  trackZeile(_index: number, zeile: Messzeile): string {
    return zeile.id;
  }
}
