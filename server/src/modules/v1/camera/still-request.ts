/**
 * Asking a controller for a still. The command, its topic and its payload belong
 * to the frozen device protocol, so the camera pipeline names only what it wants
 * and the protocol module (`DevicePublisherService.captureStill`) does the
 * asking.
 */
export interface StillRequestPort {
  /** False where the broker connection is down, which is a camera that cannot be reached rather than an error. */
  captureStill(deviceId: string): boolean;
}

export const STILL_REQUEST = 'camera:still-request';
