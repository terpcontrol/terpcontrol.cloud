import type { Device, Space } from '@fg2/shared-types/v1';

/** The devices of one place, with the room the place stands in where it stands in one. */
export interface PlaceGroup {
  spaceId: string | null;
  place: string | null;
  room: string | null;
  devices: Device[];
}

/**
 * The account's devices gathered by where they stand: the places of one room
 * side by side, in the order the places were set up, and the devices of each
 * in the order they came in - which is the order of who is talking first. A
 * device whose place this reader cannot see is gathered with the others like
 * it at the end, unnamed.
 */
export const groupedByPlace = (devices: readonly Device[], spaces: readonly Space[]): PlaceGroup[] => {
  const index = new Map(spaces.map((space, at) => [space.id, at]));
  const byId = new Map(spaces.map(space => [space.id, space]));
  const groups = new Map<string, PlaceGroup>();

  for (const device of devices) {
    const space = device.spaceId ? byId.get(device.spaceId) : undefined;
    const key = space?.id ?? '';
    const group = groups.get(key) ?? {
      spaceId: space?.id ?? null,
      place: space?.name ?? null,
      room: (space?.roomId && byId.get(space.roomId)?.name) || null,
      devices: [],
    };
    group.devices.push(device);
    groups.set(key, group);
  }

  // A place is ranked by its room where it stands in one, so a room's places stay together.
  const rank = (group: PlaceGroup): [number, number] => {
    if (group.spaceId === null) return [Infinity, Infinity];
    const own = index.get(group.spaceId) ?? Infinity;
    const roomId = byId.get(group.spaceId)?.roomId;
    return [roomId ? (index.get(roomId) ?? own) : own, own];
  };
  return [...groups.values()].sort((one, other) => {
    const [a, b] = [rank(one), rank(other)];
    return a[0] - b[0] || a[1] - b[1];
  });
};
