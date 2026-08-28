import { Component } from '@angular/core';
import { zeltTag } from 'src/app/util/zelt-tag';
import { KoerperBasis } from './koerper-basis';

/**
 * The tent itself. It is the Subjekt whenever the route carries no `ding_id`,
 * and it is the one body that is always reachable: a tent exists before any
 * device, any plant and any entry does.
 */
@Component({
  selector: 'app-zelt-koerper',
  template: `
    <app-fakt label="zelt.feld.tag" [wert]="tag"></app-fakt>
    <app-fakt label="zelt.feld.medium" [wert]="medium"></app-fakt>
    <app-fakt label="zelt.feld.zeitzone" [wert]="zeitzone"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class ZeltKoerperComponent extends KoerperBasis {
  get tag(): string {
    return this.translate.instant('zelt.tag', { tag: zeltTag(this.zelt, this.dinge, Date.now()) });
  }

  get medium(): string | null {
    const medium = this.zelt?.d?.medium ?? (this.wort('medium') as string | null);
    if (!medium) return null;
    const uebersetzt = this.translate.instant(`zelt.medium.${medium}`, { ersatz: medium });
    return uebersetzt === `zelt.medium.${medium}` ? medium : uebersetzt;
  }

  get zeitzone(): string | null {
    return this.zelt?.zeitzone ?? this.wort('zeitzone');
  }
}
