import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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

const griffVon = (fixture: ComponentFixture<TafelComponent>): ZeitgriffComponent =>
  fixture.debugElement.query(By.directive(ZeitgriffComponent)).componentInstance as ZeitgriffComponent;

/** A finger, as the strip actually receives one. */
const zeiger = (art: string, x: number, y: number): PointerEvent =>
  new PointerEvent(art, { pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true });

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

  it('ends the track at now, not at the moment the screen was opened', () => {
    // A shared tent phone is unlocked once and left on the tent screen. Eleven
    // hours later somebody waters, and the question the club opens the app to
    // ask must not be answered with „es wurde nichts aufgezeichnet".
    const griff = griffVon(fixture);
    const gestartet = Date.now();
    const spaeter = gestartet + 11 * STUNDE;
    spyOn(Date, 'now').and.returnValue(spaeter);

    const anna: Ding = { ding_id: 'g9', zelt_id: 'z1', art: 'gabe', name: '', t: gestartet + 9 * STUNDE, d: { wasser_l: 2 } };
    fixture.componentInstance.dinge = [...fixture.componentInstance.dinge, anna];
    fixture.detectChanges();

    cursor.setzen(gestartet + 8 * STUNDE, 'frei');
    fixture.detectChanges();

    griff.naechster();
    fixture.detectChanges();

    expect(griff.hinweis).toBeNull();
    expect(cursor.wert?.von).toBe(anna.t);
  });

  it('holds `Space` rather than latching it, so no key leaves a state behind', () => {
    const spur = element.querySelector('.griff-spur') as HTMLElement;

    spur.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    fixture.detectChanges();
    expect(cursor.zieht).toBeTrue();

    spur.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    fixture.detectChanges();
    expect(cursor.zieht).toBeFalse();
    expect(unterschiedAbschnitt(element).querySelectorAll('.tafel-zeile').length).toBeGreaterThan(0);
  });

  it('lets a flick down the screen scroll instead of destroying `Vorher`', () => {
    const spur = element.querySelector('.griff-spur') as HTMLElement;
    const kasten = spur.getBoundingClientRect();
    cursor.setzen(Date.now() - 4 * TAG, 'frei');
    fixture.detectChanges();
    const stand = cursor.wert?.von;

    spur.dispatchEvent(zeiger('pointerdown', kasten.left + kasten.width * 0.2, kasten.top + 14));
    spur.dispatchEvent(zeiger('pointermove', kasten.left + kasten.width * 0.2 + 2, kasten.top + 60));
    spur.dispatchEvent(zeiger('pointerup', kasten.left + kasten.width * 0.2 + 2, kasten.top + 60));
    fixture.detectChanges();

    expect(cursor.wert?.von).toBe(stand);
    expect(cursor.zieht).toBeFalse();
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

/**
 * §13.1's headline club feature, on a tent that hand-waters shared plants:
 * Anna was typed in on day 5 and everything she has done since came after that
 * day. A person's track that ends where the person's Ding does can reach none
 * of it.
 */
describe('the Zeitgriff on a person and on a plant', () => {
  /** The bundle's own strings, so a shape that stops matching de.json fails here rather than on a phone. */
  const deutsch = {
    zelt: {
      tag: 'Tag {{tag}}',
      arten: { gabe: 'Gabe', notiz: 'Notiz' },
      griff: {
        titel: 'Vorher',
        beginn: 'Beginn',
        woche: '1 Woche',
        gestern: 'gestern',
        gabe: 'letzte Gabe',
        besuch: 'voriger Besuch',
        besuchVon: 'seit dem letzten Besuch von {{wer}}',
        moment: '{{zeit}} · Tag {{tag}}',
        naechster: 'Nächster Unterschied ›',
        keinUnterschied: 'Kein weiterer Unterschied — es wurde nichts aufgezeichnet.',
      },
    },
  };

  const besuche = [Date.now() - 20 * TAG, Date.now() - 13 * TAG, Date.now() - 8 * TAG, Date.now() - 6 * TAG];

  const klubDinge = (): Ding[] => [
    { ding_id: 'zelt:z1', zelt_id: 'z1', art: 'zelt', name: 'Zelt Keller', t: ohneGeraet.tag_null, t_ende: null, d: {} },
    { ding_id: 'm1', zelt_id: 'z1', art: 'mensch', name: 'Anna', t: Date.now() - 25 * TAG, d: {} },
    { ding_id: 'm2', zelt_id: 'z1', art: 'mensch', name: 'Ben', t: Date.now() - 24 * TAG, d: {} },
    ...besuche.map((t, index) => ({
      ding_id: `ga${index}`,
      zelt_id: 'z1',
      art: 'gabe' as const,
      name: '',
      t: t,
      akteur: 'm1',
      d: { wasser_l: 2 },
    })),
    { ding_id: 'gb', zelt_id: 'z1', art: 'gabe', name: '', t: Date.now() - 7 * TAG, akteur: 'm2', d: { wasser_l: 3 } },
  ];

  /** Three plants and three pours nobody named a plant in - §13.3: that is the whole tent. */
  const pflanzenDinge = (): Ding[] => [
    { ding_id: 'zelt:z1', zelt_id: 'z1', art: 'zelt', name: 'Zelt Keller', t: ohneGeraet.tag_null, t_ende: null, d: {} },
    { ding_id: 'a1', zelt_id: 'z1', art: 'pflanze', name: 'A1', t: Date.now() - 30 * TAG, d: {} },
    { ding_id: 'a2', zelt_id: 'z1', art: 'pflanze', name: 'A2', t: Date.now() - 29 * TAG, d: {} },
    { ding_id: 'a3', zelt_id: 'z1', art: 'pflanze', name: 'A3', t: Date.now() - 28 * TAG, d: {} },
    { ding_id: 'w1', zelt_id: 'z1', art: 'gabe', name: '', t: Date.now() - 5 * TAG, d: { wasser_l: 6 } },
    { ding_id: 'w2', zelt_id: 'z1', art: 'gabe', name: '', t: Date.now() - 3 * TAG, d: { wasser_l: 6 } },
    { ding_id: 'w3', zelt_id: 'z1', art: 'gabe', name: '', t: Date.now() - TAG, d: { wasser_l: 6 } },
  ];

  const bauen = (alle: Ding[], subjekt_id: string): ComponentFixture<TafelComponent> => {
    const fixture = TestBed.createComponent(TafelComponent);
    fixture.componentInstance.zelt = ohneGeraet;
    fixture.componentInstance.dinge = alle;
    fixture.componentInstance.subjekt = alle.find(ding => ding.ding_id === subjekt_id) ?? null;
    fixture.detectChanges();
    return fixture;
  };

  let cursor: VergleichService;

  beforeEach(waitForAsync(() => {
    sessionStorage.clear();
    localStorage.removeItem('tc-zuletzt-z1');
    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  beforeEach(() => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', deutsch);
    translate.use('de');
    cursor = TestBed.inject(VergleichService);
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.removeItem('tc-zuletzt-z1');
  });

  it('lays every one of that person’s visits out along the track', () => {
    const fixture = bauen(klubDinge(), 'm1');
    const griff = griffVon(fixture);

    expect(griff.detentliste.map(detent => detent.von)).toEqual(besuche);
    // Not all four on the right edge: the track runs from the day she joined to
    // now, because her entries all come after the day somebody typed her name in.
    const stellen = griff.detentliste.map(detent => Math.round(griff.prozent(detent.von)));
    expect(new Set(stellen).size).toBe(4);
    expect(stellen.every(stelle => stelle > 0 && stelle < 95)).toBeTrue();
    fixture.destroy();
  });

  it('walks the keyboard back through her visits instead of clamping into a loop', () => {
    const fixture = bauen(klubDinge(), 'm1');
    const spur = (fixture.nativeElement as HTMLElement).querySelector('.griff-spur') as HTMLElement;

    cursor.setzen(besuche[3], 'besuch');
    fixture.detectChanges();

    const gegangen: number[] = [];
    for (let schritt = 0; schritt < 3; schritt++) {
      spur.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      fixture.detectChanges();
      gegangen.push(cursor.wert?.von ?? 0);
    }

    expect(gegangen).toEqual([besuche[2], besuche[1], besuche[0]]);
    fixture.destroy();
  });

  it('carries „seit dem letzten Besuch von Anna" onto the next Tafel', () => {
    const fixture = bauen(klubDinge(), 'm1');
    const spur = (fixture.nativeElement as HTMLElement).querySelector('.griff-spur') as HTMLElement;

    cursor.setzen(besuche[3] + 1, 'frei');
    fixture.detectChanges();
    spur.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    fixture.detectChanges();

    expect(cursor.wert?.anker).toBe('besuch');
    expect(cursor.wert?.wer).toBe('m1');
    fixture.destroy();

    // The walk: the arithmetic survived it before, the meaning did not.
    const zelt = bauen(klubDinge(), 'zelt:z1');
    expect(griffVon(zelt).ankerBeschriftung).toBe('seit dem letzten Besuch von Anna');
    zelt.destroy();
  });

  it('keeps the `seit zuletzt` rung after a drag and a walk', () => {
    localStorage.setItem('tc-zuletzt-z1', String(Date.now() - 2 * TAG));

    const erste = bauen(pflanzenDinge(), 'zelt:z1');
    expect(griffVon(erste).detentliste.map(detent => detent.id)).toContain('zuletzt');

    // One drag away from the rung, then a walk to the next Tafel. The rung is
    // where the visit was, not where the cursor happens to be standing - infer
    // one from the other and it disappears for the rest of the session.
    cursor.setzen(Date.now() - 5 * TAG, 'frei');
    erste.detectChanges();
    erste.destroy();

    const zweite = bauen(pflanzenDinge(), 'a1');
    expect(griffVon(zweite).detentliste.map(detent => detent.id)).toContain('zuletzt');
    zweite.destroy();
  });

  it('steps a plant through the pours that named no plant at all', () => {
    const alle = pflanzenDinge();
    const fixture = bauen(alle, 'a1');
    const griff = griffVon(fixture);

    cursor.setzen(Date.now() - 31 * TAG, 'frei');
    fixture.detectChanges();

    const gegangen: number[] = [];
    for (let schritt = 0; schritt < 3; schritt++) {
      griff.naechster();
      fixture.detectChanges();
      gegangen.push(cursor.wert?.von ?? 0);
    }

    // §13.3: `rel.an` absent is the whole tent, and the whole tent contains A1.
    // Not the days A2 and A3 were typed in, which is what it used to answer.
    expect(gegangen).toEqual(alle.filter(ding => ding.art === 'gabe').map(ding => ding.t));
    expect(griff.hinweis).toBeNull();

    griff.naechster();
    fixture.detectChanges();
    expect(griff.hinweis).toBe('zelt.griff.keinUnterschied');
    fixture.destroy();
  });
});
