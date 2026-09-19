import { useQuery } from '@tanstack/react-query';
import type { SpaceTimeline, TimelineRange } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The Timeline tab is one read per range chip - frames, panels, night, alarms,
 * lanes and rail are all views of the same window, so asking for them
 * separately would draw six windows that disagree at their edges.
 *
 * Only the two rolling ranges are refreshed: a phase and a grow end where they
 * end, and re-reading them would redraw the same picture. A refresh that fails
 * leaves the last answer on the screen with the line that says how old it is.
 */
export const TIMELINE_REFRESH_MS = 60_000;

/** `phase` and `grow` are stretches of one grow, so the server refuses them without one. */
export const rangeNeedsGrow = (range: TimelineRange): boolean => range === 'phase' || range === 'grow';

export const useTimeline = (spaceId: string, range: TimelineRange, growId: string | null) =>
  useQuery({
    queryKey: ['space', spaceId, 'timeline', range, growId],
    queryFn: ({ signal }) => api.get<SpaceTimeline>(`/spaces/${spaceId}/timeline`, { range, growId }, signal),
    enabled: spaceId !== '' && (!rangeNeedsGrow(range) || growId !== null),
    refetchInterval: rangeNeedsGrow(range) ? false : TIMELINE_REFRESH_MS,
  });
