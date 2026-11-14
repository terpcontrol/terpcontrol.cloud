import { MigrationContext, MigrationStep } from '../migration';

/**
 * Ends the reminders of grows that have ended.
 *
 * A grow's reminders end with the grow now, as a place's do (029): ending one
 * used to leave them, so a rhythm such as "alle 3 Tage" kept for plants that
 * were harvested stood under Aufgaben › Rhythmen for good, offering a change
 * the server would have refused to make it with. This deletes what was left -
 * the reminders about a grow that has ended, or that is no longer there at all.
 * A place's reminders are 029's and are not looked at.
 *
 * What a reminder already produced stays: the diary lines its tasks were ticked
 * off with are the grow's record. Reads the new collections and moves nothing
 * aside.
 */
export const remindersOfEndedGrows: MigrationStep = {
  name: '032-reminders-of-ended-grows',

  async run(context: MigrationContext): Promise<void> {
    const reminders = context.db.collection('reminders');
    const named = (await reminders.distinct('subject.id', { 'subject.type': 'grow' })) as string[];
    const running = (await context.db.collection('grows').distinct('id', { id: { $in: named }, endedAt: null })) as string[];
    const ended = named.filter(id => !running.includes(id));
    const left = { 'subject.type': 'grow', 'subject.id': { $in: ended } };

    context.count('reminders.endedWithAGrow', ended.length === 0 ? 0 : await reminders.countDocuments(left));
    if (!context.dryRun && ended.length > 0) await reminders.deleteMany(left);
  },
};
