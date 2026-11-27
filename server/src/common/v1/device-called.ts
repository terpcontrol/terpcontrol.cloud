import { Model } from 'mongoose';
import type { TimelineDevice } from '@fg2/shared-types/v1';
import { StoredDevice } from '@database/schemas/v1/devices.schema';

type Called = Pick<StoredDevice, 'id' | 'name' | 'type' | 'ownerId'> & { state?: Pick<StoredDevice['state'], 'released'> };

/** What `calledIn` reads of a device. */
export const CALLED_FIELDS = { id: 1, name: 1, type: 1, ownerId: 1, 'state.released': 1 } as const;

/**
 * What a device that stood in a place is called to the people of that place - in Verlauf, on Start's Zuletzt and in
 * the diary alike, also once it has left: its name where the place's owner holds it, and where nobody holds it the
 * name that owner let it go under. One somebody else holds now is called by its type: its name is theirs.
 */
export const calledIn = (device: Called, ownerId: string): TimelineDevice => {
  const released = device.ownerId === null ? device.state?.released : null;
  const name = device.ownerId === ownerId ? device.name : released?.ownerId === ownerId ? released.name : null;
  return { deviceId: device.id, name: name ?? null, type: device.type };
};

/** `calledIn` of the devices some lines name, each once. */
export const devicesCalledIn = async (
  devices: Model<StoredDevice>,
  deviceIds: readonly (string | null)[],
  ownerId: string,
): Promise<TimelineDevice[]> => {
  const ids = [...new Set(deviceIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return [];

  const rows = await devices.find({ id: { $in: ids } }, CALLED_FIELDS).lean<Called[]>();
  return rows.map(row => calledIn(row, ownerId));
};
