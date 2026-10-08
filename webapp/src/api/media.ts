import type { Media } from '@fg2/shared-types/v1';
import { api } from './client';
import { useRead } from './read';

/**
 * A film's render and an export's zip are minutes of work that do not finish
 * inside a request, so the row they will become is polled rather than waited
 * for, on this beat.
 */
const MEDIA_POLL_MS = 5_000;

const working = (status: string | undefined): boolean => status === 'queued' || status === 'rendering';

/** An export whose zip is still being written. */
export const isBuilding = (media: Media | undefined): boolean => working(media?.exportJob?.status);

/** Where a film has got to. A film with no render behind it is one the builder made, and those are only ever there once they are finished. */
export const filmStatus = (film: Media) => film.render?.status ?? 'ready';

/** One media row, polled while its render or its export is still going and left alone once it is not. */
export const useMedia = (mediaId: string | null) =>
  useRead({
    queryKey: ['media', mediaId],
    queryFn: ({ signal }) => api.get<Media>(`/media/${mediaId}`, undefined, signal),
    enabled: mediaId !== null,
    refetchInterval: query => (working(query.state.data?.render?.status) || isBuilding(query.state.data) ? MEDIA_POLL_MS : false),
  });
