import type { Ding, Zelt } from '@fg2/shared-types';
import {
  doppelGabe,
  gabeEntwurf,
  gabeVorgabe,
  messwerteAus,
  neueDingId,
  notizEntwurf,
  zahlAus,
  zeitfenster,
  zettelEntwurf,
} from './entwurf';

const STUNDE = 3600 * 1000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The reference case: a tent, a grow, and no hardware anywhere. */
const zelt: Zelt = {
  zelt_id: 'z1',
  besitzer_id: 'u1',
  name: 'Zelt Keller',
  geraete: [],
  zeitzone: 'Europe/Berlin',
  tag_null: Date.now() - 33 * 24 * STUNDE,
  erstellt_at: Date.now() - 33 * 24 * STUNDE,
};

const gabe = (ding_id: string, t: number, d: Record<string, unknown>, rel?: Record<string, string[]>): Ding => ({
  ding_id: ding_id,
  zelt_id: 'z1',
  art: 'gabe',
  name: '',
  t: t,
  d: d,
  rel: rel,
});

const basis = { zelt_id: 'z1', t: Date.now(), kannen: 3, kanne_l: 2, verteilung: 'gesamt' as const, pflanzen: [], produkte: [] };

describe('neueDingId', () => {
  it('mints a uuid v4, because the server upserts on it', () => {
    expect(neueDingId()).toMatch(UUID_V4);
  });

  it('mints a different one every time', () => {
    const ids = new Set(Array.from({ length: 50 }, () => neueDingId()));
    expect(ids.size).toBe(50);
  });
});

describe('zahlAus', () => {
  it('reads the comma a German keyboard offers', () => {
    expect(zahlAus('6,4')).toBe(6.4);
    expect(zahlAus('6.4')).toBe(6.4);
    expect(zahlAus('')).toBeNull();
    expect(zahlAus('viel')).toBeNull();
  });
});

describe('gabeEntwurf', () => {
  it('leaves rel out entirely when nobody picked a plant - absent is the whole tent', () => {
    const ding = gabeEntwurf(basis);
    expect(ding.rel).toBeUndefined();
    expect(ding.d?.['wasser_l']).toBe(6);
  });

  it('names the plants when some were picked, and never sends an empty edge', () => {
    const ding = gabeEntwurf({ ...basis, pflanzen: ['p1', 'p2'] });
    expect(ding.rel?.['an']).toEqual(['p1', 'p2']);

    const leer = gabeEntwurf({ ...basis, pflanzen: [] });
    expect(leer.rel?.['an']).toBeUndefined();
  });

  it('sends nothing the server refuses: no geraet_id, no erfasst_at, no unknown field', () => {
    const ding = gabeEntwurf({ ...basis, ph: '6,2', notiz: 'Regenwasser' });
    expect(Object.keys(ding).sort()).toEqual(['art', 'd', 'ding_id', 'name', 't', 'zelt_id']);
    expect(ding.geraet_id).toBeUndefined();
    expect(ding.erfasst_at).toBeUndefined();
    expect(Object.keys(ding.d ?? {}).every(feld => ['wasser_l', 'kannen', 'kanne_l', 'verteilung', 'ph'].includes(feld))).toBeTrue();
    expect(ding.d?.['ph']).toBe(6.2);
  });

  it('carries an actor only when it is a minted id', () => {
    expect(gabeEntwurf({ ...basis, akteur: 'anna' }).akteur).toBeUndefined();
    const echt = neueDingId();
    expect(gabeEntwurf({ ...basis, akteur: echt }).akteur).toBe(echt);
  });

  it('keeps only products somebody named, and rounds the litres a can produced', () => {
    const ding = gabeEntwurf({
      ...basis,
      kannen: 3,
      kanne_l: 1.5,
      produkte: [
        { name: ' Bio-Bloom ', ml_pro_l: 2, aus_schema: false },
        { name: '', ml_pro_l: 4, aus_schema: false },
      ],
    });
    expect(ding.d?.['wasser_l']).toBe(4.5);
    expect(ding.d?.['produkte']).toEqual([{ name: 'Bio-Bloom', ml_pro_l: 2, aus_schema: false }]);
  });

  it('puts the substrate on the Gabe rather than costing a second entry, and sends no empty Messwerte', () => {
    expect(gabeEntwurf({ ...basis, substrat: 'nass' }).d?.['messwerte']).toEqual({ substrat: 'nass' });
    expect(gabeEntwurf(basis).d?.['messwerte']).toBeUndefined();
  });
});

describe('notizEntwurf and zettelEntwurf', () => {
  it('sends a Messwerte only when an instrument was actually read', () => {
    expect(notizEntwurf({ zelt_id: 'z1', t: 1e12, text: 'gelb', messwerte: { ph: '', ec: '' } }).d?.['messwerte']).toBeUndefined();
    expect(notizEntwurf({ zelt_id: 'z1', t: 1e12, text: 'gelb', messwerte: { hoehe_cm: '51' } }).d?.['messwerte']).toEqual({ hoehe_cm: 51 });
  });

  it('opens a Zettel rather than closing one', () => {
    const ding = zettelEntwurf({ zelt_id: 'z1', t: 1e12, text: 'CO₂-Flasche fast leer' });
    expect(ding.art).toBe('zustand');
    expect(ding.t_ende).toBeNull();
    expect(ding.d?.['text']).toBe('CO₂-Flasche fast leer');
  });
});

describe('messwerteAus', () => {
  it('drops what nobody typed and refuses to produce an object that measured nothing', () => {
    expect(messwerteAus({})).toBeUndefined();
    expect(messwerteAus({ ph: '6,4', ec: null, substrat: 'feucht' })).toEqual({ ph: 6.4, substrat: 'feucht' });
  });
});

describe('gabeVorgabe', () => {
  it('starts one two-litre can on a tent that has never been watered', () => {
    expect(gabeVorgabe(zelt, [])).toEqual({ kannen: 1, kanne_l: 2 });
  });

  it('remembers the last pour, so the routine watering is two taps', () => {
    const dinge = [gabe('a', Date.now() - STUNDE * 30, { wasser_l: 6, kannen: 3, kanne_l: 2 })];
    expect(gabeVorgabe(zelt, dinge)).toEqual({ kannen: 3, kanne_l: 2 });
  });

  it('takes the tent’s own can size over an older entry’s', () => {
    const mitKanne: Zelt = { ...zelt, d: { kanne_l: 5 } };
    expect(gabeVorgabe(mitKanne, [gabe('a', 1, { wasser_l: 6, kanne_l: 2 })]).kanne_l).toBe(5);
  });
});

describe('doppelGabe', () => {
  const jetzt = Date.now();

  it('fires on a pour inside the soil water window and not outside it', () => {
    const nah = [gabe('a', jetzt - 90 * 60 * 1000, { wasser_l: 2 })];
    expect(doppelGabe({ dinge: nah, auswahl: [], t: jetzt, mitProdukten: false })?.ding.ding_id).toBe('a');

    const fern = [gabe('a', jetzt - 7 * STUNDE, { wasser_l: 2 })];
    expect(doppelGabe({ dinge: fern, auswahl: [], t: jetzt, mitProdukten: false })).toBeNull();
  });

  it('reads an absent rel.an on the earlier entry as the whole tent', () => {
    const dinge = [gabe('a', jetzt - STUNDE, { wasser_l: 2 })];
    expect(doppelGabe({ dinge: dinge, auswahl: ['p1'], t: jetzt, mitProdukten: false })?.ding.ding_id).toBe('a');
  });

  it('leaves a pour at other plants alone', () => {
    const dinge = [gabe('a', jetzt - STUNDE, { wasser_l: 2 }, { an: ['p2'] })];
    expect(doppelGabe({ dinge: dinge, auswahl: ['p1'], t: jetzt, mitProdukten: false })).toBeNull();
  });

  it('says which half of the guard fired, and carries the hand corroboration', () => {
    const dinge = [gabe('a', jetzt - STUNDE, { wasser_l: 2, messwerte: { substrat: 'nass' } })];
    const warnung = doppelGabe({ dinge: dinge, auswahl: [], t: jetzt, mitProdukten: false, wartend: ['a'] });
    expect(warnung?.lokal).toBeTrue();
    expect(warnung?.substrat).toBe('nass');
    expect(warnung?.bilder).toEqual([]);
  });

  it('uses the longer window for a feed, and coco’s shorter one for coco', () => {
    const dinge = [gabe('a', jetzt - 8 * STUNDE, { wasser_l: 2 })];
    expect(doppelGabe({ dinge: dinge, auswahl: [], t: jetzt, mitProdukten: true })?.ding.ding_id).toBe('a');
    expect(doppelGabe({ dinge: dinge, auswahl: [], t: jetzt, medium: 'coco', mitProdukten: false })).toBeNull();
  });

  it('ignores an entry that was already declared the same pour', () => {
    const dinge = [gabe('a', jetzt - STUNDE, { wasser_l: 2, dublette_von: 'b' })];
    expect(doppelGabe({ dinge: dinge, auswahl: [], t: jetzt, mitProdukten: false })).toBeNull();
  });
});

describe('zeitfenster', () => {
  it('is bounded by the run at the low end and by now at the high end', () => {
    const lauf: Ding = { ding_id: 'l1', zelt_id: 'z1', art: 'lauf', name: '', t: 1_700_000_000_000, d: { nummer: 2 } };
    expect(zeitfenster(zelt, [lauf], 1_700_000_100_000)).toEqual({ min: 1_700_000_000_000, max: 1_700_000_100_000 });
    expect(zeitfenster(zelt, [], 1_700_000_100_000).min).toBe(zelt.tag_null);
  });
});
