import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Device, GrowListItem, Space } from '@fg2/shared-types/v1';
import type { Told } from '@/log/log-context';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import { StartGrowSheet } from '@/screens/grow/new/WhatGrows';
import { drawAt } from './harness';
import { Toast } from './toast';
import { fridge } from './place-wire';
import { spaceWhere } from './session';
import { translate } from './translations';

/**
 * The one form a grow is started with, behind every "Start a grow": what it
 * opens on, what it asks, and exactly what the tap sends.
 *
 * Every request goes through the app's own client, mocked at that one seam, so
 * what is asserted is what would go on the wire - the grow and its first
 * phase, and the place's climate only where the grower chose the stage.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

// Starting a grow in a place is managing it, so the places carry the standing that decides whether the form offers them.
const tent = spaceWhere('own', { id: 'space-1', kind: 'tent', name: 'Blue Dream tent' });
const balcony = spaceWhere('own', { id: 'space-2', kind: 'balcony', name: 'Balcony' });
const guests = spaceWhere('log', { id: 'space-3', kind: 'tent', name: 'A friend´s tent' });
/** Twelve hours of light, and figures nobody took from a preset: a flowering tent. */
const controller = fridge({ type: 'controller' });

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
  summary: { locations: [] },
} as unknown as GrowListItem;

/** Still standing in the tent: a second grow would join it. */
const standing = {
  id: 'grow-2',
  name: 'Autumn run',
  startedAt: '2026-09-01T08:00:00.000Z',
  endedAt: null,
  placements: [placement('space-1', null)],
  summary: { locations: [{ spaceId: 'space-1' }] },
} as unknown as GrowListItem;

const stack = {
  spaces: [tent, balcony] as Space[],
  grows: [spring] as GrowListItem[],
  devices: [controller] as Device[],
  sockets: [] as string[],
  /** The device the server names as the place's climate; none named is the first standing there. */
  climate: null as string | null,
};

const answers = (path: string): unknown => {
  if (path === '/devices/device-1/sockets') return { items: stack.sockets.map((role, slot) => ({ slot, role })), nextCursor: null };
  if (/^\/devices\/[^/]+\/sockets$/.test(path)) return { items: [], nextCursor: null };
  if (/^\/spaces\/[^/]+\/overview$/.test(path)) return { climates: stack.climate ? [{ deviceId: stack.climate }] : [] };
  if (path === '/spaces') return { items: stack.spaces, nextCursor: null };
  if (path === '/grows') return { items: stack.grows, nextCursor: null };
  if (path === '/devices') return { items: stack.devices, nextCursor: null };
  if (path === '/me') return { preferences: { diary: null } };
  throw new Error(`No fixture for ${path}`);
};

/** What the form's toast was told. */
let told: Told[] = [];

const draw = (spaceId?: string) =>
  drawAt(
    <Toast told={told}>
      <StartGrowSheet spaceId={spaceId} name={spaceId ? tent.name : null} onClose={() => undefined} />
    </Toast>,
  );

/** The form waits for the stage the place is on before it chooses one, and is live from then on. */
const drawLoaded = async (spaceId?: string) => {
  const drawn = draw(spaceId);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start a grow' })).toBeEnabled());

  return drawn;
};

const stage = (name: string) => screen.getByRole('button', { name });
const sent = (path: string) => vi.mocked(api.post).mock.calls.find(call => call[0] === path)?.[1];

beforeAll(() => translate());

beforeEach(() => {
  told = [];
  stack.spaces = [tent, balcony];
  stack.grows = [spring];
  stack.devices = [controller];
  stack.sockets = [];
  stack.climate = null;
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.post).mockResolvedValue({ id: 'grow-new' } as never);
});

afterEach(() => vi.clearAllMocks());

describe('the form a grow is started with', () => {
  it('is named after the place it was opened for, and asks what cannot wait and nothing else', async () => {
    await drawLoaded('space-1');

    const sheet = screen.getByRole('dialog', { name: 'Blue Dream tent: What grows here?' });
    expect(within(sheet).getByRole('textbox', { name: 'Strain or name' })).toBeInTheDocument();
    expect(within(sheet).getByRole('combobox', { name: 'Since when?' })).toBeInTheDocument();
    expect(within(sheet).getByRole('spinbutton', { name: 'Plants' })).toBeInTheDocument();
    // The place is answered already, and nothing is explained above the button.
    expect(within(sheet).queryByRole('combobox', { name: 'Where' })).not.toBeInTheDocument();
    expect(sheet.querySelector('p')).toBeNull();
  });

  it('opens on the stage the place is on, once its device has said so', async () => {
    let answer: (devices: unknown) => void = () => undefined;
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === '/devices' ? (new Promise(resolve => (answer = resolve)) as never) : (Promise.resolve(answers(path)) as never),
    );
    draw('space-1');

    // Until the device has answered nothing is chosen, and nothing can be sent on a guess.
    await screen.findByRole('button', { name: 'Flower' });
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Start a grow' })).toBeDisabled();

    answer({ items: [controller], nextCursor: null });
    await waitFor(() => expect(stage('Flower')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('opens on growth where nothing says which stage the place is on', async () => {
    stack.devices = [];
    await drawLoaded('space-1');

    expect(stage('Veg')).toHaveAttribute('aria-pressed', 'true');
  });

  it('records the stage it opened on and moves nothing in the place', async () => {
    await drawLoaded('space-1');
    fireEvent.change(screen.getByRole('textbox', { name: 'Strain or name' }), { target: { value: 'Amnesia' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Plants' }), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));

    await waitFor(() => expect(sent('/grows/grow-new/phases')).toBeDefined());
    expect(sent('/grows')).toMatchObject({
      name: 'Amnesia',
      type: 'photoperiod',
      spaceId: 'space-1',
      plants: [{ strain: 'Amnesia', count: 4 }],
      scheme: null,
    });
    expect(sent('/grows/grow-new/phases')).toMatchObject({ stage: 'flowering', preset: null });
    expect(sent('/grows/grow-new/phases')).not.toHaveProperty('climate');
    expect(vi.mocked(api.post).mock.calls.map(call => call[0])).toEqual(['/grows', '/grows/grow-new/phases']);
  });

  /** A count the form cannot read is refused in words that say what it takes, never turned into one it can. */
  it('refuses a plant count that is no whole number from 1, and starts nothing until it is one', async () => {
    await drawLoaded('space-1');
    const plants = screen.getByRole('spinbutton', { name: 'Plants' });

    for (const typed of ['0', '-3', '2.5', '']) {
      fireEvent.change(plants, { target: { value: typed } });
      expect(plants).toHaveValue(typed === '' ? null : Number(typed));
      expect(plants).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent('Plants: a whole number from 1.');
      expect(screen.getByRole('button', { name: 'Start a grow' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Start a grow' })).toHaveAccessibleDescription('Plants: a whole number from 1.');
    }

    fireEvent.change(plants, { target: { value: '3' } });
    expect(plants).not.toHaveAttribute('aria-invalid');
    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));
    await waitFor(() => expect(sent('/grows')).toMatchObject({ plants: [{ count: 3 }] }));
  });

  // The stage's name stands whole on the button: no line of it ends on the dot.
  it('puts the place on a stage the grower chose, and the button says so before the tap', async () => {
    await drawLoaded('space-1');

    fireEvent.click(stage('Seedling'));
    fireEvent.click(screen.getByRole('button', { name: 'Start · climate: Seedling\u00a0·\u00a0with\u00a0light' }));

    await waitFor(() => expect(sent('/grows/grow-new/phases')).toMatchObject({ stage: 'seedling', preset: null, climate: true }));
    // The grow's page is its own answer; that the place's targets were written with it is said, since nothing there shows it.
    await waitFor(() => expect(told).toHaveLength(1));
    expect(told[0]).toMatchObject({ label: expect.stringMatching(/ started · targets set$/), undo: null });
  });

  it('writes no climate for the stage the place is already on, though it was tapped', async () => {
    await drawLoaded('space-1');

    fireEvent.click(stage('Flower'));
    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));

    await waitFor(() => expect(sent('/grows/grow-new/phases')).toBeDefined());
    expect(sent('/grows/grow-new/phases')).not.toHaveProperty('climate');
    // A grow started without a climate is answered by its page alone.
    expect(told).toEqual([]);
  });

  it('only records seeds beside a grow already growing there: their darkness is not that grow´s', async () => {
    stack.grows = [standing];
    await drawLoaded('space-1');

    fireEvent.click(stage('Germination'));
    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));

    await waitFor(() => expect(sent('/grows/grow-new/phases')).toMatchObject({ stage: 'germination' }));
    expect(sent('/grows/grow-new/phases')).not.toHaveProperty('climate');
  });

  /** The owner's decision: what germination does about the humidity is chosen with every way germination is set. */
  it('asks what germination does about the humidity where it puts the place into germination, and sends what was moved', async () => {
    stack.sockets = ['humidifier'];
    await drawLoaded('space-1');
    expect(screen.queryByRole('group', { name: 'During germination' })).not.toBeInTheDocument();
    // On a short screen they open behind the sheet's foot, so they are brought into view - again with the humidifier's switch.
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;
    onTestFinished(() => void Reflect.deleteProperty(Element.prototype, 'scrollIntoView'));

    fireEvent.click(stage('Germination'));
    const choices = screen.getByRole('group', { name: 'During germination' });
    expect(intoView.mock.contexts[0]).toBe(choices);
    const shown = intoView.mock.calls.length;
    expect(await within(choices).findByText('The humidifier holds 75 % – it never makes it wetter than that.')).toBeInTheDocument();
    expect(intoView.mock.calls.length).toBeGreaterThan(shown);
    fireEvent.click(within(choices).getByRole('switch', { name: 'Warn when it gets too humid' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start · climate: Germination\u00a0·\u00a0dark' }));

    await waitFor(() =>
      expect(sent('/grows/grow-new/phases')).toMatchObject({ stage: 'germination', climate: true, germinationChoices: { warnTooHumid: true } }),
    );
  });

  it('sends no choice of germination that nobody moved, and offers a humidifier’s only where one is paired', async () => {
    await drawLoaded('space-1');

    fireEvent.click(stage('Germination'));
    expect(screen.getByRole('switch', { name: 'Warn when it gets too humid' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Hold the humidity with the humidifier' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start · climate: Germination\u00a0·\u00a0dark' }));

    await waitFor(() => expect(sent('/grows/grow-new/phases')).toMatchObject({ stage: 'germination', climate: true }));
    expect(sent('/grows/grow-new/phases')).not.toHaveProperty('germinationChoices');
  });

  it('asks both choices of the device the climate preset is taken on, also where another controller stands in the place before it', async () => {
    stack.devices = [fridge({ id: 'device-0', type: 'controller' }), controller];
    stack.sockets = ['humidifier'];
    stack.climate = 'device-1';
    await drawLoaded('space-1');

    fireEvent.click(stage('Germination'));
    const choices = screen.getByRole('group', { name: 'During germination' });
    expect(await within(choices).findByRole('switch', { name: 'Hold the humidity with the humidifier' })).toBeInTheDocument();
    expect(within(choices).getByRole('switch', { name: 'Warn when it gets too humid' })).toBeInTheDocument();
  });

  it('opens on the stage of that device too, not of the first controller standing in the place', async () => {
    // Eighteen hours of light: growth, beside a flowering controller the place does not name.
    const growing = fridge({ type: 'controller', configuration: { ...controller.configuration, daynight: { day: 6 * 3600, night: 0 } } });
    stack.devices = [fridge({ id: 'device-0', type: 'controller' }), growing];
    stack.climate = 'device-1';
    await drawLoaded('space-1');

    expect(stage('Veg')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps its button in the sheet´s foot, where it stands while the questions scroll, and starts the grow from there', async () => {
    await drawLoaded('space-1');

    const sheet = screen.getByRole('dialog');
    const start = within(sheet).getByRole('button', { name: 'Start a grow' });
    expect(sheet.querySelector('footer')).toContainElement(start);
    expect(sheet.querySelector('form')).not.toContainElement(start);
    fireEvent.click(start);

    await waitFor(() => expect(sent('/grows/grow-new/phases')).toBeDefined());
  });

  it('asks nothing about germination where the stage is only recorded', async () => {
    stack.grows = [standing];
    await drawLoaded('space-1');

    fireEvent.click(stage('Germination'));
    expect(screen.queryByRole('group', { name: 'During germination' })).not.toBeInTheDocument();
  });

  it('names a grow nobody named after the last run in its place', async () => {
    await drawLoaded('space-1');
    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));

    await waitFor(() => expect(sent('/grows')).toMatchObject({ name: 'Spring run #2', plants: [{ strain: 'Unnamed', count: 1 }] }));
  });

  it('leaves the grow standing when its first phase is refused, and retries only that', async () => {
    const refusal = new ApiError({ status: 409, code: 'phase_refused', title: 'Conflict', detail: 'That day is before the grow began.', errors: [] });
    vi.mocked(api.post)
      .mockResolvedValueOnce({ id: 'grow-new' } as never)
      .mockRejectedValueOnce(refusal);
    await drawLoaded('space-1');

    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That day is before the grow began.'));

    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));
    await waitFor(() => expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/grows/grow-new/phases')).toHaveLength(2));
    // One grow: the second tap carries on rather than starting again.
    expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/grows')).toHaveLength(1);
  });
});

describe('where the plants go, where the form was opened for no place', () => {
  it('asks, offers the places this account manages, and opens on the first with nothing standing in it', async () => {
    stack.spaces = [tent, balcony, guests];
    stack.grows = [standing];
    await drawLoaded();

    const where = screen.getByRole('combobox', { name: 'Where' });
    expect(
      within(where)
        .getAllByRole('option')
        .map(option => option.textContent),
    ).toEqual(['Blue Dream tent', 'Balcony', 'No fixed place']);
    // The tent holds a grow, so the balcony stands chosen: a second grow in a flowering tent is never the default.
    expect(where).toHaveValue('space-2');
    expect(screen.getByRole('dialog', { name: 'New grow' })).toBeInTheDocument();
  });

  /** Started from "Alle Grows" with one tent, the grow belongs in that tent, not in no place. */
  it('opens on the only place there is, also where a grow already stands in it', async () => {
    stack.spaces = [tent];
    stack.grows = [standing];
    await drawLoaded();

    expect(screen.getByRole('combobox', { name: 'Where' })).toHaveValue('space-1');
  });

  it('opens on the place the header holds, which is the one the grower is looking at', async () => {
    stack.grows = [];
    localStorage.setItem('terp.place', 'space-2');
    onTestFinished(() => localStorage.clear());
    await drawLoaded();

    expect(screen.getByRole('combobox', { name: 'Where' })).toHaveValue('space-2');
  });

  it('starts a grow in no place where that is chosen', async () => {
    await drawLoaded();

    fireEvent.change(screen.getByRole('combobox', { name: 'Where' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));

    await waitFor(() => expect(sent('/grows')).toMatchObject({ spaceId: null }));
  });

  it('asks nothing of an account with no place: the grow stands in none', async () => {
    stack.spaces = [];
    await drawLoaded();

    expect(screen.queryByRole('combobox', { name: 'Where' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));
    await waitFor(() => expect(sent('/grows')).toMatchObject({ spaceId: null }));
  });
});
