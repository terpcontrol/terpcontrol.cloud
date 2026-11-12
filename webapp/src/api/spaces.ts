import { queryOptions, useQueries } from '@tanstack/react-query';
import { LIVE_BEAT_MS, useRead } from './read';
import type { Device, PresetPrompt, Space, SpaceCreate, SpaceLive, SpaceOverview, SpacePage, SpaceUpdate } from '@fg2/shared-types/v1';
import { api } from './client';
import { serverNow } from './clock';
import { readEvery } from './pages';
import { invalidate, useWrite, useWriteSettled } from './write';

/**
 * The tent page reads its overview once a minute and its live values on the
 * live beat: the overview costs a day of series for the verdict, the live
 * read costs one `last()`, and it is the values that age. A refresh that fails
 * leaves the last answer in place with its ages, which is what the ages are for.
 */
const OVERVIEW_REFRESH_MS = 60_000;

export const spacesQuery = queryOptions({ queryKey: ['spaces'], queryFn: ({ signal }) => api.get<SpacePage>('/spaces', undefined, signal) });

/**
 * Every place this account can see. `enabled` is here for the readers that only
 * want one space's standing: a screen that stands above every place asks
 * nothing rather than fetching the whole list to answer a question it has not
 * got a place for.
 */
export const useSpaces = (enabled = true) => useRead({ ...spacesQuery, enabled });

/**
 * Every place, to the last page of them, for the screens that look a name up
 * rather than list what they were given. One page is enough to draw a picker or
 * a board; it is not enough to decide that the tent a share link points at no
 * longer exists, and an owner with more tents than a page holds would be told
 * that live keys are dead. The answer says whether the cursor ran out, so a
 * caller can tell "not there" from "not read".
 */
export const useEverySpace = () =>
  useRead({
    queryKey: ['spaces', 'every'],
    queryFn: ({ signal }) => readEvery<Space>('/spaces', signal),
  });

const overviewQuery = (spaceId: string) =>
  queryOptions({
    queryKey: ['space', spaceId, 'overview'],
    queryFn: ({ signal }) => api.get<SpaceOverview>(`/spaces/${spaceId}/overview`, undefined, signal),
  });

export const useSpaceOverview = (spaceId: string, enabled = true) =>
  useRead({ ...overviewQuery(spaceId), refetchInterval: OVERVIEW_REFRESH_MS, enabled: enabled && spaceId !== '' });

/**
 * The 24 h verdict of several places at once, for a list that draws rows from
 * more than one of them.
 *
 * How often an output came on today is the place's answer and not the device's
 * - it is counted by the same aggregation that decides whether the tent was in
 * band - so a list spanning the whole account has to ask each place it draws a
 * row from. The key is the one a tent's own page reads its overview under, so
 * the tent tab costs nothing extra: the answer is already in hand, and the
 * account-wide tab is the only caller that pays for a read.
 *
 * A place whose overview has not landed, or would not, simply has no counts,
 * which is what a row with no run figure has always meant.
 */
export const useSpaceVerdicts = (spaceIds: readonly string[]) =>
  useQueries({
    queries: spaceIds.map(spaceId => ({ ...overviewQuery(spaceId), refetchInterval: OVERVIEW_REFRESH_MS })),
    combine: (results: { data?: SpaceOverview }[]) => new Map(spaceIds.map((spaceId, index) => [spaceId, results[index]?.data?.verdict])),
  });

export const useSpaceLive = (spaceId: string, enabled: boolean) =>
  useRead({
    queryKey: ['space', spaceId, 'live'],
    queryFn: ({ signal }) => api.get<SpaceLive>(`/spaces/${spaceId}/live`, undefined, signal),
    refetchInterval: LIVE_BEAT_MS,
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
export const useSetPresetPrompt = (spaceId: string) =>
  useWrite(
    (presetPrompt: PresetPrompt) => api.patch<Space>(`/spaces/${spaceId}`, { presetPrompt }),
    client => void invalidate(client, ['spaces'], ['space', spaceId]),
  );

/**
 * What "Ort bearbeiten" saves in one write: the name, the kind and the room -
 * by its id, by the name of one still to be made (`roomName`), or none. The
 * server makes a room a place names and ends one its last place has left, and
 * refuses a name another place carries, in a sentence the page shows.
 *
 * The home and the space list are read again because both draw the grouping,
 * and a membership held on the room reaches into every place grouped under it.
 */
export const useSavePlace = (spaceId: string) =>
  useWrite(
    (body: SpaceUpdate) => api.patch<Space>(`/spaces/${spaceId}`, body),
    client => invalidate(client, ['spaces'], ['space'], ['home']),
  );

/**
 * A new place, written the moment it is named: a tent invented while a grow is
 * started, a room on the Members tab, or the place an RTSP camera looks at. What
 * a sheet then offers as somewhere to put something is a real space with a real
 * id, and not a promise the next write would have to keep.
 */
export const useCreateSpace = () =>
  useWrite(
    (body: SpaceCreate) => api.post<Space>('/spaces', body),
    client => void invalidate(client, ['spaces'], ['home']),
  );

/**
 * Ending a place: each device, camera and running grow goes where it was sent
 * first (`remove-plan.ts`), then the place ends. Every step is a write of its
 * own, so one that is refused leaves what was done before it done; the page
 * reads what still stands here and offers the rest again. The server still
 * refuses where people are let in, and says so.
 */
export const useEndPlace = (spaceId: string) =>
  useWriteSettled(
    async (steps: readonly EndStep[]) => {
      const made = new Map<string, string>();
      const placeOf = (to: EndTo): string | null => (to === null ? null : 'made' in to ? (made.get(to.made) ?? null) : to.spaceId);

      for (const step of steps) {
        if (step.do === 'make') made.set(step.key, (await api.post<Space>('/spaces', step.body)).id);
        else if (step.do === 'device') await api.put<Device>(`/spaces/${placeOf(step.to)}/devices/${step.deviceId}`);
        else if (step.do === 'release') await api.delete(`/devices/${step.deviceId}/claim`);
        else if (step.do === 'camera') await api.patch(`/cameras/${step.cameraId}`, { spaceId: step.spaceId });
        else if (step.do === 'uncouple') await api.delete(`/cameras/${step.cameraId}`);
        else if (step.do === 'grow')
          await api.post(`/grows/${step.growId}/placements`, { spaceId: placeOf(step.to), startedAt: serverNow().toUTC().toISO()! });
        else await api.patch(`/grows/${step.growId}`, { endedAt: serverNow().toUTC().toISO()! });
      }
      await api.delete(`/spaces/${spaceId}`);
    },
    // Read again whether it went through or stopped half-way: the page then shows what still stands here.
    client => void invalidate(client, ['spaces'], ['space'], ['home'], ['devices'], ['cameras'], ['grows'], ['grow']),
  );

/** Where something goes when its place ends: a place that exists, one a step before makes, or no place at all. */
export type EndTo = { spaceId: string } | { made: string } | null;

/** One write of ending a place, in the order they are made. */
export type EndStep =
  | { do: 'make'; key: string; body: SpaceCreate }
  | { do: 'device'; deviceId: string; to: Exclude<EndTo, null> }
  | { do: 'release'; deviceId: string }
  | { do: 'camera'; cameraId: string; spaceId: string }
  | { do: 'uncouple'; cameraId: string }
  | { do: 'grow'; growId: string; to: EndTo }
  | { do: 'end'; growId: string };
