import type { Device, Space } from '@fg2/shared-types/v1';
import { enough } from '@/ui/session-access';
/**
 * The places a device can stand in: a device is moved into a place, which is
 * managing that place - the server asks for `manage` on the destination as
 * well as on the device - and a room groups other places rather than holding
 * hardware, so nothing stands in one.
 */
export const placesFor = (spaces: Space[]): Space[] => spaces.filter(space => space.kind !== 'room' && enough(space.youMay, 'manage'));

/** Whether there is a place other than the one it stands in that the device could be moved to. */
export const movesAnywhere = (spaces: Space[], device: Device): boolean => placesFor(spaces).some(space => space.id !== device.spaceId);
