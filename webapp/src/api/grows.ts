import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GrowCreate,
  GrowListItem,
  GrowPage,
  GrowReport,
  GrowUpdate,
  GrowWeekCardPage,
  Phase,
  PhaseCreate,
  PlantPage,
} from '@fg2/shared-types/v1';
import { api } from './client';
import { growChanged } from './lifecycle';

/**
 * The grow page's four reads. The grow itself carries its summary - the day
 * counter, the phase, the "auto" tag - worked out by the server, so nothing
 * here counts days. The weeks are paged, newest first, because every card costs
 * the server a time-series read; the page asks for the next screenful only when
 * somebody scrolls to it.
 *
 * The first two are the Log sheet's as well, where there may be no grow at all:
 * a sheet pointed at a tent asks for nothing rather than for a grow called null.
 */

export const useGrow = (growId: string | null) =>
  useQuery({
    queryKey: ['grow', growId],
    queryFn: ({ signal }) => api.get<GrowListItem>(`/grows/${growId}`, undefined, signal),
    enabled: growId !== null,
  });

export const useGrowPlants = (growId: string | null) =>
  useQuery({
    queryKey: ['grow', growId, 'plants'],
    queryFn: ({ signal }) => api.get<PlantPage>(`/grows/${growId}/plants`, undefined, signal),
    enabled: growId !== null,
  });

export const useGrowWeeks = (growId: string) =>
  useInfiniteQuery({
    queryKey: ['grow', growId, 'weeks'],
    queryFn: ({ pageParam, signal }) => api.get<GrowWeekCardPage>(`/grows/${growId}/weeks`, { cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
  });

export const useGrowReport = (growId: string) =>
  useQuery({
    queryKey: ['grow', growId, 'report'],
    queryFn: ({ signal }) => api.get<GrowReport>(`/grows/${growId}/report`, undefined, signal),
  });

/**
 * Changing the grow itself. The one thing the app edits here today is whether
 * the diary has a public address: the slug is fixed at creation, so turning the
 * page on and off again never moves it.
 */
export const useUpdateGrow = (growId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: GrowUpdate) => api.patch<GrowListItem>(`/grows/${growId}`, body),
    onSuccess: grow => {
      queryClient.setQueryData(['grow', growId], grow);
      void queryClient.invalidateQueries({ queryKey: ['home'] });
    },
  });
};

/**
 * Every grow this account can see, for the sheets that ask which one: moving a
 * grow into the tent you are standing in, and answering the server's question
 * about a tent a preset was applied to with no grow in it. One page is every
 * grow anybody has, so there is no cursor to follow.
 */
export const useGrows = () =>
  useQuery({
    queryKey: ['grows', 'all'],
    queryFn: ({ signal }) => api.get<GrowPage>('/grows', { limit: 100 }, signal),
  });

/**
 * The grows standing in one space, which is how a camera's page learns where
 * the phase it would film began: a phase and a whole grow are stretches only
 * the client can name both ends of.
 */
export const useSpaceGrows = (spaceId: string | null) =>
  useQuery({
    queryKey: ['grows', 'space', spaceId],
    queryFn: ({ signal }) => api.get<GrowPage>('/grows', { spaceId }, signal),
    enabled: spaceId !== null,
  });

/**
 * Starting a grow, and the stage it starts in.
 *
 * They are two calls because they are two facts: a grow exists from the moment
 * it is sown, and the day counter runs from the phase. The sheet that makes one
 * sends them in that order and reports honestly if the second is refused - a
 * grow with no phase yet is a grow that stands, not a grow that failed.
 *
 * The phase carries the grow's id rather than the hook, because the id is not
 * known until the grow answers. Everything that draws a grow is read again
 * afterwards: a new grow appears on the home, in the lists the sheets pick from
 * and in the place it was put.
 */
export const useCreateGrow = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: GrowCreate) => api.post<GrowListItem>('/grows', body),
    onSuccess: grow => {
      queryClient.setQueryData(['grow', grow.id], grow);
      growChanged(queryClient);
    },
  });
};

export const useStartingPhase = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ growId, body }: { growId: string; body: PhaseCreate }) => api.post<Phase>(`/grows/${growId}/phases`, body),
    onSuccess: () => growChanged(queryClient),
  });
};
