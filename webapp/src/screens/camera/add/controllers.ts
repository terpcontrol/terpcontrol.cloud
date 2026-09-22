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

/**
 * What to call one in a sentence. A claim names a device after its type where
 * nobody has named it yet, and a type is a key rather than a word, so a line
 * saying which controller a stream is pulled through has to turn it into one
 * or it reads as lowercase English in the German app.
 */
export const controllerName = (device: Device, t: (key: string, options?: Record<string, unknown>) => string): string =>
  device.name && device.name !== device.type ? device.name : t(`devices.type.${device.type}`, { defaultValue: device.type });
