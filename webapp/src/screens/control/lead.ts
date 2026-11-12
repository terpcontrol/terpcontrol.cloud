import type { Device } from '@fg2/shared-types/v1';
import { useSpaceOverview } from '@/api/spaces';
import { climateDeviceOf } from '@/screens/start/place';
import { usePlaceDevices } from '@/ui/place-devices';

/**
 * The device Steuerung's top is about: the place's climate as the server names
 * it, which is the device Start's readings and targets are read from too. A
 * place is one climate; whatever else stands there holds its own settings on
 * its own page.
 */
export const leadOf = (devices: Device[], climates: readonly { deviceId: string | null }[] | undefined): Device | null =>
  devices.find(device => device.id === climates?.[0]?.deviceId) ??
  climateDeviceOf(
    devices,
    devices.map(device => device.id),
  );

/** The lead of a place, with the devices standing there; null until both are read. */
export const useLead = (spaceId: string | null) => {
  const devices = usePlaceDevices(spaceId);
  const overview = useSpaceOverview(spaceId ?? '');
  const known = !devices.isPending && overview.data !== undefined;

  return { devices, overview, lead: known ? leadOf(devices.items, overview.data?.climates) : null, known };
};

/** Whether a device is the one Steuerung's top is about: the place's climate, as the server names it. */
export const useLeads = (device: Device): boolean => useLead(device.spaceId).lead?.id === device.id;
