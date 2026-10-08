import type { Device } from '@fg2/shared-types/v1';
import { useDevices } from '@/api/devices';
import { enough, useMayWith } from '@/ui/session-access';

/** The devices this session may move that stand anywhere but in this place. */
export const useDevicesElsewhere = (spaceId: string, enabled = true): Device[] => {
  const devices = useDevices(enabled);
  const mayWith = useMayWith();
  return (devices.data?.items ?? []).filter(device => device.spaceId !== spaceId && enough(mayWith(device), 'manage'));
};
