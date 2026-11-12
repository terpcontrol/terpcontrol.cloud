import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router';
import { fetchedAt } from '@/api/clock';
import { useHome } from '@/api/home';
import { useSession } from '@/api/session';
import { isPlace } from '@/app/places';
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
  if (!home.data) return <StartFailed retry={() => void home.refetch()} />;

  const answer = home.data;
  const places = answer.spaces.filter(isPlace);
  const loose = answer.spaces.filter(card => !isPlace(card) && card.grow !== null);
  const failedAt = home.isError ? home.dataUpdatedAt : null;

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
 */
export function StartOfPlace() {
  const { spaceId = '' } = useParams();
  const home = useHome();
  const cards = home.data?.spaces ?? [];

  if (cards.length === 1 && cards[0].spaceId === spaceId) return <Navigate to="/" replace />;

  return <PlaceStart key={spaceId} spaceId={spaceId} back={cards.length > 1} />;
}
