import type { Device } from '@fg2/shared-types/v1';

/**
 * Which of an account's hardware can carry a camera.
 *
 * Both tabs that ask need the same answer: the knob that pairs a Terp Cam is on
 * a controller, and the tunnel an RTSP stream is pulled through is a
 * controller's too. Every other type stands in a tent without offering the
 * network a way in, so a fridge module in the same place is not a way to reach
 * a camera even though it is a device standing there.
 */
export const controllersOf = (devices: Device[], spaceId?: string): Device[] =>
  devices.filter(device => device.type === 'controller' && (spaceId === undefined || device.spaceId === spaceId));
