import type { Ding, Zelt } from '@fg2/shared-types';
import { Messung } from './messquellen';
import { vorherLage, vorherVerschoben } from './vorher';

const TAG = 24 * 3600 * 1000;
const STUNDE = 3600 * 1000;
const JETZT = Date.UTC(2026, 7, 25, 12, 0, 0);

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

const gaben = [
  ding('g1', 'gabe', JETZT - 10 * TAG, { d: { wasser_l: 2 } }),
  ding('g2', 'gabe', JETZT - 6 * TAG, { d: { wasser_l: 2 } }),
  ding('g3', 'gabe', JETZT - 2 * TAG, { d: { wasser_l: 2 } }),
];

const basis = (zusatz: Partial<Parameters<typeof vorherLage>[0]> = {}) => ({
  zelt: zelt(),
  dinge: gaben,
  subjekt: null,
  cursor: JETZT - TAG,
  jetzt: JETZT,
  ...zusatz,
});

describe('per-art Vorher resolution - §8.1', () => {
  it('takes the cursor itself for a Ding that has a state', () => {
    const lage = vorherLage(basis({ subjekt: ding('zelt:z1', 'zelt', JETZT - 30 * TAG) }));

    expect(lage.griffart).toBe('moment');
    expect(lage.von).toBe(JETZT - TAG);
    expect(lage.spalte).toBe('vorher');
    expect(lage.kappe.key).toBe('zelt.kappe.vorher');
  });

  it('takes the same cursor for every state art - one cursor, one meaning', () => {
    for (const art of ['zelt', 'pflanze', 'dose', 'kamera', 'ziel', 'schema', 'lauf', 'geraet'] as const) {
      expect(vorherLage(basis({ subjekt: ding('x', art, JETZT - 20 * TAG) })).von).toBe(JETZT - TAG);
    }
  });

  it('walks the predecessor chain for a Ding that is a moment', () => {
    const lage = vorherLage(basis({ subjekt: gaben[2], cursor: JETZT - TAG }));

    expect(lage.griffart).toBe('kette');
    // Not the cursor: the newest Gabe before it.
    expect(lage.von).toBe(gaben[1].t);
  });

  it('lets the handle choose which predecessor, rather than owning a second cursor', () => {
    expect(vorherLage(basis({ subjekt: gaben[2], cursor: JETZT - 8 * TAG })).von).toBe(gaben[0].t);
    expect(vorherLage(basis({ subjekt: gaben[2], cursor: JETZT - 20 * TAG })).von).toBe(gaben[0].t);
  });

  it('chains a Gabe along the plants it went to', () => {
    const anA1 = ding('a1', 'gabe', JETZT - 9 * TAG, { rel: { an: ['p1'] }, d: { wasser_l: 1 } });
    const anA2 = ding('a2', 'gabe', JETZT - 5 * TAG, { rel: { an: ['p2'] }, d: { wasser_l: 1 } });
    const subjekt = ding('a3', 'gabe', JETZT - TAG, { rel: { an: ['p1'] }, d: { wasser_l: 1 } });

    expect(vorherLage(basis({ dinge: [anA1, anA2, subjekt], subjekt: subjekt, cursor: JETZT })).von).toBe(anA1.t);
  });

  it('diffs a person against their own previous visit', () => {
    const anna = ding('m1', 'mensch', JETZT - 20 * TAG, { name: 'Anna' });
    const ihre = [
      ding('e1', 'notiz', JETZT - 9 * TAG, { akteur: 'm1' }),
      ding('e2', 'notiz', JETZT - 4 * TAG, { akteur: 'm1' }),
      ding('e3', 'notiz', JETZT - 3 * TAG, { akteur: 'andere' }),
    ];

    const lage = vorherLage(basis({ dinge: [anna, ...ihre], subjekt: anna, cursor: JETZT }));
    expect(lage.griffart).toBe('besuch');
    expect(lage.von).toBe(ihre[1].t);
  });

  it('diffs a film against its own frames', () => {
    const frames = [ding('b1', 'bild', JETZT - 5 * TAG), ding('b2', 'bild', JETZT - 4 * TAG)];
    const film = ding('fi1', 'film', JETZT - 3 * TAG, { bilder: ['b1', 'b2'] });

    const lage = vorherLage(basis({ dinge: [...frames, film], subjekt: film, cursor: JETZT }));
    expect(lage.griffart).toBe('kapitel');
    expect(lage.von).toBe(frames[1].t);
  });
});

describe('§7.4 - day one, and the comparand in the same frame', () => {
  const heute = ding('zelt:z1', 'zelt', JETZT);

  it('becomes ZIEL when a device was claimed', () => {
    const lage = vorherLage(
      basis({ zelt: zelt({ tag_null: JETZT, geraete: [{ geraet_id: 'c1', seit: JETZT }] }), dinge: [heute], subjekt: heute, cursor: JETZT }),
    );

    expect(lage.spalte).toBe('ziel');
    expect(lage.kappe.key).toBe('zelt.kappe.ziel');
  });

  it('becomes PLAN when a schema was chosen and nothing else exists', () => {
    const lage = vorherLage(basis({ zelt: zelt({ tag_null: JETZT, d: { schema_id: 'biobizz' } }), dinge: [heute], subjekt: heute, cursor: JETZT }));

    expect(lage.spalte).toBe('plan');
  });

  it('becomes BEGINN when neither exists - and never an empty state', () => {
    const lage = vorherLage(basis({ zelt: zelt({ tag_null: JETZT }), dinge: [heute], subjekt: heute, cursor: JETZT }));

    expect(lage.spalte).toBe('beginn');
    expect(lage.kappe.key).toBe('zelt.kappe.beginn');
  });

  it('applies the same three comparands to a chain with no predecessor', () => {
    const erste = ding('g0', 'gabe', JETZT, { d: { wasser_l: 2 } });
    expect(vorherLage(basis({ zelt: zelt({ tag_null: JETZT }), dinge: [erste], subjekt: erste, cursor: JETZT })).spalte).toBe('beginn');
  });

  it('counts a series as evidence, so a device tent has a Vorher before anybody types', () => {
    const messungen: Messung[] = [{ mass: 'temperatur', herkunft: { quelle: 'geraet', geraet_id: 'c1' }, wert: 24, t: JETZT - 2 * STUNDE }];
    const lage = vorherLage(
      basis({ zelt: zelt({ geraete: [{ geraet_id: 'c1', seit: JETZT - TAG }] }), dinge: [heute], subjekt: heute, cursor: JETZT - STUNDE, messungen: messungen }),
    );

    expect(lage.spalte).toBe('vorher');
  });
});

describe('§9.2 - moving the Vorher half', () => {
  it('moves the half without touching where the reader put the cursor', () => {
    const lage = vorherLage(basis({ subjekt: null }));
    const verschoben = vorherVerschoben(lage, gaben[0].t);

    expect(verschoben.von).toBe(gaben[0].t);
    expect(verschoben.verschoben).toBeTrue();
    expect(lage.von).toBe(JETZT - TAG);
  });

  it('is a no-op when there is nowhere to move to', () => {
    const lage = vorherLage(basis({ subjekt: null }));
    expect(vorherVerschoben(lage, lage.von)).toBe(lage);
  });
});
