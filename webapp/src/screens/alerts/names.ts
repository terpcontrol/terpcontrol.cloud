import { useQueries } from '@tanstack/react-query';
import type { CameraPage, DevicePage, SpacePage } from '@fg2/shared-types/v1';
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
 * The device carries its last sample with it, because an offline alert has to
 * say how long the device has been quiet and its own start is only when the
 * cloud noticed.
 */
const NAMES_STALE_MS = 300_000;

export interface DeviceName {
  name: string | null;
  type: string;
  lastSeenAt: string | null;
}

export interface AlertNames {
  spaces: Map<string, string>;
  devices: Map<string, DeviceName>;
  cameras: Map<string, string>;
}

export interface InboxNames {
  names: AlertNames;
  isPending: boolean;
  /** Whether anything at all can raise an alert here: alarm rules live on a device, and stale pictures on a cam. */
  watching: boolean;
}

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
        devices: new Map(
          (devices.data?.items ?? []).map(device => [device.id, { name: device.name, type: device.type, lastSeenAt: device.state.lastSeenAt }]),
        ),
        cameras: new Map((cameras.data?.items ?? []).map(camera => [camera.id, camera.name])),
      },
      isPending: spaces.isPending || devices.isPending || cameras.isPending,
      watching: (devices.data?.items.length ?? 0) > 0 || (cameras.data?.items.length ?? 0) > 0,
    }),
  });
