import { MigrationContext, MigrationStep } from '../migration';

const DEVICES = 'devices';
const SPACES = 'spaces';

/**
 * Puts the demo flag on the places demo devices stand in now.
 *
 * `demo on` flags a device and the space it stands in at that moment, and the
 * tour lists flagged spaces only. A demo device moved since - into a place of
 * its own, which the device sheet offers since places can stand in rooms - left
 * the flag on a place it no longer stood in: the tour's Start showed that empty
 * place and not the device, while the device list showed the device. Moving
 * one now takes the flag along; this does the same for the moves made before.
 *
 * A flagged place without any device in it is what such a move left behind,
 * and stops being a demo one. A flagged place that still holds a device is
 * left alone, demo or not, because somebody flagged it on purpose.
 */
export const demoPlaces: MigrationStep = {
  name: '025-demo-places',

  async run(context: MigrationContext): Promise<void> {
    const devices = context.db.collection(DEVICES);
    const spaces = context.db.collection(SPACES);

    const standing = (await devices.distinct('spaceId', { isDemo: true, spaceId: { $ne: null } })) as string[];
    const unflagged = { id: { $in: standing }, isDemo: { $ne: true } };
    const flagged = await spaces.countDocuments(unflagged);
    context.count('spaces.demoFlagged', flagged);
    if (!context.dryRun && flagged > 0) await spaces.updateMany(unflagged, { $set: { isDemo: true } });

    const occupied = (await devices.distinct('spaceId', { spaceId: { $ne: null } })) as string[];
    const leftBehind = { isDemo: true, kind: { $ne: 'room' }, id: { $nin: occupied } };
    const cleared = await spaces.countDocuments(leftBehind);
    context.count('spaces.demoCleared', cleared);
    if (!context.dryRun && cleared > 0) await spaces.updateMany(leftBehind, { $set: { isDemo: false } });
  },
};
