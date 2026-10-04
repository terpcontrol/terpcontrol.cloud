import { MigrationContext, MigrationStep } from '../migration';

const GROWS = 'grows';
const TARGET = 'measurements.target';

// A grow whose measurement list still carries the single-number target. A row
// written since the band exists has no such key at all, which is also what the
// grows step now writes, so this matches only what was stored before.
const WITH_THE_OLD_TARGET = { [TARGET]: { $exists: true } };

/**
 * Turns every measurement's single target into the two ends of a band.
 *
 * A grower aims at a range, so a definition now carries `targetMin` and
 * `targetMax` where it carried one `target`. Nothing fills the pair in on the
 * way out: every read of a grow is a lean one and answers what the document
 * holds rather than what the schema would default, so a definition stored
 * before the band would reach a client with neither end where the contract
 * promises both.
 *
 * The number that was there becomes both ends, which is what it meant - a
 * target of 6.3 was aimed at exactly - and a definition that had none keeps
 * none. Where a definition already carries a band it is left as it is, because
 * one list can hold both shapes and a grower's 1.4 to 1.8 must not be emptied
 * by the definition beside it. The old key is removed with the same write, so a
 * later run of this step finds nothing to do.
 */
export const measurementBand: MigrationStep = {
  name: '016-measurement-band',

  async run(context: MigrationContext): Promise<void> {
    const grows = context.db.collection(GROWS);
    const stale = await grows.countDocuments(WITH_THE_OLD_TARGET);
    context.count('grows.measurementBandWidened', stale);
    if (context.dryRun || stale === 0) return;

    await grows.updateMany(WITH_THE_OLD_TARGET, [
      {
        $set: {
          measurements: {
            $map: {
              input: '$measurements',
              as: 'measurement',
              in: {
                $mergeObjects: [
                  '$$measurement',
                  {
                    targetMin: { $ifNull: ['$$measurement.target', '$$measurement.targetMin', null] },
                    targetMax: { $ifNull: ['$$measurement.target', '$$measurement.targetMax', null] },
                  },
                ],
              },
            },
          },
        },
      },
      { $unset: TARGET },
    ]);
  },
};
