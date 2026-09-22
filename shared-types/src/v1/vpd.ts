/**
 * The vapour pressure deficit, in the one place both sides of the wire read it
 * from.
 *
 * The server works out the VPD of every reading it charts, and the targets
 * screen works out the VPD a pair of setpoints amounts to before any reading
 * exists. Those are the same figure about the same tent, so a grower who sets a
 * target and then watches the chart must be looking at one curve and not two:
 * written once on each side, the two drift apart the first time either is
 * corrected. It carries no schema, so a client can import it without pulling
 * zod and the whole contract into its bundle.
 */

/** Saturation vapour pressure in kPa, by the Tetens formula. */
export const saturationVapourPressure = (temperature: number): number => 0.6108 * Math.exp((17.2694 * temperature) / (temperature + 237.3));

/**
 * The deficit in kPa between the leaf and the air around it. The leaf is
 * usually the cooler of the two, by the offset the device is set up with, which
 * is why both temperatures are given rather than one.
 */
export const vapourPressureDeficit = (airTemperature: number, leafTemperature: number, relativeHumidity: number): number =>
  saturationVapourPressure(leafTemperature) - saturationVapourPressure(airTemperature) * (relativeHumidity / 100);
