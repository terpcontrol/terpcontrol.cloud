import { useQuery } from '@tanstack/react-query';
import type { CameraPage } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { useShape } from '@/app/shell/shape';

/** How a camera a controller pairs is named until somebody names it: "Terp Cam · B07171". */
const PAIRED = /^Terp Cam · [0-9A-Z]+$/;

/**
 * What a camera is called. A Terp Cam nobody has named carries the tag printed
 * on it, which tells two apart and nothing else: where it is the account's only
 * camera it is simply "Terp Cam", on the cockpit, the camera page, the photo
 * entry and the Timeline alike. A name somebody typed is theirs and is left
 * alone.
 */
export const cameraCalled = (name: string, only: boolean): string => (only && PAIRED.test(name) ? 'Terp Cam' : name);

export const useCameraCalled = (): ((name: string) => string) => {
  const { cameras } = useShape();
  return name => cameraCalled(name, cameras <= 1);
};

/** The same, from a camera's id alone, for a screen that holds the picture but not the camera. */
export const useCameraNamed = (): ((cameraId: string | null | undefined) => string) => {
  const called = useCameraCalled();
  const cameras = useQuery({
    queryKey: ['cameras', null],
    queryFn: ({ signal }) => api.get<CameraPage>('/cameras', undefined, signal),
    refetchInterval: false,
    staleTime: 5 * 60_000,
  });

  return cameraId => called(cameras.data?.items.find(camera => camera.id === cameraId)?.name ?? 'Terp Cam');
};
