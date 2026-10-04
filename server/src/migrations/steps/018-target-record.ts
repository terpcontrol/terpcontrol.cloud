import { targetsOf } from '@modules/v1/phase/phase-targets';
import { MigrationContext, MigrationStep } from '../migration';
import { derivedId } from '../ids';

const DEVICES = 'devices';
const TARGET_CHANGES = 'targetChanges';

/**
 * Opens the target record of every device that states targets, with what it
 * aims at when this runs.
 *
 * A band across the past is drawn from the record of what the device aimed at,
 * and a device's record is otherwise only begun by the next move of its
 * targets. One that is not moved for a month would keep a running grow's band
 * on the snapshot its phase took when it began - which is what the tent is
 * judged against nowhere else - for that whole month. Opened here, the record
 * agrees with the cockpit from this instant on; what came before it is drawn as
 * it always was.
 *
 * A device whose record has begun already is left alone, so a run made to
 * repeat writes nothing a second time.
 */
export const targetRecord: MigrationStep = {
  name: '018-target-record',

  async run(context: MigrationContext): Promise<void> {
    const recorded = new Set(await context.db.collection(TARGET_CHANGES).distinct('deviceId'));
    const devices = context.db
      .collection<{ id: string; configuration?: unknown }>(DEVICES)
      .find({ configuration: { $type: 'object' } }, { projection: { id: 1, configuration: 1 } });

    for await (const device of devices) {
      const targets = targetsOf(device.configuration as Record<string, unknown>);
      if (typeof device.id !== 'string' || recorded.has(device.id) || targets === null) continue;

      await context.write(TARGET_CHANGES, { id: derivedId('targetChange', device.id), deviceId: device.id, at: context.at, targets });
    }
  },
};
