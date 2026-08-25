import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import type { Ding, Zelt } from '@fg2/shared-types';
import { DingeAnfrage, DingeService, MAX_SEITEN, ZelteService } from 'src/app/services/dinge.service';
import { VergleichService } from 'src/app/services/vergleich.service';

/** One page of Dinge. Big enough that a normal tent needs one request, small enough to arrive fast. */
const SEITE = 100;

/**
 * `/z/:zelt_id/:ding_id?` - the browser. It reads the route, reads the tent and
 * one page of its Dinge, and hands both to the Tafel. There is nothing else to
 * decide: which Ding is the Subjekt is the only thing the URL says, and with
 * `ding_id` absent it is the tent itself.
 */
@Component({
  selector: 'app-browser',
  templateUrl: './browser.page.html',
  styleUrls: ['./browser.page.scss'],
})
export class BrowserPage implements OnInit, OnDestroy {
  public zelt: Zelt | null = null;
  public subjekt: Ding | null = null;
  /** What the screen shows: the pages the server handed out, plus what was written here. */
  public dinge: Ding[] = [];
  public anfrage = '';
  public laedt = false;
  public fehler: string | null = null;

  /** The server's own pages, in the order it merged them. */
  private geladen: Ding[] = [];
  /**
   * Entries written on this screen that the server has not handed back yet.
   * They are kept apart from the read pages because the next cursor and a
   * refresh both replace those, and a queued watering exists nowhere else.
   */
  private eigene: Ding[] = [];
  private cursor: string | undefined;
  private zelt_id = '';
  private ding_id: string | null = null;
  private abo: Subscription | null = null;

  constructor(
    private route: ActivatedRoute,
    private dingeService: DingeService,
    private zelte: ZelteService,
    private vergleich: VergleichService,
  ) {}

  ngOnInit(): void {
    this.abo = this.route.paramMap.subscribe(params => {
      void this.laden(params.get('zelt_id') ?? '', params.get('ding_id'));
    });
  }

  ngOnDestroy(): void {
    this.abo?.unsubscribe();
    // The cursor outlives the screen on purpose - a reload keeps your place -
    // but its blur listener must not, or a tab losing focus stamps „zuletzt
    // hier" on a tent nobody is looking at.
    this.vergleich.verlassen();
  }

  get weitereVorhanden(): boolean {
    return this.cursor !== undefined;
  }

  /** Nothing on the screen yet, and a request out. The one moment a spinner is the truth. */
  get leerUndLaedt(): boolean {
    return this.laedt && !this.zelt;
  }

  /** The retry behind the error, and the pull-to-refresh gesture, are the same read. */
  public async erneut(ereignis?: { target?: { complete: () => void } }): Promise<void> {
    try {
      await this.laden(this.zelt_id, this.ding_id);
    } finally {
      ereignis?.target?.complete();
    }
  }

  /** The next page, on the server's own cursor. Nothing here builds one. */
  public async mehr(): Promise<void> {
    if (!this.cursor || this.laedt) return;

    this.laedt = true;
    try {
      const antwort = await this.dingeService.seite({ zelt_id: this.zelt_id, limit: SEITE, cursor: this.cursor });
      this.geladen = [...this.geladen, ...antwort.dinge];
      this.cursor = antwort.cursor;
      this.zusammenstellen();
    } finally {
      this.laedt = false;
    }
  }

  /**
   * A Ding the sheet just wrote. It is queued, not stored, so the page adopts
   * it: the Tafel drew it, but the list is this page's, and both the next
   * cursor and a pull-to-refresh replace what the server said.
   */
  public aufnehmen(ding: Ding): void {
    this.eigene = [ding, ...this.eigene.filter(eigen => eigen.ding_id !== ding.ding_id)];
    this.zusammenstellen();
  }

  private async laden(zelt_id: string, ding_id: string | null): Promise<void> {
    // Another tent's queued entries are not this screen's rows.
    if (zelt_id !== this.zelt_id) this.eigene = [];
    this.zelt_id = zelt_id;
    this.ding_id = ding_id;
    this.laedt = true;
    this.fehler = null;

    try {
      this.zelt = await this.zelte.zelt(zelt_id);

      const anfrage: DingeAnfrage = { zelt_id: zelt_id, limit: SEITE };
      this.anfrage = this.dingeService.anfrageUrl(anfrage);

      // A deep link names a Ding the first page may not hold, and the read API
      // has no by-id route, so the only way to resolve one is to walk pages
      // until it turns up. Without a `ding_id` the first page is the screen.
      const stapel = await this.dingeService.stapel(anfrage, ding_id ? MAX_SEITEN : 1, dinge =>
        ding_id ? dinge.some(ding => ding.ding_id === ding_id) : true,
      );

      this.geladen = stapel.dinge;
      this.cursor = stapel.cursor;
      this.zusammenstellen();
      this.subjekt = this.subjektAus(ding_id);
    } catch (_fehler) {
      this.fehler = 'zelt.nichtGeladen';
      this.zelt = null;
      this.subjekt = null;
    } finally {
      this.laedt = false;
    }
  }

  /**
   * One list out of two. A locally written entry drops out the moment the
   * server hands the same `ding_id` back, which it will: the id travels with
   * the write, so the stored row and the queued one are the same row.
   *
   * A new array rather than a push, because the Tafel caches every list it
   * derives and watches its inputs to know when to stop.
   */
  private zusammenstellen(): void {
    const gelesen = new Set(this.geladen.map(ding => ding.ding_id));
    this.eigene = this.eigene.filter(ding => !gelesen.has(ding.ding_id));
    this.dinge = [...this.eigene, ...this.geladen];
  }

  /**
   * With a `ding_id` the Subjekt is that Ding. Without one it is the tent, and
   * the tent projects a row of its own - so the projection is preferred and the
   * locally built row is only there for a window that did not reach day one.
   */
  private subjektAus(ding_id: string | null): Ding | null {
    if (ding_id) return this.dinge.find(ding => ding.ding_id === ding_id) ?? null;

    return (
      this.dinge.find(ding => ding.art === 'zelt') ??
      (this.zelt
        ? {
            ding_id: `zelt:${this.zelt.zelt_id}`,
            zelt_id: this.zelt.zelt_id,
            art: 'zelt' as const,
            name: this.zelt.name ?? '',
            t: this.zelt.tag_null,
            t_ende: null,
            d: { zeitzone: this.zelt.zeitzone, medium: this.zelt.d?.medium },
          }
        : null)
    );
  }
}
