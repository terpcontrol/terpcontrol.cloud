import { vpdOf } from '@modules/data/flux';
import { calculateVpd } from '@utils/calculateVpd';

/**
 * Which leaf offset a VPD reading takes. The cycle a series is read against
 * comes from the lamp's switchings on a five-minute grain, which counts the
 * lamp on for a whole grain once any sample in it was lit - so a minute the
 * device itself reported dark took the day offset, and the chart answered a
 * VPD that neither the device nor the Overview gave.
 */
describe('the half of the cycle a VPD reading takes', () => {
  const factors = { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 };
  const reading = (light: number | null, isDay: boolean | null) => ({
    temperature: 20,
    humidity: 20,
    leafTemperature: null,
    lux: null,
    light,
    isDay,
  });

  it('is night where the reading´s own lamp level is zero, whatever the cycle around it says', () => {
    expect(vpdOf(reading(0, true), factors)).toBe(calculateVpd(20, 20, 20));
  });

  it('follows the cycle where the lamp was lit during the reading', () => {
    expect(vpdOf(reading(40, true), factors)).toBe(calculateVpd(20, 18, 20));
    expect(vpdOf(reading(40, false), factors)).toBe(calculateVpd(20, 20, 20));
  });

  it('follows the cycle where the device reports no lamp at all', () => {
    expect(vpdOf(reading(null, true), factors)).toBe(calculateVpd(20, 18, 20));
  });
});
