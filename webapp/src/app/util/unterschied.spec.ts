import type { Ding } from '@fg2/shared-types';
import { Messung } from './messquellen';
import { KAPPE, nachAbweichung, unterschiedZeilen } from './unterschied';

const TAG = 24 * 3600 * 1000;
const STUNDE = 3600 * 1000;
const JETZT = Date.UTC(2026, 7, 25, 12, 0, 0);

const ding = (id: string, art: Ding['art'], t: number, zusatz: Partial<Ding> = {}): Ding => ({
  ding_id: id,
  zelt_id: 'z1',
  art: art,
  name: '',
  t: t,
  ...zusatz,
});

const reihe = (mass: string, punkte: [number, number][], quelle: 'hand' | 'geraet' = 'geraet'): Messung[] =>
  punkte.map(([t, wert]) => ({
    mass: mass,
    herkunft: quelle === 'hand' ? { quelle: 'hand' as const } : { quelle: 'geraet' as const, geraet_id: 'c1' },
    wert: wert,
    t: t,
  }));

/** A series that always says roughly the same thing, at the same time every day. */
const ruhig = (mass: string, wert: number, streuung: number, tage = 14): Messung[] =>
  reihe(
    mass,
    // The newest reading is the base value, so a test can name what „vorher"
    // was without counting the wobble backwards.
    Array.from(
      { length: tage },
      (_x, index) => [JETZT - index * TAG, index === 0 ? wert : wert + (index % 2 ? streuung : -streuung)] as [number, number],
    ),
  );

describe('the ranked diff table', () => {
  it('marks a change beyond a measure’s own noise, and one inside it', () => {
    // CO₂ wanders by 30 ppm all day; pH sits still. A 14 ppm move is noise and
    // a 0,3 pH move is not, however the raw numbers compare.
    const messungen = [...ruhig('co2', 400, 30), ...ruhig('ph', 6.3, 0.02)];
    const jetztWerte = [...reihe('co2', [[JETZT + STUNDE, 414]]), ...reihe('ph', [[JETZT + STUNDE, 6.6]])];

    const zeilen = unterschiedZeilen({
      vorher: [],
      jetzt: [],
      messungenVorher: messungen,
      messungenJetzt: [...messungen, ...jetztWerte],
      bis: JETZT + STUNDE,
      zeitzone: 'Europe/Berlin',
    });

    expect(zeilen.find(zeile => zeile.mass === 'co2')?.marke).toBe('ruhig');
    expect(zeilen.find(zeile => zeile.mass === 'ph')?.marke).toBe('ueber');
  });

  it('never marks a row whose σ is unknown as beyond its noise', () => {
    const zeilen = unterschiedZeilen({
      vorher: [ding('g1', 'gabe', JETZT - TAG, { d: { wasser_l: 12.5 } })],
      jetzt: [ding('g1', 'gabe', JETZT - TAG, { d: { wasser_l: 12.5 } }), ding('g2', 'gabe', JETZT, { d: { wasser_l: 4 } })],
      bis: JETZT,
    });

    const wasser = zeilen.find(zeile => zeile.mass === 'wasser_gesamt');
    expect(wasser?.delta).toBe(4);
    expect(wasser?.sigma).toBeNull();
    expect(wasser?.marke).toBe('ruhig');
  });

  it('ranks the real change above the noisy one, whatever the raw numbers say', () => {
    const messungen = [...ruhig('co2', 400, 30), ...ruhig('ph', 6.3, 0.02)];
    const jetztWerte = [...reihe('co2', [[JETZT + STUNDE, 414]]), ...reihe('ph', [[JETZT + STUNDE, 6.6]])];

    const zeilen = nachAbweichung(
      unterschiedZeilen({
        vorher: [],
        jetzt: [],
        messungenVorher: messungen,
        messungenJetzt: [...messungen, ...jetztWerte],
        bis: JETZT + STUNDE,
        zeitzone: 'Europe/Berlin',
      }),
    );

    expect(zeilen[0].mass).toBe('ph');
  });

  it('reorders inside a band and never across one', () => {
    const messungen = [...ruhig('co2', 400, 30), ...ruhig('ph', 6.3, 0.02, 14)];
    const zeilen = nachAbweichung(
      unterschiedZeilen({
        vorher: [ding('g1', 'gabe', JETZT - TAG, { d: { wasser_l: 12.5 } })],
        jetzt: [
          ding('g1', 'gabe', JETZT - TAG, { d: { wasser_l: 12.5 } }),
          ding('g2', 'gabe', JETZT, { d: { wasser_l: 40, messwerte: { hoehe_cm: 51 } } }),
        ],
        messungenVorher: messungen,
        messungenJetzt: [...messungen, ...reihe('co2', [[JETZT + STUNDE, 900]])],
        bis: JETZT + STUNDE,
        zeitzone: 'Europe/Berlin',
      }),
    );

    const gruppen = zeilen.map(zeile => zeile.gruppe);
    // Measured climate, then hand measures, then targets, then sums, then counts.
    expect(gruppen).toEqual([...gruppen].sort((links, rechts) => reihenfolge(links) - reihenfolge(rechts)));
  });

  it('keeps a target under the measure it belongs to when the band is reordered', () => {
    const messungen = [...ruhig('temperatur', 24, 0.1), ...ruhig('co2', 400, 30)];
    const ziele = [
      ding('ziel:1', 'ziel', JETZT - 5 * TAG, { d: { schluessel: 'day.temperature', wert: 25 } }),
    ];

    const zeilen = nachAbweichung(
      unterschiedZeilen({
        vorher: ziele,
        jetzt: ziele,
        messungenVorher: messungen,
        messungenJetzt: [...messungen, ...reihe('temperatur', [[JETZT + STUNDE, 27]])],
        bis: JETZT + STUNDE,
        zeitzone: 'Europe/Berlin',
      }),
    );

    const stelle = zeilen.findIndex(zeile => zeile.eingerueckt);
    expect(stelle).toBeGreaterThan(0);
    expect(zeilen[stelle - 1].mass).toBe('temperatur');
  });

  it('has eleven rows before it needs a „weitere" Zeile', () => {
    expect(KAPPE).toBe(11);
  });

  it('is the same function with no device: it simply has fewer bands to rank', () => {
    const zeilen = nachAbweichung(
      unterschiedZeilen({
        vorher: [ding('n1', 'notiz', JETZT - 3 * TAG, { d: { text: 'x', messwerte: { hoehe_cm: 48 } } })],
        jetzt: [
          ding('n1', 'notiz', JETZT - 3 * TAG, { d: { text: 'x', messwerte: { hoehe_cm: 48 } } }),
          ding('n2', 'notiz', JETZT, { d: { text: 'y', messwerte: { hoehe_cm: 51 } } }),
        ],
        bis: JETZT,
      }),
    );

    expect(zeilen.some(zeile => zeile.gruppe === 'geraet')).toBeFalse();
    expect(zeilen.find(zeile => zeile.mass === 'hoehe_cm')?.delta).toBe(3);
  });
});

const REIHENFOLGE = ['geraet', 'hand', 'ziel', 'summe', 'anzahl'];
const reihenfolge = (gruppe: string): number => REIHENFOLGE.indexOf(gruppe);
