/**
 * A device stood in a space, told to whoever keeps what a space is in.
 *
 * A tent may already be in a stage when a controller is claimed into it or
 * moved there, and the thresholds that stage binds are the phase writer's to
 * restate - the device slice knows only that the device now stands somewhere.
 *
 * Optional, like every port between two slices here: until something is bound to
 * this token a device is claimed and moved exactly as before, and its rules stay
 * as they were.
 */
export interface DevicePlacement {
  /** Restates on the device whatever the stage standing in the space implies. Never a reason to refuse the move. */
  restateThresholds(deviceId: string, spaceId: string): Promise<void>;
}

export const DEVICE_PLACEMENT = Symbol('DevicePlacement');
