import { MigrationContext, MigrationStep } from '../migration';

const ALERTS = 'alerts';
const DEVICES = 'devices';
const CAMERAS = 'cameras';
const RULES = 'alarmRules';

interface DeviceRow {
  id: string;
  ownerId: string | null;
  state?: { claimedAt?: Date | null };
}

/**
 * Clears the alerts nothing could ever close or that belong to somebody who no
 * longer holds the device.
 *
 * Giving a device up deleted its rules and left their alerts, so an episode open
 * at that moment stayed open on the previous owner's bell for good, and the
 * history came along with the device to whoever claimed it next. Removing a
 * camera and disabling a rule left an open episode just as stuck, because the
 * loops that close one judge only listed cameras and enabled rules. Those three
 * now clean up after themselves; this does the same for what they left before:
 *
 * - an alert of a device that is unclaimed, gone, or claimed since it began is deleted;
 * - an open alert of a removed or gone camera, or of a rule that is gone or disabled, is closed quietly,
 *   and a disabled rule stops counting itself as triggered.
 */
export const orphanedAlerts: MigrationStep = {
  name: '024-orphaned-alerts',

  async run(context: MigrationContext): Promise<void> {
    const alerts = context.db.collection(ALERTS);

    const deviceIds = (await alerts.distinct('deviceId', { deviceId: { $ne: null } })) as string[];
    const devices = await context.db
      .collection<DeviceRow>(DEVICES)
      .find({ id: { $in: deviceIds } }, { projection: { id: 1, ownerId: 1, 'state.claimedAt': 1 } })
      .toArray();
    const byId = new Map(devices.map(device => [device.id, device]));
    const given = deviceIds.filter(id => !byId.get(id)?.ownerId);
    const claimedSince = devices.filter(device => device.ownerId && device.state?.claimedAt);
    const foreign = [
      { deviceId: { $in: given } },
      ...claimedSince.map(device => ({ deviceId: device.id, startedAt: { $lt: device.state!.claimedAt! } })),
    ];

    const cameraIds = (await alerts.distinct('cameraId', { cameraId: { $ne: null }, resolvedAt: null })) as string[];
    const listed = (await context.db.collection(CAMERAS).distinct('id', { id: { $in: cameraIds }, removedAt: null })) as string[];
    const goneCameras = cameraIds.filter(id => !listed.includes(id));

    const ruleIds = (await alerts.distinct('ruleId', { ruleId: { $ne: null }, resolvedAt: null })) as string[];
    const watching = (await context.db.collection(RULES).distinct('id', { id: { $in: ruleIds }, enabled: true })) as string[];
    const idleRules = ruleIds.filter(id => !watching.includes(id));

    const stuck = { resolvedAt: null, $or: [{ cameraId: { $in: goneCameras } }, { ruleId: { $in: idleRules } }] };
    const triggeredOff = { enabled: false, 'state.triggered': true };

    const deleted = await alerts.countDocuments({ $or: foreign });
    context.count('alerts.foreignDeleted', deleted);
    if (!context.dryRun && deleted > 0) await alerts.deleteMany({ $or: foreign });

    const closed = await alerts.countDocuments(stuck);
    context.count('alerts.stuckClosed', closed);
    if (!context.dryRun && closed > 0) await alerts.updateMany(stuck, { $set: { resolvedAt: new Date() } });

    const reset = await context.db.collection(RULES).countDocuments(triggeredOff);
    context.count('alarmRules.disabledUntriggered', reset);
    if (!context.dryRun && reset > 0) {
      await context.db.collection(RULES).updateMany(triggeredOff, { $set: { 'state.triggered': false, 'state.extremeValue': null } });
    }
  },
};
