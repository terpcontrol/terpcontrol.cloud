import { MigrationContext, MigrationStep } from '../migration';

const USERS = 'users';
const ROUTING = 'notifications.routing';
const WARNINGS = `${ROUTING}.warnings`;

// An account that has a grid and no row in it for warnings. Asking for the
// grid keeps a rehearsal honest: rehearsed over a database the users step has
// not transformed yet, the collection still holds the old shapes, and those
// have no grid to be missing a row of.
const WITHOUT_THE_ROW = { [ROUTING]: { $exists: true }, [WARNINGS]: { $exists: false } };

/**
 * Gives every account the `warnings` row of its routing grid.
 *
 * The grid is one key per category, and an account written before the category
 * existed has no key for it. Nothing fills that in on the way out: every read
 * of an account is a lean one, and a lean read carries what the document
 * carries rather than what the schema would default - so `/me` would answer a
 * grid with a row missing, and a client that trusts the contract would find no
 * list where it expects one. The row is written as "not announced", which is
 * what every row starts as.
 *
 * It reads the new `users` collection and moves nothing aside: an account the
 * users step migrated already carries the row, so this is for the databases
 * that were migrated before the category was added.
 */
export const warningsRouting: MigrationStep = {
  name: '015-warnings-routing',

  async run(context: MigrationContext): Promise<void> {
    const users = context.db.collection(USERS);
    const missing = await users.countDocuments(WITHOUT_THE_ROW);
    context.count('users.warningsRowAdded', missing);
    if (context.dryRun || missing === 0) return;

    await users.updateMany(WITHOUT_THE_ROW, { $set: { [WARNINGS]: [] } });
  },
};
