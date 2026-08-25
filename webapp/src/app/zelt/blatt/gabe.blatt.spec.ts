import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { IonicModule, ModalController } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import type { Ding, Zelt } from '@fg2/shared-types';
import { AusgangService } from 'src/app/services/dinge.service';
import { ZeltModule } from '../zelt.module';
import { neueDingId } from './entwurf';
import { GabeBlattComponent } from './gabe.blatt';

const STUNDE = 3600 * 1000;

/** A tent with no device anywhere. Every field on this sheet is typed by a person. */
const zelt: Zelt = {
  zelt_id: 'z1',
  besitzer_id: 'u1',
  name: 'Zelt Keller',
  geraete: [],
  zeitzone: 'Europe/Berlin',
  tag_null: Date.now() - 33 * 24 * STUNDE,
  erstellt_at: Date.now() - 33 * 24 * STUNDE,
};

const pflanze = (ding_id: string, name: string): Ding => ({ ding_id: ding_id, zelt_id: 'z1', art: 'pflanze', name: name, t: zelt.tag_null });

describe('GabeBlattComponent, on a tent with no device', () => {
  let fixture: ComponentFixture<GabeBlattComponent>;
  let component: GabeBlattComponent;
  let element: HTMLElement;
  let geschrieben: Ding[];

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  beforeEach(() => {
    geschrieben = [];
    spyOn(TestBed.inject(AusgangService), 'eintragen').and.callFake((ding: Ding) => {
      geschrieben.push(ding);
      return ding;
    });
    spyOn(TestBed.inject(ModalController), 'dismiss').and.resolveTo(true);
  });

  const bauen = (dinge: Ding[] = []): void => {
    fixture = TestBed.createComponent(GabeBlattComponent);
    component = fixture.componentInstance;
    component.zelt = zelt;
    component.dinge = dinge;
    fixture.detectChanges();
    element = fixture.nativeElement;
  };

  /** The sheet is open; this is the second of the two taps §12.1 counts. */
  const eintragenTippen = (): void => {
    const knopf = element.querySelector<HTMLButtonElement>('.blatt-knopf');
    knopf?.click();
    fixture.detectChanges();
  };

  it('is complete on open: the routine watering is the sheet plus one tap', () => {
    bauen();

    expect(component.kannen).toBe(1);
    expect(component.wasser_l).toBe(2);
    eintragenTippen();

    expect(geschrieben.length).toBe(1);
    expect(geschrieben[0].art).toBe('gabe');
    expect(geschrieben[0].d?.['wasser_l']).toBe(2);
  });

  it('waters the whole tent by default, and says so by leaving the edge out', () => {
    bauen([pflanze('p1', 'A1 · Gorilla Glue'), pflanze('p2', 'A2 · Wedding Cake')]);
    eintragenTippen();

    expect(geschrieben[0].rel).toBeUndefined();
  });

  it('names the plants once somebody picks them, and goes back to the tent in one tap', () => {
    bauen([pflanze('p1', 'A1'), pflanze('p2', 'A2')]);

    component.pflanzeUmschalten('p1');
    fixture.detectChanges();
    eintragenTippen();
    expect(geschrieben[0].rel?.['an']).toEqual(['p1']);

    component.ganzesZelt();
    fixture.detectChanges();
    eintragenTippen();
    expect(geschrieben[1].rel).toBeUndefined();
  });

  it('offers no plant row on a tent that has none, and no device row anywhere', () => {
    bauen();

    expect(component.pflanzenListe).toEqual([]);
    expect(element.textContent).not.toContain('zelt.geraetHinzufuegen');
  });

  it('remembers the last pour, so the volume does not have to be typed again', () => {
    bauen([{ ding_id: 'g1', zelt_id: 'z1', art: 'gabe', name: '', t: Date.now() - 30 * STUNDE, d: { wasser_l: 6, kannen: 3, kanne_l: 2 } }]);

    expect(component.kannen).toBe(3);
    expect(component.wasser_l).toBe(6);
  });

  it('counts cans up on a tap and takes one back on a long press', async () => {
    bauen();

    element.querySelector<HTMLButtonElement>('.blatt-kanne')?.click();
    element.querySelector<HTMLButtonElement>('.blatt-kanne')?.click();
    expect(component.kannen).toBe(3);

    component.halten();
    await new Promise(fertig => setTimeout(fertig, 500));
    expect(component.kannen).toBe(2);

    // The click a browser sends after a long press must not undo it.
    component.mehr();
    expect(component.kannen).toBe(2);
    component.loslassen();
  });

  it('relabels the button when the guard fires, and offers the duplicate path', () => {
    const frueher = neueDingId();
    bauen([{ ding_id: frueher, zelt_id: 'z1', art: 'gabe', name: '', t: Date.now() - STUNDE, d: { wasser_l: 2 } }]);

    expect(component.warnung).toBeTruthy();
    expect(element.querySelector('.blatt-knopf')?.textContent?.trim()).toBe('zelt.blatt.trotzdem');

    element.querySelectorAll<HTMLButtonElement>('.blatt-knopf')[1].click();
    expect(geschrieben[0].d?.['dublette_von']).toBe(frueher);
  });

  it('mints its own id, and a different one for every entry', () => {
    bauen();
    eintragenTippen();
    eintragenTippen();

    expect(geschrieben[0].ding_id).not.toBe(geschrieben[1].ding_id);
    expect(geschrieben[0].ding_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('shows the Wer? row only once there are two people', () => {
    bauen([{ ding_id: 'm1', zelt_id: 'z1', art: 'mensch', name: 'Anna', t: 1, d: { farbe: '#a00' } }]);
    expect(component.werZeigen).toBeFalse();

    bauen([
      { ding_id: 'm1', zelt_id: 'z1', art: 'mensch', name: 'Anna', t: 1, d: { farbe: '#a00' } },
      { ding_id: 'm2', zelt_id: 'z1', art: 'mensch', name: 'Ben', t: 1, d: { farbe: '#00a' } },
    ]);
    expect(component.werZeigen).toBeTrue();
  });
});
