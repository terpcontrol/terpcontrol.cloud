import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Camera,
  CameraCreate,
  CameraPage,
  CameraUpdate,
  Media,
  MediaPage,
  TestCaptureAnswer,
  TimelapseAccepted,
  TimelapseCreate,
} from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The cameras of an account, one camera's page, and the films it is asked for.
 *
 * A camera answers when it last delivered rather than a liveness, because how
 * old a picture may be is the camera's own `stillIntervalSeconds` and not the
 * two minutes a sensor reading is judged by.
 */
export const CAMERAS_REFRESH_MS = 30_000;

/** A render is minutes of ffmpeg, so the job is polled rather than waited for. */
export const RENDER_POLL_MS = 5_000;

export const useCameras = (spaceId?: string) =>
  useQuery({
    queryKey: ['cameras', spaceId ?? null],
    queryFn: ({ signal }) => api.get<CameraPage>('/cameras', spaceId ? { spaceId } : undefined, signal),
    refetchInterval: CAMERAS_REFRESH_MS,
  });

/**
 * The cameras this account had at the moment this was first read, and never
 * again: a screen watching for a camera to be paired has to know which ones
 * were already there, and a list that refreshed itself would keep moving that
 * line until nothing was ever new.
 *
 * Its key deliberately stands outside the `cameras` family, so that creating or
 * changing a camera does not invalidate the very answer that says what was
 * there before; it is thrown away as soon as nobody is reading it, so opening
 * the screen again asks afresh. That makes the reader's lifetime the line's
 * lifetime, so it is read by the screen that watches rather than by a tab of
 * it, and not at all where there is no hardware that could pair anything.
 */
export const useCamerasAsOpened = (enabled = true) =>
  useQuery({
    queryKey: ['cameras-as-opened'],
    queryFn: ({ signal }) => api.get<CameraPage>('/cameras', undefined, signal),
    staleTime: Infinity,
    gcTime: 0,
    enabled,
  });

export const useCamera = (cameraId: string) =>
  useQuery({
    queryKey: ['camera', cameraId],
    queryFn: ({ signal }) => api.get<Camera>(`/cameras/${cameraId}`, undefined, signal),
    refetchInterval: CAMERAS_REFRESH_MS,
  });

/** The largest page the route will answer, whatever a client asks for (`MAX_PAGE_LIMIT` on the server). */
const FRAMES_PER_PAGE = 200;

/**
 * How many of those pages one day is walked over before the walk gives up. A
 * camera asked for a picture every thirty seconds delivers 2,880 a day, so this
 * reaches the end of any ordinary day in a handful of reads; the cap is there
 * only so that a day nobody expected - two cameras writing into one, a shorter
 * interval than the pipeline promises - cannot turn one screen into an
 * unbounded run of requests.
 */
export const MAX_FRAME_PAGES = 15;

/** A day of stills, and whether the walk reached the end of it. */
export interface CameraDay {
  items: Media[];
  /** The cap stopped the walk with rows still to come, so the count is a floor and not the day's total. */
  partial: boolean;
}

/**
 * The stills of one camera inside a span, newest first as the route answers
 * them. The scrubber walks this list rather than asking per position, so it has
 * to be the whole day and not the first page of it: the route caps a page at two
 * hundred rows and says with a cursor that there are more, and a day of a camera
 * on the pipeline's own interval is ten times that. Asking once and drawing what
 * came back left the morning unreachable and printed the page size as the day's
 * count.
 */
export const useCameraFrames = (cameraId: string, span: { startsAt: string; endsAt: string }) =>
  useQuery({
    queryKey: ['camera', cameraId, 'frames', span.startsAt, span.endsAt],
    queryFn: async ({ signal }): Promise<CameraDay> => {
      const items: Media[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < MAX_FRAME_PAGES; page += 1) {
        const answer: MediaPage = await api.get<MediaPage>(`/cameras/${cameraId}/frames`, { ...span, limit: FRAMES_PER_PAGE, cursor }, signal);
        items.push(...answer.items);
        cursor = answer.nextCursor;
        if (!cursor) break;
      }

      return { items, partial: cursor !== null };
    },
  });

/** A screenful of films, which is also the largest page the composer's own list needs. */
export const TIMELAPSES_PER_PAGE = 20;

/**
 * The films of one camera, newest first and continued by the cursor the route
 * hands out. A camera that has been filming for a season has hundreds of them,
 * and a list that read one page and drew three of it was a season of somebody's
 * own timelapses with no route to them at all.
 */
export const useTimelapses = (cameraId: string) =>
  useInfiniteQuery({
    queryKey: ['camera', cameraId, 'timelapses'],
    queryFn: ({ pageParam, signal }) => api.get<MediaPage>(`/cameras/${cameraId}/timelapses`, { limit: TIMELAPSES_PER_PAGE, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
  });

/** One media row, polled while its render is still going and left alone once it is not. */
export const useMedia = (mediaId: string | null) =>
  useQuery({
    queryKey: ['media', mediaId],
    queryFn: ({ signal }) => api.get<Media>(`/media/${mediaId}`, undefined, signal),
    enabled: mediaId !== null,
    refetchInterval: query => (isRendering(query.state.data) ? RENDER_POLL_MS : false),
  });

export const isRendering = (media: Media | undefined): boolean => media?.render?.status === 'queued' || media?.render?.status === 'rendering';

/**
 * Adding a camera: the Terp Cam a controller has paired, which this adopts
 * rather than doubling, or a stream at an address. What comes back is the whole
 * camera, so the screen that made it can go straight to its page.
 */
export const useCreateCamera = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CameraCreate) => api.post<Camera>('/cameras', body),
    onSuccess: created => {
      queryClient.setQueryData(['camera', created.id], created);
      void queryClient.invalidateQueries({ queryKey: ['cameras'] });
    },
  });
};

/**
 * The same change as `useUpdateCamera`, for a screen that learns which camera
 * it is about only while it is running: the camera being set up is made by the
 * tap that tests it, so the id cannot be named when the hook is called.
 */
export const useAmendCamera = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ cameraId, body }: { cameraId: string; body: CameraUpdate }) => api.patch<Camera>(`/cameras/${cameraId}`, body),
    onSuccess: camera => {
      queryClient.setQueryData(['camera', camera.id], camera);
      void queryClient.invalidateQueries({ queryKey: ['cameras'] });
    },
  });
};

export const useUpdateCamera = (cameraId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CameraUpdate) => api.patch<Camera>(`/cameras/${cameraId}`, body),
    onSuccess: camera => {
      queryClient.setQueryData(['camera', cameraId], camera);
      void queryClient.invalidateQueries({ queryKey: ['cameras'] });
    },
  });
};

export const useRemoveCamera = (cameraId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete(`/cameras/${cameraId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cameras'] }),
  });
};

/** Taking one away again by an id the screen only learns while it is running, for the same reason `useAmendCamera` exists. */
export const useDropCamera = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (cameraId: string) => api.delete(`/cameras/${cameraId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cameras'] }),
  });
};

/**
 * One picture now. A camera that could not be read answers the reason it gave
 * rather than an error, because a wrong address is an ordinary outcome of this
 * button and the reason is what the person needs to see.
 */
export const useTestCapture = (cameraId: string) =>
  useMutation({ mutationFn: () => api.post<TestCaptureAnswer>(`/cameras/${cameraId}/test-captures`) });

/** A picture from a camera named as the request is made, for the same reason `useAmendCamera` exists. */
export const useCaptureOnce = () =>
  useMutation({ mutationFn: (cameraId: string) => api.post<TestCaptureAnswer>(`/cameras/${cameraId}/test-captures`) });

/**
 * The composer, and the four one-tap buttons above it. The answer is the media
 * row of the film: queued when this request made it, and the one that was
 * already there when it did not.
 */
export const useRequestTimelapse = (cameraId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: TimelapseCreate) => api.post<TimelapseAccepted>(`/cameras/${cameraId}/timelapses`, body),
    onSuccess: accepted => {
      queryClient.setQueryData(['media', accepted.media.id], accepted.media);
      void queryClient.invalidateQueries({ queryKey: ['camera', cameraId, 'timelapses'] });
    },
  });
};

/**
 * The newest picture of each of several cameras, which is the thumbnail on a
 * camera's row. One read per camera, of one row each: a camera's frames are its
 * own and there is nothing to ask for across them.
 */
export const useLatestStills = (cameraIds: string[]) =>
  useQueries({
    queries: cameraIds.map(cameraId => ({
      queryKey: ['camera', cameraId, 'latest-still'],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<MediaPage>(`/cameras/${cameraId}/frames`, { limit: 1 }, signal),
      refetchInterval: CAMERAS_REFRESH_MS,
    })),
    combine: results => new Map(cameraIds.map((cameraId, index) => [cameraId, results[index]?.data?.items[0]?.id ?? null])),
  });
