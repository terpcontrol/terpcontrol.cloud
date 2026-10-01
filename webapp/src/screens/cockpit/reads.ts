import { keepPreviousData } from '@tanstack/react-query';
import type { DeviceLive, DeviceSeries, Metric, SpaceOverview } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { serverNow } from '@/api/clock';
import { DEVICES_REFRESH_MS } from '@/api/devices';
import { useRead } from '@/api/read';
import { useSpaceLive, useSpaceOverview } from '@/api/spaces';

/**
 * One device's newest values, outputs and the half of the cycle it says it is
 * in. The key is the one the device rows read the same answer under, so a
 * cockpit and the Devices tab beside it cost one request between them.
 */
export const useDeviceLive = (deviceId: string | null) =>
  useRead({
    queryKey: ['devices', deviceId, 'live'],
    queryFn: ({ signal }) => api.get<DeviceLive>(`/devices/${deviceId}/live`, undefined, signal),
    enabled: deviceId !== null,
    refetchInterval: DEVICES_REFRESH_MS,
  });

/** Ten minutes a point: a day of a tile's curve is under a hundred and fifty of them, which is all a stamp-sized line can show. */
const DAY_STEP_SECONDS = 600;

/**
 * The last 24 hours of one metric read from the device itself, for a reading
 * the place's Timeline does not draw a panel for - the leaf temperature. The
 * light output rides along, because the night is read off the lamp the way the
 * Timeline reads it.
 */
export const useDaySeries = (deviceId: string | null, metric: Metric, enabled: boolean) =>
  useRead({
    queryKey: ['devices', deviceId, 'day-series', metric],
    queryFn: ({ signal }) => {
      const endsAt = serverNow().toUTC().startOf('minute');
      const query = new URLSearchParams({
        metrics: metric,
        outputs: 'light',
        startsAt: endsAt.minus({ hours: 24 }).toISO()!,
        endsAt: endsAt.toISO()!,
        stepSeconds: String(DAY_STEP_SECONDS),
      });
      return api.get<DeviceSeries>(`/devices/${deviceId}/series?${query.toString()}`, undefined, signal);
    },
    enabled: enabled && deviceId !== null,
    refetchInterval: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

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
