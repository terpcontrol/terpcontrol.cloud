import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import type { Ding, DingArt, Zelt } from '@fg2/shared-types';
import { VergleichService } from 'src/app/services/vergleich.service';
import { KeyedCache } from 'src/app/util/keyed-cache';
import { Messung } from 'src/app/util/messquellen';
import { VERALTET_MS, istEintrag } from 'src/app/util/ding-text';
import { einheitVon } from 'src/app/util/einheiten';
import { formatTimeAgo } from 'src/app/util/time-ago';
import { KAPPE, UnterschiedZeile, handMessungen, unterschiedZeilen } from 'src/app/util/unterschied';
import { pluralSchluessel, zahlText } from 'src/app/util/zahl';
import { zeltTag } from 'src/app/util/zelt-tag';

/** One line of the header. It exists when its evidence exists, and is absent otherwise. */
export interface Kopffakt {
  id: string;
  key: string;
  params?: Record<string, unknown>;
  /** `● Online` / `● Offline` carries a dot; nothing else does. */
  punkt?: 'online' | 'offline';
}

/** One row of the table, with the grey suffix its name carries: `Höhe (cm)`, `Temperatur (°C · Controller)`. */
export interface TabellenZeile extends UnterschiedZeile {
  zusatz: string;
}

/** One row of the Verlauf, and whether the Vorher hairline is drawn above it. */
export interface VerlaufZeile {
  ding: Ding;
  /** Rows older than the cursor are dimmed, never dropped. */
  gedimmt: boolean;
  /** The `───── Vorher · Fr 22.08. 14:02 ─────` rule, drawn once. */
  trenner: boolean;
}

/** The things that are in the tent right now, rather than things that happened. */
const IM_ZELT_ARTEN: DingArt[] = ['pflanze', 'geraet', 'dose', 'kamera', 'schema'];

/** A day, for the "there is nothing older to compare against" default. */
const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * How often the screen re-reads the clock. `● Online · Werte von gerade eben`
 * is a claim about right now, and a screen left open on a tent that went
 * offline used to keep making it - the dot stayed green because `Date.now()`
 * had been read once, on entry.
 */
const TAKT_MS = 30 * 1000;

/**
 * The detail view of one Ding: header, body, and the four sections - `Offen`,
 * `Der Unterschied`, `Im Zelt`, `Verlauf`.
 *
 * There is one of these and it renders every Subjekt in the product. With
 * `ding_id` absent the Subjekt is the tent itself, and that is the only thing
 * the route decides.
 *
 * **There is no branch on whether the tent has a device.** The three
 * device-only arts (`geraet`, `dose`, `kamera`) simply project no rows without
 * one, so their sections come up shorter - not greyed, not stubbed, not
 * counted. A control whose only effect is to show that a feature class is
 * hidden is a mode, and this component has none.
 */
@Component({
  selector: 'app-tafel',
  templateUrl: './tafel.component.html',
  styleUrls: ['./tafel.component.scss'],
})
export class TafelComponent implements OnInit, OnChanges, OnDestroy {
  @Input() zelt!: Zelt;
  @Input() subjekt: Ding | null = null;
  /** Everything read for this screen, newest first, exactly as the server merged it. */
  @Input() dinge: readonly Ding[] = [];
  /** The literal request behind the screen, for `Werte {…}`. */
  @Input() anfrage = '';
  /** True while the server is still handing out cursors. */
  @Input() weitereVorhanden = false;
  @Input() laedt = false;
  /**
   * Series readings, when something measured any. They come from
   * `GET /api/reihen`, never from the Dinge, and they arrive as readings with
   * their origin attached so two devices reporting one measure stay two rows.
   */
  @Input() geraetMessungen: readonly Messung[] = [];
  @Input() geraetMessungenVorher: readonly Messung[] = [];
  /**
   * An explicit override of what `Vorher` means, for a caller that has to name
   * the moment itself. Left alone - which is the normal case - the moment comes
   * from the one cursor in `VergleichService`, and the Zeitgriff below the
   * header is what moves it.
   */
  @Input() vergleichVon: number | null = null;

  @Output() mehr = new EventEmitter<void>();

  public tabelleOffen = false;
  /** True while a thumb is on the handle. Motion collapses, rest unfolds (M3). */
  public zieht = false;

  private stand = 0;
  /**
   * The default `Vorher`, resolved once when the screen is entered rather than
   * on every read: a moment that slides while you look at it is not a moment,
   * and change detection would see a different screen on every pass.
   */
  private readonly standardVergleich = Date.now() - TAG_MS;
  private readonly offenCache = new KeyedCache<Ding[]>();
  private readonly imZeltCache = new KeyedCache<Ding[]>();
  private readonly verlaufCache = new KeyedCache<VerlaufZeile[]>();
  private readonly kopfCache = new KeyedCache<Kopffakt[]>();
  private readonly unterschiedCache = new KeyedCache<UnterschiedZeile[]>();
  private readonly tabelleCache = new KeyedCache<TabellenZeile[]>();
  private readonly messungenCache = new KeyedCache<Messung[]>();
  private readonly abos = new Subscription();
  /** The shared cursor, as it stands. `null` until a screen has named its tent. */
  private cursorVon: number | null = null;

  /** Now, re-read on a timer. Every relative time and every stale mark on the screen follows it. */
  public jetzt = Date.now();

  constructor(private cursor: VergleichService, private translate: TranslateService) {}

  ngOnInit(): void {
    this.abos.add(this.cursor.vergleich$.subscribe(vergleich => (this.cursorVon = vergleich?.von ?? null)));
    this.abos.add(this.cursor.zieht$.subscribe(zieht => (this.zieht = zieht)));
    this.abos.add(
      interval(TAKT_MS).subscribe(() => {
        this.jetzt = Date.now();
        // The derived lists are keyed on this counter; the header and the marks
        // are what actually change, and they are cheap to rebuild.
        this.stand++;
      }),
    );
  }

  ngOnDestroy(): void {
    this.abos.unsubscribe();
  }

  ngOnChanges(): void {
    // Every list below is derived, and change detection asks for them on every
    // cycle. One counter per input change is what stops a re-read rebuilding
    // rows that did not change.
    this.stand++;
  }

  get vergleichMoment(): number {
    return this.vergleichVon ?? this.cursorVon ?? this.standardVergleich;
  }

  /**
   * §8.1's second projection, the write half: „tapping any row sets the cursor
   * to that row's time", which is how you ask „was ist seit dieser Gabe
   * passiert?" in one move. The row itself still walks to its own Tafel, so the
   * two answers a row can give stay two targets.
   */
  vorherHier(ding: Ding): void {
    this.cursor.setzen(ding.t, 'frei');
  }

  /** The Subjekt's own name, in the reader's language. An unnamed tent is still a tent. */
  get titel(): string {
    return this.subjekt?.name?.trim() || this.zelt?.name?.trim() || '';
  }

  /**
   * The header, as facts. `● Online · Werte von vor 40 Sek · Tag 34` and
   * `Tag 34 · 14 Einträge · zuletzt vor 2 Std` are the same list with different
   * members: the online fact exists when something is reporting, and does not
   * when nothing is.
   */
  get kopf(): Kopffakt[] {
    return this.kopfCache.get(String(this.stand), () => this.kopfBauen());
  }

  /** `Offen` - the Zettel on the tent door. Absent when empty (§6.1). */
  get offen(): Ding[] {
    return this.offenCache.get(String(this.stand), () =>
      this.dinge.filter(ding => ding.art === 'zustand' && ding.t_ende === null && !ding.storniert_von && !ding.d?.['geschlossen_von']),
    );
  }

  /** `Im Zelt` - what is in there now. Six of nine projections return nothing without a device. */
  get imZelt(): Ding[] {
    return this.imZeltCache.get(String(this.stand), () =>
      this.dinge.filter(ding => IM_ZELT_ARTEN.includes(ding.art) && ding.ding_id !== this.subjekt?.ding_id && !ding.storniert_von),
    );
  }

  /**
   * `Verlauf` - what happened, newest first, with the Vorher hairline drawn at
   * the cursor. Everything below it is dimmed rather than hidden: the moment
   * you are comparing against is printed, and so is what is on the far side of
   * it.
   */
  get verlauf(): VerlaufZeile[] {
    return this.verlaufCache.get(`${this.stand}:${this.vergleichMoment}`, () => {
      const moment = this.vergleichMoment;
      const obenSchon = new Set(this.offen.map(ding => ding.ding_id));
      let getrennt = false;

      return this.dinge
        .filter(
          ding =>
            !IM_ZELT_ARTEN.includes(ding.art) &&
            ding.art !== 'zelt' &&
            ding.ding_id !== this.subjekt?.ding_id &&
            // A cancelled entry is gone from `Wasser gesamt` and from every
            // other list in the product; leaving it standing here is the one
            // place a corrected watering still counts.
            !ding.storniert_von &&
            // An open Zettel already has a row at the top of the screen; the
            // history is what happened, not a second copy of what is standing.
            !obenSchon.has(ding.ding_id),
        )
        .map(ding => {
          const davor = ding.t < moment;
          const trenner = davor && !getrennt;
          getrennt = getrennt || davor;
          return { ding: ding, gedimmt: davor, trenner: trenner };
        });
    });
  }

  /**
   * Every reading behind the screen, for `Werte {…}` - hand and device in one
   * list, kept apart by their origin rather than by which half they came from.
   */
  get messungen(): Messung[] {
    return this.messungenCache.get(String(this.stand), () => [...handMessungen(this.dinge), ...this.geraetMessungen]);
  }

  get unterschied(): UnterschiedZeile[] {
    return this.unterschiedCache.get(`${this.stand}:${this.vergleichMoment}`, () =>
      unterschiedZeilen({
        vorher: this.dinge.filter(ding => ding.t <= this.vergleichMoment),
        jetzt: [...this.dinge],
        messungenVorher: this.geraetMessungenVorher,
        messungenJetzt: this.geraetMessungen,
      }),
    );
  }

  /** §6.3: eleven rows, then a Zeile that expands in place. */
  get sichtbareZeilen(): TabellenZeile[] {
    return this.tabelleCache.get(`${this.stand}:${this.vergleichMoment}:${this.tabelleOffen}`, () =>
      (this.tabelleOffen ? this.unterschied : this.unterschied.slice(0, KAPPE)).map(zeile => ({
        ...zeile,
        zusatz: this.zusatz(zeile),
      })),
    );
  }

  get verborgeneZeilen(): number {
    return Math.max(0, this.unterschied.length - KAPPE);
  }

  /** `{{anzahl}} weitere Zeilen`, in the form the count needs. */
  get mehrZeilenSchluessel(): string {
    return pluralSchluessel('zelt.mehrZeilen', this.verborgeneZeilen);
  }

  get mehrZeilenParams(): Record<string, string> {
    return { anzahl: zahlText(this.verborgeneZeilen, 0) };
  }

  /**
   * Day one: a tent that exists and nothing else. §9.2 rank 8e - the screen
   * says so in one sentence instead of drawing three labelled sections with
   * nothing under them.
   */
  get tagEins(): boolean {
    return !this.offen.length && !this.imZelt.length && !this.verlauf.length && !this.unterschied.length;
  }

  /**
   * The grey half of a table row's name: its unit, and the instrument when a
   * measure has two of them. `48` is a number, `48 cm` is a height.
   */
  private zusatz(zeile: UnterschiedZeile): string {
    const teile = [einheitVon(zeile.mass)];
    if (zeile.herkunftZeigen) {
      teile.push(zeile.herkunft?.geraet_name || this.translate.instant('zelt.werte.vonHand'));
    }
    return teile.filter(Boolean).join(' · ');
  }

  trackDing(_index: number, ding: Ding): string {
    return ding.ding_id;
  }

  trackVerlauf(_index: number, zeile: VerlaufZeile): string {
    return zeile.ding.ding_id;
  }

  trackZeile(_index: number, zeile: UnterschiedZeile): string {
    return zeile.id;
  }

  trackFakt(_index: number, fakt: Kopffakt): string {
    return fakt.id;
  }

  tabelleUmschalten(): void {
    this.tabelleOffen = !this.tabelleOffen;
  }

  private kopfBauen(): Kopffakt[] {
    const jetzt = this.jetzt;
    const fakten: Kopffakt[] = [];

    // Something reporting is what makes online a meaningful word. Nothing
    // reporting is not "offline"; it is a tent, and the header says so with the
    // facts it does have.
    const melder = this.dinge.filter(ding => ding.art === 'geraet' && ding.t_ende === null);
    const gehoert = melder
      .map(ding => (typeof ding.d?.['zuletzt_gesehen'] === 'number' ? (ding.d['zuletzt_gesehen'] as number) : 0))
      .filter(t => t > 0);

    if (gehoert.length > 0) {
      const zuletzt = Math.max(...gehoert);
      const online = jetzt - zuletzt <= VERALTET_MS;
      fakten.push({
        id: 'verbindung',
        key: online ? 'zelt.kopf.online' : 'zelt.kopf.offline',
        params: { seit: formatTimeAgo(zuletzt) },
        punkt: online ? 'online' : 'offline',
      });
    }

    if (this.zelt) {
      fakten.push({ id: 'tag', key: 'zelt.tag', params: { tag: zeltTag(this.zelt, this.dinge, jetzt) } });
    }

    // What a reader counts as an entry is what somebody wrote: waterings,
    // notes, photographs, events, phase changes and Zettel. The tent itself,
    // its plants, its sockets and its setpoints are not entries, and
    // `dinge.length` is the page size besides - it read `200 Einträge` the
    // moment anybody tapped `Weitere laden`.
    // Day one has nothing to count, and `0 Einträge` is the kind of empty
    // meter §6 forbids: an absent fact is an absent fact.
    const eintraege = this.dinge.filter(istEintrag).length;
    if (eintraege > 0) {
      fakten.push({
        id: 'eintraege',
        // More pages behind the cursor means this is what has been read so far
        // and not what there is - `24+ Einträge` says exactly that.
        key: this.weitereVorhanden ? 'zelt.kopf.eintraegeMehr' : pluralSchluessel('zelt.kopf.eintraege', eintraege),
        params: { anzahl: zahlText(eintraege, 0) },
      });
    }

    const neustes = this.dinge.filter(istEintrag).reduce((groesstes, ding) => Math.max(groesstes, ding.t), 0);
    if (neustes > 0) {
      fakten.push({ id: 'zuletzt', key: 'zelt.kopf.zuletzt', params: { zeit: formatTimeAgo(neustes) } });
    }

    return fakten;
  }
}
