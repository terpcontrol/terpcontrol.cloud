import { Model } from 'mongoose';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';
import { conflict } from './problem';

/**
 * The spaces named, and the spaces standing in any of them that is a room.
 *
 * A membership on a room covers the spaces standing in it, so a list of the
 * spaces somebody holds is widened to what is inside them before anything is
 * looked for by the space it stands in - which is the rule `access()` decides
 * one subject by, from the other end.
 */
export const withSpacesInside = async (spaces: Model<SpaceDocument>, ids: readonly string[]): Promise<string[]> => {
  const inside = await spaces.find({ roomId: { $in: ids } }, { id: 1 }).lean<Pick<SpaceDocument, 'id'>[]>();

  return [...new Set([...ids, ...inside.map(space => space.id)])];
};

/**
 * A space that has ended takes nothing and lets nobody in: a room was a field
 * of places that are gone, and a place that was removed is on no screen - what
 * was written to either would be a device, a guest or a link nobody could find
 * again. One refusal for every way in, each kind with its own sentence.
 */
export const refuseEnded = (space: Pick<SpaceDocument, 'kind' | 'archivedAt'>): void => {
  if (space.archivedAt === null) return;
  if (space.kind === 'room') throw conflict('room_ended', 'A room exists only while a place stands in it, and this one ended with its last place.');

  throw conflict('space_archived', 'That place has ended, and nothing is put into an ended place.');
};

/**
 * The same refusal where only the id is in hand - a grow started or moved
 * there, a reminder kept on it. A space that is not there at all is the access
 * rule's to answer, which each of those writes has asked first.
 */
export const refuseEndedId = async (spaces: Model<SpaceDocument>, id: string): Promise<void> => {
  const space = await spaces.findOne({ id }, { kind: 1, archivedAt: 1 }).lean<Pick<SpaceDocument, 'kind' | 'archivedAt'>>();
  if (space) refuseEnded(space);
};
