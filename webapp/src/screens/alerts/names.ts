import { useQueries } from '@tanstack/react-query';
import type { CameraPage, Device, DevicePage, SpacePage } from '@fg2/shared-types/v1';
import { api } from '@/api/client';

/**
 * Where an alert happened and what it happened to, read once for the whole
 * inbox.
 *
 * A name is not a reading: it changes when somebody renames something, and
 * never on its own. The inbox therefore reads these three lists at a walk
 * rather than on the half minute the screens that watch hardware use - what has
 * to be current here is the list of alerts, and three names re-read every beat
 * were most of the traffic this screen made. The keys are the ones those
 * screens use, so whichever is opened first fills the cache for the other.
 *
 * The device is kept whole rather than reduced to its name: an offline alert
 * has to say how long the device has been quiet and its own start is only when
 * the cloud noticed, a card names the rule that raised it in the words that
 * rule's origin is read in, and a tent with two devices in it has to say which
 * of them the alert came from.
 *
 * Nothing here holds the cards up and nothing here is guessed. A list still on
 * its way and a list that was refused both leave a name unknown, the card falls
 * back to the id, and a read that actually failed is said out loud - names are
 * how a person knows which tent this is about, and quietly dropping them turns
 * seven cards into seven readings of nothing in particular.
 */
const NAMES_STALE_MS = 300_000;

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

export interface InboxNames {
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
      {
        queryKey: ['spaces'],
        queryFn: ({ signal }: { signal: AbortSignal }) => api.get<SpacePage>('/spaces', undefined, signal),
        staleTime: NAMES_STALE_MS,
      },
      {
        queryKey: ['devices'],
        queryFn: ({ signal }: { signal: AbortSignal }) => api.get<DevicePage>('/devices', undefined, signal),
        staleTime: NAMES_STALE_MS,
      },
      {
        queryKey: ['cameras', null],
        queryFn: ({ signal }: { signal: AbortSignal }) => api.get<CameraPage>('/cameras', undefined, signal),
        staleTime: NAMES_STALE_MS,
      },
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
