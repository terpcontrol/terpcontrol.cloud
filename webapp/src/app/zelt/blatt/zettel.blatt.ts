import { Component, OnInit } from '@angular/core';
import { BlattBasis } from './blatt-basis';
import { zettelEntwurf } from './entwurf';

/**
 * §13.2 - the Zettel on the tent door. Anyone opens one, anyone closes it, and
 * until somebody does it sits above everything else on the tent screen, because
 * an open fact outranks the camera.
 */
@Component({
  selector: 'app-zettel-blatt',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'zelt.blatt.zettel.titel' | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="abbrechen()">{{ 'zelt.blatt.abbrechen' | translate }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="blatt-inhalt">
      <tc-blatt-kopf [t]="t" [min]="fenster.min" [max]="fenster.max" (tChange)="t = $event"></tc-blatt-kopf>

      <textarea
        class="blatt-text"
        rows="2"
        name="text"
        [placeholder]="'zelt.blatt.zettel.platzhalter' | translate"
        [(ngModel)]="text"
      ></textarea>
      <p class="blatt-hinweis">{{ 'zelt.blatt.zettel.hinweis' | translate }}</p>

      <div class="blatt-wahl" *ngIf="werZeigen">
        <span class="blatt-wahl-name">{{ 'zelt.blatt.gabe.wer' | translate }}</span>
        <button
          type="button"
          class="blatt-chip"
          *ngFor="let mensch of menschen; trackBy: trackDing"
          [class.blatt-chip--an]="akteur === mensch.ding_id"
          [attr.aria-pressed]="akteur === mensch.ding_id"
          (click)="akteurWaehlen(mensch.ding_id)"
        >
          {{ mensch.name }}
        </button>
      </div>
    </ion-content>

    <ion-footer class="blatt-fuss">
      <button type="button" class="blatt-knopf" [disabled]="!text.trim()" (click)="eintragen()">
        {{ 'zelt.blatt.eintragen' | translate }}
      </button>
    </ion-footer>
  `,
  styleUrls: ['./blatt.scss'],
})
export class ZettelBlattComponent extends BlattBasis implements OnInit {
  public text = '';

  ngOnInit(): void {
    this.akteurLesen();
  }

  trackDing(_index: number, ding: { ding_id: string }): string {
    return ding.ding_id;
  }

  eintragen(): void {
    if (!this.text.trim()) return;
    this.fertig(zettelEntwurf({ zelt_id: this.zelt.zelt_id, t: this.t, akteur: this.akteur, text: this.text }));
  }
}
