import { mongo } from 'mongoose';
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
  createdAt?: Date;
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

/** The lines a device's past in a place is told by: what it, its alarms and its plan wrote, never a person. */
const ITS_OWN_LINES = ['system', 'alarm', 'plan'];

/** The place step 033 makes for a device. */
const placeIdOf = (deviceId: string): string => derivedId('one-climate-place', deviceId);

/**
 * Gives every second controller or fridge module of a place a place of its own, with its past.
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
 * devices in. The old place keeps it, its grows, their lines and the
 * reminders, and a stream camera. Every other one moves into a new place:
 * - called the device's own name, else the old place's - numbered where the
 *   owner already has one so called ("Zelt 2"), as the server names a place it
 *   makes; of the old place's kind, in its room, with its owner, its question
 *   about a preset and its retention; a demo device's is a demo place, and the
 *   old one stays one only while a demo device is left in it;
 * - seen by everybody who saw the old one: a room's members see it through the
 *   room, and each member of the old place is a member of the new one with the
 *   same role. Invitations and share links name one place and stay with the old
 *   one - a copy would be a code nobody holds;
 * - holding the device's whole stay in the old place: it was a climate of its
 *   own all along, so what it measured there is the new place's past, and its
 *   stay there becomes its stay in the new one, from where it began (a first
 *   placement still reaching back past its own start). Its Terp Cam goes along,
 *   and so do the alarms the two raised over that stay and the lines the device,
 *   its alarms and its plan wrote, out of the old place's grow; an open alert
 *   follows the device wherever it began, as step 030 moves them.
 *
 * The step's first version began the new place's stay at its own instant, so a
 * split place said nothing had ever been measured there while its tiles and
 * alerts showed the device's last reading. On a database it ran on, this puts
 * that right: a placement in a place this step made (the id is derived from
 * the device) that begins when the place was made, straight after one that
 * ended then, is one stay, and what the device left in the place before goes
 * along as above. A repaired stay no longer begins when its place was made, so
 * a second run finds nothing.
 *
 * Ids are derived from the device and the membership, so a run killed half-way
 * makes no second place on the next; a split place holds one climate, so a
 * second run splits nothing. Places that have ended and rooms are left. Reads
 * the new collections and moves nothing aside.
 */
export const oneClimateAPlace: MigrationStep = {
  name: '033-one-climate-a-place-with-its-past',

  async run(context: MigrationContext): Promise<void> {
    const spaces = context.db.collection<Place>('spaces');
    const devices = context.db.collection<ClimateDevice>('devices');
    const memberships = context.db.collection('memberships');
    const cameras = context.db.collection('cameras');

    const climates = await devices
      .find({ type: { $in: [...OWN_CLIMATE_TYPES] }, spaceId: { $ne: null } })
      .sort({ createdAt: 1, id: 1 })
      .toArray();
    const byPlace = new Map<string, ClimateDevice[]>();
    for (const device of climates) if (device.spaceId) byPlace.set(device.spaceId, [...(byPlace.get(device.spaceId) ?? []), device]);
    const crowded = [...byPlace].filter(([, here]) => here.length > 1).map(([spaceId]) => spaceId);
    const places = crowded.length === 0 ? [] : await spaces.find({ id: { $in: crowded }, archivedAt: null, kind: { $ne: 'room' } }).toArray();

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
        const id = placeIdOf(device.id);
        const own = device.name && device.name !== device.type ? device.name : place.name;
        const name = numbered(own.trim(), names);
        names.add(nameKey(name));
        const following = { removedAt: null, deviceId: device.id };
        const camerasAlong = (await cameras.find(following, { projection: { id: 1 } }).toArray()).map(camera => camera.id as string);
        const placements = device.placements ?? [];
        const stay = placements.findIndex(one => one.spaceId === place.id && one.endedAt === null);

        context.count('spaces.madeForASecondClimate');
        context.count('devices.movedToAPlaceOfTheirOwn');
        context.count('memberships.copiedToTheNewPlace', people.length);
        context.count('cameras.movedWithTheirDevice', camerasAlong.length);
        const past = { deviceId: device.id, cameraIds: camerasAlong, from: place.id, to: id, since: sinceOf(placements, stay), until: null };
        if (context.dryRun) {
          await takeAlong(context, past);
          continue;
        }

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
        // Without a stay in the place recorded, which a device given its placements by step 026 always has, it begins now.
        const moved =
          stay < 0 ? movedTo(placements, id, context.at) : placements.map((one, index) => (index === stay ? { ...one, spaceId: id } : one));
        await devices.updateOne({ id: device.id }, { $set: { spaceId: id, placements: moved } });
        await cameras.updateMany(following, { $set: { spaceId: id } });
        await takeAlong(context, past);
      }

      if (!context.dryRun && place.isDemo && !(await devices.countDocuments({ spaceId: place.id, isDemo: true }))) {
        await spaces.updateOne({ id: place.id }, { $set: { isDemo: false } });
      }
    }

    await repair(context);
  },
};

/** A first placement speaks for what the device measured before it (`beginsAt`, `device-placements.ts`): it has no start. */
const sinceOf = (placements: readonly DevicePlacement[], index: number): Date | null => (index > 0 ? placements[index].startedAt : null);

/** What a device left in a place over a stretch of its stay. */
interface Past {
  deviceId: string;
  cameraIds: string[];
  from: string;
  to: string;
  since: Date | null;
  until: Date | null;
}

/**
 * The alarms a device and its camera raised in a place over a stretch, an open one wherever it began, and the lines
 * the device, its alarms and its plan wrote there, taken to its own place - the lines out of the old place's grow.
 */
const takeAlong = async (context: MigrationContext, past: Past): Promise<void> => {
  const alerts = context.db.collection('alerts');
  const entries = context.db.collection('entries');
  const during = (field: string): mongo.Filter<mongo.Document> =>
    past.since || past.until ? { [field]: { ...(past.since ? { $gte: past.since } : {}), ...(past.until ? { $lt: past.until } : {}) } } : {};
  const ofIt = { $or: [{ deviceId: past.deviceId }, ...(past.cameraIds.length > 0 ? [{ cameraId: { $in: past.cameraIds } }] : [])] };

  const raised = { $and: [{ spaceId: past.from }, ofIt, { $or: [{ resolvedAt: null }, during('startedAt')] }] };
  const written = { $and: [{ spaceId: past.from, kind: { $in: ITS_OWN_LINES }, source: { $ne: 'human' } }, ofIt, during('occurredAt')] };
  const [alarms, lines] = await Promise.all([alerts.countDocuments(raised), entries.countDocuments(written)]);
  if (alarms > 0) context.count('alerts.movedWithTheirDevice', alarms);
  if (lines > 0) context.count('entries.movedWithTheirDevice', lines);
  if (context.dryRun) return;

  await alerts.updateMany(raised, { $set: { spaceId: past.to } });
  await entries.updateMany(written, { $set: { spaceId: past.to, growId: null } });
};

/**
 * What the step's first version did, put right: a stay in a place it made that begins when the place was made,
 * straight after one in the old place that ended then, is one stay from where the first began.
 */
const repair = async (context: MigrationContext): Promise<void> => {
  const spaces = context.db.collection<Place>('spaces');
  const devices = context.db.collection<ClimateDevice>('devices');
  const cameras = context.db.collection('cameras');

  // Read again, and every one wherever it stands now: a device split by the first version may have moved on since.
  const climates = await devices.find({ type: { $in: [...OWN_CLIMATE_TYPES] } }).toArray();

  const made = new Map(
    (await spaces.find({ id: { $in: climates.map(device => placeIdOf(device.id)) } }, { projection: { id: 1, createdAt: 1 } }).toArray()).map(
      place => [place.id, place.createdAt],
    ),
  );
  for (const device of climates) {
    const id = placeIdOf(device.id);
    const createdAt = made.get(id);
    const placements = device.placements ?? [];
    const split = placements.findIndex(
      (one, index) =>
        index > 0 &&
        one.spaceId === id &&
        createdAt !== undefined &&
        one.startedAt.getTime() === createdAt.getTime() &&
        placements[index - 1].endedAt?.getTime() === createdAt.getTime() &&
        placements[index - 1].spaceId !== id,
    );
    if (split < 0) continue;

    const before = placements[split - 1];
    const cameraIds = (await cameras.find({ deviceId: device.id }, { projection: { id: 1 } }).toArray()).map(camera => camera.id as string);
    context.count('devices.givenTheirPastInTheirPlace');
    await takeAlong(context, {
      deviceId: device.id,
      cameraIds,
      from: before.spaceId,
      to: id,
      since: sinceOf(placements, split - 1),
      until: createdAt!,
    });
    if (context.dryRun) continue;

    const whole = [...placements.slice(0, split - 1), { ...placements[split], startedAt: before.startedAt }, ...placements.slice(split + 1)];
    await devices.updateOne({ id: device.id }, { $set: { placements: whole } });
  }
};
