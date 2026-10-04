import type { Device, FirmwareChannel } from '@fg2/shared-types/v1';
import { useUpdateDevice } from '@/api/devices';

/**
 * Changing the channel and nothing else. `firmware` is written whole, so the
 * build the device is pinned to goes back as it was: choosing a channel is
 * not telling the device to install anything, the rollout does that.
 */
export const useChannel = (device: Device) => {
  const update = useUpdateDevice(device.id);

  return {
    set: (channel: FirmwareChannel) => update.mutate({ firmware: { channel, targetId: device.firmware.targetId } }),
    asked: update.isPending ? (update.variables?.firmware?.channel ?? null) : null,
    isPending: update.isPending,
    error: update.error,
  };
};
