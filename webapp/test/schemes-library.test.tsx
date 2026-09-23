import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scheme, SchemeUpdate, SchemeWeek } from '@fg2/shared-types/v1';
import { Schemes } from '@/screens/me/schemes/Schemes';

/**
 * Me › Feeding schemes: the shipped shelf and the person's own.
 *
 * A shipped scheme opens as a table with nothing to press, because the chart
 * is the manufacturer's and is corrected by re-reading it, not in place. An
 * own one opens in the same editor a grow's grid has, and the thing to check
 * there is the wire: one Save sends the name and the whole grid with the one
 * figure changed and nothing else moved, and deleting asks first and then
 * sends exactly one request.
 */

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
});

const amounts = (grow: number | null, bloom: number | null) => [
  { productKey: 'bio_grow', name: 'Bio·Grow', value: grow, unit: 'ml/l' },
  { productKey: 'bio_bloom', name: 'Bio·Bloom', value: bloom, unit: 'ml/l' },
];

const GRID: SchemeWeek[] = [
  { week: 1, stage: 'seedling', ecTarget: null, amounts: amounts(1, null) },
  { week: 2, stage: 'vegetative', ecTarget: null, amounts: amounts(2, null) },
  { week: 3, stage: 'flowering', ecTarget: null, amounts: amounts(2, 1) },
  { week: 4, stage: 'flowering', ecTarget: null, amounts: amounts(null, 2) },
];

const ASSET = {
  id: 'biobizz-light-mix',
  name: 'Biobizz · Light·Mix',
  manufacturer: 'Biobizz',
  version: '2025-05',
  plantTypes: [{ key: 'light_mix', name: 'Light·Mix' }],
  defaultPlantType: 'light_mix',
  flipWeek: 3,
  source: { title: 'Biobizz Nutrient Schedule', url: 'https://biobizz.example/chart.pdf', readAt: '2026-09-22' },
  notes: [],
  grid: GRID,
};

const INDEX = { schemes: [{ ...ASSET, weeks: GRID.length, notes: undefined, grid: undefined }] };

const OWN: Scheme = {
  id: 'own-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  ownerId: 'user-1',
  name: 'Biobizz, my way',
  origin: { assetId: 'biobizz-light-mix', version: '2025-05' },
  grid: GRID,
};

const server = { own: [OWN], patched: [] as { id: string; body: SchemeUpdate }[], deleted: [] as string[], asked: [] as string[] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const { pathname } = new URL(String(input), 'http://localhost');
  const method = init?.method ?? 'GET';
  server.asked.push(`${method} ${pathname}`);

  if (pathname === '/assets/schemes/index.json') return json(INDEX);
  if (pathname === '/assets/schemes/biobizz-light-mix.json') return json(ASSET);
  if (pathname === '/v1/schemes' && method === 'GET') return json({ items: server.own, nextCursor: null });
  if (pathname.startsWith('/v1/schemes/') && method === 'PATCH') {
    const id = pathname.slice('/v1/schemes/'.length);
    const body = JSON.parse(String(init?.body)) as SchemeUpdate;
    server.patched.push({ id, body });
    server.own = server.own.map(scheme => (scheme.id === id ? { ...scheme, ...body } : scheme));
    return json(server.own.find(scheme => scheme.id === id));
  }
  if (pathname.startsWith('/v1/schemes/') && method === 'DELETE') {
    const id = pathname.slice('/v1/schemes/'.length);
    server.deleted.push(id);
    server.own = server.own.filter(scheme => scheme.id !== id);
    return new Response(null, { status: 204 });
  }
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
});

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/me/schemes']}>
        <Schemes />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8')) as Record<string, unknown>;
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  server.own = [OWN];
  server.patched = [];
  server.deleted = [];
  server.asked = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('the shipped shelf', () => {
  it('lists each scheme with its maker, its length and the chart it was read at', async () => {
    draw();

    const row = await screen.findByRole('button', { name: /^Biobizz · Light·Mix/ });
    expect(row).toHaveTextContent('Biobizz · 4 weeks · v2025-05');
  });

  it('opens one as a table with nothing to press, and links the chart it came from', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /^Biobizz · Light·Mix/ }));

    const sheet = await screen.findByRole('dialog', { name: 'Biobizz · Light·Mix' });
    expect(await within(sheet).findByRole('columnheader', { name: 'w1' })).toBeInTheDocument();
    expect(within(sheet).getByRole('rowheader', { name: /Bio·Bloom/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Bio·Bloom, week 3' })).not.toBeInTheDocument();
    expect(within(sheet).getByText('Biobizz · 4 weeks · flip week 3')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Biobizz Nutrient Schedule' })).toHaveAttribute('href', 'https://biobizz.example/chart.pdf');
  });
});

describe('the own shelf', () => {
  it('lists each scheme with where it started and its length, and says the shelf is a copy', async () => {
    draw();

    const row = await screen.findByRole('button', { name: /Biobizz, my way/ });
    expect(row).toHaveTextContent('from Biobizz · Light·Mix · 4 weeks');
    expect(screen.getByText(/A scheme on this shelf is a copy/)).toBeInTheDocument();
  });

  it('opens one in the editor and sends the name and the whole grid with the one figure changed', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /Biobizz, my way/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Biobizz, my way' });

    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Bio·Bloom, week 4' }));
    fireEvent.change(within(sheet).getByLabelText('Bio·Bloom, week 4'), { target: { value: '3' } });
    fireEvent.blur(within(sheet).getByLabelText('Bio·Bloom, week 4'));
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Biobizz, my way, stronger' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(server.patched).toHaveLength(1));
    const [{ id, body }] = server.patched;
    expect(id).toBe('own-1');
    expect(body.name).toBe('Biobizz, my way, stronger');
    expect(body.grid).toHaveLength(4);
    expect(body.grid![3].amounts).toEqual(amounts(null, 3));
    expect(body.grid!.slice(0, 3)).toEqual(GRID.slice(0, 3));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('offers the chips a grow has, and can put the grid back to the chart it started from', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /Biobizz, my way/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Biobizz, my way' });

    expect(within(sheet).getByRole('button', { name: '+ product' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Repeat last week' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /^Reset to/ })).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Repeat last week' }));
    expect(within(sheet).getByRole('columnheader', { name: 'w5' })).toBeInTheDocument();
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Reset to Biobizz · Light·Mix' }));
    expect(within(sheet).queryByRole('columnheader', { name: 'w5' })).not.toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('asks before deleting, and then sends exactly one request', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /Biobizz, my way/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Biobizz, my way' });

    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    expect(server.deleted).toEqual([]);
    expect(within(sheet).getByText(/Grows already fed by it keep their own grid/)).toBeInTheDocument();
    // And the half that is not about the grows: the copy itself does not come back.
    expect(within(sheet).getByText(/The copy on your shelf goes for good/)).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete it' }));

    await waitFor(() => expect(server.deleted).toEqual(['own-1']));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText(/You have not kept a scheme of your own yet/)).toBeInTheDocument();
  });
});

describe('the demo', () => {
  it('sees the shipped shelf, is told it has no shelf of its own, and asks the server for nothing', async () => {
    session.demo = true;
    draw();

    expect(await screen.findByRole('button', { name: /^Biobizz · Light·Mix/ })).toBeInTheDocument();
    expect(screen.getByText('The demo has no shelf of its own, so only the shipped schemes are here.')).toBeInTheDocument();
    expect(server.asked.filter(call => call.includes('/v1/'))).toEqual([]);
  });
});
