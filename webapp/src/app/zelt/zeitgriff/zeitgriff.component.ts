import { Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import type { Ding, Zelt } from '@fg2/shared-types';
import { VergleichService } from 'src/app/services/vergleich.service';
import { KeyedCache } from 'src/app/util/keyed-cache';
import { Messung } from 'src/app/util/messquellen';
import {
  Detent,
  DetentEingabe,
  DichteTag,
  Vergleich,
  aufloesen,
  detents,
  dichteband,
  naechsterUnterschied,
  spanne,
} from 'src/app/util/vergleich';
import { laufBeginn, tagNummer } from 'src/app/util/zelt-tag';

/** §8.1 - „40 px magnetische Zonen, jede Position dazwischen mit einem gezielten Finger erreichbar". */
const MAGNET_PX = 40;

const STUNDE_MS = 60 * 60 * 1000;

/** One bar of the Dichteband, already normalised, in the band's own coordinates. */
export interface Balken {
  x: number;
  /** Kept frames, drawn upwards from the middle. */
  oben: number;
  /** Dinge, drawn downwards from the middle. */
  unten: number;
}

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

  /** The reply of `Nächster Unterschied` when there was no next one. Self-cancels on the next touch. */
  public hinweis: string | null = null;
  public zieht = false;
  public vergleich: Vergleich | null = null;
  /** Whether the cursor had to move back to the newest Ding before where the thumb let go. */
  public verschoben = false;

  @ViewChild('spur') private spur?: ElementRef<HTMLElement>;

  private stand = 0;
  /**
   * „Jetzt" is resolved once per screen entry. A now that slides while you look
   * at it would move every detent under the thumb.
   */
  private jetzt = Date.now();
  /**
   * The moment `zuletzt` resolved to when this screen was entered. It is read
   * once: dragging away from that rung must not make the rung disappear from
   * under the thumb.
   */
  private zuletzt: number | null = null;
  private zuletztPersoenlich = false;
  private readonly detentCache = new KeyedCache<Detent[]>();
  private readonly bandCache = new KeyedCache<DichteTag[]>();
  private readonly balkenCache = new KeyedCache<Balken[]>();
  private readonly abos = new Subscription();

  constructor(private cursor: VergleichService) {}

  ngOnInit(): void {
    this.abos.add(this.cursor.vergleich$.subscribe(vergleich => (this.vergleich = vergleich)));
    this.abos.add(this.cursor.zieht$.subscribe(zieht => (this.zieht = zieht)));
  }

  ngOnChanges(): void {
    this.stand++;
    if (!this.zelt?.zelt_id) return;

    const start = this.cursor.fuerZelt(this.zelt.zelt_id);
    if (start.anker === 'zuletzt') {
      this.zuletzt = start.von;
      this.zuletztPersoenlich = this.cursor.zuletztPersoenlich;
    }
  }

  ngOnDestroy(): void {
    this.abos.unsubscribe();
    this.cursor.ziehtSetzen(false);
  }

  /** The rungs this Subjekt has. They exist by data and by nothing else. */
  get detentliste(): Detent[] {
    return this.detentCache.get(String(this.stand), () => detents(this.eingabe, this.subjekt));
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

  onPointerDown(event: PointerEvent): void {
    this.spur?.nativeElement.setPointerCapture?.(event.pointerId);
    this.hinweis = null;
    this.cursor.ziehtSetzen(true);
    this.zielen(event.clientX);
    event.preventDefault();
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.cursor.zieht) return;
    this.zielen(event.clientX);
    event.preventDefault();
  }

  onPointerUp(): void {
    this.cursor.ziehtSetzen(false);
  }

  /**
   * Desktop, §8.1: `←`/`→` one detent, `Shift` one hour, `Space` toggles the
   * collapse. The same three writers as the thumb, through the same setter.
   */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === ' ' || event.key === 'Spacebar') {
      this.cursor.ziehtSetzen(!this.cursor.zieht);
      event.preventDefault();
      return;
    }

    const richtung = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (richtung === 0) return;

    this.hinweis = null;
    if (event.shiftKey) {
      this.setzen(this.moment + richtung * STUNDE_MS, 'frei');
    } else {
      const nachbar =
        richtung < 0
          ? [...this.detentliste].reverse().find(detent => detent.von < this.moment)
          : this.detentliste.find(detent => detent.von > this.moment);
      if (nachbar) this.setzen(nachbar.von, nachbar.anker);
    }
    event.preventDefault();
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
    this.verschoben = false;
    this.setzen(ziel, 'frei');
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
   * „dieses Ding" for `Nächster Unterschied`: the tent means everything, and
   * anything else means the rows that name it plus its own kind. A Subjekt
   * nothing points at falls back to the whole tent rather than answering „kein
   * weiterer Unterschied" while the Verlauf is full of them.
   */
  private get bezugsDinge(): readonly Ding[] {
    if (!this.subjekt || this.subjekt.art === 'zelt') return this.dinge;

    const eigene = this.dinge.filter(
      ding =>
        ding.ding_id !== this.subjekt?.ding_id &&
        (ding.art === this.subjekt?.art ||
          ding.akteur === this.subjekt?.ding_id ||
          Object.values(ding.rel ?? {}).some(ziele => ziele.includes(this.subjekt?.ding_id ?? ''))),
    );

    return eigene.length > 0 ? eigene : this.dinge;
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
      this.verschoben = false;
      this.setzen(magnet.detent.von, magnet.detent.anker);
      return;
    }

    const gelandet = aufloesen(roh, this.dinge, this.fein);
    this.verschoben = gelandet.verschoben;
    this.setzen(gelandet.von, 'frei');
  }

  private setzen(von: number, anker: Detent['anker']): void {
    const { von: unten, bis } = this.grenzen;
    this.cursor.setzen(Math.min(bis, Math.max(unten, von)), anker);
  }
}
