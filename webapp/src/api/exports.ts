import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExportAccepted, Media } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * Taking a copy of a whole grow away.
 *
 * A zip of a season with its pictures in it does not finish inside a request,
 * so the route answers the media row the file will become and the row is
 * polled: `exportJob.status` walks queued to rendering to ready, and the bytes
 * then come from `GET /media/{id}/content` like any other file in the bucket.
 * Asking twice is one export - the route answers the build already in flight,
 * or a finished one still fresh - so the button never needs to guard itself.
 */

/** How often a job that is still being built is asked about. The same beat a film's render is watched at. */
const EXPORT_POLL_MS = 5_000;

export const useAskExport = (growId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.get<ExportAccepted>(`/grows/${growId}/export`),
    // The answer is the row itself, so the poll starts from what is already
    // known rather than asking again for what was just handed over.
    onSuccess: accepted => queryClient.setQueryData(['media', accepted.media.id], accepted.media),
  });
};

/** One export's row, asked about while the zip is still being written and left alone once it is not. */
export const useExport = (mediaId: string | null) =>
  useQuery({
    queryKey: ['media', mediaId],
    queryFn: ({ signal }) => api.get<Media>(`/media/${mediaId}`, undefined, signal),
    enabled: mediaId !== null,
    refetchInterval: query => (isBuilding(query.state.data) ? EXPORT_POLL_MS : false),
  });

export const isBuilding = (media: Media | undefined): boolean => media?.exportJob?.status === 'queued' || media?.exportJob?.status === 'rendering';

/**
 * "12.4 MB", or "44 kB" for a grow with no pictures in it yet. The unit changes
 * because it has to: a diary of a fortnight rounds to 0.0 MB, and a download
 * that says it is nothing reads as an export that went wrong.
 */
export const fileSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
