import type { Camera, CameraTransport, Device } from '@fg2/shared-types/v1';

/**
 * How a stream camera is reached: the devices it can be pulled through, the
 * ways ffmpeg reads it, and whether an address already carries a login.
 */

/**
 * Every device standing in the place can carry the stream: the tunnel is part
 * of the firmware all of them share, so a fridge module is as much a way into
 * the home network as a controller - and for most growers the only one. A
 * device that is reporting comes first, because it is the one a test can
 * answer through.
 */
export const carriersOf = (devices: Device[], spaceId: string, live: (device: Device) => boolean): Device[] =>
  devices.filter(device => device.spaceId === spaceId).sort((one, other) => Number(live(other)) - Number(live(one)));

/** The device a stream camera is pulled through, or would be: the one it names, else the first standing where it looks. */
export const carrierOf = (camera: Pick<Camera, 'deviceId'>, here: Device[]): Device | null =>
  here.find(device => device.id === camera.deviceId) ?? here[0] ?? null;

/**
 * The ways ffmpeg reads RTSP, the everyday one first. A device's tunnel
 * carries TCP alone, so UDP is offered only to a stream the cloud opens itself.
 */
const TRANSPORTS: CameraTransport[] = ['tcp', 'http', 'https', 'udp'];

export const transportsFor = (tunnel: boolean): CameraTransport[] => TRANSPORTS.filter(one => !tunnel || one !== 'udp');

/** Whether an address was written with a login of its own, which then is the login. */
export const hasLogin = (url: string): boolean => {
  try {
    const parsed = new URL(url.trim());
    return parsed.username !== '' || parsed.password !== '';
  } catch {
    return false;
  }
};
