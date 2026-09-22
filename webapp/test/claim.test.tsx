import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DeviceCapabilities, Space } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import { Claim } from '@/screens/claim/Claim';

/**
 * Adding a device: what the four steps ask, what each answer puts on the wire,
 * what a code the server will not take says, and what the demo is offered.
 *
 * Every request goes through the app's own client, mocked at that one seam, so
 * what is asserted is what would leave the browser: a claim carries exactly the
 * code that was read, a rename touches the space the claim made rather than
 * making another, and a stage is applied to that space and nothing else.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

const who = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (who.demo ? ON_THE_DEMO : SIGNED_IN) };
});

/** The age on the first step is counted from the server's instant, so the clock is a fixture. */
const NOW = DateTime.fromISO('2026-09-22T10:00:00.000Z');

const CAPABILITIES: DeviceCapabilities = {
  socketOverride: true,
  socketTimer: true,
  lightOverride: true,
  roles: ['heater', 'light'],
  pulseSeconds: {},
};

const device: Device = {
  id: 'sim-controller-7f3a',
  createdAt: NOW.minus({ days: 2 }).toISO()!,
  type: 'controller',
  classId: 'class-1',
  serialNumber: 42,
  ownerId: 'user-1',
  spaceId: 'space-new',
  name: 'Terp Controller',
  firmware: { channel: 'stable', targetId: null },
  configuration: null,
  settings: { vpdLeafOffsetDay: 0, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
  isDemo: false,
  state: {
    lastSeenAt: NOW.minus({ seconds: 20 }).toISO()!,
    claimedAt: NOW.toISO()!,
    firmwareId: 'build-uuid',
    updateStartedAt: null,
    updateEndedAt: null,
    maintenanceUntil: null,
    hardware: { firmware_version: '2.4.1', webcam_did: 'none' },
    socketStateChangedAt: {},
    socketsReportedAt: NOW.toISO()!,
  },
};

const space: Space = { id: 'space-new', ownerId: 'user-1', kind: 'other', name: 'Terp Controller', roomId: null } as Space;

const state = { spaces: [] as Space[] };

const answers = (path: string) => {
  if (path === '/devices/sim-controller-7f3a') return device;
  if (path === '/devices/sim-controller-7f3a/sockets') return { items: [], nextCursor: null, capabilities: CAPABILITIES };
  if (path === '/spaces') return { items: state.spaces, nextCursor: null };
  if (path === '/grows') return { items: [], nextCursor: null };
  throw new Error(`nothing mocked for ${path}`);
};

/** Where the flow has put itself, because what survives a reload is the address and nothing else. */
function Watch() {
  const location = useLocation();

  return <span data-testid="address">{`${location.pathname}${location.search}`}</span>;
}

const address = () => screen.getByTestId('address').textContent;

const draw = (at = '/claim') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <Claim />
        <Watch />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The screen with a device claimed on it, which is every step after the first. */
const drawClaimed = async () => {
  draw();
  fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: 'ABCD1234' } });
  fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));
  await screen.findByRole('heading', { level: 2, name: /Claimed/ });
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name of the space' })).toHaveValue('Terp Controller'));
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });

  vi.useFakeTimers({ toFake: ['Date'] });
});

afterAll(() => vi.useRealTimers());

beforeEach(() => {
  vi.setSystemTime(NOW.toJSDate());
  who.demo = false;
  state.spaces = [space];
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.post).mockImplementation((path: string) =>
    path === '/devices/claims'
      ? (Promise.resolve({ device, spaceCreated: true }) as never)
      : (Promise.resolve({
          spaceId: 'space-new',
          stage: 'flowering',
          preset: null,
          appliedAt: NOW.toISO(),
          deviceIds: ['sim-controller-7f3a'],
          growId: null,
          phaseId: null,
          growDecisionNeeded: true,
          decisions: ['start_grow', 'move_grow', 'climate_only'],
          planEffect: 'none',
        }) as never),
  );
  vi.mocked(api.patch).mockResolvedValue({ ...space, name: 'Tent 1' } as never);
});

describe('adding a device', () => {
  it('asks for the code first and offers nothing to skip ahead with', () => {
    draw();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add a device · 1 of 4');
    expect(screen.getByRole('textbox', { name: 'Claim code' })).toHaveValue('');
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    expect(screen.queryByRole('textbox', { name: 'Name of the space' })).not.toBeInTheDocument();
  });

  it('takes the code the empty home already read', () => {
    draw('/claim?code=ABCD1234');

    expect(screen.getByRole('textbox', { name: 'Claim code' })).toHaveValue('ABCD1234');
  });

  it('claims exactly the code that was read', async () => {
    draw();
    fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: ' abcd1234 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/claims', { code: 'abcd1234' }));
  });

  it('reports what the device itself says, and opens the place', async () => {
    await drawClaimed();

    expect(screen.getByRole('heading', { level: 2, name: /Claimed/ })).toHaveTextContent('Claimed · Terp Controller · 7F3A');
    expect(screen.getByText(/online 20 s ago/)).toHaveTextContent('online 20 s ago · firmware 2.4.1 · 0 sockets · Cam: none');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add a device · 2 of 4');
    expect(screen.getByRole('button', { name: /Next/ })).toHaveTextContent('Next · what is it doing?');
  });

  it('draws the four steps the board names, and says the rest can wait', async () => {
    await drawClaimed();

    const steps = screen.getAllByRole('heading', { level: 2 }).map(one => one.textContent);
    expect(steps).toEqual(['Claimed · Terp Controller · 7F3A', 'Where is it?', 'What is it doing right now?', 'Sockets and cam']);
    expect(screen.getByText('Every step can be done later from Devices or Control.')).toBeInTheDocument();
  });

  it('renames the space the claim already made rather than making another', async () => {
    await drawClaimed();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the space' }), { target: { value: 'Blue room' } });
    fireEvent.click(screen.getByRole('button', { name: 'rename' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/space-new', { name: 'Blue room' }));
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('puts the kind of place on the same space', async () => {
    await drawClaimed();
    fireEvent.click(screen.getByRole('button', { name: 'tent' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/space-new', { kind: 'tent' }));
  });

  it('applies a stage to the place, and asks about the grow the way the server does', async () => {
    await drawClaimed();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Flower' }));
    fireEvent.click(screen.getByRole('button', { name: 'Put it on Flower' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/spaces/space-new/preset-applications', { stage: 'flowering' }));
    expect(await screen.findByRole('link', { name: /Start a grow here/ })).toHaveAttribute('href', '/grows/new?space=space-new&stage=flowering');
    expect(screen.getByText('The targets went to 1 controller.')).toBeInTheDocument();
  });

  it('offers monitoring without writing anything to the controller', async () => {
    await drawClaimed();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: 'just measure' }));

    expect(screen.getByText(/Nothing is written to the controller/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Put it on/ })).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('says what the server said about a code it would not take', async () => {
    vi.mocked(api.post).mockRejectedValue(
      new ApiError({ status: 409, code: 'device_claimed', title: 'Refused', detail: 'That device already belongs to somebody.', errors: [] }),
    );

    draw();
    fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That device already belongs to somebody.');
    expect(screen.getByRole('textbox', { name: 'Claim code' })).toHaveValue('ABCD1234');
  });

  it('says the claim never reached the server, rather than blaming a page that was not being loaded', async () => {
    vi.mocked(api.post).mockRejectedValue(new TypeError('Failed to fetch'));

    draw();
    fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server. Try again.');
  });

  it('says a controller that has never spoken was claimed all the same', async () => {
    vi.mocked(api.post).mockResolvedValue({
      device: { ...device, state: { ...device.state, lastSeenAt: null } },
      spaceCreated: true,
    } as never);
    vi.mocked(api.get).mockImplementation(
      (path: string) =>
        Promise.resolve(
          path === '/devices/sim-controller-7f3a' ? { ...device, state: { ...device.state, lastSeenAt: null } } : answers(path),
        ) as never,
    );

    await drawClaimed();

    expect(screen.getByText(/has not said anything yet/)).toBeInTheDocument();
  });

  it('names the place it made in a word, and not after the hardware standing in it', async () => {
    await drawClaimed();

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/space-new', { name: 'Tent 1' }));
  });

  it('numbers past a place that already carries the name', async () => {
    state.spaces = [space, { ...space, id: 'space-old', name: 'Tent 1' }];
    await drawClaimed();

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/space-new', { name: 'Tent 2' }));
  });

  it('puts the claimed device in the address, so nothing of the claim is lost by a reload', async () => {
    await drawClaimed();

    expect(address()).toBe('/claim?device=sim-controller-7f3a&at=1');
  });

  it('comes back on the step it was left on rather than asking for a code that is spent', async () => {
    draw('/claim?device=sim-controller-7f3a&at=2');

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add a device · 3 of 4'));
    expect(screen.queryByRole('textbox', { name: 'Claim code' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
  });

  it('offers the code field again when the address names a device this account cannot read', async () => {
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === '/devices/sim-controller-7f3a'
        ? (Promise.reject(
            new ApiError({ status: 404, code: 'device_not_found', title: 'Not found', detail: 'There is no device with that id.', errors: [] }),
          ) as never)
        : (Promise.resolve(answers(path)) as never),
    );

    draw('/claim?device=sim-controller-7f3a&at=2');

    expect(await screen.findByRole('textbox', { name: 'Claim code' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add a device · 1 of 4');
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  it('puts the keyboard on the question that just opened, and says which one it is', async () => {
    await drawClaimed();

    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Where is it?' }));
    expect(screen.getByRole('status')).toHaveTextContent('Where is it? · step 2 of 4');
  });

  it('writes the stage that was picked when the bottom button is the one pressed', async () => {
    await drawClaimed();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Seedling' }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/spaces/space-new/preset-applications', { stage: 'seedling' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add a device · 3 of 4');
    expect(await screen.findByRole('link', { name: /Start a grow here/ })).toBeInTheDocument();
  });

  it('leaves the green to the one action on the screen', async () => {
    await drawClaimed();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Flower' }));

    expect(screen.getByRole('button', { name: 'Put it on Flower' }).className).not.toMatch(/primary/);
    expect(screen.getByRole('button', { name: /Next/ }).className).toMatch(/primary/);
  });

  it('does not offer a kind of place that can never hold a grow', async () => {
    await drawClaimed();

    expect(screen.queryByRole('button', { name: 'room' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'tent' })).toBeInTheDocument();
  });

  it('says so before a second place is given a name another one already has', async () => {
    state.spaces = [space, { ...space, id: 'space-other', name: 'Mother tent' }];
    await drawClaimed();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the space' }), { target: { value: 'mother tent' } });

    expect(screen.getByText('A place is already called that.')).toBeInTheDocument();
  });

  it('does not report a climate write that no controller took', async () => {
    await drawClaimed();
    vi.mocked(api.post).mockResolvedValue({
      spaceId: 'space-new',
      stage: 'flowering',
      preset: null,
      appliedAt: NOW.toISO(),
      deviceIds: [],
      growId: null,
      phaseId: null,
      growDecisionNeeded: true,
      decisions: ['start_grow', 'climate_only'],
      planEffect: 'none',
    } as never);

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Flower' }));
    fireEvent.click(screen.getByRole('button', { name: 'Put it on Flower' }));

    expect(await screen.findByText('No controller here took the targets.')).toBeInTheDocument();
    expect(screen.getByText('No grow entered the stage, and no climate was written.')).toBeInTheDocument();
    expect(screen.getByText(/no controller here took the climate/)).toBeInTheDocument();
    expect(screen.queryByText(/written either way/)).not.toBeInTheDocument();
  });

  it('shows the demo why it cannot claim instead of a field it would be refused', () => {
    who.demo = true;
    draw();

    expect(screen.queryByRole('textbox', { name: 'Claim code' })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot claim hardware/)).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'Back to Devices' })).queryByRole('textbox')).toBeNull();
  });
});
