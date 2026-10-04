import { LEGACY } from '../legacy';
import { MigrationContext, MigrationStep } from '../migration';

/**
 * The three collections the model deliberately does not carry over, moved aside
 * with everything else.
 *
 * Nothing is transformed here, and that is the point: `legacy_*` is then the
 * whole of the old database rather than most of it, and an operator reading the
 * record sees how much was left behind rather than having to go looking.
 *
 * - **`passwordtokens`** live for minutes. `passwordResets` starts empty; a
 *   reset in flight during the upgrade is asked for again.
 * - **`shares`** stop working, deliberately. A share link's id was its secret
 *   and its time window was an unenforced query string, so there is nothing to
 *   carry into a link that clamps every read to its range. `shareLinks` starts
 *   empty and the links people sent out resolve to nothing.
 * - **`chartpresets`** were a query string. `chartViews` is structured, and a
 *   view is made again in the new app rather than guessed at from a string that
 *   half of them do not even hold.
 */
export const retiredCollections: MigrationStep = {
  name: '013-retired-collections',
  moves: [LEGACY.passwordTokens, LEGACY.shares, LEGACY.chartPresets],

  async run(context: MigrationContext): Promise<void> {
    for (const collection of retiredCollections.moves ?? []) {
      const source = await context.source(collection);
      context.count(`${collection}.leftBehind`, await source.countDocuments());
    }
  },
};
