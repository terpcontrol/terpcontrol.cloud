import { spaceIdOf } from '../ids';
import { LEGACY, LegacyDevice, createdAtOf, textOf } from '../legacy';
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
 *   typed to name the place it stands in. A device that was never named falls
 *   back to its id, which is what the old screens showed for it.
 *
 * An unclaimed device gets none: a space belongs to somebody, and nobody has
 * ever seen that device.
 */

const SPACE_KIND: Record<string, string> = { fridge: 'fridge', controller: 'tent' };

export const spaces: MigrationStep = {
  name: '004-spaces',

  async run(context: MigrationContext): Promise<void> {
    await context.renameAside(LEGACY.devices);
    const legacy = await context.source(LEGACY.devices);

    for await (const device of legacy.find<LegacyDevice>({}).sort({ _id: 1 })) {
      const deviceId = textOf(device.device_id);
      const ownerId = textOf(device.owner_id);
      if (!deviceId) continue;

      context.count('devices.read');
      if (!ownerId) {
        context.count('spaces.skippedUnclaimed');
        continue;
      }

      await context.write('spaces', {
        id: spaceIdOf(deviceId),
        ownerId,
        kind: SPACE_KIND[textOf(device.device_type) ?? ''] ?? 'other',
        name: textOf(device.name) ?? deviceId,
        roomId: null,
        presetPrompt: 'ask',
        retention: { climateDays: null },
        isDemo: device.demoDevice === true,
        archivedAt: null,
        createdAt: createdAtOf(device),
      });
    }
  },
};
