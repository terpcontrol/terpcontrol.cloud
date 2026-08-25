import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import type { Zelt } from '@fg2/shared-types';
import { environment } from 'src/environments/environment';
import { ZeltModule } from '../zelt.module';
import { BrowserPage } from './browser.page';

const zelt: Zelt = {
  zelt_id: 'z1',
  besitzer_id: 'u1',
  name: 'Zelt Keller',
  geraete: [],
  zeitzone: 'Europe/Berlin',
  tag_null: Date.now() - 33 * 24 * 3600 * 1000,
  erstellt_at: Date.now() - 33 * 24 * 3600 * 1000,
};

const warte = () => new Promise<void>(fertig => setTimeout(fertig, 0));

describe('BrowserPage', () => {
  let fixture: ComponentFixture<BrowserPage>;
  let http: HttpTestingController;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  const dingeAnfrage = () => http.expectOne(request => request.url === `${environment.API_URL}/api/dinge`);

  beforeEach(waitForAsync(() => {
    params = new BehaviorSubject(convertToParamMap({ zelt_id: 'z1' }));

    TestBed.configureTestingModule({
      imports: [ZeltModule, IonicModule.forRoot(), RouterTestingModule, HttpClientTestingModule, TranslateModule.forRoot()],
      providers: [{ provide: ActivatedRoute, useValue: { paramMap: params } }],
    }).compileComponents();
  }));

  beforeEach(() => {
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(BrowserPage);
  });

  afterEach(() => http.verify());

  it('makes the tent the Subjekt when the route names no Ding', async () => {
    fixture.detectChanges();
    http.expectOne(`${environment.API_URL}/api/zelte/z1`).flush(zelt);
    await warte();

    dingeAnfrage().flush({
      dinge: [{ ding_id: 'zelt:z1', zelt_id: 'z1', art: 'zelt', name: 'Zelt Keller', t: zelt.tag_null, t_ende: null }],
    });
    await warte();
    fixture.detectChanges();

    expect(fixture.componentInstance.subjekt?.art).toBe('zelt');
    expect(fixture.nativeElement.querySelector('app-zelt-koerper')).toBeTruthy();
  });

  it('renders a tent that has never had a device, with nothing stubbed', async () => {
    fixture.detectChanges();
    http.expectOne(`${environment.API_URL}/api/zelte/z1`).flush(zelt);
    await warte();

    // Six of the nine projections answer with nothing here, and that is the
    // whole page: no device rows, no placeholder, no empty state.
    dingeAnfrage().flush({ dinge: [] });
    await warte();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-tafel')).toBeTruthy();
    expect(fixture.componentInstance.subjekt?.ding_id).toBe('zelt:z1');
    expect(fixture.nativeElement.querySelectorAll('[disabled]').length).toBe(0);
  });

  it('follows the server’s cursor when the route names a Ding on a later page', async () => {
    params.next(convertToParamMap({ zelt_id: 'z1', ding_id: 'weit-hinten' }));
    fixture.detectChanges();
    http.expectOne(`${environment.API_URL}/api/zelte/z1`).flush(zelt);
    await warte();

    const erste = dingeAnfrage();
    expect(erste.request.params.has('cursor')).toBeFalse();
    erste.flush({ dinge: [{ ding_id: 'g1', zelt_id: 'z1', art: 'gabe', name: '', t: 20, d: {} }], cursor: 'seite-2' });
    await warte();

    const zweite = dingeAnfrage();
    expect(zweite.request.params.get('cursor')).toBe('seite-2');
    zweite.flush({ dinge: [{ ding_id: 'weit-hinten', zelt_id: 'z1', art: 'notiz', name: '', t: 10, d: { text: 'da' } }] });
    await warte();
    fixture.detectChanges();

    expect(fixture.componentInstance.subjekt?.ding_id).toBe('weit-hinten');
  });

  it('loads the next page on the cursor the server handed out', async () => {
    fixture.detectChanges();
    http.expectOne(`${environment.API_URL}/api/zelte/z1`).flush(zelt);
    await warte();

    dingeAnfrage().flush({ dinge: [{ ding_id: 'g1', zelt_id: 'z1', art: 'gabe', name: '', t: 20, d: {} }], cursor: 'seite-2' });
    await warte();

    expect(fixture.componentInstance.weitereVorhanden).toBeTrue();

    const geladen = fixture.componentInstance.mehr();
    const naechste = dingeAnfrage();
    expect(naechste.request.params.get('cursor')).toBe('seite-2');
    naechste.flush({ dinge: [{ ding_id: 'g2', zelt_id: 'z1', art: 'gabe', name: '', t: 10, d: {} }] });
    await geladen;

    expect(fixture.componentInstance.dinge.map(ding => ding.ding_id)).toEqual(['g1', 'g2']);
    expect(fixture.componentInstance.weitereVorhanden).toBeFalse();
  });
});
