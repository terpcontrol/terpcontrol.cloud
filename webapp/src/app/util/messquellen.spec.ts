import { messzeilen } from './messquellen';
import { unterschiedZeilen } from './unterschied';
import type { Ding } from '@fg2/shared-types';

const ding = (teil: Partial<Ding>): Ding => ({
  ding_id: 'x',
  zelt_id: 'z',
  art: 'notiz',
  name: '',
  t: 1000,
  ...teil,
});

describe('the provenance rule', () => {
  it('makes two devices reporting one measure two rows, and averages nothing', () => {
    const zeilen = messzeilen([
      { mass: 'temperatur', herkunft: { quelle: 'geraet', geraet_id: 'controller' }, wert: 24, t: 10 },
      { mass: 'temperatur', herkunft: { quelle: 'geraet', geraet_id: 'balkon' }, wert: 18, t: 10 },
    ]);

    expect(zeilen.length).toBe(2);
    expect(zeilen.map(zeile => zeile.wert).sort()).toEqual([18, 24]);
    // 21 is the average of the two, and it must exist nowhere.
    expect(zeilen.some(zeile => zeile.wert === 21)).toBeFalse();
    expect(zeilen.every(zeile => zeile.herkunftZeigen)).toBeTrue();
  });

  it('makes a hand reading and a device reading of one measure two rows', () => {
    const zeilen = messzeilen([
      { mass: 'temperatur', herkunft: { quelle: 'geraet', geraet_id: 'controller' }, wert: 24.1, t: 10 },
      { mass: 'temperatur', herkunft: { quelle: 'hand' }, wert: 26, t: 12 },
    ]);

    expect(zeilen.length).toBe(2);
    expect(zeilen.find(zeile => zeile.herkunft.quelle === 'hand')?.wert).toBe(26);
    expect(zeilen.find(zeile => zeile.herkunft.quelle === 'geraet')?.wert).toBe(24.1);
  });

  it('keeps the newest reading of one origin without merging it with another origin', () => {
    const zeilen = messzeilen([
      { mass: 'ph', herkunft: { quelle: 'hand' }, wert: 6.4, t: 10 },
      { mass: 'ph', herkunft: { quelle: 'hand' }, wert: 6.2, t: 20 },
    ]);

    expect(zeilen.length).toBe(1);
    expect(zeilen[0].wert).toBe(6.2);
  });

  it('names the origin of a hand reading even when it is the only one', () => {
    const zeilen = messzeilen([{ mass: 'hoehe_cm', herkunft: { quelle: 'hand' }, wert: 48, t: 10 }]);

    expect(zeilen[0].herkunftZeigen).toBeTrue();
  });

  it('leaves a lone device measure unqualified - the measure still identifies the row', () => {
    const zeilen = messzeilen([{ mass: 'co2', herkunft: { quelle: 'geraet', geraet_id: 'controller' }, wert: 412, t: 10 }]);

    expect(zeilen[0].herkunftZeigen).toBeFalse();
  });

  it('carries the rule into the difference table', () => {
    const zeilen = unterschiedZeilen({
      vorher: [],
      jetzt: [],
      messungenJetzt: [
        { mass: 'temperatur', herkunft: { quelle: 'geraet', geraet_id: 'controller', geraet_name: 'Controller' }, wert: 24, t: 10 },
        { mass: 'temperatur', herkunft: { quelle: 'geraet', geraet_id: 'balkon', geraet_name: 'Steckdose Balkon' }, wert: 18, t: 10 },
      ],
    });

    const temperatur = zeilen.filter(zeile => zeile.mass === 'temperatur');
    expect(temperatur.length).toBe(2);
    expect(temperatur.map(zeile => zeile.jetzt).sort()).toEqual([18, 24]);
    expect(temperatur.every(zeile => zeile.herkunftZeigen)).toBeTrue();
  });

  it('reads a pH felt while watering and one written on a note as the same pen', () => {
    const zeilen = unterschiedZeilen({
      vorher: [],
      jetzt: [
        ding({ ding_id: 'a', art: 'gabe', t: 10, d: { wasser_l: 2, messwerte: { ph: 6.4 } } }),
        ding({ ding_id: 'b', art: 'notiz', t: 20, d: { text: 'gemessen', messwerte: { ph: 6.2 } } }),
      ],
    });

    const ph = zeilen.filter(zeile => zeile.mass === 'ph');
    expect(ph.length).toBe(1);
    expect(ph[0].jetzt).toBe(6.2);
  });
});
