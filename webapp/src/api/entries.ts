import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { useRead } from './read';
import type { Entry, EntryCreate, EntryPage, EntryUpdate, Media, Phase, PhaseCreate, TaskCompletionCreate } from '@fg2/shared-types/v1';
import { api } from './client';
import { readEvery } from './pages';

/**
 * The writing half of the diary, and the little of it the Log sheet reads back.
 *
 * Writing is a plain function rather than a mutation hook: the sheet
 * acknowledges before the request is answered and keeps the line itself until
 * it is, so the queue in `@/log` owns the attempt and React Query only hears
 * about what came of it.
 */

/** As many photo lines as a viewer of one grow is worth reading at once. */
const PHOTO_LIMIT = 200;

/** The photo lines of a grow, which is where its pictures are written. */
export const useGrowPhotoLines = (growId: string) =>
  useRead({
    queryKey: ['entries', 'photos', growId],
    queryFn: ({ signal }) => api.get<EntryPage>('/entries', { growId, kinds: 'photo', limit: PHOTO_LIMIT }, signal),
  });

/** A device's own lines, newest first. */
export const useDeviceEntries = (deviceId: string, limit: number) =>
  useRead({
    queryKey: ['entries', 'device', deviceId],
    queryFn: ({ signal }) => api.get<EntryPage>('/entries', { deviceId, limit }, signal),
  });

/** The kinds a tile prefills from, asked for in one read. */
const RECENT_KINDS = ['water', 'feed', 'measurement', 'training', 'visit', 'photo', 'note'].join(',');

/** Enough rows that the newest of every one of those kinds is among them, even for somebody who writes a lot. */
const RECENT_LIMIT = 40;

/** What was logged before, which is where a tile's defaults come from. Empty for a target that is neither. */
export const useRecentEntries = (growId: string | null, spaceId: string | null) =>
  useRead({
    queryKey: ['entries', 'recent', growId ?? spaceId ?? 'none'],
    queryFn: ({ signal }) =>
      api.get<EntryPage>(
        '/entries',
        { growId: growId ?? undefined, spaceId: growId ? undefined : (spaceId ?? undefined), kinds: RECENT_KINDS, limit: RECENT_LIMIT },
        signal,
      ),
    enabled: Boolean(growId ?? spaceId),
  });

/** The most a window's lines are read in pages of the route's largest, before the rest is only counted as more. */
const WINDOW_PAGES = 5;

/** What happened in a window, newest first, and whether there was more than was read. */
export interface WindowEntries {
  items: Entry[];
  more: boolean;
}

/**
 * Everything written about a place - or a grow with no place - over one
 * window: its devices' own lines, the alarms, the plan and the diary. The
 * charts page draws them under its curves, so a window of a busy month is read
 * a few pages deep and the rest is said rather than read.
 */
export const useWindowEntries = (about: { growId: string | null; spaceId: string | null }, window: { from: string; to: string } | null) =>
  useRead({
    queryKey: ['entries', 'window', about.spaceId ?? about.growId, window],
    queryFn: async ({ signal }): Promise<WindowEntries> => {
      const { items, complete } = await readEvery<Entry>(
        '/entries',
        signal,
        { spaceId: about.spaceId, growId: about.spaceId ? null : about.growId, startsAt: window?.from, endsAt: window?.to },
        WINDOW_PAGES,
      );

      return { items, more: !complete };
    },
    enabled: window !== null && Boolean(about.spaceId ?? about.growId),
    placeholderData: keepPreviousData,
  });

export const writeEntry = (body: EntryCreate): Promise<Entry> => api.post<Entry>('/entries', body);

export const correctEntry = (id: string, body: EntryUpdate): Promise<Entry> => api.patch<Entry>(`/entries/${id}`, body);

/** The Undo the sheet offers, and nothing else: after the window it is refused unless the caller manages the place. */
export const takeEntryBack = (id: string): Promise<void> => api.delete(`/entries/${id}`);

export const completeTask = (taskId: string, body: TaskCompletionCreate = {}): Promise<Entry> =>
  api.post<Entry>(`/tasks/${encodeURIComponent(taskId)}/completions`, body);

export const startPhase = (growId: string, body: PhaseCreate): Promise<Phase> => api.post<Phase>(`/grows/${growId}/phases`, body);

/**
 * A picture, uploaded before the entry that will name it. It is two requests
 * because the bytes take as long as the connection takes and the entry does
 * not: a picture no entry ever names is swept up by the server.
 */
export const uploadPhoto = (file: File, about: { growId: string | null; spaceId: string | null }): Promise<Media> => {
  const form = new FormData();
  form.set('file', file);
  form.set('kind', 'photo');
  if (about.growId) form.set('growId', about.growId);
  else if (about.spaceId) form.set('spaceId', about.spaceId);

  return api.post<Media>('/media', form);
};

/**
 * One line changes the home, the tent, the grow, every timeline and the task
 * list at once - a tick is a line, and so is taking it back - so a write says
 * so rather than each screen polling for it.
 */
export const diaryChanged = (client: QueryClient): void => {
  for (const key of ['home', 'space', 'grow', 'entries', 'tasks']) void client.invalidateQueries({ queryKey: [key] });
};
