import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';
import type { Ding, DingArt, DingeSeite, Zelt } from '@fg2/shared-types';

export interface DingeAnfrage {
  zelt_id: string;
  /** Omitted means every art. A tent with no device asks for the same arts and gets fewer rows. */
  arten?: DingArt[];
  von?: number;
  bis?: number;
  /** Opaque, straight from the previous page. */
  cursor?: string;
  limit?: number;
}

/** Everything a caller paged, and whether the server had stopped handing out cursors. */
export interface DingeStapel {
  dinge: Ding[];
  /** Set when the walk stopped at `maxSeiten` rather than at the end of the list. */
  cursor?: string;
  vollstaendig: boolean;
}

/**
 * A deep link names a `ding_id` but `GET /api/dinge` reads lists, not single
 * rows, so resolving one means walking pages. Ten of them is a hundred times the
 * default page and further than any tent a person scrolls; past that the Tafel
 * says it could not find the row rather than paging forever.
 */
export const MAX_SEITEN = 10;

@Injectable({
  providedIn: 'root',
})
export class DingeService {
  constructor(private http: HttpClient) {}

  /**
   * One page, exactly as the server hands it out. The cursor is passed back
   * verbatim: it carries the sort key the server pages on and is not ours to
   * take apart, so nothing here parses, rebuilds or invents one.
   */
  public seite(anfrage: DingeAnfrage): Promise<DingeSeite> {
    return firstValueFrom(this.http.get<DingeSeite>(`${environment.API_URL}/api/dinge`, { params: this.params(anfrage) }));
  }

  /**
   * Follows the server's cursor. `stop` lets a caller quit as soon as it has
   * what it came for - resolving one Ding does not need the rest of the grow.
   */
  public async stapel(anfrage: DingeAnfrage, maxSeiten = MAX_SEITEN, stop?: (dinge: Ding[]) => boolean): Promise<DingeStapel> {
    const dinge: Ding[] = [];
    let cursor = anfrage.cursor;

    for (let seite = 0; seite < maxSeiten; seite++) {
      const antwort = await this.seite({ ...anfrage, cursor: cursor });
      dinge.push(...antwort.dinge);
      cursor = antwort.cursor;

      // No cursor is how the server says that was the last page.
      if (!cursor || stop?.(dinge)) {
        return { dinge: dinge, cursor: cursor, vollstaendig: !cursor };
      }
    }

    return { dinge: dinge, cursor: cursor, vollstaendig: false };
  }

  /** The literal request that produced a screen, which is what `Werte {…}` prints. */
  public anfrageUrl(anfrage: DingeAnfrage): string {
    const query = this.params(anfrage).toString();
    return `GET ${environment.API_URL}/api/dinge${query ? `?${query}` : ''}`;
  }

  private params(anfrage: DingeAnfrage): HttpParams {
    let params = new HttpParams().set('zelt_id', anfrage.zelt_id);
    if (anfrage.arten?.length) params = params.set('art', anfrage.arten.join(','));
    if (anfrage.von !== undefined) params = params.set('von', String(anfrage.von));
    if (anfrage.bis !== undefined) params = params.set('bis', String(anfrage.bis));
    if (anfrage.limit !== undefined) params = params.set('limit', String(anfrage.limit));
    if (anfrage.cursor) params = params.set('cursor', anfrage.cursor);
    return params;
  }
}

@Injectable({
  providedIn: 'root',
})
export class ZelteService {
  constructor(private http: HttpClient) {}

  public zelte(): Promise<Zelt[]> {
    return firstValueFrom(this.http.get<Zelt[]>(`${environment.API_URL}/api/zelte`));
  }

  public zelt(zelt_id: string): Promise<Zelt> {
    return firstValueFrom(this.http.get<Zelt>(`${environment.API_URL}/api/zelte/${encodeURIComponent(zelt_id)}`));
  }
}
