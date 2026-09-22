import { useNavigate, useNavigationType, useSearchParams } from 'react-router';
import { useMayManage } from '@/ui/session-access';
import { Home } from '@/screens/Home';
import { NewGrowSheet } from './NewGrowSheet';

/**
 * `/grows/new` as an address, for everything that cannot call the sheet
 * directly: a link in a mail, a bookmark, the card a claimed device leaves
 * behind.
 *
 * The sheet belongs over the screen you were on, and a link has none, so the
 * home stands behind it - the same place a closed sheet lands on. Followed from
 * inside the app, closing it is one step back; opened cold, it is the home that
 * was already there.
 *
 * `?space=` carries the place it was opened for - the tent a controller was
 * just claimed into, the card the invitation sat on - because a prop is the one
 * thing an address cannot be given. The sheet decides for itself whether that
 * id still names a place, which is the point: a bookmark outlives a tent.
 *
 * The address is as open as any other; what may be written through it is not,
 * so a session that may only look is given the home and no sheet.
 */
export function NewGrowRoute() {
  const navigate = useNavigate();
  const arrival = useNavigationType();
  const mayManage = useMayManage();
  const [search] = useSearchParams();

  const close = () => void (arrival === 'PUSH' ? navigate(-1) : navigate('/', { replace: true }));

  return (
    <>
      <Home />
      {mayManage ? <NewGrowSheet spaceId={search.get('space')} replace onClose={close} /> : null}
    </>
  );
}
