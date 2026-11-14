import type { CardValue, Device, DeviceLive, Metric, MetricValue } from '@fg2/shared-types/v1';
import { OWN_CLIMATE_TYPES } from '@fg2/shared-types/v1-schemas/socket-report.js';
import { useSpaceOverview } from '@/api/spaces';
import { climateDeviceOf } from '@/screens/start/place';
import { usePlaceDevices } from '@/ui/place-devices';

/**
 * The device a place is judged and steered by, which Steuerung's top is about and Start's readings and targets are
 * read from: the one that holds its climate - a controller or a fridge module, heard or not, the first the server
 * names as a climate where two stand there. A socket reporting beside a controller never heard is no climate of
 * the place: the place waits for the controller (Chris). Without either, the first climate the server names; where
 * nothing has reported, whatever states targets.
 */
export const leadOf = (devices: Device[], climates: readonly { deviceId: string | null }[] | undefined): Device | null => {
  const own = devices.filter(device => OWN_CLIMATE_TYPES.includes(device.type));
  return (
    (climates ?? []).flatMap(climate => own.filter(device => device.id === climate.deviceId))[0] ??
    own[0] ??
    devices.find(device => device.id === climates?.[0]?.deviceId) ??
    climateDeviceOf(
      devices,
      devices.map(device => device.id),
    )
  );
};

/**
 * The figures a place is judged and drawn by: its lead's. Where the lead holds a climate they are that climate's; a
 * lead never heard has none, whatever else of the place reports - a socket's figures stand under its own name, never
 * as the place's -; one heard that holds no climate (regulation off) has its own from its live read. The place's
 * merged figures stand in for them only while that read is on its way, and where no other device holds a climate
 * here to be taken for the place's (`placeWide`, which its setpoints and verdict may then speak for too). Without a
 * lead - a read from outside, which names no device - the first climate.
 */
export const leadValuesOf = <C extends { deviceId: string | null; values: CardValue[] }>(
  lead: Device | null,
  climates: readonly C[],
  merged: CardValue[],
  live: DeviceLive | undefined,
): { climate: C | null; values: CardValue[]; placeWide: boolean } => {
  const climate = lead ? (climates.find(one => one.deviceId === lead.id) ?? null) : (climates[0] ?? null);
  if (climate) return { climate, values: climate.values, placeWide: false };
  if (!lead) return { climate, values: merged, placeWide: true };
  const placeWide = climates.length === 0;
  if (lead.state.lastSeenAt === null) return { climate, values: [], placeWide };
  const own = live ? (Object.entries(live.metrics) as [Metric, MetricValue][]).map(([metric, value]) => ({ metric, ...value })) : [];
  return { climate, values: own.length > 0 ? own : live === undefined || placeWide ? merged : [], placeWide };
};

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
