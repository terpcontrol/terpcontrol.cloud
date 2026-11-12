import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { SpaceOverview } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { RemovePlaceSheet } from '@/screens/space/RemovePlaceSheet';
import { drawAt } from './harness';
import { spaceWhere } from './session';
import { translate } from './translations';

/**
 * A room gathers places and nothing more, and a place that still holds
 * something is emptied into another before it ends.
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

describe('removing a place that still holds something', () => {
  /** Emptying it by hand was three screens of errands; the sheet moves everything to one place and then ends it. */
  it('moves its device, its loose camera and its running grow to the place chosen, then ends it', async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/spaces') return Promise.resolve({ items: [TENT, FRIDGE, ROOM], nextCursor: null }) as never;
      if (path === '/devices')
        return Promise.resolve({
          items: [{ id: 'device-1', type: 'controller', name: 'Tent controller', spaceId: 'tent' }],
          nextCursor: null,
        }) as never;
      if (path.startsWith('/cameras'))
        return Promise.resolve({
          items: [
            { id: 'cam-device', name: 'Canopy cam', spaceId: 'tent', deviceId: 'device-1' },
            { id: 'cam-loose', name: 'Door cam', spaceId: 'tent', deviceId: null },
          ],
          nextCursor: null,
        }) as never;
      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
    vi.mocked(api.put).mockResolvedValue({ id: 'device-1' } as never);
    vi.mocked(api.patch)
      .mockClear()
      .mockResolvedValue({} as never);
    vi.mocked(api.post)
      .mockClear()
      .mockResolvedValue({} as never);
    vi.mocked(api.delete).mockResolvedValue(null as never);
    const removed = vi.fn();
    const overview = {
      spaceId: 'tent',
      name: 'Tent',
      kind: 'tent',
      deviceIds: ['device-1'],
      grows: [{ growId: 'grow-1', name: 'Spring run' }],
    } as unknown as SpaceOverview;
    drawAt(<RemovePlaceSheet overview={overview} onClose={() => {}} onRemoved={removed} />);

    expect(await screen.findByText('Still here: Tent controller · Door cam · grow Spring run.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Tent' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'KS Black' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tent' }));

    await waitFor(() => expect(removed).toHaveBeenCalled());
    expect(api.put).toHaveBeenCalledWith('/spaces/fridge/devices/device-1');
    expect(api.patch).toHaveBeenCalledWith('/cameras/cam-loose', { spaceId: 'fridge' });
    expect(api.patch).not.toHaveBeenCalledWith('/cameras/cam-device', expect.anything());
    expect(api.post).toHaveBeenCalledWith('/grows/grow-1/placements', expect.objectContaining({ spaceId: 'fridge' }));
    expect(api.delete).toHaveBeenCalledWith('/spaces/tent');
  });
});
