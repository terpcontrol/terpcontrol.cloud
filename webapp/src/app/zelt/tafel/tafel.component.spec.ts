import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, tick, waitForAsync } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type { Ding, Zelt } from '@fg2/shared-types';
import { environment } from 'src/environments/environment';
import { AusgangService } from 'src/app/services/dinge.service';
import { VergleichService } from 'src/app/services/vergleich.service';
import { formatTimeAgo } from 'src/app/util/time-ago';
import { BlattService } from '../blatt/blatt.service';
import { ZeltModule } from '../zelt.module';
import { TafelComponent } from './tafel.component';

const TAG = 24 * 3600 * 1000;

/** The reference case: a tent, a grow, a diary, and no hardware anywhere. */
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
    { ding_id: 'g1', zelt_id: 'z1', art: 'gabe', name: '', t: jetzt - 2 * 3600 * 1000, d: { wasser_l: 2, messwerte: { ph: 6.2 } } },
    { ding_id: 'n1', zelt_id: 'z1', art: 'notiz', name: '', t: jetzt - 26 * 3600 * 1000, d: { text: 'untere Blätter gelb', messwerte: { hoehe_cm: 48 } } },
    { ding_id: 'p1', zelt_id: 'z1', art: 'pflanze', name: 'A1 · Gorilla Glue', t: jetzt - 30 * TAG, d: { sorte: 'Gorilla Glue' } },
    { ding_id: 'z9', zelt_id: 'z1', art: 'zustand', name: '', t: jetzt - 3 * TAG, t_ende: null, d: { text: 'CO₂-Flasche fast leer' } },
  ];
};

describe('TafelComponent, with no device anywhere', () => {
  let fixture: ComponentFixture<TafelComponent>;
  let component: TafelComponent;
  let element: HTMLElement;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(TafelComponent);
    component = fixture.componentInstance;
    component.zelt = ohneGeraet;
    component.dinge = dinge();
    component.subjekt = component.dinge[0];
    component.anfrage = 'GET /api/dinge?zelt_id=z1';
    fixture.detectChanges();
    element = fixture.nativeElement;
  });

  it('renders the same component, with a body', () => {
    expect(element.querySelector('.tafel')).toBeTruthy();
    expect(element.querySelector('app-zelt-koerper')).toBeTruthy();
  });

  it('renders all four sections', () => {
    const titel = Array.from(element.querySelectorAll('.tafel-abschnitt-titel')).map(knoten => knoten.textContent?.trim());
    expect(titel).toContain('zelt.abschnitt.zettel');
    expect(titel).toContain('zelt.abschnitt.unterschied');
    expect(titel).toContain('zelt.abschnitt.imZelt');
    expect(titel).toContain('zelt.abschnitt.verlauf');
  });

  it('stubs, greys and disables nothing - the device arts are simply absent', () => {
    expect(element.querySelector('app-geraet-koerper')).toBeNull();
    expect(element.querySelector('app-dose-koerper')).toBeNull();
    expect(element.querySelector('app-kamera-koerper')).toBeNull();

    // No padlock, no completeness meter, no "0 sensors", no disabled control.
    expect(element.querySelectorAll('[disabled]').length).toBe(0);
    expect(element.querySelector('.tafel-punkt')).toBeNull();
    expect(element.textContent).not.toContain('—');
  });

  it('has no row for a measure nobody measured', () => {
    expect(component.unterschied.some(zeile => zeile.mass === 'temperatur')).toBeFalse();
    expect(component.unterschied.some(zeile => zeile.mass === 'co2')).toBeFalse();
  });

  it('shows the hand measures it does have', () => {
    const masse = component.unterschied.map(zeile => zeile.mass);
    expect(masse).toContain('ph');
    expect(masse).toContain('hoehe_cm');
    expect(masse).toContain('wasser_gesamt');
  });

  it('keeps the Zettel section and the tent’s own rows', () => {
    expect(component.offen.map(ding => ding.ding_id)).toEqual(['z9']);
    expect(component.imZelt.map(ding => ding.ding_id)).toEqual(['p1']);
    // The open Zettel already has its row at the top and is not repeated here.
    expect(component.verlauf.map(zeile => zeile.ding.ding_id)).toEqual(['g1', 'n1']);
  });

  it('offers the one upsell row the spec allows, and only one', () => {
    expect(element.querySelectorAll('.tafel-geraet-zeile').length).toBe(1);
  });

  it('hands the same derived list back until its inputs change', () => {
    const erst = component.verlauf;
    expect(component.verlauf).toBe(erst);

    component.dinge = [...component.dinge];
    component.ngOnChanges();
    expect(component.verlauf).not.toBe(erst);
  });

  it('never averages two devices reporting one measure', () => {
    component.geraetMessungen = [
      { mass: 'temperatur', herkunft: { quelle: 'geraet', geraet_id: 'controller', geraet_name: 'Controller' }, wert: 24, t: Date.now() },
      { mass: 'temperatur', herkunft: { quelle: 'geraet', geraet_id: 'balkon', geraet_name: 'Steckdose Balkon' }, wert: 18, t: Date.now() },
    ];
    component.ngOnChanges();
    fixture.detectChanges();

    const temperatur = component.unterschied.filter(zeile => zeile.mass === 'temperatur');
    expect(temperatur.length).toBe(2);
    expect(temperatur.some(zeile => zeile.jetzt === 21)).toBeFalse();
    expect(element.textContent).toContain('Controller');
    expect(element.textContent).toContain('Steckdose Balkon');
  });

  it('caps the table at eleven rows and expands in place', () => {
    const jetzt = Date.now();
    component.geraetMessungen = Array.from({ length: 14 }, (_wert, index) => ({
      mass: `mass${index}`,
      herkunft: { quelle: 'geraet' as const, geraet_id: 'controller' },
      wert: index,
      t: jetzt,
    }));
    component.ngOnChanges();
    fixture.detectChanges();

    expect(component.sichtbareZeilen.length).toBe(11);
    expect(component.verborgeneZeilen).toBeGreaterThan(0);

    component.tabelleUmschalten();
    expect(component.sichtbareZeilen.length).toBe(component.unterschied.length);
  });
});

describe('TafelComponent, with a device', () => {
  let fixture: ComponentFixture<TafelComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  it('is the same component, with more rows in it', () => {
    fixture = TestBed.createComponent(TafelComponent);
    const jetzt = Date.now();
    const component = fixture.componentInstance;

    component.zelt = { ...ohneGeraet, geraete: [{ geraet_id: 'd1', seit: ohneGeraet.tag_null }] };
    component.dinge = [
      ...dinge(),
      { ding_id: 'geraet:d1', zelt_id: 'z1', geraet_id: 'd1', art: 'geraet', name: 'Controller', t: ohneGeraet.tag_null, t_ende: null, d: { zuletzt_gesehen: jetzt - 40000 } },
      { ding_id: 'dose:aa', zelt_id: 'z1', geraet_id: 'd1', art: 'dose', name: 'heater', t: ohneGeraet.tag_null, t_ende: null, d: { rolle: 'heater', slot: 0 } },
    ];
    component.subjekt = component.dinge[0];
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('.tafel')).toBeTruthy();
    // The online dot is a fact about evidence, not a variant of the screen.
    expect(element.querySelector('.tafel-punkt--online')).toBeTruthy();
    expect(component.imZelt.map(ding => ding.ding_id)).toEqual(['p1', 'geraet:d1', 'dose:aa']);
  });
});

describe('TafelComponent, day one', () => {
  let fixture: ComponentFixture<TafelComponent>;
  let component: TafelComponent;
  let element: HTMLElement;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  beforeEach(() => {
    const heute = Date.now();
    fixture = TestBed.createComponent(TafelComponent);
    component = fixture.componentInstance;
    component.zelt = { ...ohneGeraet, tag_null: heute, erstellt_at: heute };
    // A tent that exists, and nothing else: the tent projects a row of its own.
    component.dinge = [{ ding_id: 'zelt:z1', zelt_id: 'z1', art: 'zelt', name: 'Zelt Keller', t: heute, t_ende: null, d: {} }];
    component.subjekt = component.dinge[0];
    fixture.detectChanges();
    element = fixture.nativeElement;
  });

  it('says the one sentence §9.2 asks for, down the one ladder', () => {
    expect(component.tagEins).toBeTrue();
    // 8e is a rung, not a second code path: the day-one line is written by the
    // same generator that writes every other line in the product.
    expect(component.satz.rang).toBe('8e');
    expect(component.satz.klauseln[0].text.key).toBe('zelt.tagEins');
    expect(element.querySelector('.tafel-satz')).toBeTruthy();
  });

  it('draws no labelled section with nothing under it', () => {
    const titel = Array.from(element.querySelectorAll('.tafel-abschnitt-titel')).map(knoten => knoten.textContent?.trim());
    expect(titel).not.toContain('zelt.abschnitt.verlauf');
    expect(titel).not.toContain('zelt.abschnitt.imZelt');
    expect(titel).not.toContain('zelt.abschnitt.zettel');
  });

  it('keeps the one upsell row, and exactly one', () => {
    expect(element.querySelectorAll('.tafel-geraet-zeile').length).toBe(1);
  });

  it('credits nobody with an entry they never made', () => {
    expect(component.unterschied.some(zeile => zeile.mass === 'eintraege')).toBeFalse();
    expect(component.kopf.some(fakt => fakt.id === 'eintraege')).toBeFalse();
    // No zero-count anywhere: an absent fact is an absent fact, never a meter
    // reading nought.
    expect(component.unterschied.length).toBe(0);
    expect(component.kopf.map(fakt => fakt.params?.['anzahl'])).not.toContain('0');
  });
});

describe('TafelComponent, the header and the table', () => {
  let fixture: ComponentFixture<TafelComponent>;
  let component: TafelComponent;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(TafelComponent);
    component = fixture.componentInstance;
    component.zelt = ohneGeraet;
    component.dinge = dinge();
    component.subjekt = component.dinge[0];
    fixture.detectChanges();
  });

  it('counts entries, not rows read: the tent and the plant are not entries', () => {
    // The fixture holds a tent, a watering, a note, a plant and a Zettel.
    const fakt = component.kopf.find(eintrag => eintrag.id === 'eintraege');
    expect(fakt?.params?.['anzahl']).toBe('3');
    expect(fakt?.key).toBe('zelt.kopf.eintraege.other');
  });

  it('speaks of one entry in the singular', () => {
    component.dinge = dinge().filter(ding => ding.art === 'zelt' || ding.ding_id === 'g1');
    component.ngOnChanges();

    const fakt = component.kopf.find(eintrag => eintrag.id === 'eintraege');
    expect(fakt?.key).toBe('zelt.kopf.eintraege.one');
  });

  it('writes the counted phrases as German, plural and decimal comma included', () => {
    const translate = TestBed.inject(TranslateService);
    // The strings are the bundle's own, so a shape that stops matching de.json
    // fails here rather than on a phone.
    translate.setTranslation('de', {
      zelt: {
        kopf: { eintraege: { one: '1 Eintrag', other: '{{anzahl}} Einträge' } },
        mehrZeilen: { one: '1 weitere Zeile', other: '{{anzahl}} weitere Zeilen' },
        zeile: { wasser: '{{liter}} l' },
      },
    });
    translate.use('de');
    fixture.detectChanges();

    const kopf: HTMLElement | null = fixture.nativeElement.querySelector('.tafel-fakten');
    expect(kopf?.textContent).toContain('3 Einträge');
    expect(kopf?.textContent).not.toContain('3 Eintrag');

    component.dinge = dinge().filter(ding => ding.art === 'zelt' || ding.ding_id === 'g1');
    component.ngOnChanges();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tafel-fakten')?.textContent).toContain('1 Eintrag');
    expect(fixture.nativeElement.querySelector('.tafel-fakten')?.textContent).not.toContain('1 Einträge');
  });

  it('says how many it has read when the server has more', () => {
    component.weitereVorhanden = true;
    component.ngOnChanges();
    expect(component.kopf.find(eintrag => eintrag.id === 'eintraege')?.key).toBe('zelt.kopf.eintraegeMehr');
  });

  it('puts the unit on every table row that has one', () => {
    const hoehe = component.sichtbareZeilen.find(zeile => zeile.mass === 'hoehe_cm');
    expect(hoehe?.zusatz).toContain('cm');

    const ph = component.sichtbareZeilen.find(zeile => zeile.mass === 'ph');
    // A pH has no unit, and `pH 6,1 -` is worse than `pH 6,1`.
    expect(ph?.zusatz).not.toContain('cm');
  });

  it('counts the diff table’s entry row the same way the header does', () => {
    const eintraege = component.unterschied.find(zeile => zeile.mass === 'eintraege');
    expect(eintraege?.jetzt).toBe(3);
  });

  it('drops a cancelled entry from the history, as every other list already did', () => {
    const jetzt = Date.now();
    component.dinge = [
      ...dinge(),
      { ding_id: 'g2', zelt_id: 'z1', art: 'gabe', name: '', t: jetzt - 3600 * 1000, storniert_von: 'g3', d: { wasser_l: 9 } },
    ];
    component.ngOnChanges();

    expect(component.verlauf.map(zeile => zeile.ding.ding_id)).not.toContain('g2');
  });

  it('asks for the plural form of „weitere Zeilen" by count', () => {
    const jetzt = Date.now();
    component.geraetMessungen = Array.from({ length: 13 }, (_wert, index) => ({
      mass: `mass${index}`,
      herkunft: { quelle: 'geraet' as const, geraet_id: 'controller' },
      wert: index,
      t: jetzt,
    }));
    component.ngOnChanges();

    expect(component.verborgeneZeilen).toBeGreaterThan(1);
    expect(component.mehrZeilenSchluessel).toBe('zelt.mehrZeilen.other');
    expect(component.mehrZeilenParams['anzahl']).toBe(String(component.verborgeneZeilen));
  });
});

describe('TafelComponent, a socket and the device that reports it', () => {
  let fixture: ComponentFixture<TafelComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  it('reads the socket as exactly as fresh as its controller', () => {
    const jetzt = Date.now();
    fixture = TestBed.createComponent(TafelComponent);
    const component = fixture.componentInstance;

    component.zelt = { ...ohneGeraet, geraete: [{ geraet_id: 'd1', seit: ohneGeraet.tag_null }] };
    component.dinge = [
      ...dinge(),
      { ding_id: 'geraet:d1', zelt_id: 'z1', geraet_id: 'd1', art: 'geraet', name: 'Controller', t: ohneGeraet.tag_null, t_ende: null, d: { zuletzt_gesehen: jetzt - 40000 } },
      // The socket projection carries `t = seit`: bound to the tent 33 days ago,
      // with no reading of its own. It is still 40 seconds of evidence.
      { ding_id: 'dose:aa', zelt_id: 'z1', geraet_id: 'd1', art: 'dose', name: 'heater', t: ohneGeraet.tag_null, t_ende: null, d: { rolle: 'heater', slot: 0 } },
    ];
    component.subjekt = component.dinge[0];
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    const alter = Array.from(element.querySelectorAll('app-zeile .zeile-alter')).map(knoten => knoten.textContent?.trim());
    const frisch = alter.filter(text => text === formatTimeAgo(jetzt - 40000));

    // The controller's row and its socket's row, saying the same thing.
    expect(frisch.length).toBe(2);
    // And no hollow „stale" square anywhere: nothing on this screen is stale.
    expect(element.querySelectorAll('app-zeile .zeile-marke--hohl').length).toBe(0);
  });
});

describe('TafelComponent, the one sentence on a tent with no device', () => {
  let fixture: ComponentFixture<TafelComponent>;
  let component: TafelComponent;
  let element: HTMLElement;

  /** The bundle's own strings, so a shape that stops matching de.json fails here rather than on a phone. */
  const deutsch = {
    zelt: {
      tag: 'Tag {{tag}}',
      tagEins: 'Dein Tagebuch fängt heute an.',
      kappe: { vorher: 'Vorher', jetzt: 'Jetzt', beginn: 'Beginn' },
      beleg: {
        kennung: { bild: 'Kamerabild', foto: 'Foto', band: 'Werte', karte: 'Einträge' },
        nichts: { keinVorher: 'Noch kein Vorher', nochNichts: 'Noch nichts eingetragen' },
        karte: { tagPhase: 'Tag {{tag}} · {{stufe}}', wasser: 'Wasser gesamt {{liter}} l' },
      },
      satz: {
        gabe: { du: { eins: 'Du hast gegossen.', viele: 'Du hast {{mal}} gegossen.' } },
        hoehe: 'Aus {{vorher}} cm sind {{jetzt}} cm geworden.',
        mal: { 2: 'zweimal' },
      },
      stufe: { flowering: 'Blüte' },
    },
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  beforeEach(() => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', deutsch);
    translate.use('de');

    const jetzt = Date.now();
    fixture = TestBed.createComponent(TafelComponent);
    component = fixture.componentInstance;
    component.zelt = ohneGeraet;
    component.dinge = [
      { ding_id: 'zelt:z1', zelt_id: 'z1', art: 'zelt', name: 'Zelt Keller', t: ohneGeraet.tag_null, t_ende: null, d: {} },
      { ding_id: 'ph1', zelt_id: 'z1', art: 'phase', name: '', t: jetzt - 12 * TAG, d: { stufe: 'flowering' } },
      { ding_id: 'g1', zelt_id: 'z1', art: 'gabe', name: '', t: jetzt - 20 * 3600 * 1000, d: { wasser_l: 2 } },
      { ding_id: 'g2', zelt_id: 'z1', art: 'gabe', name: '', t: jetzt - 2 * 3600 * 1000, d: { wasser_l: 2 } },
    ];
    component.subjekt = component.dinge[0];
    fixture.detectChanges();
    element = fixture.nativeElement;
  });

  it('writes a sentence, in German, with no hardware anywhere', () => {
    expect(component.satz.rang).toBe('7');
    expect(element.querySelector('.tafel-satz-text')?.textContent?.trim()).toBe('Du hast zweimal gegossen.');
  });

  it('offers no remedy: nine of eleven rules are silent and no substitute is invented', () => {
    expect(component.satz.regel).toBeNull();
    expect(element.querySelector('.tafel-regel')).toBeNull();
  });

  it('draws exactly one sentence on the screen', () => {
    expect(element.querySelectorAll('.tafel-satz-text').length).toBe(1);
  });

  it('prints the evidence kind in both halves of the pair', () => {
    const kennungen = Array.from(element.querySelectorAll('.tafel-kennung')).map(knoten => knoten.textContent?.trim());
    expect(kennungen.length).toBe(2);
    for (const kennung of kennungen) expect(kennung).toBeTruthy();
  });

  it('draws the Standkarte, which is what this density resolves to', () => {
    expect(component.belegJetzt.art).toBe('karte');
    expect(element.querySelectorAll('.tafel-karte-zeile').length).toBeGreaterThan(1);
    expect(element.textContent).toContain('Blüte');
  });

  it('ranks the table and marks each row against its own noise', () => {
    for (const zeile of component.sichtbareZeilen) {
      expect(['ueber', 'ruhig', 'gleich']).toContain(zeile.marke);
      // Nothing here has been read three times in fourteen days, so nothing
      // may claim to have moved further than it usually moves.
      expect(zeile.marke).not.toBe('ueber');
    }
  });
});

describe('TafelComponent, an entry that has not been sent yet', () => {
  let fixture: ComponentFixture<TafelComponent>;
  let component: TafelComponent;
  let element: HTMLElement;
  let http: HttpTestingController;

  const warte = (): Promise<void> => new Promise<void>(fertig => setTimeout(fertig, 0));
  const wartendeZeilen = (): number => element.querySelectorAll('app-zeile .zeile-wartet').length;

  beforeEach(waitForAsync(() => {
    window.localStorage.removeItem('tc.ausgang');
    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  beforeEach(() => {
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TafelComponent);
    component = fixture.componentInstance;
    component.zelt = ohneGeraet;
    component.dinge = dinge();
    component.subjekt = component.dinge[0];
    fixture.detectChanges();
    element = fixture.nativeElement;
  });

  afterEach(() => {
    window.localStorage.removeItem('tc.ausgang');
  });

  it('marks the queued row and no other, and stops marking it once it is stored', async () => {
    expect(wartendeZeilen()).toBe(0);

    const queued = component.dinge.find(ding => ding.ding_id === 'g1') as Ding;
    TestBed.inject(AusgangService).eintragen(queued);
    fixture.detectChanges();

    // One row on the screen exists only on this phone, and it is that row.
    expect(component.wartendeIds.has('g1')).toBeTrue();
    expect(wartendeZeilen()).toBe(1);

    http.expectOne(`${environment.API_URL}/api/dinge`).flush({ ding: queued });
    await warte();
    fixture.detectChanges();

    expect(component.wartendeIds.size).toBe(0);
    expect(wartendeZeilen()).toBe(0);
    http.verify();
  });

  it('hands a written entry to whoever owns the list, and shows it at once', async () => {
    const neu: Ding = { ding_id: 'neu', zelt_id: 'z1', art: 'gabe', name: '', t: Date.now(), d: { wasser_l: 3 } };
    spyOn(TestBed.inject(BlattService), 'oeffnen').and.returnValue(Promise.resolve(neu));

    const weitergereicht: Ding[] = [];
    component.geschrieben.subscribe(ding => weitergereicht.push(ding));
    await component.eintragen('gabe');

    expect(component.dinge[0].ding_id).toBe('neu');
    expect(weitergereicht.map(ding => ding.ding_id)).toEqual(['neu']);
  });
});

describe('TafelComponent, the one clock', () => {
  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  it('ages its rows on the cursor’s clock, which holds still under a thumb', fakeAsync(() => {
    const cursor = TestBed.inject(VergleichService);
    const fixture = TestBed.createComponent(TafelComponent);
    const component = fixture.componentInstance;
    component.zelt = ohneGeraet;
    component.dinge = dinge();
    component.subjekt = component.dinge[0];
    fixture.detectChanges();

    // A second clock of its own would keep counting here, and the header would
    // age while the slider it sits above did not.
    cursor.ziehtSetzen(true);
    const eingefroren = cursor.jetzt();
    tick(30 * 1000);
    expect(component.jetzt).toBe(eingefroren);

    cursor.ziehtSetzen(false);
    tick(30 * 1000);
    expect(component.jetzt).toBeGreaterThan(eingefroren);

    fixture.destroy();
    discardPeriodicTasks();
  }));
});
