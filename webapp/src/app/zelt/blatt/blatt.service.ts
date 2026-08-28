import { Injectable, Type } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Observable } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import type { Ding, Zelt } from '@fg2/shared-types';
import { AusgangProblem, AusgangService } from 'src/app/services/dinge.service';
import { GabeBlattComponent } from './gabe.blatt';
import { NotizBlattComponent } from './notiz.blatt';
import { ZettelBlattComponent } from './zettel.blatt';

/** The four buttons of §6.2, by the art each of them writes. */
export type BlattArt = 'gabe' | 'notiz' | 'zustand' | 'bild';

const BLAETTER: Record<string, Type<unknown>> = {
  gabe: GabeBlattComponent,
  notiz: NotizBlattComponent,
  zustand: ZettelBlattComponent,
};

const TOAST_MS = 6000;

/**
 * Opens the sheets and says out loud what became of what they wrote.
 *
 * A refusal is never swallowed and never retried behind the reader's back: a
 * 409 means the id is taken by a *different* entry, and quietly minting a new
 * one would turn one watering into two - the exact thing the client-minted id
 * exists to prevent.
 */
@Injectable({
  providedIn: 'root',
})
export class BlattService {
  constructor(
    private modal: ModalController,
    private toast: ToastController,
    private ausgang: AusgangService,
    private translate: TranslateService,
  ) {
    this.ausgang.probleme$.subscribe(problem => void this.sagen(problem));
  }

  /**
   * What is still waiting for a connection. §17 spends it twice: the one line
   * under the action row counts it, and every row written from one of these
   * entries carries `nicht gesendet` until it is gone from here.
   */
  get wartend$(): Observable<readonly Ding[]> {
    return this.ausgang.wartend$;
  }

  /**
   * The Ding that was written, already queued and already real, or null when
   * the sheet was closed without one. Nothing here waits for the server.
   */
  public async oeffnen(art: BlattArt, zelt: Zelt, dinge: readonly Ding[]): Promise<Ding | null> {
    if (art === 'bild') {
      await this.hinweis('zelt.aktion.fotoSpaeter');
      return null;
    }

    const blatt = await this.modal.create({
      component: BLAETTER[art],
      componentProps: { zelt: zelt, dinge: dinge },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      handle: true,
      cssClass: 'blatt-modal',
    });
    await blatt.present();

    const { data } = await blatt.onWillDismiss<Ding>();
    return data ?? null;
  }

  private async sagen(problem: AusgangProblem): Promise<void> {
    const grund = problem.problems?.map(einzeln => `${einzeln.path} ${einzeln.message}`.trim()).join(', ') ?? '';
    await this.hinweis(problem.grund === 'konflikt' ? 'zelt.ausgang.konflikt' : 'zelt.ausgang.abgelehnt', { grund: grund });
  }

  private async hinweis(schluessel: string, params?: Record<string, unknown>): Promise<void> {
    const toast = await this.toast.create({ message: this.translate.instant(schluessel, params), duration: TOAST_MS, position: 'bottom' });
    await toast.present();
  }
}
