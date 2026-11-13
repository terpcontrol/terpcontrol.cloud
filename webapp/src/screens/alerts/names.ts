import { useQueries } from '@tanstack/react-query';
import type { Device } from '@fg2/shared-types/v1';
import { camerasQuery } from '@/api/cameras';
import { devicesQuery } from '@/api/devices';
import { FOLLOWED } from '@/api/read';

/**
 * What an alert happened to, read once for the whole inbox; where it happened
 * the alert says itself (`spaceName`). A name changes when somebody renames
 * something and never on its own, so the two lists are followed rather than
 * read on the live beat. The device is kept whole: a card reads its
 * maintenance window, and a place of two devices says which.
 *
 * Nothing here holds the cards up and nothing is guessed: without a name a
 * card says the kind of thing, never an id, and a read that failed is said
 * out loud.
 */

export interface AlertNames {
  devices: Map<string, Device>;
  cameras: Map<string, string>;
  /** A read that was refused: no name is coming until it is tried again. */
  failed: boolean;
}

interface InboxNames {
  names: AlertNames;
  /** Whether anything at all can raise an alert here: alarm rules live on a device, and stale pictures on a cam. */
  watching: boolean;
}

export const useInboxNames = (): InboxNames =>
  useQueries({
    queries: [
      { ...devicesQuery, ...FOLLOWED },
      { ...camerasQuery(), ...FOLLOWED },
    ],
    combine: ([devices, cameras]) => ({
      names: {
        devices: new Map((devices.data?.items ?? []).map(device => [device.id, device])),
        cameras: new Map((cameras.data?.items ?? []).map(camera => [camera.id, camera.name])),
        failed: devices.isError || cameras.isError,
      },
      watching: (devices.data?.items.length ?? 0) > 0 || (cameras.data?.items.length ?? 0) > 0,
    }),
  });
