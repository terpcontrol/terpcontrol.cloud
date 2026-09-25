import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { useRead, useReadPages } from './read';
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
import { PAGE_LIMIT } from './pages';

/**
 * The cameras of an account, one camera's page, and the films it is asked for.
 *
 * A camera answers when it last delivered rather than a liveness, because how
 * old a picture may be is the camera's own `stillIntervalSeconds` and not the
 * two minutes a sensor reading is judged by.
 */
export const CAMERAS_REFRESH_MS = 30_000;

/**
 * How long a test picture is waited for. The server's longest honest answer to
 * a Terp Cam is its whole direct path - rendezvous, login and transfer, 48 s -
 * followed by the controller's 30 s, and it may queue behind a read the poller
 * is making. Abandoned at the 30 s every other request gets, the press said the
 * camera was never reached while the server was still reading it, and the
 * picture landed a minute later.
 */
const CAPTURE_WAIT_MS = 120_000;

/** Whether a call was given up on by this side rather than answered by the other. */
export const gaveUp = (error: unknown): boolean => error instanceof DOMException && error.name === 'TimeoutError';

/** A render is minutes of ffmpeg, so the job is polled rather than waited for. */
export const RENDER_POLL_MS = 5_000;

export const useCameras = (spaceId?: string) =>
  useRead({
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
  useRead({
    queryKey: ['cameras-as-opened'],
    queryFn: ({ signal }) => api.get<CameraPage>('/cameras', undefined, signal),
    staleTime: Infinity,
    gcTime: 0,
    enabled,
  });

export const useCamera = (cameraId: string) =>
  useRead({
    queryKey: ['camera', cameraId],
    queryFn: ({ signal }) => api.get<Camera>(`/cameras/${cameraId}`, undefined, signal),
    refetchInterval: CAMERAS_REFRESH_MS,
  });

/**
 * The largest page the route will answer, whatever a client asks for. One
 * figure, kept beside the rest of the paging in `pages.ts`, rather than a
 * second copy of a number the API now states on the `limit` parameter itself.
 */
const FRAMES_PER_PAGE = PAGE_LIMIT;

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
 *
 * It is read again on the same cadence as the camera's own row, because this is
 * a screen somebody leaves open in front of a tent. Read once at load, the
 * frame, its stamp and the count under the scrubber stood still for as long as
 * the page was up while the header pill - which does refresh - went on counting
 * seconds since the last picture, so the page said in one line that the camera
 * had delivered ten seconds ago and in the next that a picture from twenty
 * minutes back was the live one.
 *
 * A refetch asks only for what has been taken since the newest picture already
 * in hand, and puts it in front of the ones held. Walking the whole day again
 * every half minute would be up to `MAX_FRAME_PAGES` requests each time on a
 * camera delivering at its own interval, which is the cost that made reading it
 * once look reasonable; the tail is one request for a day that is not moving.
 * The bound is that a still deleted behind the app's back - retention pruning
 * an older day - is not noticed until the span is asked for afresh, which is
 * every time this page is opened.
 */
export const useCameraFrames = (cameraId: string, span: { startsAt: string; endsAt: string }) => {
  const queryClient = useQueryClient();
  const queryKey = ['camera', cameraId, 'frames', span.startsAt, span.endsAt];

  return useRead({
    queryKey,
    queryFn: async ({ signal }): Promise<CameraDay> => {
      const held = queryClient.getQueryData<CameraDay>(queryKey) ?? null;
      // The route answers newest first and takes its ends inclusively, so the
      // newest picture held is the tail's own start and comes back with it;
      // ids are what tell the two apart rather than the instant, because two
      // stills of one second are two rows.
      const from = held?.items[0]?.capturedAt ?? span.startsAt;
      const fresh: Media[] = [];
      let cursor: string | null = null;

      for (let page = 0; page < MAX_FRAME_PAGES; page += 1) {
        const answer: MediaPage = await api.get<MediaPage>(
          `/cameras/${cameraId}/frames`,
          { startsAt: from, endsAt: span.endsAt, limit: FRAMES_PER_PAGE, cursor },
          signal,
        );
        fresh.push(...answer.items);
        cursor = answer.nextCursor;
        if (!cursor) break;
      }

      if (!held) return { items: fresh, partial: cursor !== null };

      const known = new Set(held.items.map(one => one.id));

      // A day the first walk never reached the end of stays a floor, because
      // the tail says nothing about the morning it stopped short of.
      return { items: [...fresh.filter(one => !known.has(one.id)), ...held.items], partial: held.partial || cursor !== null };
    },
    refetchInterval: CAMERAS_REFRESH_MS,
  });
};

/** A screenful of films, which is also the largest page the composer's own list needs. */
export const TIMELAPSES_PER_PAGE = 20;

/**
 * The films of one camera, newest first and continued by the cursor the route
 * hands out. A camera that has been filming for a season has hundreds of them,
 * and a list that read one page and drew three of it was a season of somebody's
 * own timelapses with no route to them at all.
 */
export const useTimelapses = (cameraId: string) =>
  useReadPages({
    queryKey: ['camera', cameraId, 'timelapses'],
    queryFn: ({ pageParam, signal }) =>
      api.get<MediaPage>(`/cameras/${cameraId}/timelapses`, { limit: TIMELAPSES_PER_PAGE, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: last => last.nextCursor,
  });

/** One media row, polled while its render is still going and left alone once it is not. */
export const useMedia = (mediaId: string | null) =>
  useRead({
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
 *
 * Either answer leaves the camera in a state this app is behind on: a press
 * that worked stored a still that belongs on the frame and in the day's count,
 * and one that failed is the reason the page prints above the picture. So the
 * camera's row, the day being walked and the newest still are all asked again -
 * a press that stored a picture and changed nothing on the screen was
 * indistinguishable from a press that did nothing at all. The films are left
 * alone: no capture makes one, and that read is a walk of every page somebody
 * has opened.
 */
export const useTestCapture = (cameraId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<TestCaptureAnswer>(`/cameras/${cameraId}/test-captures`, undefined, CAPTURE_WAIT_MS),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        predicate: query => {
          const [what, id, part] = query.queryKey as [string, string | undefined, string | undefined];
          return what === 'camera' && id === cameraId && part !== 'timelapses';
        },
      }),
  });
};

/** A picture from a camera named as the request is made, for the same reason `useAmendCamera` exists. */
export const useCaptureOnce = () =>
  useMutation({ mutationFn: (cameraId: string) => api.post<TestCaptureAnswer>(`/cameras/${cameraId}/test-captures`, undefined, CAPTURE_WAIT_MS) });

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
