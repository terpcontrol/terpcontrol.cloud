import { OWN_CLIMATE_TYPES, nameKey, numbered } from '@fg2/shared-types/v1-schemas';
import { movedTo } from '@common/v1/device-placements';
import type { DevicePlacement } from '@database/schemas/v1/devices.schema';
import { setpointsOf } from '@modules/v1/device/setpoints';
import { derivedId } from '../ids';
import { MigrationContext, MigrationStep } from '../migration';

interface Place {
  id: string;
  ownerId: string;
  kind: string;
  name: string;
  roomId: string | null;
  presetPrompt?: string;
  retention?: { climateDays: number | null };
  isDemo?: boolean;
}

interface ClimateDevice {
  id: string;
  type: string;
  name: string | null;
  spaceId: string | null;
  isDemo?: boolean;
  configuration?: Record<string, unknown> | null;
  state?: { hardware?: Record<string, string> };
  placements?: DevicePlacement[];
  createdAt?: Date;
}

/**
 * Gives every second controller or fridge module of a place a place of its own.
 *
 * A place holds one climate (Chris, 2026-11-14): a second one in it was written
 * to by nothing on Steuerung, paused by no maintenance, and raised its alarms
 * under the first one's figures. The server refuses a second since; this splits
 * the places that hold two from before (Chris: split them, rather than leave a
 * note).
 *
 * The lead stays - the device the place is judged by today: of its
 * controllers and fridge modules the first that holds targets, else the first,
 * first by `createdAt` and then id, the order the server lists a place's
 * devices in. Every other one moves into a new place:
 * - called the device's own name, else the old place's - numbered where the
 *   owner already has one so called ("Zelt 2"), as the server names a place it
 *   makes; of the old place's kind, in its room, with its owner, its question
 *   about a preset and its retention; a demo device's is a demo place, and the
 *   old one stays one only while a demo device is left in it;
 * - seen by everybody who saw the old one: a room's members see it through the
 *   room, and each member of the old place is a member of the new one with the
 *   same role. Invitations and share links name one place and stay with the old
 *   one - a copy would be a code nobody holds;
 * - the device's stay in the old place ends at the step's instant and the new
 *   one begins there (`movedTo`, as a move writes it); its Terp Cam goes along,
 *   and so do the open alerts of the two, as step 030 moves them. Grows, their
 *   lines and the reminders stay with the old place; a stream camera too.
 *
 * Ids are derived from the device and the membership, so a run killed half-way
 * makes no second place on the next; a split place holds one climate, so a
 * second run finds nothing. Places that have ended and rooms are left. Reads
 * the new collections and moves nothing aside.
 */
export const oneClimateAPlace: MigrationStep = {
  name: '033-one-climate-a-place',

  async run(context: MigrationContext): Promise<void> {
    const spaces = context.db.collection<Place>('spaces');
    const devices = context.db.collection<ClimateDevice>('devices');
    const memberships = context.db.collection('memberships');
    const cameras = context.db.collection('cameras');
    const alerts = context.db.collection('alerts');

    const climates = await devices
      .find({ type: { $in: [...OWN_CLIMATE_TYPES] }, spaceId: { $ne: null } })
      .sort({ createdAt: 1, id: 1 })
      .toArray();
    const byPlace = new Map<string, ClimateDevice[]>();
    for (const device of climates) if (device.spaceId) byPlace.set(device.spaceId, [...(byPlace.get(device.spaceId) ?? []), device]);
    const crowded = [...byPlace].filter(([, here]) => here.length > 1).map(([spaceId]) => spaceId);
    if (crowded.length === 0) return;

    const places = await spaces.find({ id: { $in: crowded }, archivedAt: null, kind: { $ne: 'room' } }).toArray();
    for (const place of places) {
      const here = byPlace.get(place.id)!;
      const lead =
        here.find(device => setpointsOf(device.configuration ?? null, true, device.state?.hardware ?? {}, device.type, context.at) !== null) ??
        here[0];
      const names = new Set(
        (await spaces.find({ ownerId: place.ownerId, archivedAt: null, kind: { $ne: 'room' } }, { projection: { name: 1 } }).toArray()).map(peer =>
          nameKey(peer.name),
        ),
      );
      const people = await memberships.find({ spaceId: place.id }).toArray();

      for (const device of here.filter(one => one !== lead)) {
        const id = derivedId('one-climate-place', device.id);
        const own = device.name && device.name !== device.type ? device.name : place.name;
        const name = numbered(own.trim(), names);
        names.add(nameKey(name));
        const following = { removedAt: null, deviceId: device.id };
        const camerasAlong = (await cameras.find(following, { projection: { id: 1 } }).toArray()).map(camera => camera.id as string);
        const open = { resolvedAt: null, $or: [{ deviceId: device.id }, { cameraId: { $in: camerasAlong } }] };

        context.count('spaces.madeForASecondClimate');
        context.count('devices.movedToAPlaceOfTheirOwn');
        context.count('memberships.copiedToTheNewPlace', people.length);
        context.count('cameras.movedWithTheirDevice', camerasAlong.length);
        context.count('alerts.movedWithTheirDevice', await alerts.countDocuments(open));
        if (context.dryRun) continue;

        await spaces.updateOne(
          { id },
          {
            $setOnInsert: {
              id,
              ownerId: place.ownerId,
              kind: place.kind,
              name,
              roomId: place.roomId ?? null,
              presetPrompt: place.presetPrompt ?? 'ask',
              retention: { climateDays: place.retention?.climateDays ?? null },
              isDemo: device.isDemo === true,
              archivedAt: null,
              createdAt: context.at,
            },
          },
          { upsert: true },
        );
        for (const person of people) {
          const seen = { id: derivedId('one-climate-membership', person.id as string, device.id), spaceId: id, userId: person.userId };
          await memberships.updateOne(
            { spaceId: id, userId: person.userId },
            { $setOnInsert: { ...seen, role: person.role, invitedBy: person.invitedBy ?? null, inviteId: null, createdAt: context.at } },
            { upsert: true },
          );
        }
        await devices.updateOne({ id: device.id }, { $set: { spaceId: id, placements: movedTo(device.placements ?? [], id, context.at) } });
        await cameras.updateMany(following, { $set: { spaceId: id } });
        await alerts.updateMany(open, { $set: { spaceId: id } });
      }

      if (!context.dryRun && place.isDemo && !(await devices.countDocuments({ spaceId: place.id, isDemo: true }))) {
        await spaces.updateOne({ id: place.id }, { $set: { isDemo: false } });
      }
    }
  },
};
