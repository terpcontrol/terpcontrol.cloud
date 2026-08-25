import type { Ding, Zelt } from '@fg2/shared-types';
import { Messung } from './messquellen';
import { aufloesen, detents, dichteband, griffart, momentDetents, naechsterUnterschied, zeitlage } from './vergleich';

const TAG = 24 * 3600 * 1000;
const STUNDE = 3600 * 1000;
const JETZT = Date.UTC(2026, 7, 25, 12, 0, 0);

/** The reference case: a grow, a diary, and no hardware anywhere. */
const zelt = (zusatz: Partial<Zelt> = {}): Zelt => ({
  zelt_id: 'z1',
  besitzer_id: 'u1',
  name: 'Zelt Keller',
  geraete: [],
  zeitzone: 'Europe/Berlin',
  tag_null: JETZT - 30 * TAG,
  erstellt_at: JETZT - 30 * TAG,
  ...zusatz,
});

const ding = (id: string, art: Ding['art'], t: number, zusatz: Partial<Ding> = {}): Ding => ({
  ding_id: id,
  zelt_id: 'z1',
  art: art,
  name: '',
  t: t,
  ...zusatz,
});

describe('the one rule of §8.1', () => {
  it('scrubs a moment for a Ding that has a state', () => {
    expect(griffart('zelt')).toBe('moment');
    expect(griffart('pflanze')).toBe('moment');
    expect(griffart('dose')).toBe('moment');
    expect(griffart('ziel')).toBe('moment');
  });

  it('walks the predecessor chain for a Ding that is a moment', () => {
    expect(griffart('gabe')).toBe('kette');
    expect(griffart('notiz')).toBe('kette');
    expect(griffart('bild')).toBe('kette');
    expect(griffart('phase')).toBe('kette');
  });

  it('reaches a person through their own entries and a film through its frames', () => {
    expect(griffart('mensch')).toBe('besuch');
    expect(griffart('film')).toBe('kapitel');
  });
});

describe('the ladder, on a tent with no device', () => {
  const dinge = [
    ding('g1', 'gabe', JETZT - 3 * TAG),
    ding('n1', 'notiz', JETZT - 2 * TAG),
    ding('b1', 'bild', JETZT - 30 * STUNDE),
    ding('p1', 'phase', JETZT - 10 * TAG, { d: { stufe: 'flowering' } }),
  ];

  it('has rungs without a single reading', () => {
    const ladder = momentDetents({ zelt: zelt(), dinge: dinge, jetzt: JETZT }).map(detent => detent.id);

    expect(ladder).toContain('beginn');
    expect(ladder).toContain('gestern');
    expect(ladder).toContain('woche');
    expect(ladder).toContain('gabe');
    expect(ladder).toContain('foto');
    expect(ladder).toContain('phase');
  });

  it('leaves out `gestern Abend` while nothing has said when the light goes off', () => {
    const ohne = momentDetents({ zelt: zelt(), dinge: dinge, jetzt: JETZT }).map(detent => detent.id);
    expect(ohne).not.toContain('abend');

    // A hand-typed light schedule is a claim, and a claim is enough (§8.1).
    const mit = momentDetents({
      zelt: zelt({ d: { licht_plan: { an: 6 * 3600, aus: 24 * 3600 - 3600 } } }),
      dinge: dinge,
      jetzt: JETZT,
    }).map(detent => detent.id);
    expect(mit).toContain('abend');
  });

  it('grows `Lauf n` the moment a second run exists, and not before', () => {
    const einer = [...dinge, ding('l1', 'lauf', JETZT - 30 * TAG, { t_ende: null, d: { nummer: 1 } })];
    expect(momentDetents({ zelt: zelt(), dinge: einer, jetzt: JETZT }).map(d => d.id)).not.toContain('lauf');

    const zwei = [
      ding('l1', 'lauf', JETZT - 200 * TAG, { t_ende: JETZT - 40 * TAG, d: { nummer: 1 } }),
      ding('l2', 'lauf', JETZT - 30 * TAG, { t_ende: null, d: { nummer: 2 } }),
      ...dinge,
    ];
    const lauf = momentDetents({ zelt: zelt({ tag_null: JETZT - 200 * TAG }), dinge: zwei, jetzt: JETZT }).find(d => d.id === 'lauf');
    expect(lauf).toBeTruthy();
    // The same day number in the previous run: 30 days into it.
    expect(lauf?.von).toBe(JETZT - 200 * TAG + 30 * TAG);
  });

  it('chains a Gabe against the previous Gabe and nothing else', () => {
    const kette = detents({ zelt: zelt(), dinge: [...dinge, ding('g2', 'gabe', JETZT - STUNDE)], jetzt: JETZT }, ding('g2', 'gabe', JETZT - STUNDE));
    expect(kette.length).toBe(1);
    expect(kette[0].von).toBe(JETZT - 3 * TAG);
  });
});

describe('snapping', () => {
  const dinge = [ding('a', 'notiz', JETZT - 5 * TAG), ding('b', 'gabe', JETZT - 2 * TAG)];

  it('lands on the newest Ding at or before the thumb when only entries exist', () => {
    const gelandet = aufloesen(JETZT - 3 * TAG, dinge, false);
    expect(gelandet.von).toBe(JETZT - 5 * TAG);
    expect(gelandet.verschoben).toBeTrue();
  });

  it('lands on the minute when something samples every few seconds', () => {
    const gelandet = aufloesen(JETZT - 3 * TAG + 12345, dinge, true);
    expect(gelandet.von % 60000).toBe(0);
    expect(gelandet.verschoben).toBeFalse();
  });
});

describe('Nächster Unterschied', () => {
  const dinge = [ding('a', 'notiz', JETZT - 5 * TAG), ding('b', 'gabe', JETZT - 2 * TAG), ding('c', 'bild', JETZT - TAG)];

  it('lands on the next moment that has something in it', () => {
    expect(naechsterUnterschied(JETZT - 5 * TAG, dinge, [], JETZT)).toBe(JETZT - 2 * TAG);
    expect(naechsterUnterschied(JETZT - 2 * TAG, dinge, [], JETZT)).toBe(JETZT - TAG);
  });

  it('says there is no next one rather than moving the cursor somewhere useless', () => {
    expect(naechsterUnterschied(JETZT - STUNDE, dinge, [], JETZT)).toBeNull();
  });

  it('takes a reading that moved by more than its own σ when one comes first', () => {
    const reihe: Messung[] = [22, 22.1, 21.9, 22, 30].map((wert, index) => ({
      mass: 'temperatur',
      herkunft: { quelle: 'geraet' as const, geraet_id: 'd1' },
      wert: wert,
      t: JETZT - 5 * TAG + index * STUNDE,
    }));

    expect(naechsterUnterschied(JETZT - 5 * TAG, dinge, reihe, JETZT)).toBe(JETZT - 5 * TAG + 4 * STUNDE);
  });
});

describe('the Dichteband', () => {
  it('is one bar per day, and a week nobody touched stays a visible gap', () => {
    const dinge = [ding('a', 'notiz', JETZT - 9 * TAG), ding('b', 'bild', JETZT - TAG), ding('c', 'gabe', JETZT - TAG)];
    const band = dichteband(zelt(), dinge, JETZT - 9 * TAG, JETZT);

    expect(band.length).toBe(10);
    expect(band[0].dinge).toBe(1);
    expect(band.slice(1, 8).every(tag => tag.dinge === 0 && tag.bilder === 0)).toBeTrue();
    // Stacked per source: entries below, kept frames above, never added up.
    expect(band[8].dinge).toBe(1);
    expect(band[8].bilder).toBe(1);
  });
});

describe('what pause unfolds', () => {
  it('answers `Damals galt:` from what a human said once, with no device anywhere', () => {
    const dinge = [
      ding('p1', 'phase', JETZT - 10 * TAG, { d: { stufe: 'flowering' } }),
      ding('s1', 'schema', JETZT - 20 * TAG, { name: 'Biobizz', d: { schritt: 6 } }),
      ding('g1', 'gabe', JETZT - 5 * TAG, { d: { wasser_l: 2, messwerte: { ph: 6.1 } } }),
    ];

    const lage = zeitlage({ zelt: zelt({ d: { licht_plan: { an: 6 * 3600, aus: 18 * 3600 } } }), dinge: dinge, moment: JETZT - 5 * TAG });

    expect(lage.damals.map(text => text.key)).toEqual(['zelt.lage.phase', 'zelt.lage.schema', 'zelt.lage.lichtplan']);
    // `Lief:` needs a device and is absent rather than replaced by a lookalike.
    expect(lage.lief).toEqual([]);
    expect(lage.nahe.map(nah => nah.ding_id)).toEqual(['g1']);
  });
});
