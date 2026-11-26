import { useEffect } from 'react';
import type { GrowDiaryPage } from '@fg2/shared-types/v1';
import type { useGrowDiary } from '@/api/grows';

/** The day of the grow an address names in `?day=`: the day a camera's page shows, and the one the diary opens on. */
export const dayNamed = (params: URLSearchParams): number | null => {
  const day = Number(params.get('day'));
  return Number.isInteger(day) && day > 0 ? day : null;
};

/** The oldest day the pages read so far reach back to; null before the first page. */
export const reachesBackTo = (pages: readonly GrowDiaryPage[] | undefined): number | null => {
  const days = (pages ?? []).flatMap(page => page.items).flatMap(week => [week.dayFrom, week.dayTo]);
  return days.length > 0 ? Math.min(...days) : null;
};

/**
 * A diary is read a few weeks at a time. Asked for a day the pages read so far
 * do not reach - the camera's slider was left there, a link named it - the
 * weeks before are read until they do; true while they are still to come.
 */
export function useReadBackTo(diary: ReturnType<typeof useGrowDiary> | null, day: number | null): boolean {
  const reaches = reachesBackTo(diary?.data?.pages);
  const further = day !== null && reaches !== null && day < reaches && diary?.hasNextPage === true;
  const fetching = diary?.isFetchingNextPage === true;
  const fetchEarlier = diary?.fetchNextPage;
  useEffect(() => {
    if (further && !fetching) void fetchEarlier?.();
  }, [further, fetching, fetchEarlier]);

  return further;
}
