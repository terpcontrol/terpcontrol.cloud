import { nameKey, numbered } from '@fg2/shared-types/v1-schemas/place-names.js';
import { OWN_CLIMATE_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import type { Camera, Device, Space } from '@fg2/shared-types/v1';
import type { EndStep, EndTo } from '@/api/spaces';
import { placeKindOf } from '@/ui/naming';

/**
 * What ending a place has to settle: each device, each camera and each running
 * grow standing in it is sent somewhere. A choice is the value of its select,
 * so the page holds one string per thing and nothing else.
 *
 * A tent is kept together: one device leads - the first that holds a climate
 * of its own - and the rest stays with it wherever it goes, until told
 * otherwise.
 */

/** A device: a new place of its own, another place (`move:<id>`), with the leading device, or given up. */
export const NEW_PLACE = 'new';
export const RELEASE = 'release';
/** With the leading device wherever it goes; for a camera a device answers for, with that device. */
export const STAY = 'stay';
/** A camera: taken off its device, or removed where it looks in on its own. */
export const UNCOUPLE = 'uncouple';
/** A grow: with a device to its new place (`with:<deviceId>`), into another place, to no place, or ended. Unanswered is `''`. */
export const NOWHERE = 'nowhere';
export const END = 'end';
/** What ends with the place - its reminders, and what its guests and its room's members see: a line each, like a thing standing here. */
export const REMINDERS = 'reminders';
export const GUESTS = 'guests';
export const MEMBERS = 'members';

export const moveTo = (spaceId: string): string => `move:${spaceId}`;
export const withDevice = (deviceId: string): string => `with:${deviceId}`;

const placeIn = (choice: string): string | null => (choice.startsWith('move:') ? choice.slice(5) : null);

type Choices = Readonly<Record<string, string>>;
type Place = Pick<Space, 'id' | 'name' | 'roomId'>;
type Grow = { id: string; name: string; day: number | null };

export interface Standing {
  /** Those that hold a climate of their own first: the first that is kept leads. */
  devices: readonly Device[];
  /** Cameras paired at one of those devices: they follow it unless taken off it. */
  paired: readonly Camera[];
  /** Cameras looking into the place on their own. */
  loose: readonly Camera[];
  grows: readonly Grow[];
}

/** What stands in a place, from the lists the account already has. */
export const standingIn = (spaceId: string, devices: readonly Device[], cameras: readonly Camera[], grows: readonly Grow[]): Standing => {
  const here = devices.filter(device => device.spaceId === spaceId);
  const ids = new Set(here.map(device => device.id));
  const looking = cameras.filter(camera => camera.spaceId === spaceId && camera.removedAt === null);

  return {
    devices: [...here.filter(device => OWN_CLIMATE_TYPES.includes(device.type)), ...here.filter(device => !OWN_CLIMATE_TYPES.includes(device.type))],
    paired: looking.filter(camera => camera.deviceId !== null && ids.has(camera.deviceId)),
    loose: looking.filter(camera => camera.deviceId === null || !ids.has(camera.deviceId)),
    grows,
  };
};

/**
 * What an attempt was about, kept ahead of what stands here now until the
 * place is gone: what it settled, and what the account still holds (`lasts`) -
 * a camera goes along when its device moves, and is still to be taken off it.
 */
export const kept = (now: Standing, was: Standing, lasts: (id: string) => boolean): Standing => {
  const had = new Set([was.devices, was.paired, was.loose, was.grows].flatMap(some => some.map(one => one.id)));
  const both = <T extends { id: string }>(before: readonly T[], here: readonly T[]) =>
    [...before, ...here].filter((one, at) => (at < before.length ? lasts(one.id) : !had.has(one.id)));
  return {
    devices: both(was.devices, now.devices),
    paired: both(was.paired, now.paired),
    loose: both(was.loose, now.loose),
    grows: both(was.grows, now.grows),
  };
};

/** The device the rest stays with: the first that is not given up, so giving the controller up hands the lead on. */
export const leaderOf = (standing: Standing, choices: Choices): Device | null =>
  standing.devices.find(device => choices[device.id] !== RELEASE) ?? null;

/**
 * Where everything goes: what was chosen, and before anybody chose, the
 * leading device into another place of its kind - a new one where there is
 * none - and the rest with it. Where the plants stand is not guessed - a grow
 * is the one thing asked outright, and asked again (`''`) when the device it
 * was to go with gets no new place after all. Only what stands here is sent.
 */
export const choicesOf = (
  standing: Standing,
  elsewhere: readonly Space[],
  chosen: Choices,
  /** The places that hold a climate of their own already: a second one does not fit there - one place, one climate. */
  held: ReadonlySet<string> = new Set(),
  /** Where what an attempt sent away now stands: what was to stay or go with a device that has left goes to that place by its name. */
  settled: Readonly<Record<string, string | null>> = {},
): Record<string, string> => {
  const leader = leaderOf(standing, chosen);
  const went = (id = '') => (settled[id] ? moveTo(settled[id]) : undefined);
  const stay = went(leader?.id) ?? STAY;
  const second = (place: Space) => leader !== null && OWN_CLIMATE_TYPES.includes(leader.type) && held.has(place.id);
  const fits = leader ? elsewhere.find(place => place.kind === placeKindOf(leader.type) && !second(place)) : undefined;
  const alone = elsewhere[0] ? moveTo(elsewhere[0].id) : UNCOUPLE;
  const first: Record<string, string> = {
    ...Object.fromEntries(standing.devices.map(device => [device.id, device !== leader ? stay : fits ? moveTo(fits.id) : NEW_PLACE])),
    ...Object.fromEntries(standing.paired.map(camera => [camera.id, STAY])),
    ...Object.fromEntries(standing.loose.map(camera => [camera.id, leader ? stay : alone])),
    ...Object.fromEntries(standing.grows.map(grow => [grow.id, ''])),
  };
  // Staying holds only while there is somebody to stay with: the device that leads now is sent as a leader is.
  const sent = Object.fromEntries(Object.entries(first).map(([id, to]) => [id, chosen[id] === STAY ? to : (chosen[id] ?? to)]));
  const along = (to: string, id = to.slice(5)) => (to.startsWith('with:') ? (went(id) ?? (sent[id] === NEW_PLACE ? to : '')) : to);

  return Object.fromEntries(Object.entries(sent).map(([id, to]) => [id, along(to)]));
};

/** What becomes of one thing standing here, or of what ends with the place. */
export interface Fate {
  id: string;
  what: 'device' | 'camera' | 'grow' | 'ends';
  /** How the catalogue words it, under `place.remove.will`. */
  fate: 'make' | 'move' | 'stay' | 'release' | 'uncouple' | 'remove' | 'with' | 'nowhere' | 'end' | 'reminders' | 'unseen' | 'roomEnds' | 'roomEmpty';
  /** How many the line is about: one, but for reminders and people. */
  count: number;
  /** The name of the place it then stands in; null where it stands in none. For people, what they no longer see. */
  place: string | null;
  /** The device it stays or goes with, or is taken off. */
  beside: string | null;
  /** The write that settles it; none for a camera that its device's own move or release takes along. */
  step: EndStep | null;
}

/**
 * What becomes of everything, in the order it is written: the devices, the
 * cameras, the grows. `nameOf` is what the place made for a device is called,
 * numbered on where one of `places` - or one made a line before - already
 * carries that name. A place an earlier attempt made for a device (`made`) is
 * moved into instead of making a second. What ends with the place comes last:
 * its reminders - a grow's go where the grow goes -, then whoever is let in:
 * the guests of the place lose it, and so do the members of its room where
 * the room goes on (`everyone` counts both, a person once). Where the room
 * ends with its last place - not where what stood here gets a place in it -
 * its members lose the room, and a room nobody was let into is said to end.
 */
export const fatesOf = (
  standing: Standing,
  choices: Choices,
  nameOf: (device: Device) => string,
  places: readonly Place[],
  space: Place,
  made: Readonly<Record<string, Place | null>>,
  ends: { reminders: number; guests: number; everyone: number; room: string; members: number },
): Fate[] => {
  const names = new Set(places.map(place => nameKey(place.name)));
  const named = (spaceId: string): string => places.find(place => place.id === spaceId)?.name ?? '';
  const leader = leaderOf(standing, choices);
  const sent = new Map<string, { to: Exclude<EndTo, null>; place: string }>();
  const fates: Fate[] = [];
  const add = (what: Fate['what'], id: string, fate: Fate['fate'], place: string | null, beside: string | null, step: EndStep | null, count = 1) =>
    fates.push({ id, what, fate, count, place, beside, step });

  for (const device of standing.devices) {
    const { id } = device;
    const choice = choices[id] ?? NEW_PLACE;
    if (choice === RELEASE) {
      add('device', id, 'release', null, null, { do: 'release', id });
      continue;
    }
    const lead = choice === STAY && leader ? sent.get(leader.id) : undefined;
    const into = placeIn(choice);
    const kept = made[id];
    const fresh = lead || into || kept ? null : numbered(nameOf(device), names);
    if (fresh) names.add(nameKey(fresh));
    const goes =
      lead ??
      (into
        ? { to: { spaceId: into }, place: named(into) }
        : kept
          ? { to: { spaceId: kept.id }, place: kept.name }
          : { to: { made: id }, place: fresh! });
    // In the room the place stood in: the device does not leave the room because its place gets a new name.
    const make = fresh ? { make: { kind: placeKindOf(device.type), name: fresh, ...(space.roomId ? { roomId: space.roomId } : {}) } } : {};

    sent.set(id, goes);
    add('device', id, lead ? 'stay' : fresh ? 'make' : 'move', goes.place, lead ? leader!.id : null, { do: 'device', id, to: goes.to, ...make });
  }

  for (const { id, deviceId } of standing.paired) {
    const carrier = sent.get(deviceId ?? '');
    // A camera taken off a device that is given up went with the claim already.
    if (choices[id] === UNCOUPLE) add('camera', id, 'uncouple', null, deviceId, carrier ? { do: 'uncouple', id } : null);
    else add('camera', id, 'stay', carrier?.place ?? null, deviceId, null);
  }
  for (const { id } of standing.loose) {
    const choice = choices[id] ?? '';
    const lead = choice === STAY && leader ? sent.get(leader.id) : undefined;
    const into = placeIn(choice);
    if (lead) add('camera', id, 'stay', lead.place, leader!.id, { do: 'camera', id, to: lead.to });
    else if (into) add('camera', id, 'move', named(into), null, { do: 'camera', id, to: { spaceId: into } });
    else add('camera', id, 'remove', null, null, { do: 'uncouple', id });
  }

  for (const { id } of standing.grows) {
    const choice = choices[id] ?? '';
    const into = placeIn(choice);
    const along = choice.startsWith('with:') ? choice.slice(5) : null;
    if (choice === END) add('grow', id, 'end', null, null, { do: 'end', id });
    else if (choice === NOWHERE) add('grow', id, 'nowhere', null, null, { do: 'grow', id, to: null });
    else if (along) add('grow', id, 'with', sent.get(along)?.place ?? null, along, { do: 'grow', id, to: sent.get(along)?.to ?? null });
    else if (into) add('grow', id, 'move', named(into), null, { do: 'grow', id, to: { spaceId: into } });
  }

  const dropped = new Set(unusedOf(made, fates).map(([, placeId]) => placeId));
  const roomStays =
    fates.some(({ fate }) => fate === 'make') ||
    [...places, ...Object.values(made)].some(place => place && place.id !== space.id && place.roomId === space.roomId && !dropped.has(place.id));
  if (ends.reminders > 0) add('ends', REMINDERS, 'reminders', null, null, null, ends.reminders);
  const roomEnds = space.roomId !== null && !roomStays;
  const unseen = roomEnds ? ends.guests : ends.everyone;
  if (unseen > 0) add('ends', GUESTS, 'unseen', space.name, null, null, unseen);
  if (roomEnds) add('ends', MEMBERS, ends.members > 0 ? 'roomEnds' : 'roomEmpty', ends.room, null, null, ends.members);

  return fates;
};

/** The places an earlier attempt made, by their device, that nothing is sent to any more. */
export const unusedOf = (made: Readonly<Record<string, Place | null>>, fates: readonly Fate[]): [string, string][] => {
  const used = new Set(fates.map(({ step }) => (step && 'to' in step && step.to && 'spaceId' in step.to ? step.to.spaceId : null)));

  return Object.entries(made).flatMap(([deviceId, place]) => (place && !used.has(place.id) ? [[deviceId, place.id] as [string, string]] : []));
};

/**
 * What became of things, gathered for a sentence each: what now stands in one
 * place together, each way of going, what ended with the place. A camera is
 * named only where it goes away - one that stays is part of where its device went.
 */
export const gathered = (fates: readonly Fate[]): { how: 'stands' | Fate['fate']; place: string | null; ids: string[]; count: number }[] => {
  const groups = new Map<string, ReturnType<typeof gathered>[number]>();

  for (const fate of fates) {
    const ends = fate.what === 'ends';
    if (!ends && (!fate.step || (fate.what === 'camera' && fate.place !== null))) continue;
    const how = fate.place === null || ends ? fate.fate : 'stands';
    const key = `${how}:${fate.place ?? ''}`;
    const group = groups.get(key);
    groups.set(key, { how, place: fate.place, ids: [...(group?.ids ?? []), fate.id], count: (group?.count ?? 0) + fate.count });
  }

  return [...groups.values()];
};
