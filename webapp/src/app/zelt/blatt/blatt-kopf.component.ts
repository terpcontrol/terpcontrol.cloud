import { Component, EventEmitter, Input, Output } from '@angular/core';
import { alsEingabe, ausEingabe } from './entwurf';

/**
 * §12.2 - `heute 19:40 ✎`. Every sheet has one, because a pour is typed on the
 * way home as often as it is typed at the plant, and an entry stamped with the
 * moment somebody found their phone is an entry the double-feed guard reads
 * wrongly.
 *
 * This writes `Ding.t`, which is when it happened. `erfasst_at` is the server's
 * and is never sent.
 */
@Component({
  selector: 'tc-blatt-kopf',
  template: `
    <div class="blatt-kopf">
      <span class="blatt-zeit">
        <ng-container *ngIf="heute; else datum">{{ 'zelt.blatt.heute' | translate: { zeit: t | date: 'HH:mm' } }}</ng-container>
        <ng-template #datum>{{ t | date: 'EEE dd.MM. HH:mm' }}</ng-template>
      </span>
      <button
        type="button"
        class="blatt-stift"
        (click)="umschalten()"
        [attr.aria-expanded]="offen"
        [attr.aria-label]="'zelt.blatt.zeitpunktAendern' | translate"
      >
        <span aria-hidden="true">&#9998;</span>
      </button>
    </div>
    <ion-datetime
      *ngIf="offen"
      presentation="date-time"
      [value]="wert"
      [min]="minWert"
      [max]="maxWert"
      (ionChange)="gesetzt($any($event))"
    ></ion-datetime>
  `,
  styleUrls: ['./blatt.scss'],
})
export class BlattKopfComponent {
  @Input() t = Date.now();
  @Input() min = 0;
  @Input() max = Date.now();
  @Output() tChange = new EventEmitter<number>();

  public offen = false;

  get heute(): boolean {
    return new Date(this.t).toDateString() === new Date().toDateString();
  }

  get wert(): string {
    return alsEingabe(this.t);
  }

  get minWert(): string {
    return alsEingabe(this.min || this.max);
  }

  get maxWert(): string {
    return alsEingabe(this.max);
  }

  umschalten(): void {
    this.offen = !this.offen;
  }

  gesetzt(ereignis: CustomEvent<{ value?: string }>): void {
    const t = ausEingabe(String(ereignis.detail?.value ?? ''));
    if (t === null) return;
    this.t = t;
    this.tChange.emit(t);
  }
}
