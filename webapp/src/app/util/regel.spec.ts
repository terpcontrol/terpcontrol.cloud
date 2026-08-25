import type { Ding, Zelt } from '@fg2/shared-types';
import { Messung } from './messquellen';
import { BILDMASSE, REGELN_OHNE_GERAET, REGEL_IDS, RegelId, regel } from './regel';
import { zahlText } from './zahl';

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

const mitGeraet = zelt({ geraete: [{ geraet_id: 'c1', seit: JETZT - 30 * TAG }] });

const ding = (id: string, art: Ding['art'], t: number, zusatz: Partial<Ding> = {}): Ding => ({
  ding_id: id,
  zelt_id: 'z1',
  art: art,
  name: '',
  t: t,
  ...zusatz,
});

const geraet = (gesehen = JETZT - 40000): Ding =>
  ding('geraet:c1', 'geraet', JETZT - 30 * TAG, { geraet_id: 'c1', t_ende: null, d: { zuletzt_gesehen: gesehen } });

const dose = (rolle: string): Ding => ding(`dose:${rolle}`, 'dose', JETZT - 30 * TAG, { geraet_id: 'c1', t_ende: null, d: { rolle: rolle, slot: 0 } });

const kamera = (letztesBild: number): Ding => ding('kamera:cam1', 'kamera', JETZT - 30 * TAG, { geraet_id: 'c1', t_ende: null, d: { webcam_did: 'cam1', letztes_bild_t: letztesBild } });

const zielDing = (schluessel: string, wert: number | string, t = JETZT - 20 * TAG, quelle = 'geraet'): Ding =>
  ding(`ziel:${schluessel}:${t}`, 'ziel', t, { name: schluessel, d: { schluessel: schluessel, wert: wert, quelle: quelle } });

const reihe = (mass: string, punkte: [number, number][], quelle: 'hand' | 'geraet' = 'geraet'): Messung[] =>
  punkte.map(([t, wert]) => ({ mass: mass, herkunft: quelle === 'hand' ? { quelle: 'hand' as const } : { quelle: 'geraet' as const, geraet_id: 'c1' }, wert: wert, t: t }));

/** A lamp that goes off at 20:00 and on again at 08:00, for `n` nights back from `bis`. */
const lichtplan = (bis: number, naechte: number): Messung[] => {
  const punkte: [number, number][] = [];
  for (let index = naechte; index >= 1; index--) {
    const tagBeginn = bis - index * TAG;
    punkte.push([tagBeginn, 100], [tagBeginn + 8 * STUNDE, 0], [tagBeginn + 20 * STUNDE, 100]);
  }
  punkte.push([bis, 100]);
  return reihe('out_light', punkte);
};

/** A temperature reading every hour, at whatever the caller says each hour is worth. */
const stunden = (bis: number, anzahl: number, wert: (t: number) => number, mass = 'temperatur'): Messung[] =>
  reihe(
    mass,
    Array.from({ length: anzahl }, (_wert, index) => {
      const t = bis - (anzahl - 1 - index) * STUNDE;
      return [t, wert(t)] as [number, number];
    }),
  );

/** A dense series - one sample a minute - with two hours missing out of the middle of it. */
const mitLoch = (): Messung[] => {
  const punkte: [number, number][] = [];
  for (let index = 360; index >= 0; index--) {
    const t = JETZT - index * MINUTE;
    if (t > JETZT - 5 * STUNDE && t < JETZT - 3 * STUNDE) continue;
    punkte.push([t, 24]);
  }
  return reihe('temperatur', punkte);
};

const pruefen = (zusatz: { zelt?: Zelt; dinge?: Ding[]; messungen?: Messung[]; vorher?: number }) =>
  regel({
    zelt: zusatz.zelt ?? mitGeraet,
    dinge: zusatz.dinge ?? [],
    messungen: zusatz.messungen ?? [],
    vorher: zusatz.vorher ?? JETZT - 3 * TAG,
    jetzt: JETZT,
  });

describe('§9.3 - the deterministic remedy table', () => {
  it('is the eleven rules of the specification, in its order', () => {
    expect(REGEL_IDS).toEqual(['N-3', 'N-4', 'H-1', 'H-2', 'L-1', 'E-1', 'V-1', 'K-1', 'D-1', 'F-1', 'Z-1']);
  });

  it('fires exactly two of them with no device, and invents no substitute for the other nine', () => {
    expect(REGELN_OHNE_GERAET).toEqual(['F-1', 'Z-1']);
  });

  it('N-3: warm nights and nothing that can cool, so dim the one thing that heats', () => {
    const messungen = [
      ...lichtplan(JETZT, 5),
      // Every night sits three degrees over a 21,0 °C target.
      ...stunden(JETZT, 5 * 24, () => 24),
    ];
    const treffer = pruefen({ dinge: [geraet(), dose('heater'), dose('light'), zielDing('night.temperature', 21)], messungen: messungen });

    expect(treffer?.id).toBe('N-3');
    expect(treffer?.mechanismus).toBe('licht');
    expect(treffer?.ziel).toBe('dose:light');
    expect(treffer?.marke.params?.['id']).toBe('N-3');
  });

  it('N-3 is silent when the light cannot be dimmed - there is no advice to give', () => {
    const messungen = stunden(JETZT, 5 * 24, () => 24);
    expect(pruefen({ dinge: [geraet(), zielDing('night.temperature', 21)], messungen: messungen })).toBeNull();
  });

  it('N-4: the night target barely drops below the day target', () => {
    const treffer = pruefen({ dinge: [geraet(), zielDing('day.temperature', 25), zielDing('night.temperature', 24.5)] });

    expect(treffer?.id).toBe('N-4');
    expect(treffer?.mechanismus).toBe('ziel');
    expect(treffer?.ziel).toContain('night.temperature');
  });

  it('N-4 is silent at a normal drop', () => {
    expect(pruefen({ dinge: [geraet(), zielDing('day.temperature', 25), zielDing('night.temperature', 21)] })).toBeNull();
  });

  it('H-1: the heater ran flat out and it stayed cold anyway', () => {
    const messungen = [
      ...reihe('out_heater', [[JETZT - 6 * STUNDE, 1], [JETZT, 1]]),
      ...stunden(JETZT, 6, () => 20),
      ...reihe('out_light', [[JETZT - 6 * STUNDE, 100], [JETZT, 100]]),
    ];
    const treffer = pruefen({ dinge: [geraet(), dose('heater'), zielDing('day.temperature', 25)], messungen: messungen });

    expect(treffer?.id).toBe('H-1');
    expect(treffer?.mechanismus).toBe('dose');
    expect(treffer?.ziel).toBe('dose:heater');
  });

  it('H-1 is silent when the room actually reached its target', () => {
    const messungen = [
      ...reihe('out_heater', [[JETZT - 6 * STUNDE, 1], [JETZT, 1]]),
      ...stunden(JETZT, 6, () => 25),
      ...reihe('out_light', [[JETZT - 6 * STUNDE, 100], [JETZT, 100]]),
    ];
    expect(pruefen({ dinge: [geraet(), dose('heater'), zielDing('day.temperature', 25)], messungen: messungen })).toBeNull();
  });

  it('H-2: seven switch-ons and the temperature never followed any of them', () => {
    const schalten: [number, number][] = [];
    const waerme: [number, number][] = [];
    for (let index = 7; index >= 1; index--) {
      const t = JETZT - index * 2 * STUNDE;
      schalten.push([t - MINUTE, 0], [t, 1]);
      waerme.push([t, 20], [t + 10 * MINUTE, 19.8]);
    }
    const treffer = pruefen({
      dinge: [geraet(), dose('heater'), zielDing('day.temperature', 20)],
      messungen: [...reihe('out_heater', schalten), ...reihe('temperatur', waerme)],
    });

    expect(treffer?.id).toBe('H-2');
    expect(treffer?.text.params?.['anzahl']).toBe(7);
  });

  it('L-1: the switch says the lamp is on and the picture says the room is dark', () => {
    const messungen = [
      ...reihe('out_light', [[JETZT - STUNDE, 100], [JETZT, 100]]),
      ...reihe('helligkeit', [[JETZT - 30 * MINUTE, 12]]),
    ];
    const treffer = pruefen({ dinge: [geraet(), kamera(JETZT - MINUTE), dose('light')], messungen: messungen });

    expect(treffer?.id).toBe('L-1');
    expect(treffer?.mechanismus).toBe('kamera');
  });

  it('L-1 is silent when the two witnesses agree', () => {
    const messungen = [
      ...reihe('out_light', [[JETZT - STUNDE, 100], [JETZT, 100]]),
      ...reihe('helligkeit', [[JETZT - 30 * MINUTE, 180]]),
    ];
    expect(pruefen({ dinge: [geraet(), kamera(JETZT - MINUTE)], messungen: messungen })).toBeNull();
  });

  it('E-1: the dehumidifier never stops, in a mode where that socket cools', () => {
    const treffer = pruefen({
      dinge: [geraet(), dose('dehumidifier'), zielDing('workmode', 'temp')],
      messungen: reihe('out_dehumidifier', [[JETZT - 25 * STUNDE, 1], [JETZT, 1]]),
    });

    expect(treffer?.id).toBe('E-1');
    expect(treffer?.text.params?.['betriebsart']).toBe('temp');
  });

  it('E-1 is silent in a mode where the socket does what its name says', () => {
    expect(
      pruefen({
        dinge: [geraet(), dose('dehumidifier'), zielDing('workmode', 'small')],
        messungen: reihe('out_dehumidifier', [[JETZT - 25 * STUNDE, 1], [JETZT, 1]]),
      }),
    ).toBeNull();
  });

  it('V-1: the VPD is out of band while the temperature is fine, and nothing here can humidify', () => {
    const messungen = [
      ...stunden(JETZT, 6, () => 1.7, 'vpd'),
      ...stunden(JETZT, 6, () => 25),
      ...stunden(JETZT, 6, () => 45, 'luftfeuchte'),
      ...reihe('out_light', [[JETZT - 6 * STUNDE, 100], [JETZT, 100]]),
    ];
    const treffer = pruefen({
      dinge: [geraet(), ding('ph1', 'phase', JETZT - 12 * TAG, { d: { stufe: 'flowering' } }), zielDing('day.temperature', 25), zielDing('day.humidity', 60)],
      messungen: messungen,
    });

    expect(treffer?.id).toBe('V-1');
    expect(treffer?.mechanismus).toBe('ziel');
  });

  it('K-1: the tent is talking and the camera is not', () => {
    const treffer = pruefen({ dinge: [geraet(), kamera(JETZT - 4 * STUNDE)] });

    expect(treffer?.id).toBe('K-1');
    expect(treffer?.ziel).toBe('kamera:cam1');
  });

  it('K-1 is silent when the tent is offline too - that is D-1 territory, not the camera', () => {
    expect(pruefen({ dinge: [geraet(JETZT - 4 * STUNDE), kamera(JETZT - 4 * STUNDE)] })).toBeNull();
  });

  it('D-1: readings and pictures stop in the same window', () => {
    const treffer = pruefen({ dinge: [geraet()], messungen: mitLoch() });

    expect(treffer?.id).toBe('D-1');
    expect(treffer?.mechanismus).toBe('geraet');
  });

  it('D-1 is silent when the camera kept working through the gap', () => {
    const frame = ding('b1', 'bild', JETZT - 4 * STUNDE, { d: { quelle: 'geraet' } });
    expect(pruefen({ dinge: [geraet(), frame], messungen: mitLoch() })).toBeNull();
  });

  it('D-1 does not call an hourly series offline every hour', () => {
    // Half an hour is a hole in a five-second series and an ordinary pause in
    // an hourly one. The rule reads the series' own cadence, not a stopwatch.
    expect(pruefen({ dinge: [geraet()], messungen: stunden(JETZT, 12, () => 24) })).toBeNull();
  });

  it('F-1: the schema step came due and nothing was poured - and it fires with no device anywhere', () => {
    const schema = ding('sc1', 'schema', JETZT - 30 * TAG, { d: { schema_id: 'biobizz', schritt: 4, faellig_ab: JETZT - 2 * TAG } });
    const treffer = pruefen({ zelt: zelt(), dinge: [schema], vorher: JETZT - 7 * TAG });

    expect(treffer?.id).toBe('F-1');
    expect(treffer?.mechanismus).toBe('gabe');
    expect(treffer?.text.params?.['schritt']).toBe(5);
  });

  it('F-1 is silent once somebody poured', () => {
    const schema = ding('sc1', 'schema', JETZT - 30 * TAG, { d: { schema_id: 'biobizz', schritt: 4, faellig_ab: JETZT - 2 * TAG } });
    const gabe = ding('g1', 'gabe', JETZT - TAG, { d: { wasser_l: 2 } });
    expect(pruefen({ zelt: zelt(), dinge: [schema, gabe] })).toBeNull();
  });

  it('Z-1: a hand target moved inside the compared span, with no device anywhere', () => {
    const dinge = [zielDing('hand.ph', 6.0, JETZT - 20 * TAG, 'hand'), zielDing('hand.ph', 6.4, JETZT - TAG, 'hand')];
    const treffer = pruefen({ zelt: zelt(), dinge: dinge });

    expect(treffer?.id).toBe('Z-1');
    expect(treffer?.mechanismus).toBe('ziel');
    expect(treffer?.text.params?.['vorher']).toBe(zahlText(6, 1));
    expect(treffer?.text.params?.['jetzt']).toBe(zahlText(6.4, 1));
  });

  it('Z-1 ignores a device-written target on a tent with no device', () => {
    const dinge = [zielDing('day.temperature', 24, JETZT - 20 * TAG), zielDing('day.temperature', 25, JETZT - TAG)];
    expect(pruefen({ zelt: zelt(), dinge: dinge })).toBeNull();
  });
});

describe('the discipline the concept rests on', () => {
  it('never reads an image measure as evidence about a plant', () => {
    // Every Bildmass at once, on a tent that has a device and a camera: no rule
    // in the table may turn any of it into advice.
    const messungen = BILDMASSE.flatMap(mass => reihe(mass, [[JETZT - STUNDE, 90], [JETZT, 10]]));
    expect(pruefen({ dinge: [geraet(), kamera(JETZT - MINUTE), dose('heater'), dose('light')], messungen: messungen })).toBeNull();
  });

  it('says nothing at all when a device-less user hand-logs a temperature nobody can act on', () => {
    const heiss = ding('n1', 'notiz', JETZT - STUNDE, { d: { text: 'sehr warm', messwerte: { temperatur: 31 } } });
    expect(pruefen({ zelt: zelt(), dinge: [heiss] })).toBeNull();
  });

  it('prints at most one line, and always names the rule that produced it', () => {
    // N-3 and K-1 both hold here; the table's order decides and only one line
    // reaches the screen.
    const messungen = [...lichtplan(JETZT, 5), ...stunden(JETZT, 5 * 24, () => 24)];
    const treffer = pruefen({
      dinge: [geraet(), dose('light'), kamera(JETZT - 4 * STUNDE), zielDing('night.temperature', 21)],
      messungen: messungen,
    });

    expect(treffer?.id).toBe('N-3');
    expect(treffer?.marke.key).toBe('zelt.regel.marke');
  });

  it('points only at kit that is really in this tent', () => {
    const ids: RegelId[] = [];
    // The heater rule holds, but the tent has no heater socket: with nothing to
    // point at there is no line.
    const messungen = [
      ...reihe('out_heater', [[JETZT - 6 * STUNDE, 1], [JETZT, 1]]),
      ...stunden(JETZT, 6, () => 20),
    ];
    const treffer = pruefen({ dinge: [geraet(), zielDing('day.temperature', 25)], messungen: messungen });
    if (treffer) ids.push(treffer.id);

    expect(ids).toEqual([]);
  });
});
