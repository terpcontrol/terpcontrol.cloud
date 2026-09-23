import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Entry,
  EntryPage,
  GrowCreate,
  GrowListItem,
  GrowPage,
  GrowReport,
  GrowSeries,
  GrowSeriesRange,
  GrowUpdate,
  GrowWeekCardPage,
  Phase,
  PhaseCreate,
  Plant,
  PlantPage,
  PlantUpdate,
} from '@fg2/shared-types/v1';
import { DIARY_KINDS } from '@/ui/entries';
import { api } from './client';
import { growChanged } from './lifecycle';
import { readEvery } from './pages';

/** A plant's own page shows its lines rather than pages them: a plant of its own has few. */
const PLANT_ENTRIES = 50;

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

/**
 * The rest of a week's diary, asked for only when somebody asks to see it.
 *
 * A week card carries the first ten of its lines and says how many more there
 * are; on a busy week - an alarm that resolved itself nine times in a minute -
 * that leaves the grower's own note off the card. The line that said so named
 * the timeline, which cannot be pointed at a grow that has ended or moved out,
 * so 135 lines of one finished grow were drawn on no screen at all.
 *
 * It is the same route and the same kinds the card's own count is over, bounded
 * by the week's own window, so what arrives is exactly what the card said was
 * missing. The cursor is followed to its end because a week is a handful of
 * rows and half of them would otherwise be a second "there is more".
 */
export const useWeekEntries = (growId: string, week: { startsAt: string; endsAt: string } | null) =>
  useQuery({
    queryKey: ['entries', 'week', growId, week?.startsAt ?? null],
    queryFn: ({ signal }) =>
      readEvery<Entry>('/entries', signal, { growId, startsAt: week!.startsAt, endsAt: week!.endsAt, kinds: DIARY_KINDS.join(',') }),
    enabled: week !== null,
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
 * Every grow, to the last page of them, for the screens that look a name up
 * rather than list what they were given. A hundred is a generous screenful and
 * the wrong thing to decide an absence by: a share link onto the grow that
 * happens to sort past it is a live key, and calling it gone is the one label
 * that stops somebody taking it back. The answer says whether the cursor ran
 * out, so a caller can tell "not there" from "not read".
 */
export const useEveryGrow = () =>
  useQuery({
    queryKey: ['grows', 'every'],
    queryFn: ({ signal }) => readEvery<GrowListItem>('/grows', signal),
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
 * Every grow that has ever stood in one tent, newest first, which is a
 * different question from what stands there now.
 *
 * The Charts view is the one screen that asks it: laying two runs of a tent
 * over each other is a thing to do with the run that finished, and the list of
 * what is growing there this minute holds exactly one of them.
 */
export const useGrowsEverIn = (spaceId: string | null) =>
  useQuery({
    queryKey: ['grows', 'space', spaceId, 'ever'],
    queryFn: ({ signal }) => api.get<GrowPage>('/grows', { spaceId, including: 'ended' }, signal),
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

/**
 * Every reading a chart is drawn from, over one range. The same read answers a
 * harder question the measurements screen has to ask before it offers to
 * delete a definition: whether anything has ever been written under its key.
 *
 * Which keys are wanted is said in the request, because a series asked for and
 * thrown away is a read of the store nobody looks at. They repeat as
 * `measurements=` once per definition, which the shared client cannot spell -
 * it writes each parameter once - so this query is built here and travels in
 * the path.
 */
export const useGrowSeries = (growId: string | null, range: GrowSeriesRange, measurements: string[]) => {
  const keys = [...measurements].sort();

  return useQuery({
    queryKey: ['grow', growId, 'series', range, keys],
    queryFn: ({ signal }) => {
      const query = new URLSearchParams([['range', range], ...keys.map((key): [string, string] => ['measurements', key])]);

      return api.get<GrowSeries>(`/grows/${growId}/series?${query.toString()}`, undefined, signal);
    },
    enabled: growId !== null && keys.length > 0,
  });
};

/**
 * Everything written about one plant alone. A plant's page shows these apart
 * from the grow's own lines, because a line about the whole grow applies to
 * this plant as well and a list that mixed the two would say the plant was
 * watered by itself.
 */
export const usePlantEntries = (plantId: string) =>
  useQuery({
    queryKey: ['entries', 'plant', plantId],
    queryFn: ({ signal }) => api.get<EntryPage>('/entries', { plantId, limit: PLANT_ENTRIES }, signal),
  });

/**
 * What a plant is called and which strain it is. It is the plant page's one
 * write: a label typed in a hurry while the pots were being filled is corrected
 * weeks later, when the tag on the pot has been read again.
 */
export const useUpdatePlant = (growId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ plantId, body }: { plantId: string; body: PlantUpdate }) => api.patch<Plant>(`/plants/${plantId}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['grow', growId, 'plants'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
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
