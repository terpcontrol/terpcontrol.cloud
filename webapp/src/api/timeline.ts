import { keepPreviousData } from '@tanstack/react-query';
import { useRead } from './read';
import type { Metric, SpaceTimeline, TimelineRange } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * Verlauf is one read per window - frames, panels, night, alarms, strips and
 * the diary's lines are all views of the same window, so asking for them
 * separately would draw windows that disagree at their edges.
 *
 * A step, a zoom or a chip is a change of window and not of screen, so the
 * answer in hand stays drawn until the next one arrives.
 */

/** A window that ends now is asked again on this beat; one that stands still is not. */
const TIMELINE_REFRESH_MS = 60_000;

/** Every panel a place can have: what is measured, and what is worked out from it. */
export const TIMELINE_METRICS: Metric[] = ['temperature', 'humidity', 'vpd', 'co2', 'leafTemperature', 'lux', 'ppfd'];

/** `phase` and `grow` are stretches of one grow, so the server refuses them without one. */
export const rangeNeedsGrow = (range: TimelineRange): boolean => range === 'phase' || range === 'grow';

export interface TimelineAsk {
  range: TimelineRange;
  growId?: string | null;
  /** Both ends of a window named outright, as instants; the range then only says which grow it is of. */
  from?: string;
  to?: string;
  /** The step somebody chose; left out, the width of the window decides it. */
  stepSeconds?: number | null;
  /** One climate of several, where a place holds more than one. */
  deviceId?: string | null;
  /** A link's token, where the place is read through one: the reader's whole proof, and the window it was given. */
  share?: string | null;
  /** False for a window that stands still: nothing new can arrive in it. */
  follows?: boolean;
}

/**
 * The key an answer is kept under: what was asked, with nothing said about what was left out - so Start, which asks
 * for the last day and no more, and Verlauf as it opens share one answer.
 */
export const timelineKey = (spaceId: string | null, ask: TimelineAsk | null) => {
  const asked = ask ?? { range: '24h' as const };

  return [
    'space',
    spaceId,
    'timeline',
    {
      range: asked.range,
      growId: asked.growId ?? undefined,
      from: asked.from,
      to: asked.to,
      stepSeconds: asked.stepSeconds || undefined,
      deviceId: asked.deviceId ?? undefined,
      share: asked.share ?? undefined,
    },
  ] as const;
};

export const useTimeline = (spaceId: string | null, ask: TimelineAsk | null) => {
  const queryKey = timelineKey(spaceId, ask);
  const [, , , asked] = queryKey;

  return useRead({
    queryKey,
    queryFn: ({ signal }) => api.get<SpaceTimeline>(`/spaces/${spaceId}/timeline`, { ...asked, metrics: TIMELINE_METRICS }, signal),
    enabled: spaceId !== null && spaceId !== '' && ask !== null && (!rangeNeedsGrow(asked.range) || !!asked.growId || !!asked.from),
    refetchInterval: (ask?.follows ?? true) ? TIMELINE_REFRESH_MS : false,
    placeholderData: keepPreviousData,
  });
};
