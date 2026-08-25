import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Anker, Vergleich } from 'src/app/util/vergleich';

const TAG_MS = 24 * 60 * 60 * 1000;

/** §3.5 - the cursor of a tent, for as long as the tab is open. */
const VERGLEICH_SCHLUESSEL = (zelt_id: string): string => `tc-vergleich-${zelt_id}`;

/** §3.5 - „seit dem letzten Besuch auf diesem Gerät". This one *does* outlive the session. */
const BESUCH_SCHLUESSEL = (zelt_id: string): string => `tc-zuletzt-${zelt_id}`;

const lesen = (speicher: Storage | null, schluessel: string): string | null => {
  try {
    return speicher?.getItem(schluessel) ?? null;
  } catch (_fehler) {
    // Private mode, a locked-down browser, an embedded webview. A cursor that
    // cannot be remembered is not a reason to have no cursor.
    return null;
  }
};

const schreiben = (speicher: Storage | null, schluessel: string, wert: string): void => {
  try {
    speicher?.setItem(schluessel, wert);
  } catch (_fehler) {
    // Same, and just as unremarkable.
  }
};

/**
 * The one cursor. §3.5:
 *
 * > `VergleichService`, a `BehaviorSubject`, mirrored to
 * > `sessionStorage['tc-vergleich-<zelt_id>']` so a reload keeps your place.
 * > **Not `localStorage`.** A new session always starts at `zuletzt`.
 *
 * Its state is a **moment**, never a duration: „Vorher = Freitag 14:02" is one
 * question, and the tent, a plant, a socket, a target and a person each answer
 * it against their own rows. Which is why nothing here knows about arts - a
 * Tafel resolves what the moment means for its own Subjekt.
 *
 * It is not a device feature. A tent with `geraete: []` has entries,
 * photographs, phases and hand measurements to compare across, and the cursor
 * reaches all of them.
 */
@Injectable({
  providedIn: 'root',
})
export class VergleichService {
  private readonly strom = new BehaviorSubject<Vergleich | null>(null);
  private readonly ziehen = new BehaviorSubject<boolean>(false);

  private zelt_id = '';
  private persoenlich = false;
  /** A `mensch` write token's server-side last visit (§13.5), when the session carries one. */
  private menschBesuch: number | null = null;
  private horcht = false;

  /** What `Vorher` means right now. `null` until a screen has named its tent. */
  public readonly vergleich$: Observable<Vergleich | null> = this.strom.asObservable();

  /**
   * Whether a thumb is on the handle. Everything that would reflow under it
   * reads this and collapses to a reserved height instead (M3).
   */
  public readonly zieht$: Observable<boolean> = this.ziehen.asObservable();

  public get wert(): Vergleich | null {
    return this.strom.value;
  }

  public get zieht(): boolean {
    return this.ziehen.value;
  }

  /** Whether `zuletzt` is *this person's* last visit rather than this phone's. §3.5. */
  public get zuletztPersoenlich(): boolean {
    return this.persoenlich;
  }

  /**
   * Names the tent the cursor is for. Walking from the tent to a plant and on
   * to a socket calls this three times with the same id and the cursor does not
   * move once - that is the whole point of it being one cursor.
   */
  public fuerZelt(zelt_id: string): Vergleich {
    if (!zelt_id) return this.strom.value ?? { von: Date.now() - TAG_MS, anker: 'gestern' };
    if (this.zelt_id === zelt_id && this.strom.value) return this.strom.value;

    this.zelt_id = zelt_id;
    this.besuchHorchen();

    const gemerkt = this.gemerkter(zelt_id);
    const vergleich = gemerkt ?? this.zuletztVergleich(zelt_id);
    this.strom.next(vergleich);
    return vergleich;
  }

  /** Moves the cursor. Every writer - handle, Verlauf row, crosshair, `Nächster Unterschied` - comes through here. */
  public setzen(von: number, anker: Anker): void {
    const vergleich: Vergleich = { von: Math.round(von), anker: anker };
    if (this.zelt_id) schreiben(this.sitzung, VERGLEICH_SCHLUESSEL(this.zelt_id), JSON.stringify(vergleich));
    this.strom.next(vergleich);
  }

  public ziehtSetzen(zieht: boolean): void {
    if (this.ziehen.value !== zieht) this.ziehen.next(zieht);
  }

  /** The chart's window: from the cursor to now, both ends of the same moment. */
  public fenster(jetzt: number = Date.now()): [number, number] {
    return [this.strom.value?.von ?? jetzt - TAG_MS, jetzt];
  }

  /**
   * The last visit this person made, from a `mensch` write token. Setting it
   * changes both the moment `zuletzt` resolves to and the words the detent
   * uses, because „seit deinem letzten Besuch" and „seit dem letzten Besuch auf
   * diesem Gerät" are not the same claim.
   */
  public menschBesuchSetzen(t: number | null): void {
    this.menschBesuch = t;
  }

  /** „since anyone was last here on this phone", written when the tab loses the tent. */
  public besuchNotieren(): void {
    if (this.zelt_id) schreiben(this.dauerhaft, BESUCH_SCHLUESSEL(this.zelt_id), String(Date.now()));
  }

  private get sitzung(): Storage | null {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  }

  private get dauerhaft(): Storage | null {
    return typeof localStorage === 'undefined' ? null : localStorage;
  }

  private gemerkter(zelt_id: string): Vergleich | null {
    const roh = lesen(this.sitzung, VERGLEICH_SCHLUESSEL(zelt_id));
    if (!roh) return null;

    try {
      const gelesen = JSON.parse(roh) as Partial<Vergleich>;
      return typeof gelesen?.von === 'number' && Number.isFinite(gelesen.von)
        ? { von: gelesen.von, anker: (gelesen.anker as Anker) ?? 'frei' }
        : null;
    } catch (_fehler) {
      return null;
    }
  }

  /**
   * Where a new session starts. The person's own last visit when the session
   * can prove one, this phone's otherwise - and yesterday when neither exists,
   * because a first visit has no „last time" and must not pretend to.
   */
  private zuletztVergleich(zelt_id: string): Vergleich {
    if (this.menschBesuch) {
      this.persoenlich = true;
      return { von: this.menschBesuch, anker: 'zuletzt' };
    }

    this.persoenlich = false;
    const roh = Number(lesen(this.dauerhaft, BESUCH_SCHLUESSEL(zelt_id)));
    if (Number.isFinite(roh) && roh > 0) return { von: roh, anker: 'zuletzt' };

    return { von: Date.now() - TAG_MS, anker: 'gestern' };
  }

  private besuchHorchen(): void {
    if (this.horcht || typeof window === 'undefined') return;
    this.horcht = true;
    window.addEventListener('blur', () => this.besuchNotieren());
  }
}
