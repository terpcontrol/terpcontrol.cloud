import { skipToken, useQueries } from '@tanstack/react-query';
import type { DateTime } from 'luxon';
import { useMemo, useSyncExternalStore } from 'react';
import type { Device, DeviceCapabilities, DeviceConfiguration, SocketPage, SocketRole } from '@fg2/shared-types/v1';
import { figureAt, finiteOrNull, sectionOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { socketsKey, type OutputLevel } from '@/api/devices';
import { isAhead } from '@/ui/age';
import { outputsOf } from '@/ui/climate-hardware';
import { readStored, writeStored } from '@/ui/stored';
import type { Held } from './HandHold';

/**
 * The two things that light a tent, which one screen has to keep apart. The
 * controller drives its lamp itself and reports a percentage: it is dimmable,
 * ramps through sunrise and sunset, and its brightness is a key of its own
 * configuration document. A light socket is a plug with a role, on or off; it
 * follows the output whenever that is above zero, unless an override of its
 * own holds it. So the output takes a level and the plugs take a switch.
 */

/** The roles whose sockets follow the controller's light output, and so belong beside it. */
const LIGHT_ROLES: readonly SocketRole[] = ['light', 'secondary_light'];

export const isLightRole = (role: SocketRole): boolean => LIGHT_ROLES.includes(role);

/**
 * Where a device states the brightness it runs its lamp at, as a percentage of
 * the lamp's own maximum. The firmware caps the light curve with it, so it is
 * a ceiling and not a dimmer knob.
 *
 * The controller and the fridge keep it in a `lights` section - also where a
 * client wrote it dotted, as the server reads a setpoint. A Light keeps it at
 * the top of its document as `limit` and reads nothing else.
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
 * The controller's own light output, as its row is drawn from it. `level` is
 * a reading: a lamp set to 60 % is dark at night all the same. The device
 * acknowledges no setting; a build that announces `light_hold` reports the
 * override holding the output (`useLightHold`).
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
 * override drives a light, a level that has been reported is the lamp itself,
 * and a stored configuration that states a brightness is a device that has one
 * - where its kind of hardware drives a light at all (`outputsOf`). A document
 * is what the server wrote into it, too: an AIR fan once given a lamp's limit
 * by a climate meant for the place drew a light output it does not have.
 */
export const lightOutputOf = (device: Device, capabilities: DeviceCapabilities, level: OutputLevel | null): LightOutput | null => {
  const statesBrightness = lightLimitOf(device.configuration, device.type) !== null && outputsOf(device).includes('light');
  if (!capabilities.lightOverride && !statesBrightness && level === null) return null;

  return { deviceId: device.id, level, type: device.type, takesOverride: capabilities.lightOverride };
};

/** "40 %", and "0 %" rather than "off": a lamp at nothing is the output doing nothing, which is what the number says. */
export const percentLabel = (percent: number): string => `${Math.round(percent)} %`;

/**
 * The hold of a light output, until its time is up. A build that announces
 * `light_hold` reports it with its socket table, and then that is the answer,
 * in every browser. An older build reports none, so there it is the hold last
 * asked for from this browser - what was sent and never what the lamp does,
 * and another browser knows nothing of it. Whoever says that a light is held by
 * hand reads it here and nowhere else.
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
  const reported = useReportedHolds(deviceId ? [deviceId] : [], now).get(deviceId);

  if (reported !== undefined) return reported;
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

  const reported = useReportedHolds(deviceIds, now);

  return useMemo(() => {
    const said = JSON.parse(raw) as (string | null)[];
    const holds = ids.split(' ').map((id, index) => [id, reported.has(id) ? (reported.get(id) ?? null) : heldIn(said[index] ?? null)] as const);
    return new Map(holds.filter((hold): hold is readonly [string, Held] => hold[1] !== null && isAhead(hold[1].until, now)));
  }, [ids, raw, now, reported]);
};

/**
 * The holds the devices report, by device: null where nothing holds the
 * output, and no entry where the build reports none, which leaves the
 * browser's memory standing. Read from the socket tables a screen already
 * holds - never fetched for this alone, so a lamp module nobody reads a table
 * of costs nothing.
 */
const useReportedHolds = (deviceIds: readonly string[], now: DateTime): ReadonlyMap<string, Held | null> =>
  useQueries({
    queries: deviceIds.map(deviceId => ({ queryKey: socketsKey(deviceId), queryFn: skipToken as unknown as () => Promise<SocketPage> })),
    combine: results =>
      new Map(
        deviceIds.flatMap((deviceId, index) => {
          const table = results[index]?.data;
          if (!table?.capabilities?.lightHold || !table.lightHold) return [];
          const override = table.lightHold.override;
          const held: Held | null =
            override && override.state !== 'auto' && isAhead(override.validUntil, now) ? { state: override.state, until: override.validUntil } : null;
          return [[deviceId, held] as const];
        }),
      ),
  });

const heldIn = (raw: string | null): Held | null => {
  try {
    const { state, until } = (JSON.parse(raw ?? '{}') ?? {}) as Partial<Record<keyof Held, unknown>>;
    return (state === 'on' || state === 'off') && typeof until === 'string' ? { state, until } : null;
  } catch {
    return null;
  }
};
