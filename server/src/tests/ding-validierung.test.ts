import { randomUUID } from 'crypto';
import { T_MIN, validateDing } from '@utils/ding-validierung';

const gabeVomTelefon = () => ({
  ding_id: randomUUID(),
  zelt_id: 'zelt-1',
  art: 'gabe',
  name: 'Gabe',
  t: Date.now() - 3 * 60 * 60 * 1000,
  akteur: randomUUID(),
  rel: { an: [randomUUID(), randomUUID()] },
  d: {
    wasser_l: 5,
    kannen: 1,
    kanne_l: 5,
    verteilung: 'gesamt',
    ec: 1.4,
    ph: 6.2,
    ec_basis: 'plus_leitungswasser',
    produkte: [
      { name: 'Bio Grow', ml_pro_l: 2, aus_schema: true },
      { name: 'Bio Bloom', ml_pro_l: 1.5, aus_schema: false },
    ],
    schema_id: 'schema-1',
    schritt: 8,
  },
});

const probleme = (eingabe: unknown) => {
  const ergebnis = validateDing(eingabe);
  return ergebnis.ok === false ? ergebnis.problems : [];
};

const pfade = (eingabe: unknown) => probleme(eingabe).map(problem => problem.path);

describe('validateDing', () => {
  it('accepts the Gabe a phone really sends', () => {
    expect(validateDing(gabeVomTelefon())).toEqual({ ok: true, ding: expect.objectContaining({ art: 'gabe' }) });
  });

  it('accepts a Gabe that is nothing but water, because that is what most of them are', () => {
    const gabe = { ding_id: randomUUID(), zelt_id: 'zelt-1', art: 'gabe', name: '', t: Date.now(), d: { wasser_l: 4 } };
    expect(validateDing(gabe).ok).toBe(true);
  });

  it('accepts every stored art with its minimum payload', () => {
    const grund = { ding_id: '', zelt_id: 'zelt-1', name: 'x', t: Date.now() };
    const minimal: Record<string, unknown> = {
      pflanze: {},
      gabe: { wasser_l: 0 },
      notiz: { text: 'gegossen' },
      zustand: { text: 'Lüfter defekt' },
      phase: { stufe: 'ernte' },
      mensch: { farbe: '#c0ffee' },
      lauf: { nummer: 2 },
    };
    for (const [art, d] of Object.entries(minimal)) {
      expect(probleme({ ...grund, ding_id: randomUUID(), art: art, d: d })).toEqual([]);
    }
  });

  it('refuses a projected art and says why it cannot be stored', () => {
    const [problem] = probleme({ ...gabeVomTelefon(), art: 'dose', d: undefined });
    expect(problem.path).toBe('art');
    expect(problem.message).toContain('projected read-time');
    expect(problem.message).toContain('pflanze');
  });

  it('refuses an art nobody has heard of', () => {
    expect(probleme({ ...gabeVomTelefon(), art: 'giesskanne', d: undefined })).toEqual([
      { path: 'art', message: expect.stringContaining('cannot be stored') },
    ]);
    expect(pfade({ ...gabeVomTelefon(), art: undefined, d: undefined })).toEqual(['art']);
  });

  it('refuses a geraet_id rather than dropping it', () => {
    const [problem] = probleme({ ...gabeVomTelefon(), geraet_id: 'controller-1' });
    expect(problem.path).toBe('geraet_id');
    expect(problem.message).toContain('projected Ding');
  });

  it('refuses a ding_id that is not a uuid v4', () => {
    for (const ding_id of [undefined, '', 'gabe-17', '123e4567-e89b-12d3-a456-426614174000']) {
      expect(pfade({ ...gabeVomTelefon(), ding_id: ding_id })).toEqual(['ding_id']);
    }
  });

  it('refuses the server-owned fields on a create', () => {
    const gabe = { ...gabeVomTelefon(), erfasst_at: Date.now(), auto_bild: 'image-1', storniert_von: randomUUID() };
    expect(pfade(gabe)).toEqual(['erfasst_at', 'auto_bild', 'storniert_von']);
  });

  it('refuses a t that is not a sane epoch-ms timestamp', () => {
    expect(pfade({ ...gabeVomTelefon(), t: undefined })).toEqual(['t']);
    expect(pfade({ ...gabeVomTelefon(), t: Number.NaN })).toEqual(['t']);
    expect(probleme({ ...gabeVomTelefon(), t: Math.floor(Date.now() / 1000) })[0].message).toContain('milliseconds');
    expect(pfade({ ...gabeVomTelefon(), t: Date.now() + 8 * 24 * 60 * 60 * 1000 })).toEqual(['t']);
    expect(pfade({ ...gabeVomTelefon(), t: T_MIN })).toEqual([]);
  });

  it('takes a back-dated entry, because a pour is typed hours or days later', () => {
    expect(pfade({ ...gabeVomTelefon(), t: Date.now() - 40 * 24 * 60 * 60 * 1000 })).toEqual([]);
  });

  it('lets t_ende be absent or null, and refuses one that precedes t', () => {
    const zustand = { ding_id: randomUUID(), zelt_id: 'zelt-1', art: 'zustand', name: '', t: Date.now() - 1000, d: { text: 'offen' } };
    expect(pfade(zustand)).toEqual([]);
    expect(pfade({ ...zustand, t_ende: null })).toEqual([]);
    expect(pfade({ ...zustand, t_ende: zustand.t + 5000 })).toEqual([]);
    expect(probleme({ ...zustand, t_ende: zustand.t - 1 })[0]).toEqual({ path: 't_ende', message: 'must not precede t' });
  });

  it('checks the enums of each art', () => {
    const grund = { ding_id: randomUUID(), zelt_id: 'zelt-1', name: 'x', t: Date.now() };
    expect(probleme({ ...grund, art: 'phase', d: { stufe: 'harvest' } })[0].message).toContain('ernte');
    expect(pfade({ ...grund, art: 'phase', d: { stufe: 'flowering' } })).toEqual([]);
    expect(pfade({ ...grund, art: 'gabe', d: { wasser_l: 1, verteilung: 'pro_pflanze' } })).toEqual(['d.verteilung']);
    expect(pfade({ ...grund, art: 'gabe', d: { wasser_l: 1, ec_basis: 'relativ' } })).toEqual(['d.ec_basis']);
    expect(pfade({ ...grund, art: 'pflanze', d: { quelle: 'klon' } })).toEqual(['d.quelle']);
    expect(pfade({ ...grund, art: 'notiz', d: { text: 'gefühlt', messwerte: { substrat: 'staubig' } } })).toEqual(['d.messwerte.substrat']);
    expect(pfade({ ...grund, art: 'notiz', d: { text: 'gefühlt', messwerte: { substrat: 'feucht', ph: 6.1 } } })).toEqual([]);
  });

  it('refuses a Notiz and a Zettel with nothing in them, whatever client sent it', () => {
    const grund = { ding_id: randomUUID(), zelt_id: 'zelt-1', name: '', t: Date.now() };
    // Our own sheet already refuses this; a blank note is storable by anything
    // that is not our sheet, and it would stand at the top of the tent screen
    // saying nothing.
    expect(probleme({ ...grund, art: 'notiz', d: { text: '' } })[0]).toEqual({ path: 'd.text', message: 'must not be empty' });
    expect(pfade({ ...grund, art: 'notiz', d: { text: '   ' } })).toEqual(['d.text']);
    expect(pfade({ ...grund, art: 'zustand', d: { text: '' } })).toEqual(['d.text']);
    expect(pfade({ ...grund, art: 'notiz', d: { text: 'untere Blätter gelb' } })).toEqual([]);
  });

  it('still takes a typed zero, because an empty number and a measured nought are not the same', () => {
    const grund = { ding_id: randomUUID(), zelt_id: 'zelt-1', name: '', t: Date.now() };
    expect(pfade({ ...grund, art: 'gabe', d: { wasser_l: 0 } })).toEqual([]);
    expect(pfade({ ...grund, art: 'notiz', d: { text: 'pH gemessen', messwerte: { ph: 0 } } })).toEqual([]);
    expect(pfade({ ...grund, art: 'lauf', d: { nummer: 0 } })).toEqual([]);
  });

  it('demands wasser_l on a Gabe and refuses a negative one', () => {
    const grund = { ding_id: randomUUID(), zelt_id: 'zelt-1', art: 'gabe', name: '', t: Date.now() };
    expect(probleme({ ...grund, d: {} })[0]).toEqual({ path: 'd.wasser_l', message: 'is required on a gabe' });
    expect(probleme(grund)[0].path).toBe('d.wasser_l');
    expect(probleme({ ...grund, d: { wasser_l: -1 } })[0]).toEqual({ path: 'd.wasser_l', message: 'must not be negative' });
    expect(probleme({ ...grund, d: { wasser_l: '5' } })[0].path).toBe('d.wasser_l');
  });

  it('validates each Produkt of a Gabe', () => {
    const grund = { ding_id: randomUUID(), zelt_id: 'zelt-1', art: 'gabe', name: '', t: Date.now() };
    const gabe = (produkte: unknown) => ({ ...grund, d: { wasser_l: 5, produkte: produkte } });
    expect(pfade(gabe([{ name: 'Bio Grow', ml_pro_l: 2 }]))).toEqual([]);
    expect(pfade(gabe([{ name: '  ', ml_pro_l: 2 }]))).toEqual(['d.produkte[0].name']);
    expect(pfade(gabe([{ name: 'Bio Grow' }]))).toEqual(['d.produkte[0].ml_pro_l']);
    expect(pfade(gabe([{ name: 'Bio Grow', ml_pro_l: 2, ml_je_liter: 2 }]))).toEqual(['d.produkte[0].ml_je_liter']);
    expect(pfade(gabe('Bio Grow'))).toEqual(['d.produkte']);
  });

  it('refuses an unknown field rather than storing something nothing reads', () => {
    expect(pfade({ ...gabeVomTelefon(), duenger: 'Bio Grow' })).toEqual(['duenger']);
    const gabe = gabeVomTelefon();
    expect(pfade({ ...gabe, d: { ...gabe.d, ph_ablauf: 6.0 } })).toEqual(['d.ph_ablauf']);
    expect(pfade({ ...gabe, rel: { auf: [randomUUID()] } })).toEqual(['rel.auf']);
  });

  describe('the hand instrument set', () => {
    const grund = { ding_id: randomUUID(), zelt_id: 'zelt-1', name: 'x', t: Date.now() };
    const notiz = (messwerte: Record<string, unknown>) => ({ ...grund, art: 'notiz', d: { text: 'pH gemessen', messwerte: messwerte } });

    it('reads a cleared input as an instrument nobody owns, not as a bad value', () => {
      // A cleared <ion-input type="number"> sends null. The grower has a pH pen
      // and nothing else; losing the whole note to four "must be a finite
      // number" would be the app telling them they are missing something.
      expect(pfade(notiz({ ph: 6.2, temperatur: null, luftfeuchte: null, hoehe_cm: null }))).toEqual([]);
    });

    it('keeps a zero, because somebody typed it', () => {
      expect(pfade(notiz({ ph: 0, hoehe_cm: 0 }))).toEqual([]);
    });

    it('refuses a reading that measured nothing', () => {
      expect(pfade(notiz({}))).toEqual(['d.messwerte']);
      expect(pfade(notiz({ ph: null }))).toEqual(['d.messwerte']);
    });

    it('lets a Gabe carry them, because feeling the substrate while watering is one act', () => {
      // §4.2 puts Messwerte on a Notiz; §13.4 has the double-feed guard reading
      // `messwerte.substrat` from the previous Gabe. Two rows for one act would
      // leave the guard joining them by time and hoping.
      const gabe = gabeVomTelefon();
      expect(pfade({ ...gabe, d: { ...gabe.d, messwerte: { substrat: 'nass' } } })).toEqual([]);
      expect(pfade({ ...gabe, d: { ...gabe.d, messwerte: { substrat: 'staubig' } } })).toEqual(['d.messwerte.substrat']);
    });
  });

  describe('naming', () => {
    const grund = { ding_id: randomUUID(), zelt_id: 'zelt-1', name: 'x', t: Date.now() };

    it('demands a name where the name is the whole point', () => {
      expect(pfade({ ...grund, art: 'mensch', name: '', d: { farbe: '#c0ffee' } })).toEqual(['name']);
      expect(pfade({ ...grund, art: 'pflanze', name: undefined, d: {} })).toEqual(['name']);
      expect(pfade({ ...grund, art: 'mensch', name: '   ', d: { farbe: '#c0ffee' } })).toEqual(['name']);
      expect(pfade({ ...grund, art: 'mensch', name: 'Anna', d: { farbe: '#c0ffee' } })).toEqual([]);
    });

    it('lets everything else go unnamed, because a Notiz is described by what it says', () => {
      expect(pfade({ ...grund, art: 'notiz', name: '', d: { text: 'gegossen' } })).toEqual([]);
      expect(pfade(gabeVomTelefon())).toEqual([]);
    });
  });

  describe('edges', () => {
    it('refuses an empty edge, so absent stays the only way to say the whole tent', () => {
      // What a phone sends when somebody opens the plant picker and taps
      // nothing. Divided across no plants it is a pour that recorded nothing.
      const gabe = gabeVomTelefon();
      expect(pfade({ ...gabe, rel: { an: [] } })).toEqual(['rel.an']);
      expect(pfade({ ...gabe, rel: { an: [randomUUID()] } })).toEqual([]);
      expect(pfade({ ...gabe })).toEqual([]);
    });
  });

  it('reports every problem at once, so a client can fix the form in one pass', () => {
    expect(pfade({ art: 'gabe' }).sort()).toEqual(['d.wasser_l', 'ding_id', 't', 'zelt_id']);
  });

  it('refuses anything that is not an object', () => {
    for (const eingabe of [undefined, null, 'gabe', 42, []]) {
      expect(validateDing(eingabe).ok).toBe(false);
    }
  });
});
