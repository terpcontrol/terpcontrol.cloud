import type { AppliedClimate, DeviceConfiguration, GerminationChoices, GrowthStage } from '@fg2/shared-types/v1';
import type { AwaitedClimate } from '@database/schemas/v1/devices.schema';

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
   * is what the plan screen has always written. `stage` is the stage the step
   * is for: a drying one puts the device into its drying mode, and any other
   * switches a device that was off or drying back on. `choices` is what a
   * germination step does about the humidity, kept on the device, and
   * `applied` the climate the step writes, kept to name it by and followed by
   * the place's thresholds - null for a step that writes figures and names no
   * preset, which clears the name and puts the thresholds on its stage; left out
   * for a step that writes no climate, which leaves both. `by`, where given,
   * writes the diary line of the figures that moved, naming who moved them.
   * True when something changed.
   */
  applyConfiguration(
    deviceId: string,
    settings: DeviceConfiguration,
    stage?: GrowthStage | null,
    choices?: Partial<GerminationChoices>,
    applied?: AppliedClimate | null,
    by?: string | null,
  ): Promise<boolean>;

  /**
   * Keeps the lamp modules of a place dark while its climate germinates or dries and gives them their light back
   * after it (ADR 0007); `deviceIds` names a lamp that has just left for no place.
   */
  lampsFollow(spaceId: string | null, deviceIds?: readonly string[]): Promise<void>;

  /**
   * Puts devices that have not sent their settings yet on a climate preset as they arrive (`awaitedClimate`), and their
   * place's thresholds on it now: a climate waiting for a device is a climate written there.
   */
  awaitClimate(deviceIds: readonly string[], awaited: AwaitedClimate): Promise<void>;
}

export const DEVICE_CONFIGURATION_WRITER = Symbol('DeviceConfigurationWriter');
