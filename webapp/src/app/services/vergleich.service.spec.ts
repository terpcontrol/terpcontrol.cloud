import { TestBed } from '@angular/core/testing';
import { VergleichService } from './vergleich.service';

const TAG = 24 * 3600 * 1000;

describe('VergleichService', () => {
  let dienst: VergleichService;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.removeItem('tc-zuletzt-z1');
    TestBed.configureTestingModule({});
    dienst = TestBed.inject(VergleichService);
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.removeItem('tc-zuletzt-z1');
  });

  it('starts a new session at `zuletzt`, and at yesterday when there has been no visit', () => {
    const start = dienst.fuerZelt('z1');
    expect(start.anker).toBe('gestern');
    expect(start.von).toBeCloseTo(Date.now() - TAG, -4);
  });

  it('writes „zuletzt hier" on blur, so the next session has something to resolve', () => {
    dienst.fuerZelt('z1');
    dienst.besuchNotieren();

    expect(Number(localStorage.getItem('tc-zuletzt-z1'))).toBeCloseTo(Date.now(), -4);
  });

  it('resolves `zuletzt` from this phone when a visit was noted, and says so', () => {
    const besuch = Date.now() - 3 * TAG;
    localStorage.setItem('tc-zuletzt-z1', String(besuch));

    const start = dienst.fuerZelt('z1');
    expect(start).toEqual({ von: besuch, anker: 'zuletzt' });
    expect(dienst.zuletztPersoenlich).toBeFalse();
  });

  it('prefers the person’s own last visit when the session carries one', () => {
    const eigener = Date.now() - 5 * TAG;
    localStorage.setItem('tc-zuletzt-z1', String(Date.now() - TAG));
    dienst.menschBesuchSetzen(eigener);

    expect(dienst.fuerZelt('z1')).toEqual({ von: eigener, anker: 'zuletzt' });
    expect(dienst.zuletztPersoenlich).toBeTrue();
  });

  it('does not move when the same tent is named again - which is what walking does', () => {
    dienst.fuerZelt('z1');
    dienst.setzen(1234567890, 'gabe');

    expect(dienst.fuerZelt('z1')).toEqual({ von: 1234567890, anker: 'gabe' });
    expect(dienst.wert?.von).toBe(1234567890);
  });

  it('mirrors to sessionStorage and never to localStorage', () => {
    dienst.fuerZelt('z1');
    dienst.setzen(1700000000000, 'foto');

    expect(JSON.parse(sessionStorage.getItem('tc-vergleich-z1') ?? '{}')).toEqual({ von: 1700000000000, anker: 'foto' });
    expect(localStorage.getItem('tc-vergleich-z1')).toBeNull();
  });

  it('picks the mirrored cursor back up after a reload', () => {
    sessionStorage.setItem('tc-vergleich-z1', JSON.stringify({ von: 1700000000000, anker: 'gabe' }));
    expect(dienst.fuerZelt('z1')).toEqual({ von: 1700000000000, anker: 'gabe' });
  });

  it('hands the chart the window from the cursor to now', () => {
    dienst.fuerZelt('z1');
    dienst.setzen(1700000000000, 'frei');

    const [von, bis] = dienst.fenster(1700000900000);
    expect(von).toBe(1700000000000);
    expect(bis).toBe(1700000900000);
  });

  it('publishes the drag so anything that would reflow can reserve its height first', () => {
    const gesehen: boolean[] = [];
    dienst.zieht$.subscribe(zieht => gesehen.push(zieht));

    dienst.ziehtSetzen(true);
    dienst.ziehtSetzen(true);
    dienst.ziehtSetzen(false);

    expect(gesehen).toEqual([false, true, false]);
  });
});
