import { Component, Input } from '@angular/core';

/**
 * One labelled fact inside a body. It renders nothing at all when it has no
 * value: an absent fact is an absent row, not a dash (§6).
 */
@Component({
  selector: 'app-fakt',
  template: `
    <div class="fakt" *ngIf="wert">
      <span class="fakt-label">{{ label | translate }}</span>
      <span class="fakt-wert">{{ wert }}</span>
    </div>
  `,
  styleUrls: ['./koerper.scss'],
})
export class FaktComponent {
  /** Translation key of the label. */
  @Input() label = '';
  @Input() wert: string | null = null;
}
