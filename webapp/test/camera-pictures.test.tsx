import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Camera, StillDeletion, StillDeletionImpact } from '@fg2/shared-types/v1';
import type { Told } from '@/log/log-context';
import { sayImpact } from '@/screens/camera/pictures/impact';
import { CameraPictures } from '@/screens/camera/pictures/CameraPictures';
import { countOf, deletionOf, isPicked, NOTHING, toggled } from '@/screens/camera/pictures/selection';
import { testClient } from './harness';
import { YOU } from './session';
import { translate } from './translations';
import i18next from 'i18next';

/**
 * Deleting pictures: a span laid out hour by hour, nothing picked at first, a
 * picture the diary holds shown and never picked, and the question that says
 * how many go for good and which films are made again without them.
 */

const state = vi.hoisted(() => ({
  youMay: 'own' as AccessNeed,
  /** Every selection a preview was asked for, the span's own layout first. */
  previews: [] as StillDeletion[],
  deleted: [] as StillDeletion[],
  told: [] as Told[],
}));

const HOUR = '2026-09-19T10:00:00.000Z';
const STILLS = ['still-3', 'still-2', 'still-1'].map((id, index) => ({ id, capturedAt: `2026-09-19T10:0${4 - index * 2}:00.000Z` }));

const impactOf = (selection: StillDeletion): StillDeletionImpact => ({
  stills: selection.ids?.length ?? 3 - 1 - (selection.except?.length ?? 0),
  kept: ['still-1'],
  hours: [{ startsAt: HOUR, stills: 3, newestId: 'still-3' }],
  films: [{ id: 'film-day', cameraId: 'camera-1', window: 'day', startsAt: '2026-09-19T00:00:00.000Z', endsAt: null, remade: true }],
});

vi.mock('@/api/cameras', async importOriginal => {
  const { YOU: you, THE_HOST: host } = await import('./session');
  return {
    ...(await importOriginal<object>()),
    useCamera: () => ({ isPending: false, data: { ...CAMERA, ownerId: state.youMay === 'own' ? you : host } }),
    useStillDeletionPreview: (_cameraId: string, selection: StillDeletion | null) => {
      if (selection) state.previews.push(selection);
      return { data: selection ? impactOf(selection) : undefined, isPending: false, error: null };
    },
    useStillsOf: () => ({ data: { pages: [{ items: STILLS, nextCursor: null }] }, hasNextPage: false, isPending: false, error: null }),
    useDeleteStills: () => ({
      mutate: (selection: StillDeletion, options?: { onSuccess?: (done: StillDeletionImpact) => void }) => {
        state.deleted.push(selection);
        options?.onSuccess?.(impactOf(selection));
      },
      isPending: false,
      error: null,
    }),
  };
});

vi.mock('@/log/log-context', async importOriginal => ({
  ...(await importOriginal<object>()),
  useLog: () => ({ tell: (told: Told) => state.told.push(told) }),
}));

vi.mock('@/api/account', async importOriginal => {
  const me = () => ({ data: { preferences: { timezone: 'UTC' } } });
  return { ...(await importOriginal<object>()), useMe: me, useAccountMe: me };
});

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');
  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

vi.mock('@/api/spaces', async importOriginal => {
  const { spaceWhere, spacesAnswering } = await import('./session');
  return { ...(await importOriginal<object>()), useSpaces: () => spacesAnswering(spaceWhere(state.youMay)) };
});

const CAMERA = {
  id: 'camera-1',
  ownerId: YOU,
  spaceId: 'space-1',
  name: 'Canopy cam',
  isDemo: false,
  removedAt: null,
} as unknown as Camera;

const draw = () =>
  render(
    <QueryClientProvider client={testClient()}>
      <MemoryRouter initialEntries={['/cameras/camera-1/pictures?date=2026-09-19']}>
        <Routes>
          <Route path="/cameras/:cameraId/pictures" element={<CameraPictures />} />
          <Route path="/cameras/:cameraId" element={<p>the camera page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(() => translate());

beforeEach(() => {
  state.youMay = 'own';
  state.previews.length = 0;
  state.deleted.length = 0;
  state.told.length = 0;
});

describe('deleting pictures', () => {
  it('lays the day the camera page stood on out hour by hour, with nothing picked and the diary´s picture kept', () => {
    draw();

    expect(state.previews[0]).toEqual({ startsAt: '2026-09-19T00:00:00.000Z', endsAt: '2026-09-19T23:59:59.999Z' });
    expect(screen.getByRole('heading', { name: /10:00–11:00/ })).toBeInTheDocument();
    expect(screen.getByText('Picked: 0 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete 0 pictures' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Picture from 10:04' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Picture from 10:00, in the diary, stays' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('1 picture stays because it is in the diary. Take it out there to delete it.')).toBeInTheDocument();
  });

  it('deletes the pictures tapped, after saying it is for good and which films are made again', () => {
    draw();

    fireEvent.click(screen.getByRole('button', { name: 'Picture from 10:04' }));
    fireEvent.click(screen.getByRole('button', { name: 'Picture from 10:00, in the diary, stays' }));
    expect(screen.getByText('Picked: 1 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 picture' }));

    expect(
      screen.getByText(/^Delete 1 picture for good\? This cannot be undone\. These films are made again without them: Day 19 Sep\.$/),
    ).toBeInTheDocument();
    expect(state.deleted).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete for good' }));

    expect(state.deleted).toEqual([{ ids: ['still-3'] }]);
    expect(state.told).toEqual([{ label: '1 picture deleted · films are being made again', undo: null }]);
    expect(screen.getByText('Picked: 0 of 3')).toBeInTheDocument();
  });

  it('deletes the whole span but the pictures tapped off again', () => {
    draw();

    fireEvent.click(screen.getByRole('button', { name: 'Pick all' }));
    expect(screen.getByText('Picked: 2 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Picture from 10:02' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 picture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete for good' }));

    expect(state.deleted).toEqual([{ startsAt: '2026-09-19T00:00:00.000Z', endsAt: '2026-09-19T23:59:59.999Z', except: ['still-2'] }]);
  });

  it('is the camera page for whoever may not manage the camera', () => {
    state.youMay = 'log';
    draw();

    expect(screen.getByText('the camera page')).toBeInTheDocument();
  });
});

describe('what is picked', () => {
  it('counts one by one, or the span but the kept pictures and the ones tapped off', () => {
    const one = toggled(NOTHING, 'a');
    expect([isPicked(one, 'a'), isPicked(one, 'b'), countOf(one, 10, 2)]).toEqual([true, false, 1]);
    expect(deletionOf(one, { startsAt: 's', endsAt: 'e' })).toEqual({ ids: ['a'] });

    const all = toggled({ all: true, ids: new Set() }, 'a');
    expect([isPicked(all, 'a'), isPicked(all, 'b'), countOf(all, 10, 2)]).toEqual([false, true, 7]);
    expect(deletionOf(all, { startsAt: 's', endsAt: 'e' })).toEqual({ startsAt: 's', endsAt: 'e', except: ['a'] });
    expect(deletionOf(NOTHING, { startsAt: 's', endsAt: 'e' })).toBeNull();
  });

  it('names the films a deletion makes again and the ones it leaves without enough pictures', () => {
    const film = { cameraId: 'camera-1', endsAt: null };
    const said = sayImpact(
      i18next.t.bind(i18next) as never,
      40,
      [
        { ...film, id: 'w', window: 'week', startsAt: '2026-09-14T00:00:00.000Z', remade: true },
        { ...film, id: 'm', window: 'month', startsAt: '2026-09-01T00:00:00.000Z', remade: true },
        { ...film, id: 'd', window: 'day', startsAt: '2026-09-19T00:00:00.000Z', remade: false },
      ],
      'UTC',
    );

    expect(said).toBe(
      'Delete 40 pictures for good? This cannot be undone. These films are made again without them: Week 38, September 2026. Day 19 Sep will be gone: too few pictures are left for a film.',
    );
  });
});
