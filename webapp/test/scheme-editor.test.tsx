import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrowListItem, GrowScheme, SchemeWeek } from '@fg2/shared-types/v1';
import { Feeding } from '@/screens/grow/Feeding';
import { forgetSchemeEdit } from '@/screens/grow/scheme/edit-store';
import { ON_THE_DEMO, SIGNED_IN } from './session';

/**
 * What the Feeding tab promises: that it draws the grid the grow carries and
 * not the chart it came from, that one Save sends that whole grid with the
 * figure just typed in it and nothing else moved, that a refusal is said where
 * the tap was, and that a session which may only look is offered no control it
 * would be refused.
 *
 * The API is stubbed at the wire rather than at the hook, because the body is
 * the point: a grid patched a cell at a time, or patched without its `edited`
 * flag, would pass every test written against the screen alone.
 */

const session = { user: SIGNED_IN };

vi.mock('@/api/session', async importOriginal => ({ ...(await importOriginal<object>()), useSession: () => session.user }));

const amounts = (grow: number | null, bloom: number | null, calMag: number | null) => [
  { productKey: 'bio_grow', name: 'Bio·Grow', value: grow, unit: 'ml/l' },
  { productKey: 'bio_bloom', name: 'Bio·Bloom', value: bloom, unit: 'ml/l' },
  { productKey: 'cal_mag', name: 'Cal·Mag', value: calMag, unit: 'g/l' },
];

const GRID: SchemeWeek[] = [
  { week: 1, stage: 'seedling', ecTarget: 0.4, amounts: amounts(1, null, null) },
  { week: 2, stage: 'vegetative', ecTarget: 0.8, amounts: amounts(2, null, 0.5) },
  { week: 3, stage: 'vegetative', ecTarget: 0.8, amounts: amounts(2, 1, 0.5) },
  { week: 4, stage: 'flowering', ecTarget: 1.2, amounts: amounts(2, 2, 0.5) },
  { week: 5, stage: 'flowering', ecTarget: 1.4, amounts: amounts(null, 2, 0.5) },
  { week: 6, stage: 'flowering', ecTarget: null, amounts: amounts(null, 3, 0.5) },
];

const SCHEME: GrowScheme = {
  origin: { type: 'asset', assetId: 'biobizz-light-mix', version: '2025-05' },
  strength: 1,
  waterEc: 0.4,
  plantType: 'light_mix',
  flipWeek: 4,
  edited: true,
  grid: GRID,
};

const growOn = (scheme: GrowScheme | null): GrowListItem =>
  ({
    id: 'grow-1',
    ownerId: 'user-1',
    name: 'Spring run',
    type: 'photoperiod',
    scheme,
    measurements: [],
    summary: { dayNumber: 35, stage: 'flowering', preset: 'flower', phaseDay: 11, weekNumber: 5, isAuto: false, groups: [], locations: [] },
  }) as unknown as GrowListItem;

const INDEX = {
  schemes: [
    {
      id: 'biobizz-light-mix',
      name: 'Biobizz · Light·Mix',
      manufacturer: 'Biobizz',
      version: '2025-05',
      plantTypes: [
        { key: 'light_mix', name: 'Light·Mix' },
        { key: 'coco_mix', name: 'Coco·Mix' },
      ],
      defaultPlantType: 'light_mix',
      weeks: 6,
      flipWeek: 4,
      source: { title: 'chart', url: 'https://example.invalid', readAt: '2026-09-22' },
    },
  ],
};

interface Call {
  method: string;
  path: string;
  body: any;
}

const wire = {
  calls: [] as Call[],
  refuseSave: null as { status: number; code: string; detail: string } | null,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const problem = (status: number, code: string, detail: string) => json({ status, code, title: code, detail, errors: [] }, status);

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    wire.calls.push({ method, path, body });

    if (path === '/assets/schemes/index.json') return json(INDEX);
    if (path === '/assets/schemes/biobizz-light-mix.json') return json({ ...INDEX.schemes[0], notes: [], grid: GRID });
    if (method === 'GET' && path === '/schemes') return json({ items: [], nextCursor: null });
    if (method === 'POST' && path === '/schemes') return json({ id: 'own-1', createdAt: '2026-09-22T10:00:00.000Z', ownerId: 'user-1', ...body });
    if (method === 'PATCH' && path === '/grows/grow-1') {
      return wire.refuseSave ? problem(wire.refuseSave.status, wire.refuseSave.code, wire.refuseSave.detail) : json({ ...growOn(body.scheme) });
    }
    return problem(404, 'not_found', `No stub for ${method} ${path}`);
  }),
);

// Whether the grid may be changed is the grow page's question, asked of the
// tent this grow stands in; this screen is handed the answer.
const drawing = (grow: GrowListItem, queryClient: QueryClient, mayManage = true) => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <Feeding grow={grow} mayManage={mayManage} />
    </MemoryRouter>
  </QueryClientProvider>
);

/** `rerender` takes the grow rather than the tree, because what moves under this screen is the grow. */
const draw = (grow: GrowListItem, mayManage = true) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const drawn = render(drawing(grow, queryClient, mayManage));

  return { ...drawn, rerender: (next: GrowListItem) => drawn.rerender(drawing(next, queryClient, mayManage)) };
};

/** The tab once the shipped index has been read, which is when the scheme has a name rather than an id. */
const drawn = async (grow = growOn(SCHEME), mayManage = true) => {
  draw(grow, mayManage);
  return screen.findByText('Biobizz · Light·Mix');
};

const patched = () => wire.calls.filter(call => call.method === 'PATCH');

const posted = () => wire.calls.filter(call => call.method === 'POST' && call.path === '/schemes');

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  wire.calls = [];
  wire.refuseSave = null;
  session.user = SIGNED_IN;
  // One edit is held for the life of a tab, so each test is a fresh tab.
  forgetSchemeEdit();
});

describe('the feeding tab', () => {
  it('says a grow is fed nothing, and offers the one thing that helps', () => {
    draw(growOn(null));

    expect(screen.getByText('No feeding scheme')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a scheme' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says of a grow that is over what it was fed, and still offers the grid, which is its record', () => {
    // The grid a finished grow carries is what it really got: its report and
    // its export read it, so filling one in afterwards is a repair rather than
    // advice about a grow that is still going.
    draw({ ...growOn(null), endedAt: '2026-08-24T15:31:56.000Z' });

    expect(screen.getByText(/This grow was fed no scheme/)).toBeInTheDocument();
    expect(screen.queryByText(/This grow is fed no scheme/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a scheme' })).toBeInTheDocument();
  });

  it('draws where the grid came from, what the grow decided for itself, and the week grid with this week marked', async () => {
    await drawn();

    expect(screen.getByText('Based on')).toBeInTheDocument();
    expect(screen.getByText(/edited · v2025-05/)).toBeInTheDocument();

    // The four the grow decides rather than the chart.
    expect(screen.getByRole('combobox', { name: 'Strength' })).toHaveValue('1');
    expect(screen.getByRole('spinbutton', { name: 'Water EC' })).toHaveValue(0.4);
    expect(screen.getByText('tap')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('light_mix');
    expect(screen.getByRole('combobox', { name: 'Flip' })).toHaveValue('4');

    // A row per product, a column per week, and the week the grow is in named.
    expect(screen.getByRole('columnheader', { name: 'w1' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'w5' })).toHaveAttribute('data-current', 'true');
    expect(screen.getByRole('rowheader', { name: /Bio·Grow/ })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Cal·Mag/ })).toHaveTextContent('g/l');
    expect(screen.getByRole('button', { name: 'Bio·Bloom, week 5' })).toHaveTextContent('2');
    // A week the row is not dosed in is "not this week" rather than nothing at all.
    expect(screen.getByRole('button', { name: 'Bio·Grow, week 5' })).toHaveTextContent('–');

    expect(screen.getByText(/Week 5 is this week/)).toHaveTextContent('The flip to flower is week 4');
    expect(screen.getByText(/A scheme kept on your own shelf is a copy/)).toBeInTheDocument();
  });

  it('sends the whole grid with the one figure changed, and nothing else moved', async () => {
    await drawn();

    fireEvent.click(screen.getByRole('button', { name: 'Bio·Bloom, week 5' }));
    fireEvent.change(screen.getByLabelText('Bio·Bloom, week 5'), { target: { value: '3' } });
    fireEvent.blur(screen.getByLabelText('Bio·Bloom, week 5'));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patched()).toHaveLength(1));
    expect(patched()[0].path).toBe('/grows/grow-1');
    expect(patched()[0].body).toEqual({
      scheme: {
        ...SCHEME,
        edited: true,
        grid: GRID.map(week => (week.week === 5 ? { ...week, amounts: amounts(null, 3, 0.5) } : week)),
      },
    });
  });

  it('says what the server said when the save was refused, and keeps the edit on the screen', async () => {
    wire.refuseSave = { status: 422, code: 'measurement_key_twice', detail: 'This grow already measures that.' };
    await drawn();

    fireEvent.click(screen.getByRole('button', { name: 'Bio·Grow, week 1' }));
    fireEvent.change(screen.getByLabelText('Bio·Grow, week 1'), { target: { value: '2' } });
    fireEvent.blur(screen.getByLabelText('Bio·Grow, week 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This grow already measures that.');
    expect(screen.getByRole('button', { name: 'Bio·Grow, week 1' })).toHaveTextContent('2');
  });

  it('adds a product to every week at once, and takes one away again', async () => {
    await drawn();

    fireEvent.click(screen.getByRole('button', { name: '+ product' }));
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Silica' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByRole('button', { name: 'Silica, week 1' })).toHaveTextContent('–');
    expect(screen.getByRole('button', { name: 'Silica, week 6' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Silica' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Silica' }));
    expect(screen.queryByRole('button', { name: 'Silica, week 1' })).not.toBeInTheDocument();
  });

  it('lengthens the bloom by repeating its last week, and stops offering to once it is long enough', async () => {
    await drawn();

    fireEvent.click(screen.getByRole('button', { name: 'Stretch to 10 flower weeks' }));

    expect(screen.getByRole('columnheader', { name: 'w13' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bio·Bloom, week 13' })).toHaveTextContent('3');
    expect(screen.queryByRole('button', { name: /Stretch to/ })).not.toBeInTheDocument();
  });

  it('keeps the grid on the grower’s own shelf, with the asset and version it started from', async () => {
    await drawn();

    fireEvent.click(screen.getByRole('button', { name: 'Feeding scheme' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Biobizz, my way' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0].body).toEqual({ name: 'Biobizz, my way', origin: { assetId: 'biobizz-light-mix', version: '2025-05' }, grid: GRID });
    expect(await screen.findByText('Kept as Biobizz, my way.')).toBeInTheDocument();
    // Saving a copy is not a change to the grow, so nothing was patched.
    expect(patched()).toHaveLength(0);
  });

  /**
   * The EC row is the chart's target read back on the grower's own water, and
   * the one row nobody types into: it is what the doses and the water amount
   * to, so it moves when one of those does.
   */
  it('draws the chart\u2019s EC target on top of the water the grow is fed, and never as a cell to edit', async () => {
    await drawn();

    const row = screen.getByRole('row', { name: /EC target/ });
    // The grow's water measures 0.4, so a chart figure of 0.8 is a meter reading of 1.2.
    expect(
      within(row)
        .getAllByRole('cell')
        .map(cell => cell.textContent),
    ).toEqual(['0.8', '1.2', '1.2', '1.6', '1.8', '\u2013']);
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/EC values are what your meter should read/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Water EC' }), { target: { value: '0.9' } });
    expect(within(screen.getByRole('row', { name: /EC target/ })).getAllByRole('cell')[0]).toHaveTextContent('1.3');
  });

  it('leaves the EC row and its caption out where the chart publishes none', async () => {
    const plain = GRID.map(week => ({ ...week, ecTarget: null }));
    await drawn(growOn({ ...SCHEME, grid: plain }));

    expect(screen.queryByRole('row', { name: /EC target/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/EC values are what your meter should read/)).not.toBeInTheDocument();
  });

  /**
   * The grid belongs to the grow and not to the reader, so a screen with
   * nothing typed into it follows what the grow says - otherwise the figures on
   * a second device go on being the ones that used to feed these plants, and
   * the bar says "not saved" about a change nobody made.
   */
  it('follows a correction saved elsewhere while nothing has been typed here', async () => {
    const { rerender } = draw(growOn(SCHEME));
    await screen.findByText('Biobizz \u00b7 Light\u00b7Mix');

    const elsewhere = { ...SCHEME, grid: GRID.map(week => (week.week === 1 ? { ...week, amounts: amounts(3, null, null) } : week)) };
    rerender(growOn(elsewhere));

    expect(screen.getByRole('button', { name: 'Bio\u00b7Grow, week 1' })).toHaveTextContent('3');
    expect(screen.queryByText('not saved')).not.toBeInTheDocument();
  });

  /**
   * The other half of the same rule: a grid that moved under somebody who *is*
   * part way through changing it is a choice, never a silent overwrite.
   */
  it('says the grid was changed elsewhere rather than putting the older one back over it', async () => {
    const { rerender } = draw(growOn(SCHEME));
    await screen.findByText('Biobizz \u00b7 Light\u00b7Mix');

    fireEvent.click(screen.getByRole('button', { name: 'Bio\u00b7Grow, week 1' }));
    fireEvent.change(screen.getByLabelText('Bio\u00b7Grow, week 1'), { target: { value: '5' } });
    fireEvent.blur(screen.getByLabelText('Bio\u00b7Grow, week 1'));

    const elsewhere = { ...SCHEME, grid: GRID.map(week => (week.week === 1 ? { ...week, amounts: amounts(3, null, null) } : week)) };
    rerender(growOn(elsewhere));

    expect(screen.getByRole('alert')).toHaveTextContent('changed elsewhere');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Take theirs' }));
    expect(screen.getByRole('button', { name: 'Bio\u00b7Grow, week 1' })).toHaveTextContent('3');
    expect(screen.queryByText('changed elsewhere')).not.toBeInTheDocument();
  });

  it('keeps the edit when the reader decides theirs is the grid that stands, and sends that one', async () => {
    const { rerender } = draw(growOn(SCHEME));
    await screen.findByText('Biobizz \u00b7 Light\u00b7Mix');

    fireEvent.click(screen.getByRole('button', { name: 'Bio\u00b7Grow, week 1' }));
    fireEvent.change(screen.getByLabelText('Bio\u00b7Grow, week 1'), { target: { value: '5' } });
    fireEvent.blur(screen.getByLabelText('Bio\u00b7Grow, week 1'));

    const elsewhere = { ...SCHEME, grid: GRID.map(week => (week.week === 1 ? { ...week, amounts: amounts(3, null, null) } : week)) };
    rerender(growOn(elsewhere));
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patched()).toHaveLength(1));
    expect(patched()[0].body.scheme.grid[0].amounts[0].value).toBe(5);
  });

  /** The grow page mounts one tab at a time, so leaving the tab must not be how a half-filled grid is thrown away. */
  it('still has the unsaved grid after the tab was left and come back to', async () => {
    const { unmount } = draw(growOn(SCHEME));
    await screen.findByText('Biobizz \u00b7 Light\u00b7Mix');

    fireEvent.click(screen.getByRole('button', { name: 'Bio\u00b7Grow, week 1' }));
    fireEvent.change(screen.getByLabelText('Bio\u00b7Grow, week 1'), { target: { value: '7' } });
    fireEvent.blur(screen.getByLabelText('Bio\u00b7Grow, week 1'));
    unmount();

    await drawn();
    expect(screen.getByRole('button', { name: 'Bio\u00b7Grow, week 1' })).toHaveTextContent('7');
    expect(screen.getByText('not saved')).toBeInTheDocument();
  });

  // The demo and a member who may only write lines reach this tab the same way:
  // the grow page works out what they may do and hands it down, and the tab
  // draws the figures either way.
  it('shows somebody who may not change it the same figures and none of the controls', async () => {
    session.user = ON_THE_DEMO;
    await drawn(growOn(SCHEME), false);

    expect(screen.getAllByRole('cell', { name: '2' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Bio·Bloom, week 5' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Feeding scheme' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Tap a cell to edit/)).not.toBeInTheDocument();
  });
});
