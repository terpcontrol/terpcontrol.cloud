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
  /** The moment `zuletzt` resolved to for the named tent, cursor or no cursor. */
  private besuch: number | null = null;
  /** The blur listener of the tent that is open, so it cannot stamp a tent nobody is looking at. */
  private horcher: (() => void) | null = null;
  /** „Jetzt", held still for the duration of a gesture and for no longer. */
  private eingefroren: number | null = null;

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
   * The moment `zuletzt` resolves to for the tent that is open - the rung, not
   * the cursor. They are two different things and the difference is a bug
   * everybody meets: drag away from `seit zuletzt` and the rung has to stay on
   * the track, or you can never drag back onto it.
   */
  public get zuletztMoment(): number | null {
    return this.besuch;
  }

  /**
   * The one „jetzt" of the cursor and of everything drawn against it.
   *
   * A slider whose right edge is a field initialiser is a slider that ends the
   * day at the moment the phone was unlocked - and a tent phone is unlocked
   * once and left on the tent screen. So this is read, never stored, and the
   * one thing that holds it still is a thumb on the handle: „nichts hat sich
   * bewegt, während du gezogen hast" is true, „es wurde nichts aufgezeichnet,
   * seit du heute Morgen aufgesperrt hast" is a false negative.
   */
  public jetzt(): number {
    return this.eingefroren ?? Date.now();
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
    this.besuchHorchen(zelt_id);
    // Resolved for the tent, not for the cursor: a reload that picks its own
    // place back up must still know when the last visit was, or the rung it
    // could return to is missing from the ladder.
    this.besuchAufloesen(zelt_id);

    const gemerkt = this.gemerkter(zelt_id);
    const vergleich = gemerkt ?? this.zuletztVergleich();
    this.strom.next(vergleich);
    return vergleich;
  }

  /**
   * Moves the cursor. Every writer - handle, Verlauf row, crosshair, `Nächster
   * Unterschied` - comes through here. `wer` names the `mensch` a `besuch`
   * cursor is measured from, so the meaning survives the walk to the next
   * Tafel and not only the number (§13.1).
   */
  public setzen(von: number, anker: Anker, wer?: string): void {
    const vergleich: Vergleich = { von: Math.round(von), anker: anker, ...(wer ? { wer: wer } : {}) };
    if (this.zelt_id) schreiben(this.sitzung, VERGLEICH_SCHLUESSEL(this.zelt_id), JSON.stringify(vergleich));
    this.strom.next(vergleich);
  }

  public ziehtSetzen(zieht: boolean): void {
    if (this.ziehen.value === zieht) return;
    // Freezing „jetzt" for the length of a gesture is what stops the ladder
    // moving under a thumb. Freezing it for the session is the bug that does.
    this.eingefroren = zieht ? Date.now() : null;
    this.ziehen.next(zieht);
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
    if (this.zelt_id) this.besuchAufloesen(this.zelt_id);
  }

  /** „since anyone was last here on this phone", written when the tab loses the tent. */
  public besuchNotieren(): void {
    if (this.zelt_id) schreiben(this.dauerhaft, BESUCH_SCHLUESSEL(this.zelt_id), String(Date.now()));
  }

  /**
   * The tent screen is gone. The cursor stays where it is - `sessionStorage`
   * keeps the place across a reload - but nothing may stamp „zuletzt hier" on
   * a tent nobody is looking at any more.
   */
  public verlassen(): void {
    if (this.horcher && typeof window !== 'undefined') window.removeEventListener('blur', this.horcher);
    this.horcher = null;
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
      if (typeof gelesen?.von !== 'number' || !Number.isFinite(gelesen.von)) return null;
      return {
        von: gelesen.von,
        anker: (gelesen.anker as Anker) ?? 'frei',
        ...(typeof gelesen.wer === 'string' && gelesen.wer ? { wer: gelesen.wer } : {}),
      };
    } catch (_fehler) {
      return null;
    }
  }

  /**
   * Where a new session starts. The person's own last visit when the session
   * can prove one, this phone's otherwise - and yesterday when neither exists,
   * because a first visit has no „last time" and must not pretend to.
   */
  private zuletztVergleich(): Vergleich {
    if (this.besuch) return { von: this.besuch, anker: 'zuletzt' };
    return { von: Date.now() - TAG_MS, anker: 'gestern' };
  }

  /** When somebody was last here, and whether „somebody" is you (§3.5). */
  private besuchAufloesen(zelt_id: string): void {
    if (this.menschBesuch) {
      this.persoenlich = true;
      this.besuch = this.menschBesuch;
      return;
    }

    this.persoenlich = false;
    const roh = Number(lesen(this.dauerhaft, BESUCH_SCHLUESSEL(zelt_id)));
    this.besuch = Number.isFinite(roh) && roh > 0 ? roh : null;
  }

  /**
   * One listener, bound to the tent that is open. The old one goes when a new
   * tent is named: a handler that reads a field would stamp „zuletzt hier" on
   * whichever tent the field happened to hold.
   */
  private besuchHorchen(zelt_id: string): void {
    if (typeof window === 'undefined') return;
    this.verlassen();
    this.horcher = (): void => schreiben(this.dauerhaft, BESUCH_SCHLUESSEL(zelt_id), String(Date.now()));
    window.addEventListener('blur', this.horcher);
  }
}
