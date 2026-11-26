import { MigrationContext, MigrationStep } from '../migration';

/**
 * Puts every open alert where its device stands.
 *
 * An alert names the place it was raised in, and an open one now moves with
 * its device, because the inbox, Start and Verlauf read it by that place. A
 * device moved while an alarm was open used to leave the alert behind: it
 * stood under the place the device had left - for people who no longer see
 * the device - and under the new one as well. This moves those along: an open
 * alert of a device takes the device's place, one of a camera alone the
 * camera's, and "no place" where that is none. An alert that is over keeps
 * the place it happened in.
 *
 * An alert whose device or camera is not there is left to step 024.
 */
export const openAlertsWhereTheDeviceStands: MigrationStep = {
  name: '030-open-alerts-where-the-device-stands',

  async run(context: MigrationContext): Promise<void> {
    const alerts = context.db.collection('alerts');

    for (const [field, collection, also] of [
      ['deviceId', 'devices', {}],
      ['cameraId', 'cameras', { deviceId: null }],
    ] as const) {
      const ids = (await alerts.distinct(field, { resolvedAt: null, [field]: { $ne: null }, ...also })) as string[];
      const standing = await context.db
        .collection(collection)
        .find({ id: { $in: ids } }, { projection: { id: 1, spaceId: 1 } })
        .toArray();

      for (const row of standing) {
        const spaceId = (row.spaceId as string | null | undefined) ?? null;
        const elsewhere = { resolvedAt: null, [field]: row.id as string, ...also, spaceId: { $ne: spaceId } };

        context.count('alerts.movedToTheirDevice', await alerts.countDocuments(elsewhere));
        if (!context.dryRun) await alerts.updateMany(elsewhere, { $set: { spaceId } });
      }
    }
  },
};
