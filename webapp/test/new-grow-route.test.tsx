import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { NewGrowRoute } from '@/screens/grow/new/NewGrowRoute';
import { spaceWhere } from './session';

/**
 * `/grows/new` as an address: what the search parameters on it are worth by the
 * time the sheet has been drawn.
 *
 * The claim flow reaches the sheet only this way, so the stage it applied a
 * moment earlier travels as text and nothing else. What is asserted here is
 * therefore the end of that journey rather than the link at the start of it:
 * which chip the sheet opens on, what it says it is about to do, and - the
 * whole reason the parameter exists - that starting the grow does not write the
 * place's climate a second time over the one just applied.
 *
 * The home stands behind the sheet and is not what this is about, so it is
 * stood in for.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
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
  if (path === '/cameras') return { items: [], nextCursor: null };
  throw new Error(`nothing mocked for ${path}`);
};

const draw = async (at: string) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <NewGrowRoute />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole('button', { name: /Start the grow/ })).toBeEnabled());
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.post).mockResolvedValue({ id: 'grow-new' } as never);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('opening the new-grow sheet by address', () => {
  it('opens on the stage the address carries, and does not write that climate again', async () => {
    await draw('/grows/new?space=space-1&stage=flowering');

    expect(screen.getByRole('button', { name: /^Flower · / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/goes on the Germination preset now/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Start the grow/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/grows', expect.anything()));
    expect(vi.mocked(api.post).mock.calls.map(call => call[0])).not.toContain('/spaces/space-1/preset-applications');
  });

  it('falls back to the sheet’s own default where the address names no stage', async () => {
    await draw('/grows/new?space=space-1');

    expect(screen.getByRole('button', { name: /^Germination · / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Blue Dream tent goes on the Germination preset now/)).toBeInTheDocument();
  });

  /** A bookmark outlives a stage list, and drying is not a stage a grow begins in. */
  it('ignores a stage the sheet does not offer rather than opening on a chip that is not there', async () => {
    await draw('/grows/new?space=space-1&stage=drying');

    expect(screen.getByRole('button', { name: /^Germination · / })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /^Drying/ })).not.toBeInTheDocument();
  });
});
