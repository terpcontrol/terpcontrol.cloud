import { Navigate, useParams } from 'react-router';
import { isPlace } from '@/app/places';
import { useHome } from '@/api/home';
import { PlaceCockpitRead } from '../cockpit/PlaceCockpit';

/**
 * A place's own address, which is its cockpit - the same page whether it was
 * opened from a card on Start, a link in an alert or the grow standing in it.
 * There are no tabs under it: Verlauf, Steuerung and the devices are the bar's,
 * and open on this place.
 *
 * For an account with this one place and no other, Start already is this page,
 * so the address hands over to Start rather than drawing a second copy of it
 * with a way back to itself. With several, the way back leads to their cards.
 */
export function PlacePage() {
  const { spaceId = '' } = useParams();
  const home = useHome();
  const places = (home.data?.spaces ?? []).filter(isPlace);

  if (places.length === 1 && places[0].spaceId === spaceId) return <Navigate to="/" replace />;

  return <PlaceCockpitRead key={spaceId} spaceId={spaceId} back={places.length > 1} />;
}
