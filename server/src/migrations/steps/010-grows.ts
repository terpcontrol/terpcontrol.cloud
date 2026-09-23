import { derivedId } from '../ids';
import { LEGACY } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';
import { loadDeviceFacts } from '../device-facts';
import { reconstructGrows, slugOf } from '../grow-cycles';
import { measurementNamesIn } from '../measurements';

/**
 * The grows, read back out of the lifecycle entries by the rule the grow report
 * draws with today (`grow-cycles.ts`).
 *
 * What a reconstructed grow cannot know, decided here:
 *
 * - **It has no plants.** None were ever recorded: the old diary knew a strain
 *   name and a stage, never how many plants there were or which of them a note
 *   was about. A count invented here would be a number nobody wrote.
 * - **It is a `photoperiod`.** Nothing recorded the type, and the stage sequence
 *   the old diary logged is the photoperiod one.
 * - **It is private and gets a slug anyway.** The slug is fixed at creation and
 *   never changes, so it is made now rather than the first time somebody makes a
 *   grow public; it is the grow's name with the head of its id behind it, which
 *   is unique because the id is.
 * - **One placement, in the space its device became.** The grow stood wherever
 *   the controller was, for as long as the cycle ran, and nothing else was ever
 *   recorded about where it was.
 * - **Every phase is `human` except a plan's.** The old lifecycle entry does not
 *   say who wrote it, and a person picking the stage is what wrote nearly all of
 *   them; a grow reconstructed from a running plan alone says `plan`, which is
 *   what makes the "auto" tag right for it.
 * - **The eight measurement definitions** the old diary had as fixed fields, so
 *   the readings its entries carried have something to be keyed by.
 */
export const grows: MigrationStep = {
  name: '010-grows',
  moves: [LEGACY.devices, LEGACY.deviceLogs],

  async run(context: MigrationContext): Promise<void> {
    const facts = await loadDeviceFacts(context);
    const reconstructed = await reconstructGrows(context, facts, { report: true });

    for (const [deviceId, cycles] of reconstructed) {
      // Every reconstructed grow has an owner: the reconstruction leaves out the
      // devices that never had one.
      const fact = facts.get(deviceId);
      if (!fact?.ownerId) continue;

      for (const grow of cycles) {
        context.count('grows.read');

        await context.write('grows', {
          id: grow.id,
          ownerId: fact.ownerId,
          name: grow.name,
          description: null,
          type: 'photoperiod',
          phases: grow.phases.map(phase => ({
            id: phase.id,
            stage: phase.stage,
            preset: null,
            startedAt: phase.startedAt,
            source: phase.source,
            // Null is every plant of the grow, which is every reconstructed one:
            // a migrated grow has no plants to scope a phase to.
            plantIds: null,
            deviceId,
            // Influx never stored setpoints, and the configuration on the device
            // is today's rather than the phase's, so a past phase has no targets.
            targets: null,
            setBy: phase.source === 'human' ? fact.ownerId : null,
          })),
          placements: [
            {
              id: derivedId('placement', grow.id),
              spaceId: fact.spaceId,
              startedAt: grow.startedAt,
              endedAt: grow.endedAt,
              plantIds: null,
            },
          ],
          scheme: null,
          measurements: measurementNamesIn(context.locale),
          visibility: 'private',
          slug: slugOf(grow),
          coverMediaId: null,
          filmMediaId: null,
          startedAt: grow.startedAt,
          endedAt: grow.endedAt,
          isDemo: fact.isDemo,
          createdAt: grow.startedAt,
          updatedAt: grow.endedAt ?? context.at,
        });
      }
    }
  },
};
