import { Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import type { Ding, Zelt } from '@fg2/shared-types';
import { VergleichService } from 'src/app/services/vergleich.service';
import { istEintrag } from 'src/app/util/ding-text';
import { KeyedCache } from 'src/app/util/keyed-cache';
import { Messung } from 'src/app/util/messquellen';
import {
  Detent,
  DetentEingabe,
  DichteTag,
  Landung,
  Vergleich,
  ankerText,
  aufloesen,
  detents,
  dichteband,
  naechsterUnterschied,
  spanne,
} from 'src/app/util/vergleich';
import { laufBeginn, tagNummer } from 'src/app/util/zelt-tag';
import { DingTextService } from '../zeile/ding-text.service';

/** §8.1 - „40 px magnetische Zonen, jede Position dazwischen mit einem gezielten Finger erreichbar". */
const MAGNET_PX = 40;

/**
 * How far a press has to travel sideways before it is a scrub rather than the
 * beginning of a page scroll. One-handed in a tent, a flick down the screen is
 * the most likely thing to land on a 28 px full-bleed strip, and it must not
 * destroy `Vorher` on the way past.
 */
const SCHWELLE_PX = 6;

const STUNDE_MS = 60 * 60 * 1000;
const TAG_MS = 24 * STUNDE_MS;

/** The same thirty seconds the Tafel ages its header on. */
const TAKT_MS = 30 * 1000;

/** One bar of the Dichteband, already normalised, in the band's own coordinates. */
export interface Balken {
  x: number;
  /** Kept frames, drawn upwards from the middle. */
  oben: number;
  /** Dinge, drawn downwards from the middle. */
  unten: number;
}

/** What a press is doing, from the moment it lands to the moment it lets go. */
type Geste = 'ruht' | 'gespannt' | 'zieht' | 'abgebrochen';

/**
 * `<tc-zeitgriff>` - 56 px, directly under the sentence block, identical
 * position on every Tafel.
 *
 * **It moves `Vorher`**, and it is the only thing that does. One slider decides
 * what „vorher" means and every screen you walk to answers the same question
 * against it, which is why the cursor lives in `VergleichService` and not here.
 *
 * What `Vorher` *can* be depends on the Ding, and §8.1 gives the one rule: a
 * Ding that has a state diffs against a moment, a Ding that is a moment diffs
 * against its predecessor. There is no per-art table in this component - it
 * asks `griffart()` and renders whatever rungs the data produced.
 *
 * **It is not a device feature.** With `geraete: []` the ladder is Beginn,
 * gestern, the entries, the photographs and the phase changes; nothing is
 * greyed, disabled or padlocked, because nothing here is conditional on
 * hardware in the first place.
 *
 * **And it has no modes** (§8.2). Nothing a key or a thumb does here outlives
 * the gesture that did it: the collapse is held, never latched, and „jetzt" is
 * read from the one clock rather than remembered from the moment the phone was
 * unlocked.
 */
@Component({
  selector: 'tc-zeitgriff',
  templateUrl: './zeitgriff.component.html',
  styleUrls: ['./zeitgriff.component.scss'],
})
export class ZeitgriffComponent implements OnInit, OnChanges, OnDestroy {
  @Input() zelt!: Zelt;
  @Input() subjekt: Ding | null = null;
  @Input() dinge: readonly Ding[] = [];
  /** Series readings, when something measured any. They decide how finely the handle can land. */
  @Input() messungen: readonly Messung[] = [];

  /** The reply of `Nächster Unterschied` when there was no next one. Self-cancels on the next move. */
  public hinweis: string | null = null;
  public zieht = false;
  public vergleich: Vergleich | null = null;
  /** Whether the printed moment is one this tent can tell apart, and if not, why not. */
  public landung: Landung = 'genau';

  @ViewChild('spur') private spur?: ElementRef<HTMLElement>;

  private stand = 0;
  /**
   * „Jetzt", from `VergleichService` and from nowhere else, re-read on the same
   * thirty-second beat the Tafel ages its own header on. A now that was resolved
   * once per screen entry ends the track where the phone happened to be
   * unlocked, and a tent phone is unlocked once.
   */
  private jetzt = 0;
  private zuletzt: number | null = null;
  private zuletztPersoenlich = false;
  /** The moment this control itself last wrote, so a cursor set elsewhere resets what is printed. */
  private eigenerStand: number | null = null;

  private geste: Geste = 'ruht';
  private zeigerId: number | null = null;
  private startX = 0;
  private startY = 0;

  private readonly detentCache = new KeyedCache<Detent[]>();
  private readonly bandCache = new KeyedCache<DichteTag[]>();
  private readonly balkenCache = new KeyedCache<Balken[]>();
  private readonly abos = new Subscription();

  constructor(private cursor: VergleichService, private texte: DingTextService) {
    this.jetzt = this.cursor.jetzt();
  }

  ngOnInit(): void {
    this.abos.add(
      this.cursor.vergleich$.subscribe(vergleich => {
        // A cursor moved by a Verlauf row, the crosshair or another screen is
        // not this control's landing, and printing „(letzter Eintrag davor)"
        // about it would describe a snap that never happened.
        const fremd = vergleich?.von !== this.eigenerStand;
        this.vergleich = vergleich;
        if (fremd) {
          this.landung = 'genau';
          this.hinweis = null;
        }
      }),
    );
    this.abos.add(this.cursor.zieht$.subscribe(zieht => (this.zieht = zieht)));
    this.abos.add(
      interval(TAKT_MS).subscribe(() => {
        // Not while a thumb is on the handle: the rungs must not move under it.
        // `jetzt()` is frozen for the gesture anyway, so this only spares the
        // rebuild.
        if (this.cursor.zieht) return;
        this.jetztLesen();
      }),
    );
  }

  ngOnChanges(): void {
    this.stand++;
    this.jetzt = this.cursor.jetzt();
    if (!this.zelt?.zelt_id) return;

    this.cursor.fuerZelt(this.zelt.zelt_id);
    // The rung, not the cursor: dragging away from `seit zuletzt` must not make
    // the rung disappear from under the thumb, and it did, for the rest of the
    // session, because it was inferred from where the cursor happened to sit.
    this.zuletzt = this.cursor.zuletztMoment;
    this.zuletztPersoenlich = this.cursor.zuletztPersoenlich;
  }

  ngOnDestroy(): void {
    this.abos.unsubscribe();
    this.cursor.ziehtSetzen(false);
  }

  /** The rungs this Subjekt has. They exist by data and by nothing else. */
  get detentliste(): Detent[] {
    return this.detentCache.get(`${this.stand}:${this.jetzt}`, () => detents(this.eingabe, this.subjekt));
  }

  get band(): DichteTag[] {
    return this.bandCache.get(`${this.stand}:${this.grenzen.von}:${this.grenzen.bis}`, () =>
      dichteband(this.zelt, this.dinge, this.grenzen.von, this.grenzen.bis),
    );
  }

  /**
   * The band, normalised per source: the busiest day of entries is a full bar
   * below, the busiest day of frames a full bar above. Two sources are never
   * added together - a week of photographs must not look like a week of work.
   */
  get balken(): Balken[] {
    const band = this.band;
    return this.balkenCache.get(`${this.stand}:${band.length}:${band[0]?.t ?? 0}`, () => {
      const maxDinge = Math.max(1, ...band.map(tag => tag.dinge));
      const maxBilder = Math.max(1, ...band.map(tag => tag.bilder));
      return band.map((tag, index) => ({ x: index, oben: tag.bilder / maxBilder, unten: tag.dinge / maxDinge }));
    });
  }

  get moment(): number {
    return this.vergleich?.von ?? this.grenzen.von;
  }

  get tag(): number {
    return tagNummer(this.zelt?.zeitzone ?? 'UTC', laufBeginn(this.zelt, this.dinge), this.moment);
  }

  /** Where the playhead sits, 0-100. */
  get kopfProzent(): number {
    return this.prozent(this.moment);
  }

  /** The rung the cursor is standing on, if it is standing on one. */
  get anker(): Detent | null {
    return this.detentliste.find(detent => detent.von === this.moment) ?? null;
  }

  /**
   * How the cursor reads. A rung of *this* Subjekt when it is standing on one,
   * and otherwise what the cursor itself says it is - which is the half that
   * survives a walk: from Annas Tafel to the tent's, „seit dem letzten Besuch
   * von Anna" is the whole meaning of the number, and a generic date is not a
   * translation of it.
   */
  get ankerBeschriftung(): string {
    // Who it is measured from outranks where it happens to sit: a cursor set
    // from Annas last visit that lands on the same minute as the tent's „letzte
    // Gabe" is still Annas last visit, and the coincidence must not rename it.
    const wer = this.werName;
    if (wer) return this.texte.text({ key: 'zelt.griff.besuchVon', params: { wer: wer } });

    const eigener = this.anker;
    if (eigener) return this.texte.text(eigener.text);
    return this.texte.text(ankerText(this.vergleich?.anker, this.zuletztPersoenlich));
  }

  /** `zelt.griff.moment`, or the one that admits the thumb did not land on a moment. */
  get momentSchluessel(): string {
    if (this.landung === 'verschoben') return 'zelt.griff.verschoben';
    if (this.landung === 'unbekannt') return 'zelt.griff.unbekannt';
    return 'zelt.griff.moment';
  }

  /** A rung's own words, interpolated - `Lauf 1 · Tag 34`, not `Lauf {{nummer}} · Tag {{tag}}`. */
  beschriftung(detent: Detent): string {
    return this.texte.text(detent.text);
  }

  prozent(t: number): number {
    const { von, bis } = this.grenzen;
    return Math.min(100, Math.max(0, ((t - von) / (bis - von)) * 100));
  }

  trackDetent(_index: number, detent: Detent): string {
    return detent.id;
  }

  trackBalken(_index: number, balken: Balken): number {
    return balken.x;
  }

  /**
   * A press on the strip is not yet a scrub. It becomes one on the knob, or
   * after a few px of sideways travel; a flick down the screen is a scroll and
   * leaves `Vorher` exactly where it was, because there is no undo for it.
   */
  onPointerDown(event: PointerEvent): void {
    this.hinweis = null;
    this.zeigerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.zeigerFangen(event.pointerId);

    const ziel = event.target as Element | null;
    if (ziel?.closest?.('.griff-kopf')) {
      this.geste = 'zieht';
      this.cursor.ziehtSetzen(true);
      this.zielen(event.clientX);
      event.preventDefault();
      return;
    }

    this.geste = 'gespannt';
  }

  onPointerMove(event: PointerEvent): void {
    // A genuinely captured pointer, not „somebody, somewhere is dragging": the
    // shared flag says a thumb is on *a* handle, and a bare hover over this one
    // must not scrub because of it.
    if (this.zeigerId !== event.pointerId || this.geste === 'ruht' || this.geste === 'abgebrochen') return;

    if (this.geste === 'gespannt') {
      const quer = event.clientX - this.startX;
      const laengs = event.clientY - this.startY;
      if (Math.abs(laengs) > Math.abs(quer) && Math.abs(laengs) > SCHWELLE_PX) {
        this.geste = 'abgebrochen';
        this.zeigerLoesen(event.pointerId);
        return;
      }
      if (Math.abs(quer) < SCHWELLE_PX) return;
      this.geste = 'zieht';
      this.cursor.ziehtSetzen(true);
    }

    this.zielen(event.clientX);
    event.preventDefault();
  }

  onPointerUp(event?: PointerEvent): void {
    if (event && this.zeigerId !== null && event.pointerId !== this.zeigerId) return;

    // A press that never moved is a deliberate tap on the track, and a slider
    // you cannot tap is a slider with one reachable position.
    const tippen = this.geste === 'gespannt' && !!event;
    this.geste = 'ruht';
    if (event) this.zeigerLoesen(event.pointerId);
    this.zeigerId = null;

    if (tippen && event) this.zielen(event.clientX);
    this.cursor.ziehtSetzen(false);
    this.jetztLesen();
  }

  /** The browser took the gesture over - a page scroll. Whatever was set stays set. */
  onPointerCancel(event?: PointerEvent): void {
    this.geste = 'ruht';
    if (event) this.zeigerLoesen(event.pointerId);
    this.zeigerId = null;
    this.cursor.ziehtSetzen(false);
  }

  /**
   * Desktop, §8.1: `←`/`→` one detent, `Shift` one hour, `Space` collapses the
   * table - and §8.2: **held, not latched.** A key that leaves a screen-wide
   * state behind with nothing on screen saying a key did it is a mode by this
   * slice's own falsification test, and this slice's thesis is that there are
   * none.
   *
   * `Home`/`End`/`PageUp`/`PageDown` are here because `role="slider"` promises
   * them, and a promise a screen reader repeats is one the control has to keep.
   */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === ' ' || event.key === 'Spacebar') {
      if (!event.repeat) this.cursor.ziehtSetzen(true);
      event.preventDefault();
      return;
    }

    const rungen = this.detentliste;
    this.hinweis = null;

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const richtung = event.key === 'ArrowLeft' ? -1 : 1;
        if (event.shiftKey) {
          // Through the same resolver as the thumb: a keyboard that lands where
          // a thumb may not is a second set of reachable moments.
          this.landenAuf(this.moment + richtung * STUNDE_MS);
          break;
        }
        const nachbar =
          richtung < 0
            ? [...rungen].reverse().find(detent => detent.von < this.moment)
            : rungen.find(detent => detent.von > this.moment);
        if (nachbar) this.setzen(nachbar.von, nachbar.anker);
        break;
      }
      case 'Home': {
        const erste = rungen[0];
        if (erste) this.setzen(erste.von, erste.anker);
        else this.landenAuf(this.grenzen.von);
        break;
      }
      case 'End':
        this.landenAuf(this.grenzen.bis);
        break;
      case 'PageDown':
        this.landenAuf(this.moment - TAG_MS);
        break;
      case 'PageUp':
        this.landenAuf(this.moment + TAG_MS);
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  onKeyup(event: KeyboardEvent): void {
    if (event.key === ' ' || event.key === 'Spacebar') this.cursor.ziehtSetzen(false);
  }

  /** Focus left the strip mid-hold. Nothing this control did may outlive that. */
  onBlur(): void {
    this.geste = 'ruht';
    this.zeigerId = null;
    this.cursor.ziehtSetzen(false);
  }

  /**
   * §8.1 - jump to the next moment at which this Ding actually changed, so
   * nobody has to hunt for one. With nothing left it says so and leaves the
   * cursor exactly where it is.
   */
  naechster(): void {
    const ziel = naechsterUnterschied(this.moment, this.bezugsDinge, this.messungen, this.jetzt);
    if (ziel === null) {
      this.hinweis = 'zelt.griff.keinUnterschied';
      return;
    }

    this.hinweis = null;
    this.landung = 'genau';
    this.setzen(ziel, 'frei');
  }

  /** The person the cursor is measured from, when it was set from one person's visit. */
  private get werName(): string | null {
    const wer = this.vergleich?.wer;
    if (!wer) return null;
    const mensch = this.dinge.find(ding => ding.ding_id === wer && ding.art === 'mensch');
    return mensch?.name?.trim() || null;
  }

  /** What the raw handle position is resolved against, and how finely it can land. */
  private get fein(): boolean {
    return this.messungen.length > 0;
  }

  private get eingabe(): DetentEingabe {
    return {
      zelt: this.zelt,
      dinge: this.dinge,
      messungen: this.messungen,
      jetzt: this.jetzt,
      zuletzt: this.zuletzt,
      zuletztPersoenlich: this.zuletztPersoenlich,
    };
  }

  private get grenzen(): { von: number; bis: number } {
    return spanne(this.eingabe, this.subjekt, this.detentliste);
  }

  /**
   * „dieses Ding" for `Nächster Unterschied`: the tent means everything, a
   * person means what they wrote, and a plant means what was done to it -
   * **including the pours that named nobody**, because §13.3 says `rel.an`
   * absent is the whole tent and the whole tent contains this plant. Without
   * that rule a plant's own waterings are invisible to the step and the reader
   * is walked through the day the neighbouring plants were typed in instead.
   */
  private get bezugsDinge(): readonly Ding[] {
    if (!this.subjekt || this.subjekt.art === 'zelt') return this.dinge;

    const id = this.subjekt.ding_id;
    const ganzesZelt = this.subjekt.art === 'pflanze';
    const eigene = this.dinge.filter(ding => {
      if (ding.ding_id === id || !istEintrag(ding)) return false;
      if (ding.akteur === id) return true;
      const ziele = Object.values(ding.rel ?? {}).flat();
      return ziele.length === 0 ? ganzesZelt : ziele.includes(id);
    });

    return eigene.length > 0 ? eigene : this.dinge;
  }

  private jetztLesen(): void {
    const jetzt = this.cursor.jetzt();
    if (jetzt === this.jetzt) return;
    this.jetzt = jetzt;
    this.stand++;
  }

  private zeigerFangen(pointerId: number): void {
    try {
      this.spur?.nativeElement.setPointerCapture?.(pointerId);
    } catch (_fehler) {
      // A pointer the browser no longer knows about. The gesture is still ours
      // to track; capture is what keeps it ours once the thumb leaves the strip.
    }
  }

  private zeigerLoesen(pointerId: number): void {
    try {
      this.spur?.nativeElement.releasePointerCapture?.(pointerId);
    } catch (_fehler) {
      // The pointer was never captured, or is already gone. Neither is a state.
    }
  }

  /** One pointer position, snapped the way §8.1 snaps: magnetic to a rung, resolved otherwise. */
  private zielen(clientX: number): void {
    const kasten = this.spur?.nativeElement.getBoundingClientRect();
    if (!kasten || kasten.width <= 0) return;

    const { von, bis } = this.grenzen;
    const anteil = Math.min(1, Math.max(0, (clientX - kasten.left) / kasten.width));
    const roh = von + anteil * (bis - von);
    const proMs = kasten.width / (bis - von);

    const magnet = this.detentliste
      .map(detent => ({ detent: detent, abstand: Math.abs(detent.von - roh) * proMs }))
      .filter(kandidat => kandidat.abstand <= MAGNET_PX)
      .sort((links, rechts) => links.abstand - rechts.abstand)[0];

    if (magnet) {
      this.landung = 'genau';
      this.setzen(magnet.detent.von, magnet.detent.anker);
      return;
    }

    this.landenAuf(roh);
  }

  /** Every writer that is not a rung goes through here, thumb and keyboard alike. */
  private landenAuf(roh: number): void {
    const { von, bis } = this.grenzen;
    const gelandet = aufloesen(Math.min(bis, Math.max(von, roh)), this.dinge, this.fein);
    this.landung = gelandet.landung;
    this.setzen(gelandet.von, 'frei');
  }

  private setzen(von: number, anker: Detent['anker']): void {
    const { von: unten, bis } = this.grenzen;
    const gesetzt = Math.min(bis, Math.max(unten, von));
    this.eigenerStand = Math.round(gesetzt);
    // A rung of a person's Tafel carries who it is about, so the meaning walks
    // with the arithmetic: on the tent's Tafel the same cursor still reads
    // „seit dem letzten Besuch von Anna".
    const wer = anker === 'besuch' && this.subjekt?.art === 'mensch' ? this.subjekt.ding_id : undefined;
    this.cursor.setzen(gesetzt, anker, wer);
  }
}
