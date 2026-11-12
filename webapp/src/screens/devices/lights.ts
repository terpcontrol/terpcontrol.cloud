import type { DateTime } from 'luxon';
import { useMemo, useSyncExternalStore } from 'react';
import type { Device, DeviceCapabilities, DeviceConfiguration, SocketRole } from '@fg2/shared-types/v1';
import { figureAt, finiteOrNull, sectionOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import type { OutputLevel } from '@/api/devices';
import { isAhead } from '@/ui/age';
import { readStored, writeStored } from '@/ui/stored';
import type { Held } from './HandHold';

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
const LIGHT_ROLES: readonly SocketRole[] = ['light', 'secondary_light'];

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

/** Whether this document is a Light's, which states its brightness at the top rather than in a section. */
const statesFlat = (configuration: DeviceConfiguration, type: Device['type']): boolean =>
  type === 'light' || (typeof configuration[FIELD] === 'number' && sectionOf(configuration, SECTION) === null);

const lightLimitOf = (configuration: DeviceConfiguration | null, type: Device['type']): number | null => {
  if (!configuration) return null;
  return statesFlat(configuration, type) ? finiteOrNull(configuration[FIELD]) : figureAt(configuration, `${SECTION}.${FIELD}`);
};

/**
 * The controller's own light output, as its row is drawn from it.
 *
 * `level` is a reading: a lamp set to 60 % is dark at night all the same, and
 * only the reading can tell a grower which of the two the tent is in. The
 * device acknowledges neither a setting nor an override, so what it reports
 * is the only thing here that is a fact about the hardware.
 */
export interface LightOutput {
  deviceId: string;
  level: OutputLevel | null;
  /** The kind of device, which decides whether any build of it holds its light on command. */
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
  if (!capabilities.lightOverride && lightLimitOf(device.configuration, device.type) === null && level === null) return null;

  return { deviceId: device.id, level, type: device.type, takesOverride: capabilities.lightOverride };
};

/** "40 %", and "0 %" rather than "off": a lamp at nothing is the output doing nothing, which is what the number says. */
export const percentLabel = (percent: number): string => `${Math.round(percent)} %`;

/**
 * The hold of a light output last asked for from this browser, until its time
 * is up. The device reports no hold of its own lamp back, so this is what was
 * sent and never what the lamp does - and another browser knows nothing of it.
 * Whoever says that a light is held by hand reads it here and nowhere else.
 */
const HOLD_KEY = (deviceId: string) => `terp.lightHold.${deviceId}`;

/** What a browser that keeps nothing was told, for as long as the page lives. */
const unkept = new Map<string, string>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Keeps the hold a light output was just asked for, or forgets it once the output was handed back. */
export const rememberLightHold = (deviceId: string, hold: Held | null) => {
  const raw = hold ? JSON.stringify(hold) : null;
  writeStored(HOLD_KEY(deviceId), raw);
  if (raw === null || readStored(HOLD_KEY(deviceId)) === raw) unkept.delete(deviceId);
  else unkept.set(deviceId, raw);
  for (const listener of listeners) listener();
};

const rawHold = (deviceId: string): string | null => readStored(HOLD_KEY(deviceId)) ?? unkept.get(deviceId) ?? null;

export const useLightHold = (deviceId: string, now: DateTime): Held | null => {
  const raw = useSyncExternalStore(
    subscribe,
    () => rawHold(deviceId),
    () => null,
  );
  const held = useMemo(() => heldIn(raw), [raw]);

  return held && isAhead(held.until, now) ? held : null;
};

/** The holds of several devices' light outputs, by device: for a line that says what a whole place drives. */
export const useLightHolds = (deviceIds: readonly string[], now: DateTime): ReadonlyMap<string, Held> => {
  const ids = deviceIds.join(' ');
  const raw = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(ids.split(' ').map(rawHold)),
    () => '[]',
  );

  return useMemo(() => {
    const said = JSON.parse(raw) as (string | null)[];
    const holds = ids.split(' ').map((id, index) => [id, heldIn(said[index] ?? null)] as const);
    return new Map(holds.filter((hold): hold is readonly [string, Held] => hold[1] !== null && isAhead(hold[1].until, now)));
  }, [ids, raw, now]);
};

const heldIn = (raw: string | null): Held | null => {
  try {
    const { state, until } = (JSON.parse(raw ?? '{}') ?? {}) as Partial<Record<keyof Held, unknown>>;
    return (state === 'on' || state === 'off') && typeof until === 'string' ? { state, until } : null;
  } catch {
    return null;
  }
};
