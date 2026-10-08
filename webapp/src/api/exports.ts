import { useMutation, useQuery } from '@tanstack/react-query';
import type { ExportAccepted, Media } from '@fg2/shared-types/v1';
import { api, apiBlob } from './client';
import { saveFile } from '@/ui/download';
import { useWrite } from './write';

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

export const useAskExport = (growId: string) =>
  useWrite(
    () => api.get<ExportAccepted>(`/grows/${growId}/export`),
    // The answer is the row itself, so the poll starts from what is already
    // known rather than asking again for what was just handed over.
    (client, accepted) => client.setQueryData(['media', accepted.media.id], accepted.media),
  );

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
 * The same job for everything the account has - every grow, every photo, and
 * the climate a row a minute - which is the export the privacy screen
 * promises. It answers the same row and is polled the same way; only the route
 * differs, and with it who may ask: a demo session owns nothing and is refused.
 *
 * The climate is the one thing here that is not what the store holds. A device
 * sends a reading every five seconds and the zip carries the mean of each
 * minute, which the card beside this button says and the zip's own README says
 * again; both used to say "every reading", which was a twelfth of the truth.
 */
export const useAskAccountExport = () =>
  useWrite(
    () => api.get<ExportAccepted>('/me/export'),
    (client, accepted) => {
      client.setQueryData(['media', accepted.media.id], accepted.media);
      client.setQueryData(ASKED_KEY, accepted.media.id);
    },
  );

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
 * download of their own making.
 *
 * It answers what went wrong rather than throwing into nothing, because the
 * one thing worse than a refused download is a button that does nothing twice.
 */
export const useDownloadExport = () =>
  useMutation({
    mutationFn: async ({ mediaId, filename }: { mediaId: string; filename: string }) =>
      saveFile(await apiBlob(`/media/${mediaId}/content`), filename),
  });
