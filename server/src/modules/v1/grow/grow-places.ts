import { FilterQuery } from 'mongoose';
import { GrowDocument } from '@database/schemas/v1/grows.schema';

/**
 * Where a grow stood over a stretch of time, from its placements. `null` among
 * them is "no fixed place", which is a place a grow can be in and not the
 * absence of an answer.
 *
 * A placement with no end is open, so a grow that has never moved answers the
 * one space for every week of its life.
 */
export const spacesDuring = (grow: GrowDocument, startsAt: Date, endsAt: Date): (string | null)[] => [
  ...new Set(
    grow.placements
      .filter(placement => placement.startedAt < endsAt && (placement.endedAt === null || placement.endedAt > startsAt))
      .map(placement => placement.spaceId),
  ),
];

/** The spaces a grow's plants stand in now: its open placements that name one. */
export const spacesNow = (grow: Pick<GrowDocument, 'placements'>): string[] =>
  grow.placements.flatMap(placement => (placement.endedAt === null && placement.spaceId ? [placement.spaceId] : []));

/** A grow still going with an open placement in the space. */
export const standingIn = (spaceId: string): FilterQuery<GrowDocument> => ({ endedAt: null, placements: { $elemMatch: { spaceId, endedAt: null } } });
