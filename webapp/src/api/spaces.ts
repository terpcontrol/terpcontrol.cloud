import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PresetPrompt, Space, SpaceLive, SpaceOverview, SpacePage } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The tent page reads its overview once a minute and its live values every
 * half minute: the overview costs a day of series for the verdict, the live
 * read costs one `last()`, and it is the values that age. A refresh that fails
 * leaves the last answer in place with its ages, which is what the ages are for.
 */
export const OVERVIEW_REFRESH_MS = 60_000;
export const LIVE_REFRESH_MS = 30_000;

/**
 * Every place this account can see. `enabled` is here for the readers that only
 * want one space's standing: a screen that stands above every place asks
 * nothing rather than fetching the whole list to answer a question it has not
 * got a place for.
 */
export const useSpaces = (enabled = true) =>
  useQuery({
    queryKey: ['spaces'],
    queryFn: ({ signal }) => api.get<SpacePage>('/spaces', undefined, signal),
    enabled,
  });

export const useSpaceOverview = (spaceId: string) =>
  useQuery({
    queryKey: ['space', spaceId, 'overview'],
    queryFn: ({ signal }) => api.get<SpaceOverview>(`/spaces/${spaceId}/overview`, undefined, signal),
    refetchInterval: OVERVIEW_REFRESH_MS,
  });

export const useSpaceLive = (spaceId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['space', spaceId, 'live'],
    queryFn: ({ signal }) => api.get<SpaceLive>(`/spaces/${spaceId}/live`, undefined, signal),
    refetchInterval: LIVE_REFRESH_MS,
    enabled,
  });

/**
 * Whether this place asks what should happen to the grow every time a preset is
 * applied to it.
 *
 * A tent that is only ever watched, and a fridge full of jars, are put on a
 * stage over and over and never hold a grow, so the question is one they can
 * only ever answer the same way. The answer belongs to the space rather than to
 * a memory this session keeps, because a question that comes back on the next
 * phone is not one that was answered.
 */
export const useSetPresetPrompt = (spaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (presetPrompt: PresetPrompt) => api.patch<Space>(`/spaces/${spaceId}`, { presetPrompt }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['spaces'] });
      void queryClient.invalidateQueries({ queryKey: ['space', spaceId] });
    },
  });
};
