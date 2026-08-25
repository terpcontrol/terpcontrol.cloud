import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import type { Ding, Zelt } from '@fg2/shared-types';
import { VergleichService } from 'src/app/services/vergleich.service';
import { TafelComponent } from '../tafel/tafel.component';
import { ZeltModule } from '../zelt.module';
import { ZeitgriffComponent } from './zeitgriff.component';

const TAG = 24 * 3600 * 1000;
const STUNDE = 3600 * 1000;

/** A tent, a grow, a diary, and no hardware anywhere. Everything below is this tent. */
const ohneGeraet: Zelt = {
  zelt_id: 'z1',
  besitzer_id: 'u1',
  name: 'Zelt Keller',
  geraete: [],
  zeitzone: 'Europe/Berlin',
  tag_null: Date.now() - 33 * TAG,
  erstellt_at: Date.now() - 33 * TAG,
};

const dinge = (): Ding[] => {
  const jetzt = Date.now();
  return [
    { ding_id: 'zelt:z1', zelt_id: 'z1', art: 'zelt', name: 'Zelt Keller', t: ohneGeraet.tag_null, t_ende: null, d: {} },
    { ding_id: 'g1', zelt_id: 'z1', art: 'gabe', name: '', t: jetzt - 2 * STUNDE, d: { wasser_l: 2, messwerte: { ph: 6.2 } } },
    { ding_id: 'n1', zelt_id: 'z1', art: 'notiz', name: '', t: jetzt - 26 * STUNDE, d: { text: 'untere Blätter gelb', messwerte: { hoehe_cm: 48 } } },
    { ding_id: 'b1', zelt_id: 'z1', art: 'bild', name: '', t: jetzt - 3 * TAG, d: { quelle: 'hand' } },
    { ding_id: 'p1', zelt_id: 'z1', art: 'pflanze', name: 'A1 · Gorilla Glue', t: jetzt - 30 * TAG, d: { sorte: 'Gorilla Glue' } },
  ];
};

const tafelBauen = (subjekt_id: string): ComponentFixture<TafelComponent> => {
  const fixture = TestBed.createComponent(TafelComponent);
  const component = fixture.componentInstance;
  component.zelt = ohneGeraet;
  component.dinge = dinge();
  component.subjekt = component.dinge.find(ding => ding.ding_id === subjekt_id) ?? null;
  fixture.detectChanges();
  return fixture;
};

/** The `Der Unterschied` section, which is what collapses under a moving thumb. */
const unterschiedAbschnitt = (element: HTMLElement): HTMLElement =>
  Array.from(element.querySelectorAll<HTMLElement>('.tafel-abschnitt')).find(abschnitt =>
    abschnitt.querySelector('.tafel-abschnitt-titel')?.textContent?.includes('unterschied'),
  ) as HTMLElement;

describe('the Zeitgriff on a tent with no device', () => {
  let fixture: ComponentFixture<TafelComponent>;
  let element: HTMLElement;
  let cursor: VergleichService;

  beforeEach(waitForAsync(() => {
    sessionStorage.clear();
    localStorage.removeItem('tc-zuletzt-z1');
    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  beforeEach(() => {
    cursor = TestBed.inject(VergleichService);
    fixture = tafelBauen('zelt:z1');
    element = fixture.nativeElement;
  });

  afterEach(() => sessionStorage.clear());

  it('is there, in the same place, with no hardware anywhere', () => {
    const griff = element.querySelector('tc-zeitgriff');
    expect(griff).toBeTruthy();
    // §8.1: directly under the sentence block, before every section - and the
    // sentence block is there at this density too, because rank 8 always writes
    // one.
    expect(element.querySelector('.tafel-satz')?.nextElementSibling).toBe(griff as Element);
  });

  it('is not a device feature: nothing greyed, nothing disabled, no padlock', () => {
    expect(element.querySelectorAll('tc-zeitgriff [disabled]').length).toBe(0);
    expect(element.querySelector('tc-zeitgriff')?.getAttribute('hidden')).toBeNull();
    expect(element.querySelectorAll('.griff-detent').length).toBeGreaterThan(1);
  });

  it('draws a Dichteband with a bar per day', () => {
    expect(element.querySelectorAll('.griff-band rect').length).toBeGreaterThan(2);
  });

  it('moves `Vorher` when a row hands it a moment, and dims what is older', () => {
    const gabe = fixture.componentInstance.dinge.find(ding => ding.ding_id === 'g1') as Ding;
    fixture.componentInstance.vorherHier(gabe);
    fixture.detectChanges();

    expect(cursor.wert?.von).toBe(gabe.t);
    expect(fixture.componentInstance.vergleichMoment).toBe(gabe.t);

    // Everything older than that Gabe is below the hairline now, and the row it
    // was set from is not: it is the moment, not something before it.
    const verlauf = fixture.componentInstance.verlauf;
    expect(verlauf.filter(zeile => zeile.gedimmt).map(zeile => zeile.ding.ding_id)).toEqual(['n1', 'b1']);
    expect(verlauf.filter(zeile => zeile.trenner).length).toBe(1);
    expect(element.querySelector('.tafel-trenner')).toBeTruthy();
  });

  it('reserves the height of the diff table while the thumb is on the handle', () => {
    // A moment with something around it, so the unfolded state has rows to lose.
    const notiz = fixture.componentInstance.dinge.find(ding => ding.ding_id === 'n1') as Ding;
    cursor.setzen(notiz.t, 'frei');
    fixture.detectChanges();

    const abschnitt = unterschiedAbschnitt(element);
    const ruhend = abschnitt.getBoundingClientRect().height;
    expect(ruhend).toBeGreaterThan(44);

    cursor.ziehtSetzen(true);
    fixture.detectChanges();

    expect(abschnitt.style.height).toBe(`${ruhend}px`);
    expect(abschnitt.getBoundingClientRect().height).toBe(ruhend);
    // Collapsed to the two-line scrub header, and the rows really are gone.
    expect(abschnitt.querySelectorAll('.tafel-zeile').length).toBe(0);
    expect(abschnitt.querySelector('.lage--scrub')).toBeTruthy();

    cursor.ziehtSetzen(false);
    fixture.detectChanges();

    expect(abschnitt.style.height).toBe('');
    expect(abschnitt.querySelectorAll('.tafel-zeile').length).toBeGreaterThan(0);
    // On release it unfolds and gains the rows that need a deliberate stop.
    expect(abschnitt.querySelector('.lage-satz')).toBeTruthy();
  });

  it('steps to the next moment at which something changed', () => {
    const alle = fixture.componentInstance.dinge;
    const foto = alle.find(ding => ding.ding_id === 'b1') as Ding;
    const notiz = alle.find(ding => ding.ding_id === 'n1') as Ding;

    cursor.setzen(foto.t, 'foto');
    fixture.detectChanges();

    (element.querySelector('.griff-naechster') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(cursor.wert?.von).toBe(notiz.t);
    expect(element.querySelector('.griff-hinweis')).toBeNull();
  });

  it('says so and stays put when there is no next difference', () => {
    cursor.setzen(Date.now(), 'frei');
    fixture.detectChanges();
    const stand = cursor.wert?.von;

    (element.querySelector('.griff-naechster') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(cursor.wert?.von).toBe(stand);
    expect(element.querySelector('.griff-hinweis')?.textContent).toContain('keinUnterschied');
  });

  it('keeps the cursor across a walk from one Tafel to another', () => {
    const ziel = Date.now() - 4 * TAG;
    cursor.setzen(ziel, 'frei');
    fixture.detectChanges();
    fixture.destroy();

    const pflanze = tafelBauen('p1');
    expect(pflanze.componentInstance.vergleichMoment).toBe(ziel);
    expect((pflanze.nativeElement as HTMLElement).querySelector('tc-zeitgriff')).toBeTruthy();
    pflanze.destroy();
  });

  it('chains a Gabe against its predecessors instead of a moment', () => {
    const zweite: Ding = { ding_id: 'g2', zelt_id: 'z1', art: 'gabe', name: '', t: Date.now() - STUNDE, d: { wasser_l: 3 } };
    const gabeTafel = TestBed.createComponent(TafelComponent);
    gabeTafel.componentInstance.zelt = ohneGeraet;
    gabeTafel.componentInstance.dinge = [...dinge(), zweite];
    gabeTafel.componentInstance.subjekt = zweite;
    gabeTafel.detectChanges();

    const griff = gabeTafel.debugElement.query(By.directive(ZeitgriffComponent)).componentInstance as ZeitgriffComponent;
    const vorgaenger = gabeTafel.componentInstance.dinge.find(ding => ding.ding_id === 'g1') as Ding;

    // The predecessor chain, not the moment ladder: no Beginn, no `gestern`.
    expect(griff.detentliste.map(detent => detent.von)).toEqual([vorgaenger.t]);
    gabeTafel.destroy();
  });
});
