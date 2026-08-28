import { Component, Input } from '@angular/core';
import { KeyedCache } from 'src/app/util/keyed-cache';
import { Herkunft, Messung, Messzeile, herkunftSchluessel, messzeilen } from 'src/app/util/messquellen';

/**
 * `Werte {…}` - what produced the numbers on this screen, printed rather than
 * implied: the literal request, the rule the rows follow, and one row per
 * measure *per origin*.
 *
 * The rule is §3.1's and it is the reason this panel exists at all:
 *
 * > One measure, two sources, two rows. Never merged, never averaged, never
 * > silently superseded.
 *
 * So two controllers reporting temperature are two rows here, a pH pen and a
 * controller are two rows here, and no row on this panel is ever an average of
 * anything.
 */
@Component({
  selector: 'app-werte',
  templateUrl: './werte.component.html',
  styleUrls: ['./werte.component.scss'],
})
export class WerteComponent {
  /** The literal request that produced the screen. */
  @Input() anfrage = '';
  @Input() messungen: readonly Messung[] = [];

  public offen = false;

  private readonly zeilenCache = new KeyedCache<Messzeile[]>();

  get zeilen(): Messzeile[] {
    const schluessel = this.messungen.map(messung => `${messung.mass}|${herkunftSchluessel(messung.herkunft)}|${messung.t}`).join(',');
    return this.zeilenCache.get(schluessel, () => messzeilen([...this.messungen]));
  }

  /** `von Hand` or the device's own name - the suffix §3.1 puts after the measure. */
  herkunftText(herkunft: Herkunft): string {
    return herkunft.quelle === 'hand' ? 'zelt.werte.vonHand' : 'zelt.werte.vomGeraet';
  }

  herkunftName(herkunft: Herkunft): string | null {
    return herkunft.quelle === 'hand' ? null : herkunft.geraet_name ?? null;
  }

  trackZeile(_index: number, zeile: Messzeile): string {
    return zeile.id;
  }

  umschalten(): void {
    this.offen = !this.offen;
  }
}
