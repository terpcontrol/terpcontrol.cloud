import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { NewGrowRoute } from '@/screens/grow/new/NewGrowRoute';
import { drawAt } from './harness';
import { spaceWhere } from './session';
import { translate } from './translations';

/**
 * `/grows/new` as an address: the one form over Start, for the place the
 * address names - where it still names one the account may start a grow in.
 *
 * The home stands behind the sheet and is not what this is about, so it is
 * stood in for.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/screens/Home', () => ({ Home: () => <div data-testid="home" /> }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

// The sheet offers a place only where the reader manages it, so the standing rides on the row.
const tent = spaceWhere('own', { id: 'space-1', kind: 'tent', name: 'Blue Dream tent' });
const controller = { id: 'device-1', type: 'controller', spaceId: 'space-1' } as Device;

const answers = (path: string): unknown => {
  if (path === '/spaces') return { items: [tent], nextCursor: null };
  if (path === '/grows') return { items: [], nextCursor: null };
  if (path === '/devices') return { items: [controller], nextCursor: null };
  if (path === '/me') return { preferences: { diary: null } };
  throw new Error(`nothing mocked for ${path}`);
};

const draw = async (at: string) => {
  drawAt(<NewGrowRoute />, { at });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start a grow' })).toBeEnabled());
};

beforeAll(() => translate());

beforeEach(() => {
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.post).mockResolvedValue({ id: 'grow-new' } as never);
});

afterEach(() => vi.clearAllMocks());

describe('opening the form a grow is started with by address', () => {
  it('is about the place the address names', async () => {
    await draw('/grows/new?space=space-1');

    expect(screen.getByRole('dialog', { name: 'What grows in Blue Dream tent?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/grows', expect.objectContaining({ spaceId: 'space-1' })));
  });

  /** A bookmark outlives a tent. */
  it('asks where, where the address names a place that is not there', async () => {
    await draw('/grows/new?space=gone');

    expect(screen.getByRole('dialog', { name: 'New grow' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Where' })).toHaveValue('space-1');
  });
});
