import { FilterQuery, Model } from 'mongoose';
import type { SpaceKind } from '@fg2/shared-types/v1';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { conflict } from './problem';

/**
 * One name, one place: an account's places that have not ended carry different
 * names, and so do its rooms. A place may be called what a room is called - the
 * two are never listed as one.
 *
 * Compared as a person reads them, so "Zelt", " zelt " and "ZELT" are one name.
 * No unique index states it, because the comparison is not a field.
 */
export const nameKey = (name: string): string => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** The spaces of an owner a name is unique among: its rooms for a room, its places for anything else. */
const peersOf = (ownerId: string, kind: SpaceKind): FilterQuery<SpaceDocument> => ({
  ownerId,
  archivedAt: null,
  kind: kind === 'room' ? 'room' : { $ne: 'room' },
});

const namesOf = async (spaces: Model<SpaceDocument>, ownerId: string, kind: SpaceKind, exceptId?: string): Promise<Map<string, SpaceDocument>> => {
  const peers = await spaces
    .find(peersOf(ownerId, kind), { id: 1, name: 1, kind: 1, ownerId: 1 })
    .sort({ createdAt: 1, id: 1 })
    .lean<SpaceDocument[]>();

  return new Map(peers.filter(peer => peer.id !== exceptId).map(peer => [nameKey(peer.name), peer]));
};

/** The owner's room or place of that name, if there is one. */
export const namedLike = async (spaces: Model<SpaceDocument>, ownerId: string, kind: SpaceKind, name: string): Promise<SpaceDocument | null> =>
  (await namesOf(spaces, ownerId, kind)).get(nameKey(name)) ?? null;

/** Refuses a name another of the owner's places - or rooms - already carries, in a sentence a screen can show. */
export const refuseTakenName = async (
  spaces: Model<SpaceDocument>,
  ownerId: string,
  kind: SpaceKind,
  name: string,
  exceptId?: string,
): Promise<void> => {
  const taken = (await namesOf(spaces, ownerId, kind, exceptId)).get(nameKey(name));
  if (!taken) return;

  throw conflict(
    'name_taken',
    kind === 'room' ? `Another room is already called "${taken.name}".` : `Another place is already called "${taken.name}".`,
    [{ field: 'name', code: 'taken', detail: 'Names are unique among the places, and among the rooms, of one account.' }],
  );
};

/**
 * The name itself where it is free, else the name with the lowest number that
 * is: "Zelt", "Zelt 2", "Zelt 3". A name that already ends in a number counts
 * on from it - a second "Zelt 1" is "Zelt 2", not "Zelt 1 2".
 */
export const numbered = (name: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(nameKey(name))) return name;

  const counted = /^(.*\S)\s+(\d{1,6})$/u.exec(name);
  const stem = counted ? counted[1] : name;
  for (let number = counted ? Number(counted[2]) + 1 : 2; ; number += 1) {
    const candidate = `${stem} ${number}`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
};

/** A name for a place the server makes by itself, which is never refused: the wanted one, numbered where it is taken. */
export const freeNameFor = async (spaces: Model<SpaceDocument>, ownerId: string, kind: SpaceKind, wanted: string): Promise<string> =>
  numbered(wanted.trim(), new Set((await namesOf(spaces, ownerId, kind)).keys()));
