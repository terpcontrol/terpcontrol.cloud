import { MigrationContext, MigrationStep } from '../migration';

const DEVICES = 'devices';
const SPACES = 'spaces';

interface PlacedDevice {
  id: string;
  spaceId?: string | null;
  createdAt?: Date;
  state?: { claimedAt?: Date | null };
}

/**
 * Gives every device the record of where it stood.
 *
 * Until now a device row said only where it stands, and every read about the
 * past - a place's curves, a grow's days, an export - took that for where it
 * had always stood. The first placement says exactly that: a device standing in
 * a place has stood there since it was claimed, or since it first registered
 * where nothing recorded the claim - which is every device carried over from
 * the old database. A first placement is read back past the instant it carries
 * (`common/v1/device-placements.ts`), so nothing a screen shows changes with
 * this step, whichever of the two instants it is.
 *
 * A device nobody has claimed, and a claimed one without a place, gets an empty
 * list: it stands nowhere, which is no placement. A device whose place has
 * since ended keeps pointing at it, as its `spaceId` does, and is counted.
 *
 * Only rows without the field are touched, so a second run finds nothing.
 */
export const devicePlacements: MigrationStep = {
  name: '026-device-placements',

  async run(context: MigrationContext): Promise<void> {
    const devices = context.db.collection<PlacedDevice>(DEVICES);
    const ended = new Set(
      (
        await context.db
          .collection(SPACES)
          .find({ archivedAt: { $ne: null } }, { projection: { id: 1 } })
          .toArray()
      ).map(space => space.id as string),
    );

    const cursor = devices.find({ placements: { $exists: false } }, { projection: { id: 1, spaceId: 1, createdAt: 1, 'state.claimedAt': 1 } });
    for await (const device of cursor) {
      const since = device.state?.claimedAt ?? device.createdAt ?? context.at;
      const placements = device.spaceId ? [{ spaceId: device.spaceId, startedAt: since, endedAt: null }] : [];

      context.count(device.spaceId ? 'devices.placed' : 'devices.standingNowhere');
      if (device.spaceId && ended.has(device.spaceId)) context.count('devices.placedInAnEndedSpace');
      if (!context.dryRun) await devices.updateOne({ id: device.id, placements: { $exists: false } }, { $set: { placements } });
    }
  },
};
