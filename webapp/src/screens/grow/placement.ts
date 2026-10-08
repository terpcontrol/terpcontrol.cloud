import type { GrowListItem, Space } from '@fg2/shared-types/v1';
import { enough } from '@/ui/session-access';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The places a grow can be put in. Starting, moving or splitting a grow into a
 * place is managing that place - a move is written against the destination as
 * well as against the grow - so one this account may only write lines in is
 * left out rather than refused on save. "No fixed place" needs none and is
 * offered beside these.
 */
export const growPlaces = (spaces: Space[]): Space[] =>
  spaces.filter(space => space.archivedAt === null && space.kind !== 'room' && enough(space.youMay, 'manage'));

/** A place by its name, looked up among every place so that an archived one still reads; none is "no fixed place". */
export const placeName = (t: Translate, spaces: Space[], spaceId: string | null): string =>
  spaceId === null ? t('grow.noFixedPlace') : (spaces.find(space => space.id === spaceId)?.name ?? '…');

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
