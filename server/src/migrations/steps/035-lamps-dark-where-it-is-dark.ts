import type { DeviceConfiguration } from '@fg2/shared-types/v1';
import { darkIn, hasWorkModes } from '@modules/device-protocol/work-modes';
import { MigrationContext, MigrationStep } from '../migration';

const DEVICES = 'devices';

interface Placed {
  id: string;
  type: string;
  spaceId: string | null;
  configuration: DeviceConfiguration | null;
  baseWorkmode?: string | null;
  limitBeforeDark?: number | null;
}

/**
 * Puts every lamp module to nothing that stands where the place germinates or dries, its brightness kept.
 *
 * Germination and drying are dark for every lamp of the place (ADR 0007), and the server darkens a lamp module as
 * either begins, as it joins a place in either and as it sends its first settings (`lampsFollow`). A place that was
 * germinating or drying before that was built had none of these happen: its lamp burnt on under "Keimung · dunkel",
 * and the page called its brightness one set since. This does once what `lampsFollow` does - `limit` 0 and the
 * brightness kept in `limitBeforeDark`, given back when the spell ends - for each lamp no spell has darkened yet; one
 * a spell darkened and somebody lit since keeps their brightness, as it would have. The lamp is handed the stored
 * document when it next connects (`fetch`), which a release's new broker makes every device do. A second run finds
 * every such lamp at nothing.
 */
export const lampsDarkWhereItIsDark: MigrationStep = {
  name: '035-lamps-dark-where-it-is-dark',

  async run(context: MigrationContext): Promise<void> {
    const devices = context.db.collection<Placed>(DEVICES);
    const climates = await devices
      .find({ spaceId: { $ne: null }, type: { $ne: 'light' } }, { projection: { id: 1, type: 1, spaceId: 1, configuration: 1, baseWorkmode: 1 } })
      .toArray();
    const dark = [
      ...new Set(
        climates.filter(one => hasWorkModes(one.type) && darkIn(one.type, one.configuration, one.baseWorkmode)).map(one => one.spaceId as string),
      ),
    ];
    const lit = await devices
      .find(
        { type: 'light', spaceId: { $in: dark }, 'configuration.limit': { $gt: 0 }, limitBeforeDark: { $in: [null, undefined] } },
        { projection: { id: 1, configuration: 1 } },
      )
      .toArray();
    context.count('devices.lampsDarkened', lit.length);
    if (context.dryRun) return;

    for (const lamp of lit) {
      await devices.updateOne(
        { id: lamp.id, 'configuration.limit': lamp.configuration?.limit },
        { $set: { 'configuration.limit': 0, limitBeforeDark: lamp.configuration?.limit } },
      );
    }
  },
};
