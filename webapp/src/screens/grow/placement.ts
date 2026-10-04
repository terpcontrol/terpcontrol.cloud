import type { GrowListItem } from '@fg2/shared-types/v1';

/**
 * The last place a grow stood, for a grow that stands nowhere any more.
 *
 * The newest placement by the day it was closed, which for an ended grow is the
 * tent it came down in. It is a label and nothing else: where a grow may be
 * logged or managed is still its *open* placements, which is what the serialiser
 * answers and what the access decision reads.
 *
 * The header and the Move sheet share it because both say where a grow is, and
 * the two must not disagree: `summary.locations` is empty once the last
 * placement is closed, and read as a present fact it says "no fixed place" of a
 * grow that spent seven months in a fridge.
 */
export const lastPlaceOf = (grow: GrowListItem): { spaceId: string | null } | null =>
  grow.placements.reduce<GrowListItem['placements'][number] | null>(
    (latest, placement) => (latest && (latest.endedAt ?? '') >= (placement.endedAt ?? '') ? latest : placement),
    null,
  );
