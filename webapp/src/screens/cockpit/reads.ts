import type { Device, SpaceOverview } from '@fg2/shared-types/v1';
import { useSpaceLive, useSpaceOverview } from '@/api/spaces';
import { useHumidifier } from '../control/germination/germination-choices';
import { humidifierHoldOf, type HumidifierHold } from './place';

/**
 * A place as its page draws it: the overview, with the values and targets of
 * the live read laid over it whenever that answered last. The overview is read
 * once a minute and costs a day of series for the verdict; the live read is one
 * `last()` every half minute, and it is the values that age.
 *
 * How old the page is, is said once, by the pill beside the place's name - the
 * age of its newest reading, or since when it has been offline - and not again
 * under the wordmark: "aktualisiert vor 16 s" beside "live · 16 s" was two
 * clocks for one fact.
 *
 * A refresh that failed is dated by the half that failed, and of two failed
 * halves by the older, because what is on the screen is as old as its older
 * half.
 */
export const usePlace = (spaceId: string) => {
  const overview = useSpaceOverview(spaceId);
  const live = useSpaceLive(spaceId, (overview.data?.deviceIds?.length ?? 0) > 0);

  const fresher = live.data && live.dataUpdatedAt > overview.dataUpdatedAt ? live.data : null;

  const current: SpaceOverview | undefined =
    overview.data && fresher ? { ...overview.data, values: fresher.values, setpoints: fresher.setpoints } : overview.data;
  const staleAt = Math.min(overview.isError ? overview.dataUpdatedAt : Infinity, live.isError ? live.dataUpdatedAt : Infinity);

  return { read: overview, current, failedAt: Number.isFinite(staleAt) ? staleAt : null };
};

/**
 * The humidity a humidifier socket holds at the place's device while it
 * germinates, from the device's socket table (`humidifierHoldOf`); null where
 * none does. The cockpit and a place's card on Start judge the humidity by it.
 */
export const useHumidifierHold = (device: Device | null): HumidifierHold | null => humidifierHoldOf(device, useHumidifier(device));
