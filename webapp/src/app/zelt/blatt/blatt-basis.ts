import { Directive, Input } from '@angular/core';
import { ModalController } from '@ionic/angular';
import type { Ding, Zelt } from '@fg2/shared-types';
import { AusgangService } from 'src/app/services/dinge.service';
import { Zeitfenster, zeitfenster } from './entwurf';

/** Where this phone remembers who is holding it, so a club member types their name once. */
const AKTEUR_SCHLUESSEL = 'tc.akteur';

/**
 * What the three sheets have in common: which tent they write into, when the
 * thing they record happened, and who did it.
 *
 * None of it reads a device. Every field on every sheet is human-entered, and a
 * tent with `geraete: []` fills them all in exactly as one with three does.
 */
@Directive()
export abstract class BlattBasis {
  @Input() zelt!: Zelt;
  /** Everything the screen behind the sheet already read. The sheet asks the network for nothing. */
  @Input() dinge: readonly Ding[] = [];

  /** §12.2 - when it *happened*. Defaulted to now, editable, and never the same field as `erfasst_at`. */
  public t = Date.now();
  public akteur: string | null = null;

  private readonly geoeffnet = Date.now();

  constructor(protected modal: ModalController, protected ausgang: AusgangService) {}

  /** §12.2's bounds: no earlier than this run, no later than now. */
  get fenster(): Zeitfenster {
    return zeitfenster(this.zelt, this.dinge, this.geoeffnet);
  }

  /** §13.1: the `Wer?` row exists at two people and not before. We never ask for identity. */
  get menschen(): Ding[] {
    return this.dinge.filter(ding => ding.art === 'mensch' && !ding.storniert_von);
  }

  get werZeigen(): boolean {
    return this.menschen.length >= 2;
  }

  public akteurWaehlen(ding_id: string | null): void {
    this.akteur = this.akteur === ding_id ? null : ding_id;
    try {
      if (this.akteur) window.localStorage.setItem(`${AKTEUR_SCHLUESSEL}.${this.zelt?.zelt_id}`, this.akteur);
    } catch (_fehler) {
      // Remembering the person is a convenience; not remembering costs one tap.
    }
  }

  public abbrechen(): void {
    void this.modal.dismiss(null, 'abgebrochen');
  }

  /** The one exit that writes: queue it, hand the row back, close. */
  protected fertig(ding: Ding): void {
    void this.modal.dismiss(this.ausgang.eintragen(ding), 'eingetragen');
  }

  protected akteurLesen(): void {
    try {
      const gemerkt = window.localStorage.getItem(`${AKTEUR_SCHLUESSEL}.${this.zelt?.zelt_id}`);
      if (gemerkt && this.menschen.some(mensch => mensch.ding_id === gemerkt)) this.akteur = gemerkt;
    } catch (_fehler) {
      this.akteur = null;
    }
  }
}
