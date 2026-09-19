import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  HarvestCreate,
  HarvestResult,
  Phase,
  PhaseCreate,
  PhaseUpdate,
  Placement,
  PlacementCreate,
  PlacementUpdate,
  PresetApplication,
  PresetApplicationCreate,
  SplitCreate,
  SplitResult,
} from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * A grow's life: the stage it is in, where it stands, what came down and what
 * went its own way - and the climate preset a tent is put on, which is the same
 * story told from the other end.
 *
 * None of these answer the grow itself. A phase, a placement, a harvest and a
 * split each hand back the row they appended, and what that means for the day
 * counter, the headline stage and where the plants are is worked out in the
 * grow serialiser - so every one of them ends by reading the grow again rather
 * than patching a summary into the cache that the server would have worked out
 * differently.
 *
 * They wait for the server. The Log sheet's queue acknowledges a line before it
 * is sent because a line can be taken back afterwards; a harvest cannot, and a
 * grow that had not really moved on would be a lie on every screen at once.
 */

/**
 * One move touches the grow, the plants, both tents it is between, the diary
 * and the home card that draws all of it, so the answer is "read it again"
 * rather than a list of what each caller changed.
 */
export const growChanged = (client: QueryClient): void => {
  for (const key of ['grow', 'grows', 'home', 'space', 'spaces', 'entries']) void client.invalidateQueries({ queryKey: [key] });
};

const useLifecycleMutation = <T, V>(mutationFn: (variables: V) => Promise<T>) => {
  const client = useQueryClient();

  return useMutation({ mutationFn, onSuccess: () => growChanged(client) });
};

/** The stage picker: the grow moves on, and the diary says so. */
export const useAddPhase = (growId: string) => useLifecycleMutation((body: PhaseCreate) => api.post<Phase>(`/grows/${growId}/phases`, body));

/** A phase entered with the wrong stage or on the wrong day. Who put the grow there is not corrected with it. */
export const useCorrectPhase = (growId: string) =>
  useLifecycleMutation(({ phaseId, body }: { phaseId: string; body: PhaseUpdate }) => api.patch<Phase>(`/grows/${growId}/phases/${phaseId}`, body));

/** A phase the grow never entered. The line that announced it goes with it. */
export const useWithdrawPhase = (growId: string) => useLifecycleMutation((phaseId: string) => api.delete(`/grows/${growId}/phases/${phaseId}`));

/** A move: the open placement of these plants is closed and a new one opened. */
export const useMovePlants = (growId: string) =>
  useLifecycleMutation((body: PlacementCreate) => api.post<Placement>(`/grows/${growId}/placements`, body));

/**
 * The same move, asked from the tent's side, where the place is given and the
 * grow is the question. It is the grow's route either way - a placement belongs
 * to the grow that made it - so only which half is known beforehand differs.
 */
export const useMoveGrowHere = (spaceId: string) =>
  useLifecycleMutation(({ growId, startedAt }: { growId: string; startedAt: string }) =>
    api.post<Placement>(`/grows/${growId}/placements`, { spaceId, startedAt }),
  );

/** A move recorded wrongly - which is also how a placement left open is closed on the day the plants really left. */
export const useCorrectPlacement = (growId: string) =>
  useLifecycleMutation(({ placementId, body }: { placementId: string; body: PlacementUpdate }) =>
    api.patch<Placement>(`/grows/${growId}/placements/${placementId}`, body),
  );

/**
 * A move that never happened. The server refuses to leave a grow standing
 * nowhere, so this is the one call here whose failure is something a person
 * acts on rather than reads.
 */
export const useWithdrawPlacement = (growId: string) =>
  useLifecycleMutation((placementId: string) => api.delete(`/grows/${growId}/placements/${placementId}`));

/** Cutting plants down. The weights are totals; the server shares them out over the plants named. */
export const useHarvest = (growId: string) =>
  useLifecycleMutation((body: HarvestCreate) => api.post<HarvestResult>(`/grows/${growId}/harvests`, body));

/** Some plants go their own way: their own phase, their own place, or both, while the rest of the grow carries on. */
export const useSplit = (growId: string) => useLifecycleMutation((body: SplitCreate) => api.post<SplitResult>(`/grows/${growId}/splits`, body));

/**
 * Putting a tent on a climate preset, and with it the grow standing in it.
 *
 * The answer is not a resource - nothing of the application is stored - so it
 * is kept by the sheet that asked for it and reported there: which controllers
 * were written, which grow entered the stage, what a plan running here had to
 * do about it, and whether the server is waiting to be told what to do with a
 * tent that has no grow in it.
 */
export const useApplyPreset = (spaceId: string) =>
  useLifecycleMutation((body: PresetApplicationCreate) => api.post<PresetApplication>(`/spaces/${spaceId}/preset-applications`, body));
