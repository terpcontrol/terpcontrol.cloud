import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import type { Ding } from '@fg2/shared-types';
import { environment } from 'src/environments/environment';
import { AusgangProblem, AusgangService } from './dinge.service';

const URL = `${environment.API_URL}/api/dinge`;

const gabe = (ding_id: string): Ding => ({ ding_id: ding_id, zelt_id: 'z1', art: 'gabe', name: '', t: Date.now(), d: { wasser_l: 2 } });

/** Let the awaited continuation inside the drain run before asking for the next request. */
const weiter = (): Promise<void> => new Promise<void>(fertig => setTimeout(fertig, 0));

describe('AusgangService', () => {
  let ausgang: AusgangService;
  let http: HttpTestingController;

  beforeEach(() => {
    window.localStorage.removeItem('tc.ausgang');
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    ausgang = TestBed.inject(AusgangService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    window.localStorage.removeItem('tc.ausgang');
  });

  it('hands the entry back before the network has heard of it', () => {
    const ding = gabe('a');
    expect(ausgang.eintragen(ding)).toBe(ding);
    expect(ausgang.wartende('z1').map(eintrag => eintrag.ding_id)).toEqual(['a']);

    http.expectOne(URL).flush({ ding: ding });
    http.verify();
  });

  it('sends the id the client minted, and drops the entry once it is stored', async () => {
    const ding = gabe('a');
    ausgang.eintragen(ding);

    const anfrage = http.expectOne(URL);
    expect(anfrage.request.body.ding_id).toBe('a');
    anfrage.flush({ ding: ding });
    await weiter();

    expect(ausgang.wartende('z1')).toEqual([]);
    http.verify();
  });

  it('keeps the entry over a lost connection and retries it under the same id', async () => {
    const ding = gabe('a');
    ausgang.eintragen(ding);

    http.expectOne(URL).error(new ProgressEvent('offline'), { status: 0, statusText: 'offline' });
    await weiter();
    expect(ausgang.wartende('z1').map(eintrag => eintrag.ding_id)).toEqual(['a']);

    // Not awaited: the drain does not finish until the request it is waiting
    // on has been answered, and answering it is the next line.
    void ausgang.leeren();
    const zweite = http.expectOne(URL);
    // The same id, which is what makes this a retry rather than a second
    // watering: the server upserts on it.
    expect(zweite.request.body.ding_id).toBe('a');
    zweite.flush({ ding: ding });
    await weiter();

    expect(ausgang.wartende('z1')).toEqual([]);
    http.verify();
  });

  it('says a taken id out loud instead of minting a new one and logging it twice', async () => {
    const probleme: AusgangProblem[] = [];
    ausgang.probleme$.subscribe(problem => probleme.push(problem));

    ausgang.eintragen(gabe('a'));
    http.expectOne(URL).flush({ message: 'ding_id is already taken by a different Ding' }, { status: 409, statusText: 'Conflict' });
    await weiter();

    expect(probleme.map(problem => problem.grund)).toEqual(['konflikt']);
    expect(ausgang.wartende('z1')).toEqual([]);
    http.verify();
  });

  it('reports what the server refused rather than retrying it forever', async () => {
    const probleme: AusgangProblem[] = [];
    ausgang.probleme$.subscribe(problem => probleme.push(problem));

    ausgang.eintragen(gabe('a'));
    http.expectOne(URL).flush({ problems: [{ path: 'd.wasser_l', message: 'is required on a gabe' }] }, { status: 400, statusText: 'Bad Request' });
    await weiter();

    expect(probleme[0].grund).toBe('abgelehnt');
    expect(probleme[0].problems?.[0].path).toBe('d.wasser_l');
    http.verify();
  });

  it('survives a tab close: what is queued is written down', async () => {
    ausgang.eintragen(gabe('a'));
    http.expectOne(URL).error(new ProgressEvent('offline'), { status: 0, statusText: 'offline' });
    await weiter();

    expect(JSON.parse(window.localStorage.getItem('tc.ausgang') ?? '[]').length).toBe(1);

    // Drained here so the retry the failure scheduled finds nothing to send.
    void ausgang.leeren();
    http.expectOne(URL).flush({ ding: gabe('a') });
    await weiter();
    http.verify();
  });

  it('counts what is waiting, for the one line the screen prints', async () => {
    const staende: number[] = [];
    ausgang.anzahl$.subscribe(anzahl => staende.push(anzahl));

    ausgang.eintragen(gabe('a'));
    http.expectOne(URL).flush({ ding: gabe('a') });
    await weiter();

    expect(staende).toEqual([0, 1, 0]);
    http.verify();
  });
});
