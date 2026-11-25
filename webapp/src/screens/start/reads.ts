import type { DateTime } from 'luxon';
import type { Device, OpenAlert, SpaceOverview, SpaceTimeline } from '@fg2/shared-types/v1';
import { useOpenAlerts } from '@/api/alerts';
import { useDeviceLive, useLiveReads } from '@/api/devices';
import { itemsOf } from '@/api/pages';
import { failingSince } from '@/api/read';
import { useSpaceLive, useSpaceOverview } from '@/api/spaces';
import { useTimeline } from '@/api/timeline';
import { useHumidifier } from '@/screens/control/germination/germination-choices';
import { useHeldLight } from '@/screens/control/held-light';
import { useLightHolds } from '@/screens/devices/lights';
import { humidifierHoldOf, placeAlerts, type HumidifierHold } from '@/screens/start/place';
import type { Lamp } from '@/screens/start/readings';

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
 * The place's lamps as they last reported, and whether somebody holds one by
 * hand: the climate device's own light output, and every lamp module standing
 * in the same place - each is controlled on its own, so each is said. A
 * place's Start and its card among several say the same lamps. `live` is the
 * climate device's own read.
 */
export const useLamp = (device: Device | null, here: Device[], now: DateTime) => {
  const live = useDeviceLive(device?.id ?? null).data;
  const lamps = [...(device ? [device] : []), ...here.filter(one => one.type === 'light' && one.id !== device?.id)];
  const { levels } = useLiveReads(lamps.map(one => one.id));
  const reported = lamps.filter(one => levels.get(one.id));
  // The first lamp's hold is read with its light sockets; a lamp module's is the one this browser sent it.
  const first = useHeldLight(reported[0] ?? null, now);
  const holds = useLightHolds(
    reported.map(one => one.id),
    now,
  );
  const lit: Lamp[] = reported.map((one, index) => ({
    device: one,
    level: levels.get(one.id)!,
    live: one.id === device?.id ? (live ?? null) : null,
    held: index === 0 ? first : (holds.get(one.id) ?? null),
  }));

  return { live, lit };
};

/** A place's open alerts for its status (`placeAlerts`), each about the device the account's own list of alerts - Meldungen's - names. */
export const usePlaceAlerts = (listed: OpenAlert[], here: Device[], now: DateTime) => placeAlerts(listed, itemsOf(useOpenAlerts().data), here, now);

/** The same read Verlauf opens on, so the page behind a figure is already in hand. */
const LAST_DAY = { range: '24h' as const };

/**
 * The last day of the place, for the small curves under its figures. They are
 * the lead's, as the figures are: a day drawn from another device of the place
 * is no day of it, and a place waiting for its lead's first figures has none.
 */
export const useLastDay = (spaceId: string, lead: string | null, wanted: boolean): SpaceTimeline | null => {
  const timeline = useTimeline(wanted ? spaceId : null, LAST_DAY).data;
  if (!wanted || !timeline || (lead !== null && timeline.deviceId && timeline.deviceId !== lead)) return null;
  return timeline;
};
