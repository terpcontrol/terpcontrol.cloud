import { MigrationContext, MigrationStep } from '../migration';

const DEVICES = 'devices';

const FRIDGE_WITH_A_CO2_REPORT = { type: 'fridge', 'state.hardware.co2': { $exists: true } };

/**
 * Takes a `co2` key out of every fridge's hardware report.
 *
 * Only the tent controller's firmware reports whether it found a CO2 sensor; a
 * fridge always has one, because its firmware counts a missing SCD as a sensor
 * fault and stops regulating. A fridge that carries the key got it from a build
 * of another type it once ran, and its own firmware never sends the key that
 * would clear it - so a stale `co2=off` hid the fridge's CO2 target, its
 * readings and its alarms for good. The report service no longer stores the
 * key for a fridge; this clears what it stored before.
 */
export const fridgeCo2Sensor: MigrationStep = {
  name: '023-fridge-co2-sensor',

  async run(context: MigrationContext): Promise<void> {
    const devices = context.db.collection(DEVICES);
    const stale = await devices.countDocuments(FRIDGE_WITH_A_CO2_REPORT);
    context.count('devices.fridgeCo2ReportCleared', stale);
    if (context.dryRun || stale === 0) return;

    await devices.updateMany(FRIDGE_WITH_A_CO2_REPORT, { $unset: { 'state.hardware.co2': '' } });
  },
};
