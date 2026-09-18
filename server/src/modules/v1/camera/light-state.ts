/**
 * Whether a controller's light is on right now, which is the one thing outside
 * this module that `nightOff` needs to know. The reading lives in the series
 * store, so the device part provides this; until something does, `nightOff`
 * skips nothing - a camera keeps taking pictures rather than stopping for a
 * night nobody can confirm.
 */
export interface LightStateReader {
  /** Null when nothing is known about that device's light, which is not the same as "off". */
  isLightOn(deviceId: string): Promise<boolean | null>;
}

export const LIGHT_STATE_READER = Symbol('LightStateReader');
