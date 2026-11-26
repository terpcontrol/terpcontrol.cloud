import { MigrationContext, MigrationStep } from '../migration';

/**
 * Gives the phases a person set on a climate preset to that person.
 *
 * A phase entered with a climate - a grow started on "Sämling · mit Licht",
 * flowering entered with its climate, a climate preset applied to the place -
 * was stored as `source: 'preset'` with nobody as `setBy`, and the app reads a
 * phase that is not `human` as one the device or the plan wrote by itself:
 * "von allein" in the grow's head, under "Bisherige Phasen" and on its line of
 * the diary. Every one of them was a person's tap - a plan writes `plan` - so
 * each becomes `human`, and its line in the diary with it. Who tapped was not
 * stored, so the person is the grow's owner, as the grows carried over from the
 * old cloud name their owner for every phase somebody set.
 *
 * A grow whose owner is not known is left as it is. Reads the new collections
 * and moves nothing aside.
 */
export const handSetPhases: MigrationStep = {
  name: '031-hand-set-phases',

  async run(context: MigrationContext): Promise<void> {
    const grows = context.db.collection('grows');
    const entries = context.db.collection('entries');
    const set = await grows
      .find({ ownerId: { $type: 'string' }, phases: { $elemMatch: { source: 'preset' } } }, { projection: { id: 1, ownerId: 1, phases: 1 } })
      .toArray();

    for (const grow of set) {
      const ownerId = grow.ownerId as string;
      const phases = grow.phases as { id: string; source: string; setBy?: string | null }[];
      const preset = phases.filter(phase => phase.source === 'preset').map(phase => phase.id);
      const lines = { growId: grow.id, source: 'preset', 'values.kind': 'phase', 'values.phaseId': { $in: preset } };
      context.count('phases.givenToTheirPerson', preset.length);
      context.count('entries.givenToTheirPerson', await entries.countDocuments(lines));
      if (context.dryRun) continue;

      await grows.updateOne(
        { id: grow.id },
        {
          $set: {
            phases: phases.map(phase => (phase.source === 'preset' ? { ...phase, source: 'human', setBy: phase.setBy ?? ownerId } : phase)),
          },
        },
      );
      await entries.updateMany(lines, [{ $set: { source: 'human', authorId: { $ifNull: ['$authorId', ownerId] } } }]);
    }
  },
};
