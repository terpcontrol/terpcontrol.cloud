import { MigrationContext, MigrationStep } from '../migration';

/**
 * Rests the reminders of grows that have ended.
 *
 * A grow's reminders rest while it is ended and come back when it is reopened
 * (Chris, 2026-11-14): ending one used to leave them working, so a rhythm such as
 * "alle 3 Tage" kept for plants that were harvested stood under Aufgaben ›
 * Rhythmen for good, offering a change the server would have refused to make it
 * with. This gives each reminder of an ended grow `restingSince` - the instant
 * its grow ended - which takes it off every list and every announcement until
 * the grow is reopened. A grow that is gone takes its reminders along, as
 * deleting one does now. A place's reminders are 029's and are not looked at.
 *
 * A reminder resting already is passed by, so a second run changes nothing.
 * Reads the new collections and moves nothing aside.
 *
 * An earlier build of this round named a step `032-reminders-of-ended-grows`
 * that deleted those reminders; it never shipped. A database it ran on keeps
 * that name in its record, which no step answers to any more, and runs this one
 * on its next boot - finding the reminders of ended grows gone already.
 */
export const restingRemindersOfEndedGrows: MigrationStep = {
  name: '032-resting-reminders-of-ended-grows',

  async run(context: MigrationContext): Promise<void> {
    const reminders = context.db.collection('reminders');
    const named = (await reminders.distinct('subject.id', { 'subject.type': 'grow' })) as string[];
    const grows = (await context.db
      .collection('grows')
      .find({ id: { $in: named } }, { projection: { id: 1, endedAt: 1 } })
      .toArray()) as unknown as { id: string; endedAt: Date | null }[];
    const ended = grows.filter(grow => grow.endedAt !== null);
    const gone = named.filter(id => !grows.some(grow => grow.id === id));
    const awake = { 'subject.type': 'grow', restingSince: null };

    const resting = ended.length === 0 ? 0 : await reminders.countDocuments({ ...awake, 'subject.id': { $in: ended.map(grow => grow.id) } });
    const goneWith = gone.length === 0 ? 0 : await reminders.countDocuments({ 'subject.type': 'grow', 'subject.id': { $in: gone } });
    context.count('reminders.restingWithAGrow', resting);
    context.count('reminders.goneWithAGrow', goneWith);
    if (context.dryRun) return;

    for (const grow of ended) await reminders.updateMany({ ...awake, 'subject.id': grow.id }, { $set: { restingSince: grow.endedAt } });
    if (gone.length > 0) await reminders.deleteMany({ 'subject.type': 'grow', 'subject.id': { $in: gone } });
  },
};
