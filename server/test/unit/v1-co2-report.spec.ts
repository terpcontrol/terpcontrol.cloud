import { cylindersOf, refillsOf, reportOf, USUAL_FILL_GRAMS } from '@modules/v1/space/co2-report';

/**
 * The CO2 report's arithmetic, on its own: which cylinder a refill line starts
 * and ends, and the rate the one in use is judged by.
 */

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(Date.UTC(2026, 0, 1));
const at = (days: number) => new Date(T0.getTime() + days * DAY);

const line = (days: number, readings: Record<string, number>) => ({
  occurredAt: at(days),
  values: { kind: 'measurement', readings: Object.entries(readings).map(([key, value]) => ({ key, value, plantId: null })) },
});

describe('the cylinders the refills make', () => {
  it('starts one per refill, in order, and ends each with the rest the next one wrote down', () => {
    const cylinders = cylindersOf(refillsOf([line(20, { co2FillingInitial: 425, co2FillingRest: 60 }), line(0, { co2FillingInitial: 500 })]));

    expect(cylinders).toEqual([
      { since: at(0), until: at(20), filledGrams: 500, restGrams: 60 },
      { since: at(20), until: null, filledGrams: 425, restGrams: null },
    ]);
  });

  it('takes a cylinder whose weight nobody wrote down to be the usual one, and one changed without a rest to have run empty', () => {
    const cylinders = cylindersOf(refillsOf([line(0, { co2FillingRest: 0 }), line(4, { phMeasurement: 6 }), line(9, { co2FillingInitial: 500 })]));

    // The pH line is no refill at all.
    expect(cylinders).toEqual([
      { since: at(0), until: at(9), filledGrams: USUAL_FILL_GRAMS, restGrams: 0 },
      { since: at(9), until: null, filledGrams: 500, restGrams: null },
    ]);
  });
});

describe('the report', () => {
  it('rates the cylinder in use by every finished cylinder together, not by the average of their rates', () => {
    const cylinders = cylindersOf(
      refillsOf([
        line(0, { co2FillingInitial: 400 }),
        line(10, { co2FillingInitial: 400, co2FillingRest: 300 }),
        line(20, { co2FillingInitial: 500 }),
      ]),
    );
    // 100 g for 1000 openings, then 400 g for 1000: 2000 over 500 g is 4 a gram.
    const report = reportOf([
      { ...cylinders[0], openings: 1000 },
      { ...cylinders[1], openings: 1000 },
      { ...cylinders[2], openings: 800 },
    ]);

    expect(report.openingsPerGram).toBe(4);
    expect(report.restGrams).toBe(300);
    expect(report.cylinders.map(cylinder => cylinder.openingsPerGram)).toEqual([null, 2.5, 10]);
  });

  it('says nothing about what is left before a cylinder has finished, and never less than nothing', () => {
    const first = cylindersOf(refillsOf([line(0, { co2FillingInitial: 425 })]));
    expect(reportOf([{ ...first[0], openings: 5000 }])).toMatchObject({ openingsPerGram: null, restGrams: null });

    const two = cylindersOf(refillsOf([line(0, { co2FillingInitial: 100 }), line(5, { co2FillingInitial: 100, co2FillingRest: 0 })]));
    expect(
      reportOf([
        { ...two[0], openings: 100 },
        { ...two[1], openings: 900 },
      ]).restGrams,
    ).toBe(0);
  });
});
