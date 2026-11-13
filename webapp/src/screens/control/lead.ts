import type { Device } from '@fg2/shared-types/v1';
import { OWN_CLIMATE_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useSpaceOverview } from '@/api/spaces';
import { climateDeviceOf } from '@/screens/start/place';
import { usePlaceDevices } from '@/ui/place-devices';

/**
 * The device Steuerung's top is about: the place's climate as the server names
 * it, which Start's readings and targets are read from too. Where no device has
 * reported yet none states targets: a controller or a fridge module leads then.
 */
export const leadOf = (devices: Device[], climates: readonly { deviceId: string | null }[] | undefined): Device | null =>
  devices.find(device => device.id === climates?.[0]?.deviceId) ??
  climateDeviceOf(
    [...devices].sort((one, other) => Number(OWN_CLIMATE_TYPES.includes(other.type)) - Number(OWN_CLIMATE_TYPES.includes(one.type))),
    devices.map(device => device.id),
  );

/** The devices of a place in the order Steuerung lists them: the place's climate first, the others as they stand. */
export const inOrder = (devices: Device[], lead: Device | null): Device[] =>
  [...devices].sort((one, other) => Number(other.id === lead?.id) - Number(one.id === lead?.id));

/** The lead of a place, with the devices standing there; null until both are read. */
export const useLead = (spaceId: string | null) => {
  const devices = usePlaceDevices(spaceId);
  const overview = useSpaceOverview(spaceId ?? '');
  const known = !devices.isPending && overview.data !== undefined;

  return { devices, overview, lead: known ? leadOf(devices.items, overview.data?.climates) : null, known };
};

/** Whether a device is the one Steuerung's top is about: the place's climate, as the server names it. */
export const useLeads = (device: Device): boolean => useLead(device.spaceId).lead?.id === device.id;
