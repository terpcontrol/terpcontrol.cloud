import type { Ding, Zelt } from '@fg2/shared-types';
import { Text } from './ding-text';
import { Messung } from './messquellen';
import { SATZ_MAX, satz, satzText } from './satz';

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
  tag_null: JETZT - 33 * TAG,
  erstellt_at: JETZT - 33 * TAG,
  ...zusatz,
});

const mitGeraet = zelt({ geraete: [{ geraet_id: 'c1', seit: JETZT - 33 * TAG }] });

const ding = (id: string, art: Ding['art'], t: number, zusatz: Partial<Ding> = {}): Ding => ({
  ding_id: id,
  zelt_id: 'z1',
  art: art,
  name: '',
  t: t,
  ...zusatz,
});

const geraet = (gesehen = JETZT - 40000): Ding =>
  ding('geraet:c1', 'geraet', JETZT - 33 * TAG, { geraet_id: 'c1', t_ende: null, d: { zuletzt_gesehen: gesehen } });

const kamera = (letztesBild: number): Ding =>
  ding('kamera:cam1', 'kamera', JETZT - 33 * TAG, { geraet_id: 'c1', t_ende: null, d: { webcam_did: 'cam1', letztes_bild_t: letztesBild } });

const reihe = (mass: string, punkte: [number, number][], quelle: 'hand' | 'geraet' = 'geraet'): Messung[] =>
  punkte.map(([t, wert]) => ({
    mass: mass,
    herkunft: quelle === 'hand' ? { quelle: 'hand' as const } : { quelle: 'geraet' as const, geraet_id: 'c1' },
    wert: wert,
    t: t,
  }));

const sagen = (zusatz: { zelt?: Zelt; dinge?: Ding[]; messungen?: Messung[]; vorher?: number }) =>
  satz({
    zelt: zusatz.zelt ?? zelt(),
    dinge: zusatz.dinge ?? [],
    messungen: zusatz.messungen ?? [],
    vorher: zusatz.vorher ?? JETZT - 3 * TAG,
    jetzt: JETZT,
  });

/** Enough diary that rank 8 never has to answer, unless a test wants it to. */
const notiz = (id: string, t: number, hoehe?: number): Ding =>
  ding(id, 'notiz', t, { d: { text: 'Blätter', ...(hoehe === undefined ? {} : { messwerte: { hoehe_cm: hoehe } }) } });

describe('§9 - the one ladder, rank by rank', () => {
  it('rank 1: the camera has gone quiet', () => {
    const antwort = sagen({ zelt: mitGeraet, dinge: [geraet(), kamera(JETZT - 4 * STUNDE)] });
    expect(antwort.rang).toBe('1');
    expect(antwort.klauseln[0].text.key).toBe('zelt.satz.kamerastill');
  });

  it('rank 2: the tent stopped talking', () => {
    const antwort = sagen({ zelt: mitGeraet, dinge: [geraet(JETZT - 2 * STUNDE)] });
    expect(antwort.rang).toBe('2');
    expect(antwort.klauseln[0].text.key).toBe('zelt.satz.offline');
  });

  it('rank 3, device: the picture describes what changed in it and nothing more', () => {
    const messungen = reihe('gruenanteil', [[JETZT - 3 * TAG, 34], [JETZT, 37]]);
    const antwort = sagen({ zelt: mitGeraet, dinge: [geraet()], messungen: messungen });

    expect(antwort.rang).toBe('3');
    expect(antwort.klauseln[0].text.key).toBe('zelt.satz.gewachsen');
  });

  it('rank 3, device: less green is described, never diagnosed', () => {
    const messungen = reihe('gruenanteil', [[JETZT - 3 * TAG, 37], [JETZT, 30]]);
    const antwort = sagen({ zelt: mitGeraet, dinge: [geraet()], messungen: messungen });

    expect(antwort.klauseln[0].text.key).toBe('zelt.satz.wenigerGruen');
    // The picture never prescribes: nothing about a plant reaches the `→` line.
    expect(antwort.regel).toBeNull();
  });

  it('rank 3, device-less: the tape measure, from two readings in the span', () => {
    const dinge = [notiz('n1', JETZT - 4 * TAG, 48), notiz('n2', JETZT - TAG, 51)];
    const antwort = sagen({ dinge: dinge });

    expect(antwort.rang).toBe('3');
    expect(antwort.klauseln[0].text.key).toBe('zelt.satz.hoehe');
    expect(antwort.klauseln[0].text.params?.['vorher']).toBe('48');
    expect(antwort.klauseln[0].text.params?.['jetzt']).toBe('51');
  });

  it('rank 4, device-less: below three readings in fourteen days there is no clause', () => {
    const zwei = [
      ding('g1', 'gabe', JETZT - 4 * TAG, { d: { wasser_l: 1, messwerte: { ph: 6.3 } } }),
      ding('g2', 'gabe', JETZT - TAG, { d: { wasser_l: 1, messwerte: { ph: 5.9 } } }),
    ];
    expect(sagen({ dinge: zwei }).rang).not.toBe('4');
  });

  it('rank 4, device-less: three readings and a move beyond σ says so', () => {
    const dinge = [
      ding('g1', 'gabe', JETZT - 10 * TAG, { d: { wasser_l: 1, messwerte: { ph: 6.3 } } }),
      ding('g2', 'gabe', JETZT - 9 * TAG, { d: { wasser_l: 1, messwerte: { ph: 6.3 } } }),
      ding('g3', 'gabe', JETZT - 8 * TAG, { d: { wasser_l: 1, messwerte: { ph: 6.35 } } }),
      ding('g4', 'gabe', JETZT - TAG, { d: { wasser_l: 1, messwerte: { ph: 5.9 } } }),
    ];
    const antwort = sagen({ dinge: dinge, vorher: JETZT - 5 * TAG });

    expect(antwort.rang).toBe('4');
    expect(antwort.klauseln[0].text.key).toBe('zelt.satz.gefallen');
  });

  it('rank 4, device: the night is measured against the nights before it', () => {
    const licht: [number, number][] = [];
    const waerme: [number, number][] = [];
    for (let index = 6; index >= 1; index--) {
      const tagBeginn = JETZT - index * TAG;
      licht.push([tagBeginn, 100], [tagBeginn + STUNDE, 0], [tagBeginn + 9 * STUNDE, 100]);
      // Five quiet nights at 21 °C, then one at 25.
      for (let stunde = 1; stunde <= 9; stunde++) waerme.push([tagBeginn + stunde * STUNDE, index === 1 ? 25 : 21 + (index % 2) * 0.2]);
    }

    const antwort = sagen({
      zelt: mitGeraet,
      dinge: [geraet()],
      messungen: [...reihe('out_light', licht), ...reihe('temperatur', waerme)],
      vorher: JETZT - 2 * TAG,
    });

    expect(antwort.klauseln.some(eine => eine.text.key === 'zelt.satz.nachtsWaermer')).toBeTrue();
  });

  it('rank 5: the tiles say where, and never what', () => {
    // Tile 4 of an 8x6 grid: top row, middle third.
    const kacheln = Array.from({ length: 48 }, (_wert, index) => (index === 4 ? 90 : 4));
    const frame = ding('b1', 'bild', JETZT - STUNDE, { d: { quelle: 'geraet', kacheln: kacheln } });
    const antwort = sagen({ zelt: mitGeraet, dinge: [geraet(), frame] });

    expect(antwort.rang).toBe('5');
    expect(antwort.klauseln[0].text.key).toBe('zelt.satz.kachel');
    expect((antwort.klauseln[0].text.params?.['ort'] as Text).key).toBe('zelt.satz.ort.obenMitte');
  });

  it('rank 5 never matches with no device - hand photos are shown, not measured', () => {
    const kacheln = Array.from({ length: 48 }, (_wert, index) => (index === 4 ? 90 : 4));
    const foto = ding('b1', 'bild', JETZT - STUNDE, { d: { quelle: 'hand', kacheln: kacheln } });
    expect(sagen({ dinge: [foto] }).rang).not.toBe('5');
  });

  it('rank 6: the same mechanism at both densities', () => {
    const hand = ding('ziel:1', 'ziel', JETZT - TAG, { name: 'hand.ph', d: { schluessel: 'hand.ph', wert: 6.2, quelle: 'hand' } });
    const antwort = sagen({ dinge: [hand] });

    expect(antwort.rang).toBe('6');
    expect(antwort.klauseln[0].text.key).toBe('zelt.satz.zielDu');
  });

  it('rank 6 never lowercases a clause that opens with the target’s own name', () => {
    const vomGeraet = ding('ziel:1', 'ziel', JETZT - TAG, { name: 'day.temperature', d: { schluessel: 'day.temperature', wert: 25, quelle: 'geraet' } });
    const antwort = sagen({ zelt: mitGeraet, dinge: [geraet(), vomGeraet] });

    expect(antwort.klauseln[0].text.key).toBe('zelt.satz.zielGeraet');
    expect(antwort.klauseln[0].kleinbar).toBeFalse();
  });

  it('rank 7: the widened template table, one art per clause', () => {
    const faelle: [Ding[], string][] = [
      [[ding('g1', 'gabe', JETZT - TAG, { d: { wasser_l: 2 } })], 'zelt.satz.gabe.du.eins'],
      [
        [ding('g1', 'gabe', JETZT - 2 * TAG, { d: { wasser_l: 2 } }), ding('g2', 'gabe', JETZT - TAG, { d: { wasser_l: 2 } })],
        'zelt.satz.gabe.du.viele',
      ],
      [[ding('ph1', 'phase', JETZT - TAG, { d: { stufe: 'flowering' } })], 'zelt.satz.phase'],
      [[notiz('n1', JETZT - TAG), notiz('n2', JETZT - 2 * STUNDE)], 'zelt.satz.notiz.du.viele'],
      [
        [ding('b1', 'bild', JETZT - TAG, { d: { quelle: 'hand' } }), ding('b2', 'bild', JETZT - 2 * STUNDE, { d: { quelle: 'hand' } })],
        'zelt.satz.bild.du.viele',
      ],
      [[ding('p1', 'pflanze', JETZT - TAG, { name: 'A4' })], 'zelt.satz.pflanze'],
      [[ding('zu1', 'zustand', JETZT - TAG, { t_ende: null, d: { text: 'nicht gießen' } })], 'zelt.satz.zustand.du.eins'],
    ];

    for (const [dinge, schluessel] of faelle) {
      const antwort = sagen({ dinge: dinge });
      expect(antwort.rang).toBe('7');
      expect(antwort.klauseln[0].text.key).toBe(schluessel);
    }
  });

  it('rank 7 names the person when one person did all of it', () => {
    const anna = ding('m1', 'mensch', JETZT - 20 * TAG, { name: 'Anna' });
    const gabe = ding('g1', 'gabe', JETZT - 2 * STUNDE, { akteur: 'm1', d: { wasser_l: 2 } });
    const antwort = sagen({ dinge: [anna, gabe] });

    expect(antwort.klauseln[0].text.key).toBe('zelt.satz.gabe.wer.eins');
    expect(antwort.klauseln[0].text.params?.['name']).toBe('Anna');
    // „anna hat gegossen" is not German, so this clause is never lowercased.
    expect(antwort.klauseln[0].kleinbar).toBeFalse();
  });
});

describe('§9.2 - rank 8, the empty day', () => {
  const laeufe = [
    ding('l1', 'lauf', JETZT - 100 * TAG, { t_ende: JETZT - 40 * TAG, d: { nummer: 1 } }),
    ding('l2', 'lauf', JETZT - 33 * TAG, { t_ende: null, d: { nummer: 2 } }),
  ];

  it('8a: the same day number in the previous run, and the Vorher half moves there', () => {
    const damals = laeufe[0].t + (JETZT - laeufe[1].t);
    const dinge = [...laeufe, notiz('alt', damals), ding('phA', 'phase', damals - TAG, { d: { stufe: 'flowering' } })];
    const antwort = sagen({ dinge: dinge, vorher: JETZT - STUNDE });

    expect(antwort.rang).toBe('8a');
    expect(antwort.vorherNeu).toBe(damals);
  });

  it('8b: a schema is chosen', () => {
    const schema = ding('sc1', 'schema', JETZT - 33 * TAG, { d: { schema_id: 'biobizz', schritt: 4 } });
    const antwort = sagen({ dinge: [schema], vorher: JETZT - STUNDE });

    expect(antwort.rang).toBe('8b');
    expect(antwort.klauseln[0].text.params?.['schritt']).toBe(5);
  });

  it('8c: any earlier evidence, and the Vorher half moves to that day', () => {
    const alt = notiz('n1', JETZT - 9 * TAG);
    const antwort = sagen({ dinge: [alt], vorher: JETZT - STUNDE });

    expect(antwort.rang).toBe('8c');
    expect(antwort.vorherNeu).toBe(alt.t);
    expect(antwort.klauseln[0].text.key).toBe('zelt.satz.zuletztEingetragen');
  });

  it('8d: with a device, and nothing anybody wrote', () => {
    const antwort = sagen({ zelt: mitGeraet, dinge: [geraet()], vorher: JETZT - STUNDE });

    expect(antwort.rang).toBe('8d');
    expect(antwort.klauseln[0].text.key).toBe('zelt.satz.wenigGeaendert');
  });

  it('8e: genuinely nothing, ever - and it is a rung, not a second code path', () => {
    const antwort = sagen({ dinge: [], vorher: JETZT - STUNDE });

    expect(antwort.rang).toBe('8e');
    expect(antwort.klauseln[0].text.key).toBe('zelt.tagEins');
  });

  it('never comments on the reader', () => {
    for (const dinge of [[], [notiz('n1', JETZT - 9 * TAG)]]) {
      const antwort = sagen({ dinge: dinge, vorher: JETZT - STUNDE });
      expect(antwort.klauseln[0].text.key).not.toContain('nichts');
      expect(antwort.klauseln[0].text.key).not.toContain('eingetragenNichts');
    }
  });
});

describe('the one sentence', () => {
  const roh = (text: Text): string => {
    const teile = Object.values(text.params ?? {}).map(wert => (typeof wert === 'object' ? roh(wert) : String(wert)));
    return `${text.key}${teile.length ? `(${teile.join(',')})` : ''}`;
  };

  it('composes the first two matches with „ und ", the second lowercased', () => {
    const gebaut = satzText(
      [
        { rang: '3', text: { roh: 'Aus 48 cm sind 51 cm geworden.' }, kleinbar: true },
        { rang: '7', text: { roh: 'Du hast zweimal gegossen.' }, kleinbar: true },
      ],
      text => text.roh ?? '',
    );

    expect(gebaut).toBe('Aus 48 cm sind 51 cm geworden und du hast zweimal gegossen.');
    expect(gebaut.length).toBeLessThanOrEqual(SATZ_MAX);
  });

  it('keeps a name capitalised in the second clause', () => {
    const gebaut = satzText(
      [
        { rang: '3', text: { roh: 'Die Pflanzen sind gewachsen.' }, kleinbar: true },
        { rang: '7', text: { roh: 'Anna hat gegossen.' }, kleinbar: false },
      ],
      text => text.roh ?? '',
    );

    expect(gebaut).toBe('Die Pflanzen sind gewachsen und Anna hat gegossen.');
  });

  it('falls back to one clause past ninety characters', () => {
    const lang = 'Die Pflanzen sind in den letzten drei Tagen sichtbar gewachsen und stehen dicht.';
    const gebaut = satzText(
      [
        { rang: '3', text: { roh: lang }, kleinbar: true },
        { rang: '7', text: { roh: 'Du hast zweimal gegossen und zwei Notizen geschrieben.' }, kleinbar: true },
      ],
      text => text.roh ?? '',
    );

    expect(gebaut).toBe(lang);
  });

  it('is exactly one sentence on every screen, at every density', () => {
    const faelle = [
      sagen({ dinge: [] }),
      sagen({ dinge: [notiz('n1', JETZT - TAG)] }),
      sagen({ zelt: mitGeraet, dinge: [geraet()], messungen: reihe('temperatur', [[JETZT, 24]]) }),
    ];

    for (const antwort of faelle) {
      expect(antwort.klauseln.length).toBeGreaterThan(0);
      expect(antwort.klauseln.length).toBeLessThanOrEqual(2);
      expect(roh(antwort.klauseln[0].text)).toBeTruthy();
    }
  });

  it('a tent with no device produces a sentence too, always', () => {
    const ohne = zelt({ geraete: [] });
    const antwort = sagen({ zelt: ohne, dinge: [], vorher: JETZT - STUNDE });

    expect(antwort.klauseln.length).toBe(1);
    expect(antwort.rang).toBe('8e');
    // Nine of eleven rules are silent, and no substitute is invented.
    expect(antwort.regel).toBeNull();
  });
});
