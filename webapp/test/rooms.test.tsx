import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Device } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { groupedByPlace } from '@/screens/devices/grouping';
import { NewRoomSheet } from '@/screens/home/NewRoomSheet';
import { drawAt } from './harness';
import { spaceWhere } from './session';
import { translate } from './translations';

/**
 * A room gathers places and nothing more: it is made from Start with the
 * places it holds, and the Devices tab lists each device under the place it
 * stands in and the room around that place.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

beforeAll(() => translate());

const TENT = spaceWhere('own', { id: 'tent', name: 'Tent', roomId: 'room' });
const FRIDGE = spaceWhere('own', { id: 'fridge', name: 'KS Black', kind: 'fridge' });
const ROOM = spaceWhere('own', { id: 'room', name: 'Grow room', kind: 'room' });
const BALCONY = spaceWhere('own', { id: 'balcony', name: 'Balcony', kind: 'balcony' });

describe('making a room from Start', () => {
  it('makes the room and moves every place chosen into it', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [TENT, FRIDGE, ROOM], nextCursor: null } as never);
    vi.mocked(api.post).mockResolvedValue(spaceWhere('own', { id: 'room-new', kind: 'room', name: 'Grow tent room' }) as never);
    vi.mocked(api.patch).mockResolvedValue({} as never);
    drawAt(<NewRoomSheet onClose={() => {}} />);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: ' Grow tent room ' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Tent · in Grow room' }));
    fireEvent.click(screen.getByRole('button', { name: 'KS Black' }));
    expect(screen.queryByRole('button', { name: 'Grow room' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create the room with 2 places' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenCalledWith('/spaces', { kind: 'room', name: 'Grow tent room' });
    expect(api.patch).toHaveBeenCalledWith('/spaces/tent', { roomId: 'room-new' });
    expect(api.patch).toHaveBeenCalledWith('/spaces/fridge', { roomId: 'room-new' });
  });
});

describe('devices by where they stand', () => {
  const device = (id: string, spaceId: string | null) => ({ id, spaceId }) as Device;

  it('keeps a room´s places together, in the order the places were set up', () => {
    const groups = groupedByPlace(
      [device('a', 'balcony'), device('b', 'fridge'), device('c', 'tent'), device('d', 'tent'), device('e', null)],
      [ROOM, BALCONY, TENT, FRIDGE],
    );

    expect(groups.map(group => [group.room, group.place, group.devices.map(one => one.id)])).toEqual([
      ['Grow room', 'Tent', ['c', 'd']],
      [null, 'Balcony', ['a']],
      [null, 'KS Black', ['b']],
      [null, null, ['e']],
    ]);
  });
});
