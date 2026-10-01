import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { CameraPage, DevicePage, LayoutSeen } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { useHomeShape } from '@/api/home';
import { useDiaryAnswer } from '@/api/layers';
import { useSession } from '@/api/session';
import { isPlace } from '@/app/places';

/**
 * What the navigation is drawn from: whether the diary is laid over the
 * climate, how many places Start lists, and how many devices the account has.
 *
 * Each of these is somebody else's read, followed rather than polled - the
 * navigation needs the count and not the figures - and none of them is there
 * on the first frame. A bar that drew its guess and then jumped by a tab once
 * the answers came was the app rearranging itself under a thumb, so the last
 * shape this browser saw for this account stands in until they have.
 */
export interface Shape {
  diary: boolean;
  places: number;
  devices: number;
}

/** What an account nothing is known about yet is drawn as: one device, no diary - the customer the app is designed for. */
const FIRST: Shape = { diary: false, places: 1, devices: 1 };

const QUIET = { refetchInterval: false, staleTime: 5 * 60_000 } as const;

const keyOf = (userId: string) => `terp.shape.${userId}`;

const remembered = (userId: string | null): Shape => {
  if (!userId) return FIRST;
  try {
    const raw = localStorage.getItem(keyOf(userId));
    return raw ? { ...FIRST, ...(JSON.parse(raw) as Partial<Shape>) } : FIRST;
  } catch {
    return FIRST;
  }
};

const remember = (userId: string, shape: string) => {
  try {
    localStorage.setItem(keyOf(userId), shape);
  } catch {
    // Private mode: the next first frame is drawn from the first guess, which is no worse.
  }
};

export const useShape = (): Shape & { ready: boolean } => {
  const { user } = useSession();
  const signedIn = user !== null;
  const home = useHomeShape(signedIn);
  const diary = useDiaryAnswer();
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: ({ signal }) => api.get<DevicePage>('/devices', undefined, signal),
    ...QUIET,
    enabled: signedIn,
  });
  const cameras = useQuery({
    queryKey: ['cameras', null],
    queryFn: ({ signal }) => api.get<CameraPage>('/cameras', undefined, signal),
    ...QUIET,
    enabled: signedIn,
  });

  const known: Shape | null =
    home.data && diary !== undefined && devices.data && cameras.data
      ? { diary, places: home.data.spaces.filter(isPlace).length, devices: devices.data.items.length + cameras.data.items.length }
      : null;
  const userId = user?.id ?? null;
  const written = known ? JSON.stringify(known) : null;

  useEffect(() => {
    if (userId && written) remember(userId, written);
  }, [userId, written]);

  return known ? { ...known, ready: true } : { ...remembered(userId), ready: false };
};

/**
 * What came in since the shape last shown: the diary, a second place, or both.
 * Nothing where no shape was ever recorded - nothing changed for somebody seen
 * for the first time - and nothing for what went away, which the person did.
 */
export const newsOf = (seen: LayoutSeen | null, now: LayoutSeen): LayoutSeen | null => {
  if (seen === null) return null;
  const news = { diary: now.diary && !seen.diary, places: now.places && !seen.places };
  return news.diary || news.places ? news : null;
};
