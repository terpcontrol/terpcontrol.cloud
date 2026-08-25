import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, firstValueFrom } from 'rxjs';
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

/** One reason the server refused a Ding. Developer text, and printed as it stands. */
export interface DingProblem {
  path: string;
  message: string;
}

/**
 * What became of a write. `verbindung` is the only outcome worth trying again:
 * the other two are the server having read the entry and said no, and no amount
 * of resending changes an answer about the entry itself.
 */
export type SchreibErgebnis =
  | { ok: true; ding: Ding }
  | { ok: false; grund: 'konflikt' }
  | { ok: false; grund: 'abgelehnt'; problems: DingProblem[] }
  | { ok: false; grund: 'verbindung' };

const schreibFehler = (fehler: unknown): SchreibErgebnis => {
  const antwort = fehler as HttpErrorResponse;
  const status = typeof antwort?.status === 'number' ? antwort.status : 0;
  if (status === 409) return { ok: false, grund: 'konflikt' };
  // Status 0 is a phone with no signal; a 5xx is the server having a bad
  // minute. Neither is a statement about the entry, so both stay queued.
  if (status === 0 || status >= 500) return { ok: false, grund: 'verbindung' };
  const problems = (antwort?.error as { problems?: DingProblem[] })?.problems;
  return { ok: false, grund: 'abgelehnt', problems: problems ?? [{ path: '', message: `HTTP ${status}` }] };
};

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

  /**
   * The one write. The id travels in the body and the server upserts on it, so
   * sending the same Ding twice stores one - which is what lets a retry over a
   * bad connection be a retry rather than a second watering.
   *
   * A 409 is the opposite case and is never retried: the id is taken by a
   * *different* entry, and minting a fresh one to get past it would log the
   * pour twice. It is handed back to be said out loud.
   */
  public async schreibe(ding: Ding): Promise<SchreibErgebnis> {
    try {
      const antwort = await firstValueFrom(this.http.post<{ ding?: Ding }>(`${environment.API_URL}/api/dinge`, ding));
      return { ok: true, ding: antwort?.ding ?? ding };
    } catch (fehler) {
      return schreibFehler(fehler);
    }
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

/** Where the outbox survives a tab close. */
const AUSGANG_SCHLUESSEL = 'tc.ausgang';

/** How long the drain waits before trying again, per consecutive failure. */
const WARTEZEITEN_MS = [2000, 8000, 30000, 120000];

/** An entry the server read and refused. It is never retried and never silently dropped. */
export interface AusgangProblem {
  ding: Ding;
  grund: 'konflikt' | 'abgelehnt';
  problems?: DingProblem[];
}

/**
 * The outbox. §17 makes every write local-first: the client mints the id, the
 * entry is stored here, the row is drawn, and the drain runs afterwards - on
 * connectivity, on focus, and on a timer while it keeps failing.
 *
 * A queued item is always a create with an id of its own, so there is no
 * conflict to resolve and no order to preserve beyond the one it was typed in.
 */
@Injectable({
  providedIn: 'root',
})
export class AusgangService {
  private wartend: Ding[] = [];
  private readonly anzahl = new BehaviorSubject<number>(0);
  private readonly problem = new Subject<AusgangProblem>();
  private laeuft = false;
  private versuche = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private dinge: DingeService) {
    this.wartend = this.gelesen();
    this.anzahl.next(this.wartend.length);

    // A cellar with one bar is the case this exists for, so the two moments a
    // phone gets a connection back - the network event and the tab returning -
    // are both a reason to try again.
    window.addEventListener('online', () => void this.leeren());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.leeren();
    });

    if (this.wartend.length > 0) void this.leeren();
  }

  /** `3 Einträge warten auf Verbindung.` - the one line §17 allows. */
  public get anzahl$(): Observable<number> {
    return this.anzahl.asObservable();
  }

  public get probleme$(): Observable<AusgangProblem> {
    return this.problem.asObservable();
  }

  /** What is still queued for one tent - the double-feed guard's local half reads it. */
  public wartende(zelt_id: string): Ding[] {
    return this.wartend.filter(ding => ding.zelt_id === zelt_id);
  }

  /**
   * Local first: the entry exists the moment it is queued. The caller draws its
   * row from what comes back here, not from what the server eventually says.
   */
  public eintragen(ding: Ding): Ding {
    this.wartend = [...this.wartend, ding];
    this.gespeichert();
    void this.leeren();
    return ding;
  }

  /** Sends what is queued, oldest first, and stops at the first item the network refuses. */
  public async leeren(): Promise<void> {
    if (this.laeuft) return;
    this.laeuft = true;

    try {
      while (this.wartend.length > 0) {
        const ding = this.wartend[0];
        const ergebnis = await this.dinge.schreibe(ding);

        if (ergebnis.ok === false && ergebnis.grund === 'verbindung') {
          this.spaeter();
          return;
        }

        this.wartend = this.wartend.slice(1);
        this.gespeichert();
        this.versuche = 0;
        if (ergebnis.ok === false) {
          this.problem.next({ ding: ding, grund: ergebnis.grund, problems: ergebnis.grund === 'abgelehnt' ? ergebnis.problems : undefined });
        }
      }
    } finally {
      this.laeuft = false;
    }
  }

  private spaeter(): void {
    if (this.timer) return;
    const wartezeit = WARTEZEITEN_MS[Math.min(this.versuche, WARTEZEITEN_MS.length - 1)];
    this.versuche++;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.leeren();
    }, wartezeit);
  }

  private gespeichert(): void {
    this.anzahl.next(this.wartend.length);
    try {
      window.localStorage.setItem(AUSGANG_SCHLUESSEL, JSON.stringify(this.wartend));
    } catch (_fehler) {
      // A browser with no storage still sends what it is holding; only
      // surviving a tab close is lost, and nothing here depends on it.
    }
  }

  private gelesen(): Ding[] {
    try {
      const roh: unknown = JSON.parse(window.localStorage.getItem(AUSGANG_SCHLUESSEL) ?? '[]');
      return Array.isArray(roh) ? (roh.filter(ding => typeof ding?.ding_id === 'string') as Ding[]) : [];
    } catch (_fehler) {
      return [];
    }
  }
}
