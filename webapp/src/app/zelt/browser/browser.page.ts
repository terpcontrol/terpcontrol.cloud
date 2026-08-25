import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import type { Ding, Zelt } from '@fg2/shared-types';
import { DingeAnfrage, DingeService, MAX_SEITEN, ZelteService } from 'src/app/services/dinge.service';

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
  public dinge: Ding[] = [];
  public anfrage = '';
  public laedt = false;
  public fehler: string | null = null;

  private cursor: string | undefined;
  private zelt_id = '';
  private abo: Subscription | null = null;

  constructor(private route: ActivatedRoute, private dingeService: DingeService, private zelte: ZelteService) {}

  ngOnInit(): void {
    this.abo = this.route.paramMap.subscribe(params => {
      void this.laden(params.get('zelt_id') ?? '', params.get('ding_id'));
    });
  }

  ngOnDestroy(): void {
    this.abo?.unsubscribe();
  }

  get weitereVorhanden(): boolean {
    return this.cursor !== undefined;
  }

  /** The next page, on the server's own cursor. Nothing here builds one. */
  public async mehr(): Promise<void> {
    if (!this.cursor || this.laedt) return;

    this.laedt = true;
    try {
      const antwort = await this.dingeService.seite({ zelt_id: this.zelt_id, limit: SEITE, cursor: this.cursor });
      // A new array, not a push: the Tafel caches every list it derives and
      // watches its inputs to know when to stop.
      this.dinge = [...this.dinge, ...antwort.dinge];
      this.cursor = antwort.cursor;
    } finally {
      this.laedt = false;
    }
  }

  private async laden(zelt_id: string, ding_id: string | null): Promise<void> {
    this.zelt_id = zelt_id;
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

      this.dinge = stapel.dinge;
      this.cursor = stapel.cursor;
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
