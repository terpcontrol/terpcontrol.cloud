import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router';
import { fetchedAt } from '@/api/clock';
import { useHome } from '@/api/home';
import { failingSince } from '@/api/read';
import { useSession } from '@/api/session';
import { useSpaces } from '@/api/spaces';
import { isPlace } from '@/app/places';
import { NoLongerHere } from '@/ui/PageState';
import { EmptyStart } from './EmptyStart';
import { GrowStart } from './GrowStart';
import { Places } from './Places';
import { PlaceStart } from './PlaceStart';
import { noteLoaded } from './loaded';
import { StartFailed, StartWaiting } from './states';

/**
 * Start. An account with one place is shown that place; one whose single grow
 * stands in no place, that grow; with more than one of either it is a card
 * per place, each opening the place's own Start. Before there is anything it
 * asks what to begin with.
 */
export function Start() {
  const home = useHome();
  const { user } = useSession();
  const userId = user?.id ?? null;
  const answeredAt = home.data ? home.dataUpdatedAt : 0;

  useEffect(() => {
    if (answeredAt) noteLoaded(userId, fetchedAt(answeredAt));
  }, [userId, answeredAt]);

  if (home.isPending) return <StartWaiting />;
  if (!home.data) return <StartFailed retry={() => void home.refetch()} error={home.error} retrying={home.isFetching} />;

  const answer = home.data;
  const places = answer.spaces.filter(isPlace);
  const loose = answer.spaces.filter(card => !isPlace(card) && card.grow !== null);
  const failedAt = failingSince(home);

  if (places.length + loose.length === 0) return <EmptyStart />;
  if (places.length === 1 && loose.length === 0) return <PlaceStart spaceId={places[0].spaceId} />;
  if (places.length === 0 && loose.length === 1) return <GrowStart card={loose[0]} answer={answer} failedAt={failedAt} />;

  return <Places places={places} loose={loose} answer={answer} failedAt={failedAt} />;
}

/**
 * A place's own address. Where Start already is this place - the account's
 * only one - the address hands over to Start rather than drawing a second
 * copy of it with a way back to itself; with several, the way back leads to
 * their cards.
 *
 * A room has no Start of its own: it groups places and holds nothing, so its
 * address leads to Start, where it is the heading over its places. Only a
 * room with hardware standing in the room itself is a place - Start lists it
 * as a card - and keeps its page.
 */
export function StartOfPlace() {
  const { spaceId = '' } = useParams();
  const { user } = useSession();
  const home = useHome();
  const spaces = useSpaces();
  const cards = home.data?.spaces ?? [];
  const room = spaces.data?.items.some(space => space.id === spaceId && space.kind === 'room') === true;

  if (cards.length === 1 && cards[0].spaceId === spaceId) return <Navigate to="/" replace />;
  if (room && home.data && !cards.some(card => card.spaceId === spaceId)) return <Navigate to="/" replace />;
  // Whether the address names a room is known once the places have answered; until then nothing of a place is drawn for it.
  if (spaces.isPending || home.isPending) return <StartWaiting />;
  // A place that has ended still answers its own read, so the account's places say that it is gone, as they do
  // where it is edited and removed. Support reads a place that is not its own, which only that read answers for.
  if (spaces.data && !user?.isAdmin && !spaces.data.items.some(space => space.id === spaceId && space.archivedAt === null)) {
    return <NoLongerHere what="space" />;
  }

  return <PlaceStart key={spaceId} spaceId={spaceId} back={cards.length > 1} />;
}
