import { MigrationContext, MigrationStep } from '../migration';

const ENTRIES = 'entries';
const BY_TASK = 'taskId_1';

/**
 * Makes the index behind a ticked-off task unique.
 *
 * A task is done when a line carries its id, so that line is the only record
 * that it happened - and therefore the only thing that can stop it happening
 * twice. The service reads before it writes, which two ticks in the same moment
 * both pass, and only the collection itself can refuse the second.
 *
 * A step of its own because mongoose will not change an index it already built:
 * asked for the same key with different options it answers that one exists, and
 * swallows the failure. So the old one goes here and the unique one is built
 * from the schema on the next boot, which is this run's own.
 *
 * Idempotent in both directions: an index that is already unique is left alone,
 * and one that is not there at all - a fresh install, where the schema's unique
 * index was built first - is nothing to drop.
 */
export const oneLinePerTask: MigrationStep = {
  name: '014-one-line-per-task',

  async run(context: MigrationContext): Promise<void> {
    if (context.dryRun) return;

    const names = await context.db.listCollections({ name: ENTRIES }, { nameOnly: true }).toArray();
    if (names.length === 0) return;

    const entries = context.db.collection(ENTRIES);
    const existing = await entries.indexes();
    const byTask = existing.find(index => index.name === BY_TASK);
    if (!byTask || byTask.unique) return;

    await entries.dropIndex(BY_TASK);
    context.count('entries.taskIndexRebuilt');
  },
};
