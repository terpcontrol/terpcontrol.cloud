import { Model } from 'mongoose';
import type { Person } from '@fg2/shared-types/v1';
import { StoredUser } from '@database/schemas/v1/users.schema';

/**
 * Everyone a page names, once, so "Mia fed" needs no second read. Asked of the
 * ids as they are answered: a redacted line names nobody, and a page that names
 * nobody has nobody to look up.
 */
export const peopleNamed = async (users: Model<StoredUser>, ids: Iterable<string | null>): Promise<Person[]> => {
  const named = [...new Set(ids)].filter((id): id is string => id !== null);
  if (named.length === 0) return [];

  const people = await users.find({ id: { $in: named } }, { id: 1, handle: 1 }).lean<Pick<StoredUser, 'id' | 'handle'>[]>();
  return people.map(person => ({ id: person.id, handle: person.handle }));
};
