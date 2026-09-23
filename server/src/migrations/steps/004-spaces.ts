import { spaceIdOf } from '../ids';
import { LEGACY, LegacyDevice, createdAtOf, flagOf, fromTable, textOf } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';

/**
 * A space per claimed device, because the old model has no place that is not a
 * device: a grow stood in a tent only in so far as a controller was in it.
 *
 * Two things the old data does not say, decided here:
 *
 * - **What kind of place it is.** Read from the device type, which is as close
 *   as the old database gets: a fridge controller is in a fridge and a tent
 *   controller in a tent. A plug, a fan or a light is in something, but nothing
 *   says what, so it becomes `other` and its owner can say.
 * - **What it is called.** The device's name, because that is what its owner
 *   typed to name the place it stands in. Two thirds of them were never named,
 *   and their id is what the old screens showed - but an id is a name for a
 *   *device*, and this is a place: falling back to it would open the app, after
 *   the upgrade, on a home screen of hex. So an unnamed device's place is
 *   called what this app calls a new one - "Tent 2", "Fridge 1", "Place 3" -
 *   numbered per owner and per kind in the order the devices were made, which
 *   is the order their owner met them in. The words are English because the
 *   server has no catalogue to say them in, and the name is one tap to change.
 *
 * An unclaimed device gets none: a space belongs to somebody, and nobody has
 * ever seen that device.
 */

const SPACE_KIND: Record<string, string> = { fridge: 'fridge', controller: 'tent' };

/** The app's own words for a place nobody has named, one per kind of place. */
const UNNAMED: Record<string, string> = { tent: 'Tent', fridge: 'Fridge', other: 'Place' };

/** "Tent 2": the next number this owner has of that kind, counting only the ones being named here. */
const nextName = (counted: Map<string, number>, ownerId: string, kind: string): string => {
  const key = `${ownerId}:${kind}`;
  const n = (counted.get(key) ?? 0) + 1;
  counted.set(key, n);

  return `${UNNAMED[kind] ?? UNNAMED.other} ${n}`;
};

export const spaces: MigrationStep = {
  name: '004-spaces',
  moves: [LEGACY.devices],

  async run(context: MigrationContext): Promise<void> {
    const legacy = await context.source(LEGACY.devices);
    // One counter per owner and per kind, so a grower with three unnamed tents
    // gets Tent 1, Tent 2 and Tent 3 rather than three of the same name.
    const counted = new Map<string, number>();

    for await (const device of legacy.find<LegacyDevice>({}).sort({ _id: 1 })) {
      const deviceId = textOf(device.device_id);
      const ownerId = textOf(device.owner_id);
      if (!deviceId) continue;

      context.count('devices.read');
      if (!ownerId) {
        context.count('spaces.skippedUnclaimed');
        continue;
      }

      const kind = fromTable(SPACE_KIND, textOf(device.device_type)) ?? 'other';

      await context.write('spaces', {
        id: spaceIdOf(deviceId),
        ownerId,
        kind,
        name: textOf(device.name) ?? nextName(counted, ownerId, kind),
        roomId: null,
        presetPrompt: 'ask',
        retention: { climateDays: null },
        isDemo: flagOf(device.demoDevice),
        archivedAt: null,
        createdAt: createdAtOf(device),
      });
    }
  },
};
