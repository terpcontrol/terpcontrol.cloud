import { Component, Input } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { BandWert, Beleg } from 'src/app/util/beleg';
import { Text } from 'src/app/util/ding-text';
import { einheitVon } from 'src/app/util/einheiten';
import { zahlText } from 'src/app/util/zahl';
import { DingTextService } from '../zeile/ding-text.service';

/** One half of the pair, already resolved by `beleg()`. */
export interface PaarHalbe {
  id: 'vorher' | 'jetzt';
  /** `VORHER` · `JETZT`, or §7.4's comparand when there is no before. */
  kappe: Text;
  beleg: Beleg;
  moment: number;
  tag: number;
  /**
   * §7.4: `ZIEL`, `PLAN` and `BEGINN` are comparands, not moments. Printing a
   * wall clock over them would date the left half to a minute the tent did not
   * exist in.
   */
  zeitZeigen: boolean;
}

/**
 * §5 - the picture pair. Same box, same 4:3, same mini-caps, same position, in
 * every arm of the evidence ladder, and **the caption's third slot is the
 * evidence kind and it is always printed**.
 *
 * That one word is what makes there be no mode: the screen always says what it
 * is looking at, at every density, including the mixed pair the day after a
 * controller arrives. Which arm a half landed in is `beleg()`'s answer and
 * nothing in here re-decides it - this component draws what it was handed.
 */
@Component({
  selector: 'tc-paar',
  templateUrl: './paar.component.html',
  styleUrls: ['./paar.component.scss'],
})
export class PaarComponent {
  @Input() haelften: PaarHalbe[] = [];

  constructor(private texte: DingTextService, private translate: TranslateService) {}

  /** The one place a `Text` becomes words in here. */
  public wort(text: Text | null): string {
    return this.texte.text(text);
  }

  /** One stacked min/max of das Werteband, with its unit on it. */
  public bandParams(wert: BandWert): Record<string, string> {
    return {
      mass: this.translate.instant(`zelt.mass.${wert.mass}`),
      min: zahlText(wert.min),
      max: zahlText(wert.max),
      einheit: einheitVon(wert.mass),
    };
  }

  trackHalbe(_index: number, halbe: PaarHalbe): string {
    return halbe.id;
  }

  trackBand(_index: number, wert: BandWert): string {
    return wert.id;
  }
}
