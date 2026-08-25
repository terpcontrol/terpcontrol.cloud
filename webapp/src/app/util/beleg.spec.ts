import type { Ding, Zelt } from '@fg2/shared-types';
import { beleg, standkarte, werteband } from './beleg';
import { Messung } from './messquellen';

const TAG = 24 * 3600 * 1000;
const STUNDE = 3600 * 1000;
const MINUTE = 60 * 1000;
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

const frame = (id: string, t: number): Ding => ding(id, 'bild', t, { d: { quelle: 'geraet' }, bilder: [`img-${id}`] });
const foto = (id: string, t: number): Ding => ding(id, 'bild', t, { d: { quelle: 'hand' }, bilder: [`img-${id}`] });

const messung = (mass: string, wert: number, t: number, quelle: 'hand' | 'geraet' = 'geraet'): Messung => ({
  mass: mass,
  herkunft: quelle === 'hand' ? { quelle: 'hand' } : { quelle: 'geraet', geraet_id: 'c1' },
  wert: wert,
  t: t,
});

/** A diary with something in it: two entries, a phase, a schema and an open Zettel. */
const tagebuch = (): Ding[] => [
  ding('p1', 'pflanze', JETZT - 30 * TAG, { name: 'A1' }),
  ding('ph1', 'phase', JETZT - 12 * TAG, { d: { stufe: 'flowering' } }),
  ding('sc1', 'schema', JETZT - 30 * TAG, { name: 'Biobizz All-Mix', d: { schema_id: 'biobizz', schritt: 6 } }),
  ding('g1', 'gabe', JETZT - 2 * TAG, { d: { wasser_l: 2.5, messwerte: { ph: 6.4 } } }),
  ding('n1', 'notiz', JETZT - 3 * TAG, { d: { text: 'Blätter hängen', messwerte: { hoehe_cm: 48 } } }),
  ding('z1', 'zustand', JETZT - 3 * TAG, { t_ende: null, d: { text: 'CO₂-Flasche fast leer' } }),
];

describe('beleg() - the evidence ladder of §5', () => {
  it('rung 1: a kept camera frame within ±5 min', () => {
    const dinge = [...tagebuch(), frame('f1', JETZT - 2 * MINUTE)];
    const antwort = beleg({ zelt: zelt(), dinge: dinge, messungen: [messung('temperatur', 24, JETZT)] }, JETZT);

    expect(antwort.art).toBe('bild');
    expect(antwort.image_id).toBe('img-f1');
    expect(antwort.kennung.key).toBe('zelt.beleg.kennung.bild');
  });

  it('rung 2: a hand photo within ±12 h, when no frame is near', () => {
    const dinge = [...tagebuch(), foto('u1', JETZT - 6 * STUNDE), frame('f1', JETZT - 3 * STUNDE)];
    const antwort = beleg({ zelt: zelt(), dinge: dinge }, JETZT);

    expect(antwort.art).toBe('foto');
    expect(antwort.image_id).toBe('img-u1');
    expect(antwort.kennung.key).toBe('zelt.beleg.kennung.foto');
  });

  it('rung 3: sensor samples in the last twelve hours', () => {
    const antwort = beleg(
      { zelt: zelt(), dinge: tagebuch(), messungen: [messung('temperatur', 24.1, JETZT - STUNDE), messung('temperatur', 24.8, JETZT)] },
      JETZT,
    );

    expect(antwort.art).toBe('band');
    expect(antwort.band.map(wert => wert.mass)).toEqual(['temperatur']);
    expect(antwort.band[0].min).toBe(24.1);
    expect(antwort.band[0].max).toBe(24.8);
  });

  it('rung 4: the Standkarte, which is what a tent with no device shows', () => {
    const antwort = beleg({ zelt: zelt(), dinge: tagebuch() }, JETZT);

    expect(antwort.art).toBe('karte');
    expect(antwort.kennung.key).toBe('zelt.beleg.kennung.karte');
    expect(antwort.text.length).toBeLessThanOrEqual(5);
    expect(antwort.text.map(zeile => zeile.key)).toEqual([
      'zelt.beleg.karte.tagPhase',
      'zelt.beleg.karte.schema',
      'zelt.beleg.karte.wasser',
      'zelt.beleg.karte.messwerte',
      'zelt.beleg.karte.zettel.one',
    ]);
  });

  it('rung 5: nothing, and it says which nothing', () => {
    expect(beleg({ zelt: zelt(), dinge: [], halbe: 'vorher' }, JETZT).kennung.key).toBe('zelt.beleg.nichts.keinVorher');
    expect(beleg({ zelt: zelt(), dinge: [], halbe: 'jetzt' }, JETZT).kennung.key).toBe('zelt.beleg.nichts.nochNichts');
  });

  it('never says „Noch nichts passiert" on a device-less Zelt, at any rung', () => {
    for (const halbe of ['vorher', 'jetzt'] as const) {
      const antwort = beleg({ zelt: zelt(), dinge: [], halbe: halbe }, JETZT);
      expect(antwort.kennung.key).not.toContain('passiert');
    }
  });

  it('prints the evidence kind in every arm - that is what makes there be no mode', () => {
    const arme = [
      beleg({ zelt: zelt(), dinge: [frame('f1', JETZT)] }, JETZT),
      beleg({ zelt: zelt(), dinge: [foto('u1', JETZT)] }, JETZT),
      beleg({ zelt: zelt(), dinge: [], messungen: [messung('temperatur', 24, JETZT)] }, JETZT),
      beleg({ zelt: zelt(), dinge: tagebuch() }, JETZT),
      beleg({ zelt: zelt(), dinge: [] }, JETZT),
    ];

    expect(arme.map(arm => arm.art)).toEqual(['bild', 'foto', 'band', 'karte', 'nichts']);
    for (const arm of arme) expect(arm.kennung.key).toBeTruthy();
  });

  it('ties go to the device frame', () => {
    const dinge = [frame('f1', JETZT), foto('u1', JETZT)];
    expect(beleg({ zelt: zelt(), dinge: dinge }, JETZT).art).toBe('bild');
  });

  it('resolves each half independently, so a mixed pair needs no code', () => {
    const claim = JETZT - 5 * TAG;
    const dinge = [...tagebuch(), foto('u1', claim - 2 * STUNDE), frame('f1', JETZT)];

    const links = beleg({ zelt: zelt(), dinge: dinge, halbe: 'vorher' }, claim - 2 * STUNDE);
    const rechts = beleg({ zelt: zelt(), dinge: dinge, halbe: 'jetzt' }, JETZT);

    expect(links.art).toBe('foto');
    expect(rechts.art).toBe('bild');
  });

  it('never shows a frame the cull threw away as evidence', () => {
    const verworfen = ding('f1', 'bild', JETZT, { d: { quelle: 'geraet', verworfen: true }, bilder: ['img-f1'] });
    expect(beleg({ zelt: zelt(), dinge: [verworfen, ...tagebuch()] }, JETZT).art).toBe('karte');
  });

  it('is one function: the device-less tent walks the same five rungs', () => {
    const ohne = zelt();
    const mit = zelt({ geraete: [{ geraet_id: 'c1', seit: JETZT - 30 * TAG }] });
    const dinge = tagebuch();

    // Same input, same answer: nothing in here reads the binding list at all.
    expect(beleg({ zelt: ohne, dinge: dinge }, JETZT).art).toBe(beleg({ zelt: mit, dinge: dinge }, JETZT).art);
  });
});

describe('das Werteband', () => {
  it('is unreachable device-less, because a hand reading is not a series', () => {
    const hand = [messung('ph', 6.2, JETZT - STUNDE, 'hand'), messung('ph', 6.4, JETZT, 'hand')];
    expect(werteband(hand, JETZT)).toEqual([]);
  });

  it('leaves the outputs out: a socket state has no min and max worth stacking', () => {
    const messungen = [messung('out_light', 100, JETZT), messung('temperatur', 24, JETZT)];
    expect(werteband(messungen, JETZT).map(wert => wert.mass)).toEqual(['temperatur']);
  });

  it('does not band a series that stopped reporting half a day ago', () => {
    expect(werteband([messung('temperatur', 24, JETZT - 13 * STUNDE)], JETZT)).toEqual([]);
  });
});

describe('die Standkarte', () => {
  it('is a carry-forward: it answers for a moment nobody wrote anything on', () => {
    const zeilen = standkarte(zelt(), tagebuch(), JETZT - STUNDE);
    expect(zeilen.length).toBeGreaterThan(1);
  });

  it('says nothing rather than printing a day number alone', () => {
    expect(standkarte(zelt(), [], JETZT)).toEqual([]);
  });
});
