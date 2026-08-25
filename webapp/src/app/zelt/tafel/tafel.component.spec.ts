import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import type { Ding, Zelt } from '@fg2/shared-types';
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
    expect(titel).toContain('zelt.abschnitt.offen');
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
