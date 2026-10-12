import type { Space } from '@fg2/shared-types/v1';
import { enough } from '@/ui/session-access';
/**
 * The places a device can stand in: a device is moved into a place, which is
 * managing that place - the server asks for `manage` on the destination as
 * well as on the device - and a room groups other places rather than holding
 * hardware, so nothing stands in one.
 */
export const placesFor = (spaces: readonly Space[]): Space[] => spaces.filter(space => space.kind !== 'room' && enough(space.youMay, 'manage'));
