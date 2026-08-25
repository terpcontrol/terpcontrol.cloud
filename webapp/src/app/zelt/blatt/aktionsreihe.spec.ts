import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import type { Ding, Zelt } from '@fg2/shared-types';
import { TafelComponent } from '../tafel/tafel.component';
import { ZeltModule } from '../zelt.module';
import { BlattService } from './blatt.service';
import { neueDingId } from './entwurf';

const TAG = 24 * 3600 * 1000;

/**
 * Let the click's own continuation run. `whenStable` never settles here: the
 * Tafel ages its header on a 30-second interval, so the zone is never quiet.
 */
const weiter = (): Promise<void> => new Promise<void>(fertig => setTimeout(fertig, 0));

/** The reference case: no device, no camera, and a diary that has to be writable anyway. */
const zelt: Zelt = {
  zelt_id: 'z1',
  besitzer_id: 'u1',
  name: 'Zelt Keller',
  geraete: [],
  zeitzone: 'Europe/Berlin',
  tag_null: Date.now() - 33 * TAG,
  erstellt_at: Date.now() - 33 * TAG,
};

describe('the action row on the Tafel', () => {
  let fixture: ComponentFixture<TafelComponent>;
  let component: TafelComponent;
  let element: HTMLElement;
  let blaetter: jasmine.SpyObj<BlattService>['oeffnen'];

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
    }).compileComponents();
  }));

  beforeEach(() => {
    blaetter = spyOn(TestBed.inject(BlattService), 'oeffnen').and.resolveTo(null);

    fixture = TestBed.createComponent(TafelComponent);
    component = fixture.componentInstance;
    component.zelt = zelt;
    component.dinge = [{ ding_id: 'zelt:z1', zelt_id: 'z1', art: 'zelt', name: 'Zelt Keller', t: zelt.tag_null, t_ende: null, d: {} }];
    component.subjekt = component.dinge[0];
    fixture.detectChanges();
    element = fixture.nativeElement;
  });

  it('offers the four buttons of §6.2, in order', () => {
    const beschriftungen = Array.from(element.querySelectorAll('.tafel-aktion')).map(knopf => knopf.textContent?.trim());
    expect(beschriftungen).toEqual(['zelt.aktion.gabe', 'zelt.aktion.notiz', 'zelt.aktion.foto', 'zelt.aktion.zettel']);
  });

  it('disables none of them - logging is a cloud write and needs no hardware', () => {
    const knoepfe = Array.from(element.querySelectorAll<HTMLButtonElement>('.tafel-aktion'));
    expect(knoepfe.every(knopf => !knopf.disabled)).toBeTrue();
  });

  it('opens the sheet the button is for', async () => {
    element.querySelector<HTMLButtonElement>('.tafel-aktion--gabe')?.click();
    await weiter();

    expect(blaetter).toHaveBeenCalledWith('gabe', zelt, component.dinge);
  });

  it('puts the new entry on the screen before the server has heard of it', async () => {
    const gabe: Ding = { ding_id: neueDingId(), zelt_id: 'z1', art: 'gabe', name: '', t: Date.now(), d: { wasser_l: 2 } };
    blaetter.and.resolveTo(gabe);

    element.querySelector<HTMLButtonElement>('.tafel-aktion--gabe')?.click();
    await weiter();
    fixture.detectChanges();

    expect(component.verlauf.map(zeile => zeile.ding.ding_id)).toContain(gabe.ding_id);
  });

  it('says how much is still waiting, in one line and nowhere else', () => {
    expect(element.querySelector('.tafel-wartend')).toBeNull();

    component.wartend = 3;
    fixture.detectChanges();
    expect(element.querySelector('.tafel-wartend')?.textContent?.trim()).toBe('zelt.ausgang.wartet.other');
  });
});
