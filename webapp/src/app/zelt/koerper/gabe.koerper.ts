import { Component } from '@angular/core';
import type { GabeProdukt } from '@fg2/shared-types';
import { KeyedCache } from 'src/app/util/keyed-cache';
import { zahlText } from 'src/app/util/zahl';
import { KoerperBasis } from './koerper-basis';

/**
 * A watering or a feed - the spine of the free product, and a cloud write that
 * never needed a device.
 */
@Component({
  selector: 'app-gabe-koerper',
  template: `
    <app-fakt label="zelt.feld.wasser" [wert]="wasser"></app-fakt>
    <app-fakt label="zelt.feld.kannen" [wert]="kannen"></app-fakt>
    <app-fakt label="zelt.feld.verteilung" [wert]="verteilung"></app-fakt>
    <app-fakt label="zelt.feld.ec" [wert]="ec"></app-fakt>
    <app-fakt label="zelt.feld.ph" [wert]="ph"></app-fakt>
    <app-fakt label="zelt.feld.ablaufEc" [wert]="ablaufEc"></app-fakt>
    <app-fakt label="zelt.feld.ablaufPh" [wert]="ablaufPh"></app-fakt>
    <app-fakt label="zelt.feld.substrat" [wert]="substrat"></app-fakt>
    <div class="fakt" *ngFor="let produkt of produkte; trackBy: trackProdukt">
      <span class="fakt-label">{{ produkt.name }}</span>
      <span class="fakt-wert">{{ 'zelt.feld.mlProLiter' | translate: { ml: ml(produkt) } }}</span>
    </div>
  `,
  styleUrls: ['./koerper.scss'],
})
export class GabeKoerperComponent extends KoerperBasis {
  private readonly produkteCache = new KeyedCache<GabeProdukt[]>();

  get wasser(): string | null {
    return this.messwert('wasser_l', this.translate.instant('zelt.einheit.liter'), 2);
  }

  get kannen(): string | null {
    const kannen = this.zahl('kannen');
    return kannen === null ? null : String(kannen);
  }

  get verteilung(): string {
    // Absent reads as `gesamt`: most people water the tent rather than a
    // numbered plant, and the reader supplies the default the writer omitted.
    const roh = this.wort('verteilung') ?? 'gesamt';
    return this.translate.instant(`zelt.verteilung.${roh}`);
  }

  get ec(): string | null {
    return this.messwert('ec', this.translate.instant('zelt.einheit.ms'), 2);
  }

  get ph(): string | null {
    return this.messwert('ph', '', 2);
  }

  get ablaufEc(): string | null {
    return this.messwert('ablauf_ec', this.translate.instant('zelt.einheit.ms'), 2);
  }

  get ablaufPh(): string | null {
    return this.messwert('ablauf_ph', '', 2);
  }

  get substrat(): string | null {
    const messwerte = this.ding?.d?.['messwerte'] as { substrat?: string } | undefined;
    return messwerte?.substrat ? this.translate.instant(`zelt.substrat.${messwerte.substrat}`) : null;
  }

  get produkte(): GabeProdukt[] {
    const roh = (this.ding?.d?.['produkte'] as GabeProdukt[] | undefined) ?? [];
    return this.produkteCache.get(roh.map(produkt => `${produkt.name}:${produkt.ml_pro_l}`).join('|'), () => roh);
  }

  /** ngx-translate interpolates by string replace, so the number has to arrive already spoken. */
  ml(produkt: GabeProdukt): string {
    return zahlText(produkt.ml_pro_l, 2);
  }

  trackProdukt(_index: number, produkt: GabeProdukt): string {
    return produkt.name;
  }
}
