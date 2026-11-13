import { nameKey, numbered } from '@fg2/shared-types/v1-schemas/place-names.js';
import type { Camera, Device, Space } from '@fg2/shared-types/v1';
import type { EndStep, EndTo } from '@/api/spaces';
import { OWN_CLIMATE } from '@/screens/claim/steps';
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

export const moveTo = (spaceId: string): string => `move:${spaceId}`;
export const withDevice = (deviceId: string): string => `with:${deviceId}`;

const placeIn = (choice: string): string | null => (choice.startsWith('move:') ? choice.slice(5) : null);

type Choices = Readonly<Record<string, string>>;
type Place = Pick<Space, 'id' | 'name'>;

export interface Standing {
  /** Those that hold a climate of their own first: the first that is kept leads. */
  devices: readonly Device[];
  /** Cameras paired at one of those devices: they follow it unless taken off it. */
  paired: readonly Camera[];
  /** Cameras looking into the place on their own. */
  loose: readonly Camera[];
  grows: readonly { growId: string; name: string }[];
}

/** What stands in a place, from the lists the account already has. */
export const standingIn = (
  spaceId: string,
  devices: readonly Device[],
  cameras: readonly Camera[],
  grows: readonly { growId: string; name: string }[],
): Standing => {
  const here = devices.filter(device => device.spaceId === spaceId);
  const ids = new Set(here.map(device => device.id));
  const looking = cameras.filter(camera => camera.spaceId === spaceId && camera.removedAt === null);

  return {
    devices: [...here.filter(device => OWN_CLIMATE.includes(device.type)), ...here.filter(device => !OWN_CLIMATE.includes(device.type))],
    paired: looking.filter(camera => camera.deviceId !== null && ids.has(camera.deviceId)),
    loose: looking.filter(camera => camera.deviceId === null || !ids.has(camera.deviceId)),
    grows,
  };
};

/** The device the rest stays with: the first that is not given up, so giving the controller up hands the lead on. */
export const leaderOf = (standing: Standing, choices: Choices): Device | null =>
  standing.devices.find(device => choices[device.id] !== RELEASE) ?? null;

/**
 * Where everything goes: what was chosen, and before anybody chose, the
 * leading device into another place of its kind - a new one where there is
 * none - and the rest with it. Where the plants stand is not guessed - a grow
 * is the one thing asked outright.
 */
export const choicesOf = (
  standing: Standing,
  elsewhere: readonly Space[],
  chosen: Choices,
  /** The places that hold a climate of their own already: a second one does not fit there - one place, one climate. */
  held: ReadonlySet<string> = new Set(),
): Record<string, string> => {
  const leader = leaderOf(standing, chosen);
  const second = (place: Space) => leader !== null && OWN_CLIMATE.includes(leader.type) && held.has(place.id);
  const fits = leader ? elsewhere.find(place => place.kind === placeKindOf(leader.type) && !second(place)) : undefined;
  const alone = elsewhere[0] ? moveTo(elsewhere[0].id) : UNCOUPLE;
  const first: Record<string, string> = {
    ...Object.fromEntries(standing.devices.map(device => [device.id, device !== leader ? STAY : fits ? moveTo(fits.id) : NEW_PLACE])),
    ...Object.fromEntries(standing.paired.map(camera => [camera.id, STAY])),
    ...Object.fromEntries(standing.loose.map(camera => [camera.id, leader ? STAY : alone])),
    ...Object.fromEntries(standing.grows.map(grow => [grow.growId, ''])),
  };

  // Staying holds only while there is somebody to stay with: the device that leads now is sent as a leader is.
  return Object.fromEntries(Object.entries({ ...first, ...chosen }).map(([id, choice]) => [id, choice === STAY ? first[id] : choice]));
};

/** Whether everything standing here has somewhere to go that still holds: a grow needs an answer, and a device to go with one that gets a new place. */
export const settled = (standing: Standing, choices: Choices): boolean =>
  standing.grows.every(grow => {
    const choice = choices[grow.growId] ?? '';
    if (choice === '') return false;
    return !choice.startsWith('with:') || choices[choice.slice(5)] === NEW_PLACE;
  });

/** What becomes of one thing standing here. */
export interface Fate {
  id: string;
  what: 'device' | 'camera' | 'grow';
  /** How the catalogue words it, under `place.remove.will`. */
  fate: 'make' | 'move' | 'stay' | 'release' | 'uncouple' | 'remove' | 'with' | 'nowhere' | 'end';
  /** The name of the place it then stands in; null where it stands in none. */
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
 * moved into instead of making a second.
 */
export const fatesOf = (
  standing: Standing,
  choices: Choices,
  nameOf: (device: Device) => string,
  places: readonly Place[],
  roomId: string | null,
  made: Readonly<Record<string, Place | null>>,
): Fate[] => {
  const names = new Set(places.map(place => nameKey(place.name)));
  const named = (spaceId: string): string => places.find(place => place.id === spaceId)?.name ?? '';
  const leader = leaderOf(standing, choices);
  const sent = new Map<string, { to: Exclude<EndTo, null>; place: string }>();
  const fates: Fate[] = [];
  const add = (what: Fate['what'], id: string, fate: Fate['fate'], place: string | null, beside: string | null, step: EndStep | null) =>
    fates.push({ id, what, fate, place, beside, step });

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
    const make = fresh ? { make: { kind: placeKindOf(device.type), name: fresh, ...(roomId ? { roomId } : {}) } } : {};

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

  for (const { growId: id } of standing.grows) {
    const choice = choices[id] ?? '';
    const into = placeIn(choice);
    const along = choice.startsWith('with:') ? choice.slice(5) : null;
    if (choice === END) add('grow', id, 'end', null, null, { do: 'end', id });
    else if (choice === NOWHERE) add('grow', id, 'nowhere', null, null, { do: 'grow', id, to: null });
    else if (along) add('grow', id, 'with', sent.get(along)?.place ?? null, along, { do: 'grow', id, to: sent.get(along)?.to ?? null });
    else if (into) add('grow', id, 'move', named(into), null, { do: 'grow', id, to: { spaceId: into } });
  }

  return fates;
};

/** The places an earlier attempt made, by their device, that nothing is sent to any more. */
export const unusedOf = (made: Readonly<Record<string, Place | null>>, fates: readonly Fate[]): [string, string][] => {
  const used = new Set(fates.map(({ step }) => (step && 'to' in step && step.to && 'spaceId' in step.to ? step.to.spaceId : null)));

  return Object.entries(made).flatMap(([deviceId, place]) => (place && !used.has(place.id) ? [[deviceId, place.id] as [string, string]] : []));
};

/**
 * What became of things, gathered for a sentence each: what now stands in one
 * place together, then each way of going. A camera is named only where it
 * goes away - one that stays is part of where its device went.
 */
export const gathered = (fates: readonly Fate[]): { how: 'stands' | Fate['fate']; place: string | null; ids: string[] }[] => {
  const groups = new Map<string, { how: 'stands' | Fate['fate']; place: string | null; ids: string[] }>();

  for (const fate of fates) {
    if (!fate.step || (fate.what === 'camera' && fate.place !== null)) continue;
    const how = fate.place === null ? fate.fate : 'stands';
    const key = `${how}:${fate.place ?? ''}`;
    groups.set(key, { how, place: fate.place, ids: [...(groups.get(key)?.ids ?? []), fate.id] });
  }

  return [...groups.values()];
};
