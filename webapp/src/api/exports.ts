import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExportAccepted, Media } from '@fg2/shared-types/v1';
import { api, apiBlob } from './client';

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

/**
 * Which export of the whole account is going, or has gone, in this session.
 *
 * The id lives here rather than in the row that asked for it because the job
 * outlives the screen: a season of readings takes a while to write, and
 * somebody who walks to another page and back should find their file rather
 * than a button offering to build one the server has already built. Nothing
 * fetches this key - it is written by the ask below and read by every row that
 * draws the export - and it is never collected, because the screen it belongs
 * to is unmounted for exactly as long as the wait is worth remembering.
 *
 * It is not carried across a reload. The route that would find a standing
 * export again is the one that starts a new one, so asking it on the way in
 * would build a zip nobody asked for.
 */
const ASKED_KEY = ['export', 'asked'];

export const useAskedExport = (): string | null =>
  useQuery<string | null>({
    queryKey: ASKED_KEY,
    queryFn: () => null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity,
  }).data;

/**
 * The same job for everything the account has - every grow, every reading,
 * every photo - which is the export the privacy screen promises. It answers
 * the same row and is polled the same way; only the route differs, and with it
 * who may ask: a demo session owns nothing and is refused.
 */
export const useAskAccountExport = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.get<ExportAccepted>('/me/export'),
    onSuccess: accepted => {
      queryClient.setQueryData(['media', accepted.media.id], accepted.media);
      queryClient.setQueryData(ASKED_KEY, accepted.media.id);
    },
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
 * "1.2 GB", "12.4 MB", or "44 kB" for a grow with no pictures in it yet. The
 * unit changes because it has to at both ends: a diary of a fortnight rounds
 * to 0.0 MB, and a download that says it is nothing reads as an export that
 * went wrong - while a whole account with a year of diary photos and films in
 * it is a gigabyte and more, and four digits of megabytes is a figure nobody
 * can weigh against the room on their disk.
 *
 * The steps are the binary ones under the SI labels, which is what this app
 * writes a size in everywhere, so the same zip reads the same on the account
 * page and on the administrator's health card. The decimal is always written
 * where there is room for one, because "1 GB" beside "1.2 GB" reads as the
 * rounder of two answers rather than as the same kind of figure, and it is
 * written the way the language writes a decimal rather than the way the
 * browser does; a caller with no language to hand gets the browser's.
 */
export const fileSize = (bytes: number, language?: string): string => {
  const figure = (value: number, digits: number) =>
    new Intl.NumberFormat(language, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

  if (bytes >= 1024 ** 3) return `${figure(bytes / 1024 ** 3, 1)} GB`;
  if (bytes >= 1024 ** 2) return `${figure(bytes / 1024 ** 2, 1)} MB`;

  return `${figure(Math.round(bytes / 1024), 0)} kB`;
};

/**
 * What the zip is called once it is on somebody's disk. The server names no
 * file, and a browser left to itself would call it after the media id - which
 * is nothing anybody could find again among a year of downloads.
 *
 * What it is an export of is read from the job rather than from the row's own
 * `growId`, which an export leaves null on purpose: an export is the account's
 * private copy of what it can see, and hanging it off a grow would put a zip
 * among that grow's pictures. Read from there, every grow export was called an
 * export of the whole account.
 */
export const exportFilename = (row: Media): string =>
  `terp-control-${row.exportJob?.scope === 'grow' ? 'grow' : 'account'}-${row.createdAt.slice(0, 10)}.zip`;

/**
 * Handing the finished zip over. The route wants a session rather than the
 * token a picture's URL carries, so the bytes are fetched and given to a
 * download of their own making; the object URL is released on the next tick,
 * once the browser has taken it.
 *
 * It answers what went wrong rather than throwing into nothing, because the
 * one thing worse than a refused download is a button that does nothing twice.
 */
export const useDownloadExport = () =>
  useMutation({
    mutationFn: async ({ mediaId, filename }: { mediaId: string; filename: string }) => {
      const blob = await apiBlob(`/media/${mediaId}/content`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  });
