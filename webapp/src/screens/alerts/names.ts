import { useQueries } from '@tanstack/react-query';
import type { Device } from '@fg2/shared-types/v1';
import { camerasQuery } from '@/api/cameras';
import { devicesQuery } from '@/api/devices';
import { FOLLOWED } from '@/api/read';
import { spacesQuery } from '@/api/spaces';

/**
 * Where an alert happened and what it happened to, read once for the whole
 * inbox. A name changes when somebody renames something and never on its own,
 * so the three lists are followed rather than read on the live beat - what has
 * to be current here is the list of alerts. The device is kept whole: a card
 * reads its maintenance window, and a place of two devices says which.
 *
 * Nothing here holds the cards up and nothing is guessed: a list still on its
 * way and one that was refused both leave a name unknown, the card falls back
 * to the id, and a read that failed is said out loud.
 */

export interface AlertNames {
  spaces: Map<string, string>;
  devices: Map<string, Device>;
  cameras: Map<string, string>;
  /** How many devices stand in a space, so a card only names the device where the place does not say it. */
  devicesInSpace: Map<string, number>;
  /** A read still on its way: the name may yet arrive, so the id is not drawn as the answer. */
  pending: boolean;
  /** A read that was refused: no name is coming until it is tried again. */
  failed: boolean;
}

interface InboxNames {
  names: AlertNames;
  /** Whether anything at all can raise an alert here: alarm rules live on a device, and stale pictures on a cam. */
  watching: boolean;
}

const countBySpace = (devices: Device[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const device of devices) if (device.spaceId) counts.set(device.spaceId, (counts.get(device.spaceId) ?? 0) + 1);

  return counts;
};

export const useInboxNames = (): InboxNames =>
  useQueries({
    queries: [
      { ...spacesQuery, ...FOLLOWED },
      { ...devicesQuery, ...FOLLOWED },
      { ...camerasQuery(), ...FOLLOWED },
    ],
    combine: ([spaces, devices, cameras]) => ({
      names: {
        spaces: new Map((spaces.data?.items ?? []).map(space => [space.id, space.name])),
        devices: new Map((devices.data?.items ?? []).map(device => [device.id, device])),
        cameras: new Map((cameras.data?.items ?? []).map(camera => [camera.id, camera.name])),
        devicesInSpace: countBySpace(devices.data?.items ?? []),
        pending: spaces.isPending || devices.isPending || cameras.isPending,
        failed: spaces.isError || devices.isError || cameras.isError,
      },
      watching: (devices.data?.items.length ?? 0) > 0 || (cameras.data?.items.length ?? 0) > 0,
    }),
  });
