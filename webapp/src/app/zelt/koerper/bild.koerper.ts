import { Component } from '@angular/core';
import { KoerperBasis } from './koerper-basis';

/**
 * A photograph. One art, both origins: a phone photo and a kept camera frame
 * differ only in the word the caption prints, which is §3.1's provenance rule
 * moved up to the picture.
 *
 * No pixels are drawn here yet. Reading an image still goes through the
 * device-shaped URL, and a photograph of a tent with no device has no device to
 * put in it; the tent-scoped read path (§16.1) is the item that fixes it.
 */
@Component({
  selector: 'app-bild-koerper',
  template: `
    <app-fakt label="zelt.feld.aufgenommen" [wert]="aufgenommen"></app-fakt>
    <app-fakt label="zelt.feld.herkunft" [wert]="herkunft"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class BildKoerperComponent extends KoerperBasis {
  get aufgenommen(): string | null {
    return this.ding?.t ? new Date(this.ding.t).toLocaleString() : null;
  }

  get herkunft(): string {
    return this.translate.instant(this.wort('quelle') === 'hand' ? 'zelt.herkunft.hand' : 'zelt.herkunft.kamera');
  }
}
