import { nameKey, numbered } from '@fg2/shared-types/v1-schemas/place-names.js';
import type { Camera, Device, Space } from '@fg2/shared-types/v1';
import type { EndStep, EndTo } from '@/api/spaces';
import { placeKindOf } from '@/ui/naming';

/**
 * What ending a place has to settle: each device, each camera and each running
 * grow standing in it is sent somewhere of its own. A choice is the value of
 * its select, so the page holds one string per thing and nothing else.
 */

/** A device: a new place of its own, another place (`move:<id>`), or given up. */
export const NEW_PLACE = 'new';
export const RELEASE = 'release';
/** A camera a device answers for: it goes wherever that device goes, or is taken off it. */
export const STAY = 'stay';
export const UNCOUPLE = 'uncouple';
/** A grow: with a device to its new place (`with:<deviceId>`), into another place, to no place, or ended. Unanswered is `''`. */
export const NOWHERE = 'nowhere';
export const END = 'end';

export const moveTo = (spaceId: string): string => `move:${spaceId}`;
export const withDevice = (deviceId: string): string => `with:${deviceId}`;

const placeIn = (choice: string): string | null => (choice.startsWith('move:') ? choice.slice(5) : null);

export interface Standing {
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
    devices: here,
    paired: looking.filter(camera => camera.deviceId !== null && ids.has(camera.deviceId)),
    loose: looking.filter(camera => camera.deviceId === null || !ids.has(camera.deviceId)),
    grows,
  };
};

/**
 * What each thing is sent to before anybody chose: a device to a place of its
 * own, its camera with it, a camera on its own to the first other place. Where
 * the plants stand is not guessed - a grow is the one thing asked outright.
 */
export const firstChoices = (standing: Standing, elsewhere: readonly Space[]): Record<string, string> => ({
  ...Object.fromEntries(standing.devices.map(device => [device.id, NEW_PLACE])),
  ...Object.fromEntries(standing.paired.map(camera => [camera.id, STAY])),
  ...Object.fromEntries(standing.loose.map(camera => [camera.id, elsewhere[0] ? moveTo(elsewhere[0].id) : UNCOUPLE])),
  ...Object.fromEntries(standing.grows.map(grow => [grow.growId, ''])),
});

/** Whether everything standing here has somewhere to go that still holds: a grow needs an answer, and a device to go with one that gets a new place. */
export const settled = (standing: Standing, choices: Readonly<Record<string, string>>): boolean =>
  standing.grows.every(grow => {
    const choice = choices[grow.growId] ?? '';
    if (choice === '') return false;
    return !choice.startsWith('with:') || choices[choice.slice(5)] === NEW_PLACE;
  });

/**
 * The writes, in the order they are made: the places devices get of their own,
 * the devices, the cameras, the grows. A camera that stays with its device is
 * moved by the device's own move and needs none. `nameOf` is what the place
 * made for a device is called, numbered on where one of `taken` - or a place
 * made a step before - already carries that name.
 */
export const stepsOf = (
  standing: Standing,
  choices: Readonly<Record<string, string>>,
  nameOf: (device: Device) => string,
  taken: readonly string[],
  roomId: string | null,
): EndStep[] => {
  const names = new Set(taken.map(nameKey));
  const made = new Map<string, EndTo>();
  const steps: EndStep[] = [];

  for (const device of standing.devices) {
    const choice = choices[device.id] ?? NEW_PLACE;
    if (choice === RELEASE) {
      steps.push({ do: 'release', deviceId: device.id });
      continue;
    }
    const into = placeIn(choice);
    if (into) {
      steps.push({ do: 'device', deviceId: device.id, to: { spaceId: into } });
      continue;
    }
    const name = numbered(nameOf(device), names);
    names.add(nameKey(name));
    made.set(device.id, { made: device.id });
    // In the room the place stood in: the device does not leave the room because its place gets a new name.
    steps.push({ do: 'make', key: device.id, body: { kind: placeKindOf(device.type), name, ...(roomId ? { roomId } : {}) } });
    steps.push({ do: 'device', deviceId: device.id, to: { made: device.id } });
  }

  for (const camera of standing.paired) {
    if (choices[camera.id] === UNCOUPLE) steps.push({ do: 'uncouple', cameraId: camera.id });
  }
  for (const camera of standing.loose) {
    const into = placeIn(choices[camera.id] ?? '');
    steps.push(into ? { do: 'camera', cameraId: camera.id, spaceId: into } : { do: 'uncouple', cameraId: camera.id });
  }

  for (const grow of standing.grows) {
    const choice = choices[grow.growId] ?? '';
    if (choice === END) steps.push({ do: 'end', growId: grow.growId });
    else if (choice === NOWHERE) steps.push({ do: 'grow', growId: grow.growId, to: null });
    else if (choice.startsWith('with:')) steps.push({ do: 'grow', growId: grow.growId, to: made.get(choice.slice(5)) ?? null });
    else {
      const into = placeIn(choice);
      if (into) steps.push({ do: 'grow', growId: grow.growId, to: { spaceId: into } });
    }
  }

  // A camera taken off a device that is given up went with the claim already.
  const released = new Set(standing.devices.filter(device => choices[device.id] === RELEASE).map(device => device.id));
  return steps.filter(
    step => !(step.do === 'uncouple' && standing.paired.some(camera => camera.id === step.cameraId && released.has(camera.deviceId ?? ''))),
  );
};
