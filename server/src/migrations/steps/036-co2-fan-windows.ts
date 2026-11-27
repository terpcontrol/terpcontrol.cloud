import type { DeviceConfiguration } from '@fg2/shared-types/v1';
import { co2FanOf, co2InjectFor, co2PlugOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { keepsTime } from '@modules/device-protocol/schedule-clock';
import { MigrationContext, MigrationStep } from '../migration';

const DEVICES = 'devices';

type Row = { id?: unknown; configuration?: unknown; scheduleClock?: unknown };

/** What a fan is to be told: the section its socket's document makes, and the clock that socket's times are kept on. */
type Told = { plugId: string | null; section: Record<string, unknown>; scheduleClock: unknown };

const isDocument = (value: unknown): value is DeviceConfiguration => typeof value === 'object' && value !== null && !Array.isArray(value);

const same = (one: unknown, other: unknown): boolean => JSON.stringify(one) === JSON.stringify(other);

const isEmpty = (section: Record<string, unknown>): boolean => Object.keys(section).length === 0;

/**
 * Writes every AIR fan slowed for a smart socket's CO2 the section the server
 * writes it from the socket's document (`co2InjectFor`), as a save of the
 * socket does (`followCo2Fan`).
 *
 * The pre-rewrite app wrote the fan's `co2inject` itself and read the socket's
 * day and night from where its form never kept them, so both were left out and
 * the fan took its compile-time 06:00-22:00 UTC. A socket dosing "only by day"
 * from 20:00 to 08:00 had its fan slowed from 08:00 to midnight instead -
 * through the dark, when nothing is dosed, and not in the hours that are. The
 * app also cleared the fan before writing it without waiting for the one to
 * land before the other, so a fan could be left uncoupled while its socket
 * still named it. Both last until the socket is saved again, and a grower who
 * set it up once has no reason to.
 *
 * - A fan its socket names gets the socket's windows, day and speed, or an
 *   empty section where the socket does not dose in windows. Where two sockets
 *   name one fan, the one that doses in windows wins, then the first by id.
 * - A fan naming a socket that does not name it back is told it is slowed for
 *   nothing.
 * - The times are the socket's, so the fan keeps them on the socket's clock.
 *
 * The device is sent the new document the next time it asks for one. A fan
 * that never sent its settings is left alone, as at a save of the socket, and
 * so is one that already says what this writes, so a second run writes
 * nothing. Reads the new `devices` and moves nothing aside.
 */
export const co2FanWindows: MigrationStep = {
  name: '036-co2-fan-windows',

  async run(context: MigrationContext): Promise<void> {
    const devices = context.db.collection<Row>(DEVICES);
    const told = new Map<string, Told>();

    const plugs = devices.find({ type: 'plug' }, { projection: { id: 1, configuration: 1, scheduleClock: 1 } }).sort({ id: 1 });
    for await (const plug of plugs) {
      if (typeof plug.id !== 'string' || !isDocument(plug.configuration)) continue;
      const coupling = co2FanOf(plug.configuration);
      if (!coupling) continue;

      const section = co2InjectFor(plug.id, plug.configuration, coupling.speed);
      const earlier = told.get(coupling.fanId);
      if (earlier) {
        context.count('devices.fanNamedTwice');
        if (!isEmpty(earlier.section) || isEmpty(section)) continue;
      }
      told.set(coupling.fanId, { plugId: plug.id, section, scheduleClock: plug.scheduleClock ?? null });
    }

    const fans = devices.find({ type: 'fan' }, { projection: { id: 1, configuration: 1, scheduleClock: 1 } });
    for await (const fan of fans) {
      if (typeof fan.id !== 'string' || !isDocument(fan.configuration)) continue;

      const wanted: Told | null = told.get(fan.id) ?? (co2PlugOf(fan.configuration) ? { plugId: null, section: {}, scheduleClock: null } : null);
      if (!wanted) continue;

      // Through JSON, as the server stores what it sends: a socket without a day leaves the key out rather than storing it undefined.
      const section = JSON.parse(JSON.stringify(wanted.section)) as Record<string, unknown>;
      if (same(fan.configuration.co2inject ?? {}, section)) continue;

      const configuration = { ...fan.configuration, co2inject: section };
      context.count(wanted.plugId === null ? 'devices.fanLetGo' : isEmpty(section) ? 'devices.fanNotSlowed' : 'devices.fanWindowWritten');
      await context.write(DEVICES, {
        id: fan.id,
        configuration,
        scheduleClock: keepsTime(configuration) ? (isEmpty(section) ? (fan.scheduleClock ?? null) : wanted.scheduleClock) : null,
      });
    }

    await context.flushAll();
  },
};
