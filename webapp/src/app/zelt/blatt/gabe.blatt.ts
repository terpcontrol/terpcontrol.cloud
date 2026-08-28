import { Component, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import type { Ding, GabeProdukt, GabeVerteilung } from '@fg2/shared-types';
import { AusgangService } from 'src/app/services/dinge.service';
import { formatTimeAgo } from 'src/app/util/time-ago';
import { pluralSchluessel, zahlText } from 'src/app/util/zahl';
import { BlattBasis } from './blatt-basis';
import {
  DoppelWarnung,
  GabeVorgabe,
  KANNEN_GROESSEN,
  KANNEN_MAX,
  ProduktEingabe,
  Substrat,
  SUBSTRAT_WERTE,
  doppelGabe,
  gabeEntwurf,
  gabeVorgabe,
  gerundet,
  gesamtLiter,
} from './entwurf';

/** How long a thumb has to rest on the counter before it means „one can fewer". */
const HALTEN_MS = 450;

/**
 * §12.1 - the `Gabe` sheet, and the spine of the free product. Two taps for the
 * watering most people log: open it, `Eintragen`. Everything below the counter
 * is there for the entry that wants it and costs nothing to the entry that
 * does not.
 *
 * Not one line of it reads a device.
 */
@Component({
  selector: 'app-gabe-blatt',
  templateUrl: './gabe.blatt.html',
  styleUrls: ['./blatt.scss', './zaehler.scss'],
})
export class GabeBlattComponent extends BlattBasis implements OnInit {
  public kannen = 1;
  public kanne_l = 2;
  public verteilung: GabeVerteilung = 'gesamt';
  /** Empty is the whole tent - the default, and what most waterings are. */
  public pflanzen: string[] = [];
  public produkte: ProduktEingabe[] = [];
  public ph = '';
  public ec = '';
  public ablauf_ph = '';
  public ablauf_ec = '';
  public substrat: Substrat | null = null;
  public notiz = '';
  public warnung: DoppelWarnung | null = null;
  public mehrOffen = false;

  public readonly groessen = KANNEN_GROESSEN;
  public readonly substrate = SUBSTRAT_WERTE;
  public readonly punkte = Array.from({ length: KANNEN_MAX }, (_wert, index) => index);

  private halteTimer: ReturnType<typeof setTimeout> | null = null;
  private gehalten = false;

  constructor(modal: ModalController, ausgang: AusgangService, private translate: TranslateService) {
    super(modal, ausgang);
  }

  ngOnInit(): void {
    const vorgabe: GabeVorgabe = gabeVorgabe(this.zelt, this.dinge);
    this.kannen = vorgabe.kannen;
    this.kanne_l = vorgabe.kanne_l;
    this.akteurLesen();
    this.pruefe();
  }

  /** §12.1: only when there is more than the tent to water. */
  get pflanzenListe(): Ding[] {
    return this.dinge.filter(ding => ding.art === 'pflanze' && !ding.storniert_von && !ding.d?.['entfernt_t']);
  }

  get wasser_l(): number {
    return gerundet(this.kannen * this.kanne_l);
  }

  get gesamt_l(): number {
    return gesamtLiter(this.wasser_l, this.verteilung, this.pflanzen.length);
  }

  /** `3 Kannen · 6,0 l` - the litres are read out of the taps and never typed. */
  get kannenSchluessel(): string {
    return pluralSchluessel('zelt.blatt.gabe.kannen', this.kannen);
  }

  get kannenParams(): Record<string, string> {
    return { anzahl: zahlText(this.kannen, 0), liter: zahlText(this.wasser_l, 2) };
  }

  get mengeSchluessel(): string {
    return this.verteilung === 'je_pflanze' ? 'zelt.blatt.gabe.jePflanze' : 'zelt.blatt.gabe.gesamt';
  }

  get mengeParams(): Record<string, string> {
    return { liter: zahlText(this.wasser_l, 2), gesamt: zahlText(this.gesamt_l, 2) };
  }

  get warnungParams(): Record<string, string> {
    const warnung = this.warnung;
    if (!warnung) return {};
    return {
      wer: this.akteurName(warnung.ding.akteur) ?? this.translate.instant('zelt.blatt.gabe.jemand'),
      was: this.zielName(warnung.pflanzen),
      wann: formatTimeAgo(warnung.ding.t),
      liter: zahlText(warnung.wasser_l, 2),
    };
  }

  get substratText(): string {
    return this.warnung?.substrat ? this.translate.instant(`zelt.substrat.${this.warnung.substrat}`) : '';
  }

  /** The last feed's products, offered as one tap rather than prefilled - we never invent a dose. */
  get letzteProdukte(): GabeProdukt[] {
    const letzte = [...this.dinge]
      .filter(ding => ding.art === 'gabe' && !ding.storniert_von && Array.isArray(ding.d?.['produkte']))
      .sort((links, rechts) => rechts.t - links.t)[0];
    return this.produkte.length > 0 ? [] : ((letzte?.d?.['produkte'] as GabeProdukt[] | undefined) ?? []);
  }

  get letzteText(): string {
    return this.letzteProdukte.map(produkt => `${produkt.name} ${zahlText(produkt.ml_pro_l, 2)}`).join(' · ');
  }

  name(ding: Ding): string {
    return ding.name?.trim() || this.translate.instant('zelt.arten.pflanze');
  }

  mehr(): void {
    // A long press already meant „one fewer"; the click the browser sends after
    // it must not undo that.
    if (this.gehalten) {
      this.gehalten = false;
      return;
    }
    this.kannen = Math.min(KANNEN_MAX, this.kannen + 1);
  }

  weniger(): void {
    this.kannen = Math.max(1, this.kannen - 1);
  }

  halten(): void {
    this.gehalten = false;
    this.halteTimer = setTimeout(() => {
      this.gehalten = true;
      this.weniger();
    }, HALTEN_MS);
  }

  loslassen(): void {
    if (this.halteTimer) clearTimeout(this.halteTimer);
    this.halteTimer = null;
  }

  /** The picker's own numbers are numbers on the screen, so they are spoken too. */
  groesseText(groesse: number): string {
    return zahlText(groesse, 1);
  }

  kanneWaehlen(ereignis: CustomEvent<{ value?: unknown }>): void {
    const wert = Number(ereignis.detail?.value);
    if (Number.isFinite(wert) && wert > 0) this.kanne_l = wert;
  }

  /** Tapping `Ganzes Zelt` is how you get back to the default, and it is one tap. */
  ganzesZelt(): void {
    this.pflanzen = [];
    this.pruefe();
  }

  pflanzeUmschalten(ding_id: string): void {
    this.pflanzen = this.pflanzen.includes(ding_id) ? this.pflanzen.filter(id => id !== ding_id) : [...this.pflanzen, ding_id];
    this.pruefe();
  }

  produktZufuegen(): void {
    this.produkte = [...this.produkte, { name: '', ml_pro_l: '', aus_schema: false }];
    this.pruefe();
  }

  produktEntfernen(index: number): void {
    this.produkte = this.produkte.filter((_produkt, stelle) => stelle !== index);
    this.pruefe();
  }

  letzteUebernehmen(): void {
    this.produkte = this.letzteProdukte.map(produkt => ({ name: produkt.name, ml_pro_l: zahlText(produkt.ml_pro_l, 2), aus_schema: false }));
    this.pruefe();
  }

  substratWaehlen(wert: Substrat): void {
    this.substrat = this.substrat === wert ? null : wert;
  }

  zeitpunkt(t: number): void {
    this.t = t;
    this.pruefe();
  }

  eintragen(): void {
    this.fertig(this.entwurf(null));
  }

  /** §13.6: two phones, one pour. Nothing is deleted; the second entry says what it is. */
  dublette(): void {
    this.fertig(this.entwurf(this.warnung?.ding.ding_id ?? null));
  }

  trackProdukt(index: number): number {
    return index;
  }

  trackDing(_index: number, ding: Ding): string {
    return ding.ding_id;
  }

  private entwurf(dublette_von: string | null): Ding {
    return gabeEntwurf({
      zelt_id: this.zelt.zelt_id,
      t: this.t,
      akteur: this.akteur,
      kannen: this.kannen,
      kanne_l: this.kanne_l,
      verteilung: this.verteilung,
      pflanzen: this.pflanzen,
      produkte: this.produkte,
      ph: this.ph,
      ec: this.ec,
      ablauf_ph: this.ablauf_ph,
      ablauf_ec: this.ablauf_ec,
      substrat: this.substrat,
      notiz: this.notiz,
      dublette_von: dublette_von,
    });
  }

  private pruefe(): void {
    this.warnung = doppelGabe({
      dinge: this.dinge,
      auswahl: this.pflanzen,
      t: this.t,
      medium: this.zelt?.d?.medium,
      mitProdukten: this.produkte.some(produkt => produkt.name.trim() !== ''),
      wartend: this.ausgang.wartende(this.zelt?.zelt_id ?? '').map(ding => ding.ding_id),
    });
  }

  private akteurName(ding_id: string | undefined): string | null {
    return this.menschen.find(mensch => mensch.ding_id === ding_id)?.name?.trim() || null;
  }

  private zielName(pflanzen: readonly string[]): string {
    if (pflanzen.length === 0) return this.translate.instant('zelt.verteilung.gesamt');
    return pflanzen.map(id => this.pflanzenListe.find(ding => ding.ding_id === id)?.name?.trim()).filter(Boolean).join(' ');
  }
}
