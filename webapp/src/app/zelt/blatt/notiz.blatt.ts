import { Component, OnInit } from '@angular/core';
import type { Messwerte } from '@fg2/shared-types';
import { BlattBasis } from './blatt-basis';
import { notizEntwurf } from './entwurf';

/**
 * §4.2 - a note, and the hand instrument set that rides along with it. One
 * sheet, no second modal, no new art: a pH pen and a tape measure are the
 * device-less grower's whole sensor suite and they belong on the entry they
 * were read for.
 */
@Component({
  selector: 'app-notiz-blatt',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'zelt.blatt.notiz.titel' | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="abbrechen()">{{ 'zelt.blatt.abbrechen' | translate }}</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="blatt-inhalt">
      <tc-blatt-kopf [t]="t" [min]="fenster.min" [max]="fenster.max" (tChange)="t = $event"></tc-blatt-kopf>

      <textarea
        class="blatt-text"
        rows="3"
        name="text"
        [placeholder]="'zelt.blatt.notiz.platzhalter' | translate"
        [(ngModel)]="text"
      ></textarea>

      <tc-messwerte-feld [werte]="messwerte" [substratZeigen]="true"></tc-messwerte-feld>

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
export class NotizBlattComponent extends BlattBasis implements OnInit {
  public text = '';
  public messwerte: Partial<Record<keyof Messwerte, unknown>> = {};

  ngOnInit(): void {
    this.akteurLesen();
  }

  trackDing(_index: number, ding: { ding_id: string }): string {
    return ding.ding_id;
  }

  eintragen(): void {
    if (!this.text.trim()) return;
    this.fertig(notizEntwurf({ zelt_id: this.zelt.zelt_id, t: this.t, akteur: this.akteur, text: this.text, messwerte: this.messwerte }));
  }
}
