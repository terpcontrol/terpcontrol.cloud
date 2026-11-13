import { MigrationContext, MigrationStep } from '../migration';

/**
 * Ends the reminders of places that have ended.
 *
 * A place's reminders end with the place now, as the ways into it do. Ending
 * one used to leave them: a rhythm kept for a tent that is gone stayed listed,
 * naming no place anybody could open and with nothing to change it by. A room
 * that ended kept its own the same way. This deletes what was left - the
 * reminders about a place or a room that has ended, or that is no longer
 * there at all. A grow's reminders are the grow's and are not looked at.
 *
 * What a reminder already produced stays: the diary lines its tasks were
 * ticked off with name the place, and the place's row is still there to name.
 */
export const remindersOfEndedPlaces: MigrationStep = {
  name: '029-reminders-of-ended-places',

  async run(context: MigrationContext): Promise<void> {
    const reminders = context.db.collection('reminders');
    const named = (await reminders.distinct('subject.id', { 'subject.type': 'space' })) as string[];
    const open = (await context.db.collection('spaces').distinct('id', { id: { $in: named }, archivedAt: null })) as string[];
    const ended = named.filter(id => !open.includes(id));
    const left = { 'subject.type': 'space', 'subject.id': { $in: ended } };

    context.count('reminders.endedWithAPlace', ended.length === 0 ? 0 : await reminders.countDocuments(left));
    if (!context.dryRun && ended.length > 0) await reminders.deleteMany(left);
  },
};
