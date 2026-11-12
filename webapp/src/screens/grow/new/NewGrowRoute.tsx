import { useNavigate, useNavigationType, useSearchParams } from 'react-router';
import { useMayManage } from '@/ui/session-access';
import { Start } from '@/screens/start/Start';
import { useSpaces } from '@/api/spaces';
import { growPlaces } from '../placement';
import { StartGrowSheet } from './WhatGrows';

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
 * `?space=` carries the place it was opened for, because a prop is the one
 * thing an address cannot be given. An id that names no place the account may
 * start a grow in - a bookmark outlives a tent - is left out, and the form
 * asks where.
 *
 * The address is as open as any other; what may be written through it is not,
 * so a session that may only look is given the home and no sheet.
 */
export function NewGrowRoute() {
  const navigate = useNavigate();
  const arrival = useNavigationType();
  const mayManage = useMayManage();
  const [search] = useSearchParams();

  const places = growPlaces(useSpaces().data?.items ?? []);
  const place = places.find(one => one.id === search.get('space')) ?? null;
  const close = () => void (arrival === 'PUSH' ? navigate(-1) : navigate('/', { replace: true }));

  return (
    <>
      <Start />
      {mayManage ? <StartGrowSheet key={place?.id} spaceId={place?.id} name={place?.name} replace onClose={close} /> : null}
    </>
  );
}
