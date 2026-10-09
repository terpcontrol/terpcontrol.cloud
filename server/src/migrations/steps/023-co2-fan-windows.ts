import type { DeviceConfiguration } from '@fg2/shared-types/v1';
import { co2FanOf, co2InjectFor, co2PlugOf } from '@fg2/shared-types/v1-schemas/configuration-fields.js';
import { MigrationContext, MigrationStep } from '../migration';

const DEVICES = 'devices';

type Row = { id?: unknown; type?: unknown; configuration?: unknown; scheduleClock?: unknown };

/** What a fan is to be told: the section its socket's document makes, and the clock that socket's times are kept on. */
type Told = { plugId: string; section: Record<string, unknown>; scheduleClock: unknown };

const isDocument = (value: unknown): value is DeviceConfiguration => typeof value === 'object' && value !== null && !Array.isArray(value);

const same = (one: unknown, other: unknown): boolean => JSON.stringify(one) === JSON.stringify(other);

/**
 * Writes every AIR fan coupled to a smart socket's CO2 the section the server
 * writes it from the socket's document now (`co2InjectFor`), as a save of the
 * socket would.
 *
 * The old app wrote the fan's `co2inject` itself, with the socket's day and
 * night read from where its form never kept them - so they were left out, and
 * the fan took its compile-time 06:00-22:00 UTC. A socket that doses "only by
 * day" from 20:00 to 08:00 had its fan slowed from 08:00 to midnight instead:
 * through the dark, when nothing is dosed, and not in the hours that are. The
 * app also cleared the fan before writing it and did not wait for the one to
 * land before the other, so a fan could be left uncoupled while its socket
 * still named it. Both last until the socket is saved again in the new app; a
 * grower who set it up once has no reason to.
 *
 * - A fan its socket names gets the socket's windows, day and speed - or an
 *   empty section where the socket does not dose in windows. Where two sockets
 *   name one fan, the one that doses in windows wins, then the first by id.
 * - A fan that names a socket which does not name it back is told it is slowed
 *   for nothing.
 * - The fan's times are kept on the socket's clock, since they are the socket's.
 *
 * The device is sent the new document the next time it asks for one, as it
 * always is. Reads the new collections and moves nothing aside. A fan that
 * already says what this writes is left alone, so a repeated run writes nothing.
 */
export const co2FanWindows: MigrationStep = {
  name: '023-co2-fan-windows',

  async run(context: MigrationContext): Promise<void> {
    const told = new Map<string, Told>();
    const plugs = context.db
      .collection<Row>(DEVICES)
      .find({ type: 'plug' }, { projection: { id: 1, configuration: 1, scheduleClock: 1 } })
      .sort({ id: 1 });
    for await (const plug of plugs) {
      if (typeof plug.id !== 'string' || !isDocument(plug.configuration)) continue;
      const coupling = co2FanOf(plug.configuration);
      if (!coupling) continue;

      const section = co2InjectFor(plug.id, plug.configuration, coupling.speed);
      const earlier = told.get(coupling.fanId);
      if (earlier) {
        context.count('fans.namedTwice');
        if (Object.keys(earlier.section).length > 0 || Object.keys(section).length === 0) continue;
      }
      told.set(coupling.fanId, { plugId: plug.id, section, scheduleClock: plug.scheduleClock ?? null });
    }

    const fans = context.db.collection<Row>(DEVICES).find({ type: 'fan' }, { projection: { id: 1, configuration: 1, scheduleClock: 1 } });
    for await (const fan of fans) {
      // A fan that never sent its settings has nothing to write the section into, as at a save of the socket.
      if (typeof fan.id !== 'string' || !isDocument(fan.configuration)) continue;

      const wanted =
        told.get(fan.id) ?? (co2PlugOf(fan.configuration) ? { plugId: null, section: {}, scheduleClock: fan.scheduleClock ?? null } : null);
      if (!wanted) continue;

      // Through JSON, as the server stores what it sends: a socket without a day leaves the key out rather than storing it empty.
      const section = JSON.parse(JSON.stringify(wanted.section)) as Record<string, unknown>;
      if (same(fan.configuration.co2inject ?? {}, section)) continue;

      context.count(wanted.plugId === null ? 'fans.uncoupled' : Object.keys(section).length > 0 ? 'fans.windowsWritten' : 'fans.notSlowed');
      await context.write(DEVICES, {
        id: fan.id,
        configuration: { ...fan.configuration, co2inject: section },
        ...(Object.keys(section).length > 0 ? { scheduleClock: wanted.scheduleClock } : {}),
      });
    }

    await context.flushAll();
  },
};
