import { useEffect } from 'react';
import type { LayoutSeen } from '@fg2/shared-types/v1';
import { useCamerasShape } from '@/api/cameras';
import { useDevicesShape } from '@/api/devices';
import { useHomeShape } from '@/api/home';
import { useDiaryAnswer } from '@/api/layers';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { isPlace } from '@/app/places';
import { enough, mayWithOf } from '@/ui/session-access';
import { readStoredJson, writeStored } from '@/ui/stored';

/**
 * What the navigation is drawn from: whether the diary is laid over the
 * climate, how many places Start lists, whether the account has a device, a
 * device the session may steer, and how many cameras.
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
  /** Whether there is a device at all - a controller, a fridge module, a plug - rather than only cameras or nothing. */
  steering: boolean;
  /** Whether the session may manage one of those devices: a guest who may only log and the demo may not. */
  managed: boolean;
  cameras: number;
}

/** What an account nothing is known about yet is drawn as: one device, no diary - the customer the app is designed for. */
const FIRST: Shape = { diary: false, places: 1, steering: true, managed: true, cameras: 0 };

const keyOf = (userId: string) => `terp.shape.${userId}`;

const remembered = (userId: string | null): Shape => (userId ? { ...FIRST, ...readStoredJson<Partial<Shape>>(keyOf(userId)) } : FIRST);

/** Whether the account has a device, as this browser last saw it: what a page that could not be read still knows. */
export const useSteersAsLastSeen = (): boolean => remembered(useSession().user?.id ?? null).steering;

export const useShape = (): Shape & { ready: boolean } => {
  const { user } = useSession();
  const signedIn = user !== null;
  const home = useHomeShape(signedIn);
  const diary = useDiaryAnswer();
  const devices = useDevicesShape(signedIn);
  const cameras = useCamerasShape(signedIn);
  // What a member may do in somebody else's place is the place's answer, so the shape waits for the places too.
  const spaces = useSpaces(signedIn);
  const mayWith = mayWithOf(user, spaces.data?.items);

  const known: Shape | null =
    home.data?.spaces && diary !== undefined && devices.data?.items && cameras.data?.items && spaces.data
      ? {
          diary,
          places: home.data.spaces.filter(isPlace).length,
          steering: devices.data.items.length > 0,
          managed: devices.data.items.some(device => enough(mayWith(device), 'manage')),
          cameras: cameras.data.items.length,
        }
      : null;
  const userId = user?.id ?? null;
  const written = known ? JSON.stringify(known) : null;

  useEffect(() => {
    if (userId && written) writeStored(keyOf(userId), written);
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
