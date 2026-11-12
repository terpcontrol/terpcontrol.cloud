import type { DateTime } from 'luxon';
import type { Device, SpaceOverview } from '@fg2/shared-types/v1';
import { useDeviceLive } from '@/api/devices';
import { failingSince } from '@/api/read';
import { useSpaceLive, useSpaceOverview } from '@/api/spaces';
import { useHumidifier } from '@/screens/control/germination/germination-choices';
import { useHeldLight } from '@/screens/control/held-light';
import { humidifierHoldOf, type HumidifierHold } from '@/screens/start/place';

/**
 * A place as its page draws it: the overview, with the values and targets of
 * the live read laid over it whenever that answered last. The overview is read
 * once a minute and costs a day of series for the verdict; the live read is one
 * `last()` every half minute, and it is the values that age.
 *
 * A refresh that failed is dated by the half that failed, and of two failed
 * halves by the older: what is on the screen is as old as its older half.
 */
export const usePlace = (spaceId: string) => {
  const overview = useSpaceOverview(spaceId);
  const live = useSpaceLive(spaceId, (overview.data?.deviceIds?.length ?? 0) > 0);

  const fresher = live.data && live.dataUpdatedAt > overview.dataUpdatedAt ? live.data : null;

  const current: SpaceOverview | undefined =
    overview.data && fresher
      ? {
          ...overview.data,
          values: fresher.values,
          setpoints: fresher.setpoints,
          climates: overview.data.climates.map(climate => {
            const device = fresher.devices.find(one => one.deviceId === climate.deviceId);
            return device ? { ...climate, values: device.values, setpoints: device.setpoints } : climate;
          }),
        }
      : overview.data;
  const staleAt = Math.min(failingSince(overview) ?? Infinity, failingSince(live) ?? Infinity);

  return { read: overview, current, failedAt: Number.isFinite(staleAt) ? staleAt : null };
};

/**
 * The humidity a humidifier socket holds at the place's device while it
 * germinates, from the device's socket table (`humidifierHoldOf`); null where
 * none does. A place's Start and its card among several judge the humidity by it.
 */
export const useHumidifierHold = (device: Device | null): HumidifierHold | null => humidifierHoldOf(device, useHumidifier(device));

/**
 * The place's lamp as it last reported, and whether somebody holds it by hand:
 * the climate device's own light output, or else a light of its own standing
 * in the same place. A place's Start and its card among several say the same
 * lamp.
 */
export const useLamp = (device: Device | null, here: Device[], now: DateTime) => {
  const live = useDeviceLive(device?.id ?? null).data;
  const lamp = here.find(one => one.type === 'light' && one.id !== device?.id) ?? null;
  const lampLive = useDeviceLive(lamp?.id ?? null).data;
  const lit =
    device && live?.outputs.light?.value != null
      ? { device, live }
      : lamp && lampLive?.outputs.light?.value != null
        ? { device: lamp, live: lampLive }
        : null;

  return { live, lit, held: useHeldLight(lit?.device ?? null, now) };
};
