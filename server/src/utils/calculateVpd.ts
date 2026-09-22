import { vapourPressureDeficit } from '@fg2/shared-types/v1-schemas/vpd.js';

/**
 * The VPD of a reading, to the two decimals a chart is drawn and stored with.
 * The curve itself is the contract's, because the targets screen works out the
 * VPD of a setpoint from the same one.
 */
export const calculateVpd = (temperatureAir: number, temperatureLeaf: number, relativeHumidity: number): number =>
  parseFloat(vapourPressureDeficit(temperatureAir, temperatureLeaf, relativeHumidity).toFixed(2));
