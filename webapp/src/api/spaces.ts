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

/**
 * Which room a place stands in, or none.
 *
 * A room is a space of kind `room` and the grouping is one level deep in both
 * directions, so this is the whole of what grouping means to the client: one
 * field on the tent, pointing at a room or at nothing. The server refuses the
 * rest - a room in a room, a room of another account, a room that is not one -
 * and its sentence is shown rather than guessed at here.
 *
 * The home and the space list are read again because both draw the grouping,
 * and a membership held on the room reaches into every tent grouped under it,
 * so the tent's own member list is stale the moment it moves.
 */
export const useSetRoom = (spaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (roomId: string | null) => api.patch<Space>(`/spaces/${spaceId}`, { roomId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['spaces'] });
      await queryClient.invalidateQueries({ queryKey: ['space', spaceId] });
      await queryClient.invalidateQueries({ queryKey: ['home'] });
    },
  });
};
