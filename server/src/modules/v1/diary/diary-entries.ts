import { Model } from 'mongoose';
import type { Entry, EntryKind, Person } from '@fg2/shared-types/v1';
import { entryKind } from '@fg2/shared-types/v1-schemas';
import { serialiseEntry } from '@common/v1/entries';
import { EntryDocument } from '@database/schemas/v1/entries.schema';
import { StoredUser } from '@database/schemas/v1/users.schema';
import { Redaction } from '../grow/grow-serialiser';

/**
 * An entry as somebody other than its owner may read it.
 *
 * `access()` decides whether a timeline may be read at all and hands back how
 * much of it: whose privacy applies, and whether pictures of a camera are part
 * of the answer. This is what that comes to line by line, so that one read of
 * the diary cannot leak what the grow screen and the public page both hide.
 */
export const serialiseDiaryEntry = (entry: EntryDocument, hide: Redaction, includeCameras: boolean): Entry => {
  const told = serialiseEntry(entry);

  return {
    ...told,
    // Who wrote it is the account behind it. A page that names nobody - which is
    // every public page, and a tent somebody was sent a link to - says what was
    // done and leaves the person out, rather than handing over an id that has no
    // handle beside it to make sense of.
    authorId: hide.authors ? null : told.authorId,
    // And where it happened is the place behind it. A week card that answers no
    // `deviceIds` and a report that answers no `spaceIds` would say nothing at
    // all if the lines under them named the tent and the controller anyway -
    // every phase line carries the space it was written in, and every line a
    // device wrote carries the device. A reader outside the tent is told what
    // happened rather than which corner of somebody's flat it happened in.
    spaceId: hide.authors ? null : told.spaceId,
    deviceId: hide.authors ? null : told.deviceId,
    // A list of plants is a count stated the long way round, and an empty one
    // already means "about whatever this is attached to" rather than about
    // single plants - which is what the grow serialiser answers a hidden scope
    // with too.
    plantIds: hide.counts ? [] : told.plantIds,
    // A link that was not made to carry pictures is not told which camera a line
    // was about; the pictures themselves are refused per picture, by the same
    // decision, where they are fetched.
    cameraId: includeCameras ? told.cameraId : null,
    values: valuesOf(told.values, hide),
  };
};

/**
 * What is left of an entry's own values.
 *
 * The weights are the setting they are; the plant a reading is of is the count
 * stated one measurement at a time. A page that answers `plantCount: null` and
 * an empty `plantIds` and then names a real plant inside a reading hands the
 * count back to anybody willing to collect the distinct ids across a diary - so
 * a reading whose scope is hidden is a reading of whatever the line is about,
 * which is what a null `plantId` already means.
 */
const valuesOf = (values: Entry['values'], hide: Redaction): Entry['values'] => {
  const weighed = hide.weights && values.kind === 'harvest' ? { ...values, wetWeightG: null, dryWeightG: null } : values;

  return hide.counts && 'readings' in weighed ? { ...weighed, readings: weighed.readings.map(reading => ({ ...reading, plantId: null })) } : weighed;
};

/**
 * What a device and the plan engine write for themselves. They are entries like
 * any other and are kept like any other, but they are a machine's running
 * commentary rather than a record of the grow, so a week card and a report
 * chapter leave them out and the timeline's rail reads them under a cap of their
 * own.
 */
export const MACHINE_KINDS: EntryKind[] = entryKind.options.filter(kind => kind === 'system' || kind === 'plan');

/**
 * What a week card or a report chapter is about: everything somebody did to the
 * grow, and everything that happened to it, with a machine's bookkeeping left
 * out. The rail on the Timeline tab is deliberately not this list - a tent's
 * whole record is what it is scrubbed for.
 */
export const DIARY_KINDS = entryKind.options.filter(kind => !MACHINE_KINDS.includes(kind));

/**
 * When each of these grows was last written in, by its id.
 *
 * What a reader of a diary means by "updated" is that there is something new to
 * read, which is a line somebody wrote - not the moment the grow's own row was
 * last saved. The two are far apart: a diary write never touches the grow
 * document, so its `updatedAt` is whatever last changed the grow itself, and
 * after a migration that is the migration. A device's own lines are left out
 * for the same reason: an alarm every ten minutes would make every silent grow
 * look freshly written.
 */
export const diaryMovedAt = async (entries: Model<EntryDocument>, growIds: string[]): Promise<Map<string, Date>> => {
  if (growIds.length === 0) return new Map();

  const rows = await entries.aggregate<{ _id: string; at: Date }>([
    { $match: { growId: { $in: growIds }, source: 'human', kind: { $in: DIARY_KINDS } } },
    { $group: { _id: '$growId', at: { $max: '$occurredAt' } } },
  ]);

  return new Map(rows.map(row => [row._id, row.at]));
};

/** The kinds that carry readings of the grow's own measurements. */
export const READING_KINDS = ['water', 'feed', 'measurement'] as const;

/** Everyone a set of entries names, so a card can say who watered without a read of its own. */
export const peopleOf = (entries: readonly Entry[], users: readonly Pick<StoredUser, 'id' | 'handle'>[]): Person[] => {
  const named = new Set(entries.flatMap(entry => (entry.authorId ? [entry.authorId] : [])));

  return users.flatMap(user => (named.has(user.id) ? [{ id: user.id, handle: user.handle }] : []));
};

/** The ids to look those people up by. */
export const authorIdsOf = (entries: readonly Entry[]): string[] => [...new Set(entries.flatMap(entry => (entry.authorId ? [entry.authorId] : [])))];
