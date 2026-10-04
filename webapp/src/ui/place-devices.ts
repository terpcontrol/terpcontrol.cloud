import type { Device } from '@fg2/shared-types/v1';
import { useDevices, useDevicesById } from '@/api/devices';
import { useSpaceOverview } from '@/api/spaces';
import { useVisiting } from './session-access';

/**
 * The devices standing in a place, for whoever is reading it.
 *
 * An account's own places are answered from its own device list. Support
 * reading a customer's place has none of the customer's devices in that list,
 * so a cockpit and a Steuerung drawn from it lost the lamp's tile, the outputs
 * under the readings, the alarms and the targets' light - the very things a
 * support case about a lamp or a compressor is about - and Steuerung invited
 * the administrator to add a device. There each device the place names is read
 * on its own, which an administrator may.
 */
export const usePlaceDevices = (spaceId: string | null, deviceIds?: readonly string[] | null, enabled = true) => {
  const visiting = useVisiting(spaceId);
  const own = useDevices(enabled && !visiting);
  const named = useSpaceOverview(spaceId ?? '', enabled && visiting && deviceIds === undefined);
  const ids = deviceIds ?? named.data?.deviceIds ?? [];
  const visited = useDevicesById(ids, enabled && visiting);

  if (!visiting) {
    return {
      items: own.data?.items.filter(device => (deviceIds ? deviceIds.includes(device.id) : device.spaceId === spaceId)) ?? [],
      isPending: own.isPending,
      failed: !own.isPending && !own.data,
      refetch: () => void own.refetch(),
    };
  }

  const read = visited.flatMap(one => (one.data ? [one.data] : [])) satisfies Device[];
  return {
    items: read,
    isPending: (deviceIds === undefined && named.isPending) || visited.some(one => one.isPending),
    failed: (deviceIds === undefined && !named.isPending && !named.data) || visited.some(one => one.isError && !one.data),
    refetch: () => {
      void named.refetch();
      for (const one of visited) void one.refetch();
    },
  };
};
