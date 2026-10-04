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
