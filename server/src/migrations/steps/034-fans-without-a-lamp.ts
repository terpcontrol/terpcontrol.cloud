import { MigrationContext, MigrationStep } from '../migration';

const DEVICES = 'devices';

const FAN_WITH_A_LAMP = { type: 'fan', $or: [{ 'configuration.lights': { $exists: true } }, { 'configuration.daynight': { $exists: true } }] };

/**
 * Takes a lamp's sections out of every AIR fan's document.
 *
 * A fan states day and night targets, which drive its speed, and nothing about
 * a light: its firmware reads no `lights` and no `daynight`, and goes by its own
 * light sensor for day and night. A climate written to a place - a grow started
 * with a stage, a preset, a plan's phase - merged the preset's lamp limit and
 * light window into any document that stated targets, a fan's too, and
 * Steuerung then drew a light output the fan does not have. The server writes a
 * section only into a document that carries it now; this takes out what it
 * wrote before. A fan's own upload never carries them, so a second run finds
 * nothing. Reads the new `devices` and moves nothing aside.
 */
export const fansWithoutALamp: MigrationStep = {
  name: '034-fans-without-a-lamp',

  async run(context: MigrationContext): Promise<void> {
    const devices = context.db.collection(DEVICES);
    const carrying = await devices.countDocuments(FAN_WITH_A_LAMP);
    context.count('devices.fanLampSectionsRemoved', carrying);
    if (context.dryRun || carrying === 0) return;

    await devices.updateMany(FAN_WITH_A_LAMP, { $unset: { 'configuration.lights': '', 'configuration.daynight': '' } });
  },
};
