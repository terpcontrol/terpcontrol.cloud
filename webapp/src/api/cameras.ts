import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Camera, CameraPage, CameraUpdate, Media, MediaPage, TestCaptureAnswer, TimelapseAccepted, TimelapseCreate } from '@fg2/shared-types/v1';
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

export const useCamera = (cameraId: string) =>
  useQuery({
    queryKey: ['camera', cameraId],
    queryFn: ({ signal }) => api.get<Camera>(`/cameras/${cameraId}`, undefined, signal),
    refetchInterval: CAMERAS_REFRESH_MS,
  });

/**
 * The stills of one camera inside a span, newest first as the route answers
 * them. The day scrubber walks this list rather than asking per position: the
 * frames of a day are a few hundred rows and one read.
 */
export const useCameraFrames = (cameraId: string, span: { startsAt: string; endsAt: string }, limit = 400) =>
  useQuery({
    queryKey: ['camera', cameraId, 'frames', span.startsAt, span.endsAt, limit],
    queryFn: ({ signal }) => api.get<MediaPage>(`/cameras/${cameraId}/frames`, { ...span, limit }, signal),
  });

export const useTimelapses = (cameraId: string) =>
  useQuery({
    queryKey: ['camera', cameraId, 'timelapses'],
    queryFn: ({ signal }) => api.get<MediaPage>(`/cameras/${cameraId}/timelapses`, { limit: 20 }, signal),
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

/**
 * One picture now. A camera that could not be read answers the reason it gave
 * rather than an error, because a wrong address is an ordinary outcome of this
 * button and the reason is what the person needs to see.
 */
export const useTestCapture = (cameraId: string) =>
  useMutation({ mutationFn: () => api.post<TestCaptureAnswer>(`/cameras/${cameraId}/test-captures`) });

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
