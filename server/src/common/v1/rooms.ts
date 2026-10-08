import { Model } from 'mongoose';
import { SpaceDocument } from '@database/schemas/v1/spaces.schema';

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
