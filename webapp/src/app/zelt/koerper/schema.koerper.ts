import { Component } from '@angular/core';
import { KoerperBasis } from './koerper-basis';

/**
 * The feeding plan. Its step advances on feed events and never on the clock,
 * which is why the number here is a fact about the grow and not about today.
 */
@Component({
  selector: 'app-schema-koerper',
  template: `
    <app-fakt label="zelt.feld.schema" [wert]="schema"></app-fakt>
    <app-fakt label="zelt.feld.schritt" [wert]="schritt"></app-fakt>
  `,
  styleUrls: ['./koerper.scss'],
})
export class SchemaKoerperComponent extends KoerperBasis {
  get schema(): string | null {
    return this.schluesselwort('zelt.schema', 'schema_id');
  }

  get schritt(): string | null {
    const schritt = this.zahl('schritt');
    return schritt === null ? null : String(schritt);
  }
}
