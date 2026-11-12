import { MigrationContext, MigrationStep } from '../migration';

/**
 * Ends the rooms nothing is left in.
 *
 * A room used to be made, emptied and deleted like a place, so an install could
 * be left with rooms nobody had taken away after their last tent moved out.
 * A room is a field of the places in it now: the server makes one when a place
 * names it and ends it once its last place and its last member have left. This
 * does that for the rooms emptied before.
 *
 * Empty is: no place in it that has not ended, nobody a member of it, and
 * nothing standing in it itself - a room could hold a device, a camera or a
 * grow of its own, and one that does is somebody's place and is left alone. An
 * ended room goes the way a deleted place goes: a tombstone history can still
 * name, its invites and share links removed. The ended places still naming it
 * are taken out of it, so that one brought back does not hang in a room that
 * is gone.
 *
 * A room already ended is not looked at again, so a second run finds nothing.
 */
export const emptyRooms: MigrationStep = {
  name: '027-empty-rooms',

  async run(context: MigrationContext): Promise<void> {
    const spaces = context.db.collection('spaces');
    const rooms = await spaces.find({ kind: 'room', archivedAt: null }, { projection: { id: 1 } }).toArray();

    for (const room of rooms) {
      const id = room.id as string;
      const held =
        (await spaces.countDocuments({ roomId: id, archivedAt: null }, { limit: 1 })) ||
        (await context.db.collection('memberships').countDocuments({ spaceId: id }, { limit: 1 })) ||
        (await context.db.collection('devices').countDocuments({ spaceId: id }, { limit: 1 })) ||
        (await context.db.collection('cameras').countDocuments({ spaceId: id, removedAt: null }, { limit: 1 })) ||
        (await context.db
          .collection('grows')
          .countDocuments({ endedAt: null, placements: { $elemMatch: { spaceId: id, endedAt: null } } }, { limit: 1 }));
      if (held) {
        context.count('rooms.kept');
        continue;
      }

      context.count('rooms.ended');
      if (context.dryRun) continue;

      await spaces.updateOne({ id }, { $set: { archivedAt: context.at } });
      const left = await spaces.updateMany({ roomId: id }, { $set: { roomId: null } });
      context.count('spaces.takenOutOfAnEndedRoom', left.modifiedCount);
      await context.db.collection('invites').deleteMany({ spaceId: id });
      await context.db.collection('shareLinks').deleteMany({ 'subject.type': 'space', 'subject.id': id });
    }
  },
};
