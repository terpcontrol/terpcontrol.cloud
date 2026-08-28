import { Component } from '@angular/core';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import type { Ding, DingArt, Zelt } from '@fg2/shared-types';
import { ZeltModule } from '../zelt.module';
import { KOERPER, KOERPER_KOMPONENTEN } from './koerper.registry';

const ALLE_ARTEN: DingArt[] = [
  'zelt',
  'geraet',
  'pflanze',
  'dose',
  'kamera',
  'bild',
  'film',
  'gabe',
  'notiz',
  'zustand',
  'phase',
  'ziel',
  'mensch',
  'ereignis',
  'schema',
  'lauf',
];

const zelt: Zelt = {
  zelt_id: 'z1',
  besitzer_id: 'u1',
  name: 'Zelt Keller',
  geraete: [],
  zeitzone: 'Europe/Berlin',
  tag_null: Date.now() - 33 * 24 * 3600 * 1000,
  erstellt_at: Date.now() - 33 * 24 * 3600 * 1000,
};

@Component({
  template: `<ng-container [appKoerper]="ding" [appKoerperZelt]="zelt" [appKoerperDinge]="[]"></ng-container>`,
})
class KoerperWirtComponent {
  public zelt = zelt;
  public ding: Ding | null = null;
}

describe('the art-specific bodies', () => {
  let fixture: ComponentFixture<KoerperWirtComponent>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [KoerperWirtComponent],
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(KoerperWirtComponent);
  });

  it('declares one component per art and no fewer', () => {
    expect(Object.keys(KOERPER).sort()).toEqual([...ALLE_ARTEN].sort());
    expect(KOERPER_KOMPONENTEN.length).toBe(ALLE_ARTEN.length);
    // Separate components, not one class registered sixteen times.
    expect(new Set(KOERPER_KOMPONENTEN).size).toBe(ALLE_ARTEN.length);
  });

  ALLE_ARTEN.forEach(art => {
    it(`resolves the body for ${art}`, () => {
      fixture.componentInstance.ding = { ding_id: `${art}:1`, zelt_id: 'z1', art: art, name: 'x', t: Date.now(), d: {} };
      fixture.detectChanges();

      // The registry's own component is what stands in the Tafel, and its tag
      // says which one it is - nothing generic can have been substituted.
      const wirt = fixture.debugElement.query(By.directive(KOERPER[art]));
      expect(wirt).withContext(`no body resolved for art ${art}`).toBeTruthy();
      expect(wirt.nativeElement.tagName.toLowerCase()).toBe(`app-${art}-koerper`);
    });
  });

  it('keeps the standing instance when the same art is re-read', () => {
    const jetzt = Date.now();
    fixture.componentInstance.ding = { ding_id: 'g1', zelt_id: 'z1', art: 'gabe', name: '', t: jetzt, d: { wasser_l: 2 } };
    fixture.detectChanges();

    const erst = fixture.nativeElement.querySelector('app-gabe-koerper');
    fixture.componentInstance.ding = { ding_id: 'g1', zelt_id: 'z1', art: 'gabe', name: '', t: jetzt, d: { wasser_l: 4 } };
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-gabe-koerper')).toBe(erst);
  });

  it('rebuilds when the art changes', () => {
    fixture.componentInstance.ding = { ding_id: 'g1', zelt_id: 'z1', art: 'gabe', name: '', t: Date.now(), d: {} };
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-gabe-koerper')).toBeTruthy();

    fixture.componentInstance.ding = { ding_id: 'n1', zelt_id: 'z1', art: 'notiz', name: '', t: Date.now(), d: { text: 'hallo' } };
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-gabe-koerper')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-notiz-koerper')).toBeTruthy();
  });
});
