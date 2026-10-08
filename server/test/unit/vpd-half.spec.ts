import { vapourPressureDeficit } from '@fg2/shared-types/v1-schemas/vpd.js';
import { DEFAULT_DEVICE_SETTINGS } from '@database/schemas/v1/devices.schema';
import { vpdOf } from '@modules/data/flux';

/**
 * Which leaf offset a VPD reading takes. The cycle a series is read against
 * comes from the lamp's switchings on a five-minute grain, which counts the
 * lamp on for a whole grain once any sample in it was lit - so a minute the
 * device itself reported dark took the day offset, and the chart answered a
 * VPD that neither the device nor the Overview gave.
 */
describe('the half of the cycle a VPD reading takes', () => {
  const factors = DEFAULT_DEVICE_SETTINGS;
  const vpd = (air: number, leaf: number, rh: number) => parseFloat(vapourPressureDeficit(air, leaf, rh).toFixed(2));
  const reading = (light: number | null, isDay: boolean | null) => ({
    temperature: 20,
    humidity: 20,
    leafTemperature: null,
    lux: null,
    light,
    isDay,
  });

  it('is night where the reading´s own lamp level is zero, whatever the cycle around it says', () => {
    expect(vpdOf(reading(0, true), factors)).toBe(vpd(20, 20, 20));
  });

  it('follows the cycle where the lamp was lit during the reading', () => {
    expect(vpdOf(reading(40, true), factors)).toBe(vpd(20, 18, 20));
    expect(vpdOf(reading(40, false), factors)).toBe(vpd(20, 20, 20));
  });

  it('follows the cycle where the device reports no lamp at all', () => {
    expect(vpdOf(reading(null, true), factors)).toBe(vpd(20, 18, 20));
  });
});
