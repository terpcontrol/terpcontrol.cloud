import { messwerteAusDiary } from '@utils/messwerte';

describe('messwerteAusDiary', () => {
  it('maps the six legacy diary fields onto their Messwerte', () => {
    const messwerte = messwerteAusDiary({
      phMeasurement: 6.2,
      ecMeasurement: 1.4,
      tdsMeasurement: 700,
      lightMeasurement: 620,
      distanceMeasurement: 45,
      outsideTemperatureMeasurement: 19.5,
    });

    expect(messwerte).toEqual({ ph: 6.2, ec: 1.4, tds: 700, ppfd: 620, abstand_cm: 45, aussen_temperatur: 19.5 });
  });

  it('leaves the five fields with no legacy source absent rather than inventing zeros', () => {
    const messwerte = messwerteAusDiary({ phMeasurement: 6.2 });

    expect(messwerte).toEqual({ ph: 6.2 });
    for (const feld of ['temperatur', 'luftfeuchte', 'hoehe_cm', 'substrat', 'topfgewicht_kg']) {
      expect(messwerte).not.toHaveProperty(feld);
    }
  });

  it('keeps a legacy zero, because the old modal left an untouched field undefined', () => {
    expect(messwerteAusDiary({ distanceMeasurement: 0 })).toEqual({ abstand_cm: 0 });
  });

  it('ignores the diary fields that are not hand instruments', () => {
    expect(
      messwerteAusDiary({ co2FillingRest: 12, co2FillingInitial: 425, newLifecycleStage: 'flowering', lifecycleName: 'Wedding Cake' }),
    ).toBeUndefined();
  });

  it('has nothing to say about an entry that carried no measurement', () => {
    expect(messwerteAusDiary(undefined)).toBeUndefined();
    expect(messwerteAusDiary(null)).toBeUndefined();
    expect(messwerteAusDiary({})).toBeUndefined();
    expect(messwerteAusDiary({ phMeasurement: undefined })).toBeUndefined();
  });

  it('reads a number a client once stored as a string, and drops what is not a number at all', () => {
    expect(messwerteAusDiary({ phMeasurement: '6.4' } as never)).toEqual({ ph: 6.4 });
    expect(messwerteAusDiary({ phMeasurement: 'sauer' } as never)).toBeUndefined();
    expect(messwerteAusDiary({ ecMeasurement: Number.NaN })).toBeUndefined();
  });
});
