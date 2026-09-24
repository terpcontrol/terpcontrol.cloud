import type { Device, DeviceCapabilities, DeviceConfiguration, SocketRole } from '@fg2/shared-types/v1';
import type { OutputLevel } from '@/api/devices';

/**
 * The two different things that light a tent, which one screen has to keep
 * apart.
 *
 * The controller drives its lamp itself, on a PWM channel, and reports what it
 * is doing as a percentage: it is dimmable, it ramps through sunrise and sunset,
 * and the brightness it runs at is a key of its own configuration document
 * rather than anything a command carries. A light socket is a plug with a role,
 * on or off and nothing between; it follows the output whenever the output is
 * above zero, unless an override of its own is holding it.
 *
 * So the output takes a level and the plugs take a switch, and neither control
 * can stand in for the other.
 */

/** The roles whose sockets follow the controller's light output, and so belong beside it. */
export const LIGHT_ROLES: readonly SocketRole[] = ['light', 'secondary_light'];

export const isLightRole = (role: SocketRole): boolean => LIGHT_ROLES.includes(role);

/**
 * Where a device states the brightness it runs its lamp at, as a percentage of
 * the lamp's own maximum. The firmware caps the light curve with it, so it is a
 * ceiling and not a dimmer knob: the lamp still ramps up at sunrise and is dark
 * at night, and this is how bright it gets in between.
 *
 * The controller and the fridge keep it in a `lights` section, and a client
 * that once wrote it dotted meant the same thing, so both are read - exactly as
 * the server reads a setpoint out of the same document. A Light keeps it at the
 * top of its document as `limit`, and reads nothing else: a brightness written
 * into a section there is a key the lamp never looks at.
 */
const SECTION = 'lights';
const FIELD = 'limit';

/** What the controller's own display offers, so a level set here is one a person could have dialled in on the device. */
export const LEVEL_STEP = 5;

const sectionOf = (configuration: DeviceConfiguration, name: string): Record<string, unknown> | null => {
  const value = configuration[name];
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
};

/** Whether this document is a Light's, which states its brightness at the top rather than in a section. */
const statesFlat = (configuration: DeviceConfiguration, type: Device['type']): boolean =>
  type === 'light' || (typeof configuration[FIELD] === 'number' && sectionOf(configuration, SECTION) === null);

export const lightLimitOf = (configuration: DeviceConfiguration | null, type: Device['type']): number | null => {
  if (!configuration) return null;
  const value = statesFlat(configuration, type)
    ? configuration[FIELD]
    : (sectionOf(configuration, SECTION)?.[FIELD] ?? configuration[`${SECTION}.${FIELD}`]);

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/**
 * The document to send for a new brightness.
 *
 * Everything else the device is running is kept, because the route replaces
 * the document whole: the ramps, the day window and the dehumidifier's timing
 * are the tent's own tuning, and a save that dropped them would be a change
 * nobody asked for. The dotted spelling is removed where it was used, so one
 * document never states the same figure twice.
 */
export const withLightLimit = (configuration: DeviceConfiguration, type: Device['type'], percent: number): DeviceConfiguration => {
  if (statesFlat(configuration, type)) return { ...configuration, [FIELD]: percent };

  const next: DeviceConfiguration = { ...configuration };
  delete next[`${SECTION}.${FIELD}`];
  next[SECTION] = { ...(sectionOf(configuration, SECTION) ?? {}), [FIELD]: percent };

  return next;
};

/**
 * The controller's own light output, as its row is drawn from it.
 *
 * `level` is a reading and `limitPercent` a setting, and the row says both: a
 * lamp set to 60 % is dark at night all the same, and only the reading can tell
 * a grower which of the two the tent is in. The device acknowledges neither a
 * setting nor an override, so what it reports is the only thing here that is a
 * fact about the hardware.
 */
export interface LightOutput {
  deviceId: string;
  level: OutputLevel | null;
  limitPercent: number | null;
  /** What a new brightness is written into. Null where the device has never sent its settings, which is nothing to write back. */
  configuration: DeviceConfiguration | null;
  /** Which document shape the brightness is written in. */
  type: Device['type'];
  /** Whether the build announced that it holds its own light output on command. */
  takesOverride: boolean;
}

/**
 * The light output of one device, or null where nothing says it drives one.
 *
 * Three witnesses, in the order they are worth: a build that announced the
 * override drives a light, a stored configuration that states a brightness is a
 * device that has one, and a level that has been reported is the lamp itself. A
 * device type is deliberately not one of them - the set of types grows with the
 * hardware, and a plug that one day gained a dimmed output would be missed.
 */
export const lightOutputOf = (device: Device, capabilities: DeviceCapabilities, level: OutputLevel | null): LightOutput | null => {
  const limitPercent = lightLimitOf(device.configuration, device.type);
  if (!capabilities.lightOverride && limitPercent === null && level === null) return null;

  return {
    deviceId: device.id,
    level,
    limitPercent,
    configuration: device.configuration,
    type: device.type,
    takesOverride: capabilities.lightOverride,
  };
};

/** "40 %", and "0 %" rather than "off": a lamp at nothing is the output doing nothing, which is what the number says. */
export const percentLabel = (percent: number): string => `${Math.round(percent)} %`;
