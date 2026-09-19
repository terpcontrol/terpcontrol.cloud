import type { Entry, Person } from '@fg2/shared-types/v1';
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
    // A list of plants is a count stated the long way round, and an empty one
    // already means "about whatever this is attached to" rather than about
    // single plants - which is what the grow serialiser answers a hidden scope
    // with too.
    plantIds: hide.counts ? [] : told.plantIds,
    // A link that was not made to carry pictures is not told which camera a line
    // was about; the pictures themselves are refused per picture, by the same
    // decision, where they are fetched.
    cameraId: includeCameras ? told.cameraId : null,
    values: hide.weights && told.values.kind === 'harvest' ? { ...told.values, wetWeightG: null, dryWeightG: null } : told.values,
  };
};

/**
 * What the diary shows without being asked. A device's own line and the plan's
 * bookkeeping are `system` and `plan`: they are kept, they are read through the
 * timeline when somebody asks for those kinds, and they are not what a week card
 * or a chapter is about.
 */
export const DIARY_KINDS = entryKind.options.filter(kind => kind !== 'system' && kind !== 'plan');

/** The kinds that carry readings of the grow's own measurements. */
export const READING_KINDS = ['water', 'feed', 'measurement'] as const;

/** Everyone a set of entries names, so a card can say who watered without a read of its own. */
export const peopleOf = (entries: readonly Entry[], users: readonly Pick<StoredUser, 'id' | 'handle'>[]): Person[] => {
  const named = new Set(entries.flatMap(entry => (entry.authorId ? [entry.authorId] : [])));

  return users.flatMap(user => (named.has(user.id) ? [{ id: user.id, handle: user.handle }] : []));
};

/** The ids to look those people up by. */
export const authorIdsOf = (entries: readonly Entry[]): string[] => [...new Set(entries.flatMap(entry => (entry.authorId ? [entry.authorId] : [])))];
