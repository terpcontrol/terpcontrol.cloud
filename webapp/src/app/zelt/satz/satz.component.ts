import { Component, Input, OnChanges } from '@angular/core';
import { Satz, satzText } from 'src/app/util/satz';
import { DingTextService } from '../zeile/ding-text.service';

/**
 * §9's one sentence, and §9.3's one `→` line under it.
 *
 * The sentence is whatever rung of the ladder matched - there is no second
 * generator for the device-less case and no day-one branch beside it, so this
 * component has no idea which density it is drawing and needs none.
 *
 * §8.2 calls the remedy line the closest call in the whole no-modes audit: a
 * user can go weeks without seeing one and then meet an element they have never
 * met. The mitigation is here, in the markup - it is an ordinary Zeile inside
 * the sentence block, with the rule that produced it printed alongside so the
 * advice can be argued with rather than believed.
 */
@Component({
  selector: 'tc-satz',
  templateUrl: './satz.component.html',
  styleUrls: ['./satz.component.scss'],
})
export class SatzComponent implements OnChanges {
  @Input() satz: Satz | null = null;
  /** Where the remedy walks to. A rule always names a Ding of this tent's own. */
  @Input() zeltId = '';

  public zeile = '';
  public regel = '';
  public marke = '';
  public ziel: unknown[] | null = null;

  constructor(private texte: DingTextService) {}

  ngOnChanges(): void {
    this.zeile = this.satz ? satzText(this.satz.klauseln, text => this.texte.text(text)) : '';
    this.regel = this.satz?.regel ? this.texte.text(this.satz.regel.text) : '';
    this.marke = this.satz?.regel ? this.texte.text(this.satz.regel.marke) : '';
    this.ziel = this.satz?.regel ? ['/z', this.zeltId, this.satz.regel.ziel] : null;
  }
}
