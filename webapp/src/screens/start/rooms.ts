import type { HomeSpaceCard, Space } from '@fg2/shared-types/v1';

/** A run of Start's cards: the places of one room under its name, or a place that stands in none. */
export interface CardGroup<T> {
  room: { id: string; name: string } | null;
  cards: T[];
}

/**
 * Start's cards gathered under the rooms they stand in.
 *
 * The cards come in already ordered by what needs a person, and the order
 * survives: a room stands where its most urgent place would have stood, and
 * its places follow one another in their own order inside it. A room's own
 * card - hardware standing in the room itself - is one of its places. A room
 * this reader cannot see by name (a member let into one tent of it) groups
 * nothing, because a heading with no name would say less than none.
 */
export const groupedByRoom = <T extends HomeSpaceCard>(cards: readonly T[], spaces: readonly Space[]): CardGroup<T>[] => {
  const names = new Map(spaces.filter(space => space.kind === 'room').map(space => [space.id, space.name]));
  const groups: CardGroup<T>[] = [];
  const byRoom = new Map<string, CardGroup<T>>();

  for (const card of cards) {
    const roomId = card.kind === 'room' ? card.spaceId : card.roomId;
    const name = roomId ? names.get(roomId) : undefined;
    if (!roomId || name === undefined) {
      groups.push({ room: null, cards: [card] });
      continue;
    }
    const group = byRoom.get(roomId);
    if (group) {
      group.cards.push(card);
      continue;
    }
    const opened = { room: { id: roomId, name }, cards: [card] };
    byRoom.set(roomId, opened);
    groups.push(opened);
  }
  return groups;
};
