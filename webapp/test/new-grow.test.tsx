import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, Device, GrowListItem, Space } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import { NewGrowSheet } from '@/screens/grow/new/NewGrowSheet';

/**
 * The new-grow sheet: what it offers, what it promises before the tap, and
 * exactly what the tap sends.
 *
 * Every request goes through the app's own client, mocked at that one seam, so
 * what is asserted is what would go on the wire - two writes, and a third only
 * where the phase would not write the tent's climate itself. The feeding
 * schemes are assets rather than a resource, so they are fetched, and the
 * fixture stands in for the folder a build ships.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

const who = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (who.demo ? ON_THE_DEMO : SIGNED_IN) };
});

const tent = { id: 'space-1', kind: 'tent', name: 'Blue Dream tent', archivedAt: null } as Space;
const balcony = { id: 'space-2', kind: 'balcony', name: 'Balcony', archivedAt: null } as Space;
const controller = { id: 'device-1', type: 'controller', spaceId: 'space-1' } as Device;
const cam = { id: 'cam-1', spaceId: 'space-1', removedAt: null } as Camera;

const placement = (spaceId: string | null, endedAt: string | null) => ({
  id: `placement-${spaceId}`,
  spaceId,
  startedAt: '',
  endedAt,
  plantIds: null,
});

/** The tent's last run, already down: the place is free, and its name is what the next run there is counted from. */
const spring = {
  id: 'grow-1',
  name: 'Spring run',
  startedAt: '2026-08-01T08:00:00.000Z',
  endedAt: '2026-08-28T08:00:00.000Z',
  placements: [placement('space-1', '2026-08-28T08:00:00.000Z')],
} as GrowListItem;

/** Newer than the tent's run and still standing, so a suggestion taken account-wide would be this one. */
const tomatoes = {
  id: 'grow-2',
  name: 'Balcony tomatoes',
  startedAt: '2026-09-01T08:00:00.000Z',
  endedAt: null,
  placements: [placement('space-2', null)],
} as GrowListItem;

const GRID = [{ week: 1, stage: 'seedling', amounts: [{ productKey: 'grow', name: 'Bio·Grow', value: 1, unit: 'ml/l' }] }];

const CATALOGUE = { schemes: [{ id: 'biobizz', name: 'Biobizz · Light·Mix', version: '2' }] };
const SCHEME = {
  id: 'biobizz',
  name: 'Biobizz · Light·Mix',
  manufacturer: 'Biobizz',
  version: '2',
  plantTypes: [{ key: 'soil', name: 'Soil' }],
  defaultPlantType: 'soil',
  flipWeek: 4,
  source: { title: 'Nutrient Schedule', url: 'https://example.invalid/chart.pdf', readAt: '2026-09-22' },
  notes: [],
  grid: GRID,
};

/** The scheme as it goes across once the sheet has read the asset somebody was offered. */
const SENT_SCHEME = {
  origin: { type: 'asset', assetId: 'biobizz', version: '2' },
  strength: 1,
  waterEc: null,
  plantType: 'soil',
  flipWeek: 4,
  edited: false,
  grid: GRID,
};

/** What the account holds, per test: the places, the grows already run, and what stands in them. */
const stack = { spaces: [tent, balcony] as Space[], grows: [spring, tomatoes] as GrowListItem[], devices: [controller], cameras: [cam] };

/** Which reads fail, per test: a read that failed is a state the sheet has to draw, not an empty list. */
const broken = { devices: false, schemes: false };

const answers = (path: string): unknown => {
  if (path === '/spaces') return { items: stack.spaces, nextCursor: null };
  if (path === '/grows') return { items: stack.grows, nextCursor: null };
  if (path === '/devices') return { items: stack.devices, nextCursor: null };
  if (path === '/cameras') return { items: stack.cameras, nextCursor: null };
  throw new Error(`No fixture for ${path}`);
};

const draw = (spaceId?: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <NewGrowSheet spaceId={spaceId} onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/**
 * The sheet waits for the places, the grows and the scheme index; the questions
 * are drawn once they are there, and the primary is live from that moment -
 * nothing on the sheet has to be filled in first.
 */
const drawLoaded = async (spaceId?: string) => {
  const drawn = draw(spaceId);
  await waitFor(() => expect(screen.getByRole('button', { name: /Start the grow/ })).toBeEnabled());

  return drawn;
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  who.demo = false;
  stack.spaces = [tent, balcony];
  stack.grows = [spring, tomatoes];
  stack.devices = [controller];
  stack.cameras = [cam];
  broken.devices = false;
  broken.schemes = false;

  vi.mocked(api.get).mockImplementation((path: string) =>
    path === '/devices' && broken.devices ? (Promise.reject(new Error('down')) as never) : (Promise.resolve(answers(path)) as never),
  );
  vi.mocked(api.post).mockResolvedValue({ id: 'grow-new' } as never);

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: !broken.schemes,
      status: broken.schemes ? 500 : 200,
      json: async () => (url.endsWith('index.json') ? CATALOGUE : SCHEME),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const sow = (strain: string) => fireEvent.change(screen.getByPlaceholderText('Strain'), { target: { value: strain } });

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('the new-grow sheet', () => {
  it('asks the board’s six questions, with what stands in each place beside its name', async () => {
    await drawLoaded();

    expect(screen.getByRole('dialog', { name: 'New grow' })).toBeInTheDocument();
    expect(screen.getByText('a count is enough; names help you compare later')).toBeInTheDocument();
    expect(screen.getByText('autoflowers skip the 12/12 flip and feed lighter')).toBeInTheDocument();
    expect(screen.getByText("the space's preset and cams follow the grow")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Blue Dream tent · Controller + Cam' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Balcony' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Germination · today' })).toBeInTheDocument();

    // The board opens on the first shipped scheme; "None / my own" is a choice, not the default.
    expect(screen.getByRole('button', { name: 'Biobizz · Light·Mix' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'None / my own' })).toHaveAttribute('aria-pressed', 'false');

    // The run after the last one *here*, offered rather than filled in - the
    // account's newest run stands on the balcony and is not what the tent is counted from.
    expect(screen.getByRole('button', { name: 'Spring run #2' })).toBeInTheDocument();
    expect(screen.getByText('Blue Dream tent goes on the Germination preset now.')).toBeInTheDocument();
  });

  it('counts the suggestion over the place that is chosen, not over the account', async () => {
    await drawLoaded();

    press('Balcony');
    expect(screen.getByRole('button', { name: 'Balcony tomatoes #2' })).toBeInTheDocument();

    press('Blue Dream tent · Controller + Cam');
    expect(screen.getByRole('button', { name: 'Spring run #2' })).toBeInTheDocument();
  });

  it('sets its five hints in the text face, because they are advice and not figures', async () => {
    await drawLoaded();

    const hints = [
      'a count is enough; names help you compare later',
      'autoflowers skip the 12/12 flip and feed lighter',
      "the space's preset and cams follow the grow",
      'seeds usually show in 2\u20135 days',
      'a starting point, not a rule; edit any week',
    ];
    for (const hint of hints) expect(screen.getByText(hint).className).not.toMatch(/mono/);
  });

  it('offers an account with nothing a place to invent and a name to start from', async () => {
    stack.spaces = [];
    stack.grows = [];
    stack.devices = [];
    stack.cameras = [];
    await drawLoaded();

    expect(screen.queryByRole('button', { name: /Blue Dream/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New space' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'First grow' })).toBeInTheDocument();
    expect(screen.getByText('No place, so nothing is steered; the stages are recorded all the same.')).toBeInTheDocument();
  });

  it('sends the grow with the scheme it opened on, then its first stage, then the tent’s climate', async () => {
    await drawLoaded();

    sow('Amnesia');
    press('One more');
    press('Start the grow · Day 1');

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
    expect(api.post).toHaveBeenNthCalledWith(1, '/grows', {
      name: 'Spring run #2',
      type: 'photoperiod',
      startedAt: expect.any(String),
      spaceId: 'space-1',
      plants: [{ strain: 'Amnesia', count: 2 }],
      scheme: SENT_SCHEME,
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/grows/grow-new/phases', { stage: 'germination', preset: null, startedAt: expect.any(String) });
    // The phase writes no climate without a preset of its own, so the stage is applied to the tent as well.
    expect(api.post).toHaveBeenNthCalledWith(3, '/spaces/space-1/preset-applications', { stage: 'germination', preset: null });
  });

  // The hint over the field says a count is enough, and the primary has to mean it.
  it('starts a grow from a count alone, sending the unnamed row under a stand-in name', async () => {
    await drawLoaded();

    press('One more');
    press('One more');
    press('Start the grow · Day 1');

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenNthCalledWith(1, '/grows', expect.objectContaining({ plants: [{ strain: 'Unnamed', count: 3 }] }));
  });

  it('gives an autoflower its own preset and the scheme at half strength, and writes the climate once', async () => {
    await drawLoaded();

    sow('Gelato');
    press('Autoflower');
    press('Veg');

    expect(screen.getByText('Autoflower: the presets keep 18–20 h of light, and the scheme runs at half strength.')).toBeInTheDocument();
    press('Start the grow · Day 1');

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenNthCalledWith(1, '/grows', {
      name: 'Spring run #2',
      type: 'autoflower',
      startedAt: expect.any(String),
      spaceId: 'space-1',
      plants: [{ strain: 'Gelato', count: 1 }],
      scheme: { ...SENT_SCHEME, strength: 0.5, flipWeek: null },
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/grows/grow-new/phases', {
      stage: 'vegetative',
      preset: 'autoflower',
      startedAt: expect.any(String),
    });
  });

  it('leaves the grow standing when its first stage is refused, and retries only that', async () => {
    const refusal = new ApiError({ status: 409, code: 'phase_refused', title: 'Conflict', detail: 'That day is before the grow began.', errors: [] });
    vi.mocked(api.post)
      .mockResolvedValueOnce({ id: 'grow-new' } as never)
      .mockRejectedValueOnce(refusal);
    await drawLoaded();

    sow('Amnesia');
    press('Start the grow · Day 1');

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That day is before the grow began.'));
    expect(screen.getByRole('status')).toHaveTextContent('The grow is made and stands where it was put');

    press('Start the grow · Day 1');
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(4));
    // One grow, three attempts at what follows it: the second tap carries on rather than starting again.
    expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/grows')).toHaveLength(1);
    expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/grows/grow-new/phases')).toHaveLength(2);
  });

  it('offers the demo no way to start one', async () => {
    who.demo = true;
    draw();

    await waitFor(() => expect(screen.getByText('The demo may look at a grow, not start one.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Start the grow/ })).not.toBeInTheDocument();
  });
});

describe('where the plants go', () => {
  it('opens on the first place with nothing standing in it', async () => {
    stack.grows = [{ ...spring, endedAt: null, placements: [placement('space-1', null)] } as GrowListItem, tomatoes];
    stack.spaces = [tent, balcony, { id: 'space-3', kind: 'tent', name: 'Mother tent', archivedAt: null } as Space];
    await drawLoaded();

    expect(screen.getByRole('button', { name: 'Mother tent' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Blue Dream tent · Controller + Cam' })).toHaveAttribute('aria-pressed', 'false');
  });

  // The tap that starts the grow is never the first time the tent it disturbs is named.
  it('says what is already growing where the plants are being sent, and what that costs', async () => {
    stack.grows = [{ ...spring, endedAt: null, placements: [placement('space-1', null)] } as GrowListItem, tomatoes];
    await drawLoaded();

    press('Blue Dream tent · Controller + Cam');

    const warning =
      'Spring run is already growing in Blue Dream tent: its climate goes to the Germination preset now, and a plan running there pauses.';
    expect(screen.getAllByText(warning)).toHaveLength(2);
  });

  it('honours the place it was opened for, and falls back where that place is gone', async () => {
    const { unmount } = await drawLoaded('space-2');
    expect(screen.getByRole('button', { name: 'Balcony' })).toHaveAttribute('aria-pressed', 'true');
    unmount();

    await drawLoaded('space-gone');
    expect(screen.getByRole('button', { name: 'Blue Dream tent · Controller + Cam' })).toHaveAttribute('aria-pressed', 'true');
  });

  // A chosen chip is the place the grow goes, so "New space" cannot leave the
  // previous tent held behind it and written to on the way out.
  it('lets go of the held place while a new one is being invented, and keeps the primary out of reach', async () => {
    await drawLoaded();

    press('New space');

    expect(screen.getByRole('button', { name: 'Blue Dream tent · Controller + Cam' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Blue Dream tent goes on the Germination preset now.')).not.toBeInTheDocument();
    expect(screen.getByText('Make the place first, or pick one of the chips.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start the grow · Day 1' })).toBeDisabled();
  });
});

describe('a read that failed', () => {
  it('says the hardware could not be read rather than drawing places with none', async () => {
    broken.devices = true;
    await drawLoaded();

    expect(screen.getByRole('button', { name: 'Blue Dream tent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Controller/ })).not.toBeInTheDocument();
    expect(screen.getByText(/What stands in these places could not be read/)).toBeInTheDocument();
    expect(
      screen.getByText('What stands in Blue Dream tent is not known, so no climate is written there; the stages are recorded all the same.'),
    ).toBeInTheDocument();

    sow('Amnesia');
    press('Start the grow · Day 1');

    // Two writes, not three: a climate is never written to hardware nobody could confirm.
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.post).mock.calls.map(([path]) => path)).toEqual(['/grows', '/grows/grow-new/phases']);
  });

  it('tells a failed scheme index apart from a build that ships none', async () => {
    broken.schemes = true;
    draw();

    await waitFor(() => expect(screen.getByText(/The feeding schemes could not be read/)).toBeInTheDocument());
    expect(screen.queryByText(/This build ships no feeding schemes/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'None / my own' })).toHaveAttribute('aria-pressed', 'true');
  });
});
