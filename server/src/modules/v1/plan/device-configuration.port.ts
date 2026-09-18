import type { DeviceConfiguration } from '@fg2/shared-types/v1';

/**
 * Putting a device on the settings a plan step carries.
 *
 * What goes over the wire is the frozen device protocol - snake_case keys, the
 * device's own configuration document, its topics - and one module speaks it.
 * The plan hands over what the step stored and learns whether it changed
 * anything. Implemented by the device-protocol slice and bound to this token.
 */
export interface DeviceConfigurationWriter {
  /**
   * Merges the step's settings into the device's configuration, stores it and
   * sends it. A step that carries the whole document therefore replaces it, which
   * is what the plan screen has always written. True when something changed.
   */
  applyConfiguration(deviceId: string, settings: DeviceConfiguration): Promise<boolean>;
}

export const DEVICE_CONFIGURATION_WRITER = Symbol('DeviceConfigurationWriter');
