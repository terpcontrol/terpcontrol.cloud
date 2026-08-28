import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import type { Ding } from '@fg2/shared-types';
import { environment } from 'src/environments/environment';
import { DingeService } from './dinge.service';

const ding = (ding_id: string, t: number): Ding => ({ ding_id: ding_id, zelt_id: 'z1', art: 'notiz', name: '', t: t });

/** Let the awaited continuation inside `stapel` run before asking for the next request. */
const weiter = () => new Promise<void>(fertig => setTimeout(fertig, 0));

describe('DingeService', () => {
  let service: DingeService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(DingeService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks for a page without inventing a cursor', () => {
    void service.seite({ zelt_id: 'z1', limit: 100 });

    const anfrage = http.expectOne(request => request.url === `${environment.API_URL}/api/dinge`);
    expect(anfrage.request.params.get('zelt_id')).toBe('z1');
    expect(anfrage.request.params.get('limit')).toBe('100');
    expect(anfrage.request.params.has('cursor')).toBeFalse();
    // The sort key is the server's business; a client that sends these has
    // invented an API nobody promised.
    expect(anfrage.request.params.has('t')).toBeFalse();
    expect(anfrage.request.params.has('ding_id')).toBeFalse();
    anfrage.flush({ dinge: [] });
  });

  it('hands the server’s cursor back verbatim and stops when it stops handing one out', async () => {
    const stapel = service.stapel({ zelt_id: 'z1', limit: 2 });

    const erste = http.expectOne(request => request.url === `${environment.API_URL}/api/dinge`);
    expect(erste.request.params.has('cursor')).toBeFalse();
    erste.flush({ dinge: [ding('a', 30), ding('b', 20)], cursor: 'MTAwMDphYmM' });
    await weiter();

    const zweite = http.expectOne(request => request.url === `${environment.API_URL}/api/dinge`);
    expect(zweite.request.params.get('cursor')).toBe('MTAwMDphYmM');
    zweite.flush({ dinge: [ding('c', 10)] });
    await weiter();

    const ergebnis = await stapel;
    expect(ergebnis.dinge.map(eintrag => eintrag.ding_id)).toEqual(['a', 'b', 'c']);
    expect(ergebnis.cursor).toBeUndefined();
    expect(ergebnis.vollstaendig).toBeTrue();
  });

  it('stops at the page limit and keeps the cursor it stopped on', async () => {
    const stapel = service.stapel({ zelt_id: 'z1' }, 1);

    http.expectOne(request => request.url === `${environment.API_URL}/api/dinge`).flush({ dinge: [ding('a', 30)], cursor: 'weiter' });
    await weiter();

    const ergebnis = await stapel;
    expect(ergebnis.cursor).toBe('weiter');
    expect(ergebnis.vollstaendig).toBeFalse();
  });

  it('stops paging as soon as the caller has what it came for', async () => {
    const stapel = service.stapel({ zelt_id: 'z1' }, 5, dinge => dinge.some(eintrag => eintrag.ding_id === 'b'));

    http
      .expectOne(request => request.url === `${environment.API_URL}/api/dinge`)
      .flush({ dinge: [ding('a', 30), ding('b', 20)], cursor: 'weiter' });
    await weiter();

    const ergebnis = await stapel;
    expect(ergebnis.dinge.length).toBe(2);
  });

  it('prints the literal request Werte {…} shows', () => {
    const url = service.anfrageUrl({ zelt_id: 'z1', arten: ['gabe', 'notiz'], limit: 100 });

    expect(url).toContain('/api/dinge?');
    expect(url).toContain('zelt_id=z1');
    expect(url).toContain('art=gabe,notiz');
  });
});
