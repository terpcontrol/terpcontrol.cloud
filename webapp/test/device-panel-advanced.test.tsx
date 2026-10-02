import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DeviceCapabilities, Socket, SocketPage } from '@fg2/shared-types/v1';
import { api, apiRequest } from '@/api/client';
import { DeviceList } from '@/screens/devices/DeviceList';
import { draftFor, problemOf, secondsOfSpan, spanOf, updateOf } from '@/screens/devices/socket-form';
import { SocketRow } from '@/screens/devices/SocketRow';
import { rowsOf } from '@/screens/devices/sockets';
import { SIGNED_IN, spaceWhere } from './session';

/**
 * What a device's panel lets its owner do beyond the everyday: whether it
 * updates itself and from which channel, which build an administrator puts it
 * on, giving it up, and pairing, timing and removing the smart sockets it
 * drives.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
  apiRequest: vi.fn(),
}));

const who = vi.hoisted(() => ({ admin: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN: signedIn } = await import('./session');
  return {
    ...(await importOriginal<object>()),
    mediaUrl: (id: string) => `/media/${id}`,
    useSession: () => (who.admin ? { ...signedIn, user: { ...signedIn.user!, isAdmin: true } } : signedIn),
  };
});

// No light output, so the panel draws no lamp row that reads a plan.
const CAPABILITIES: DeviceCapabilities = {
  socketOverride: true,
  socketTimer: true,
  lightOverride: false,
  roles: ['heater', 'dehumidifier', 'co2', 'light', 'secondary_light', 'pump', 'custom_timer', 'humidifier'],
  pulseSeconds: {},
};

const controller = (over: Partial<Device> = {}): Device =>
  ({
    id: 'sim-controller-1',
    name: 'controller',
    type: 'controller',
    classId: 'class-controller',
    ownerId: SIGNED_IN.user!.id,
    spaceId: 'space-1',
    isDemo: false,
    firmware: { channel: 'manual', targetId: null },
    configuration: null,
    control: null,
    settings: { vpdLeafOffsetDay: 0, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0 },
    state: { lastSeenAt: DateTime.now().minus({ seconds: 20 }).toISO()!, firmwareId: 'fw-old', hardware: {}, maintenanceUntil: null },
    ...over,
  }) as unknown as Device;

const BUILDS = [
  { id: 'fw-old', createdAt: '2026-08-01T10:00:00.000Z', classId: 'class-controller', name: 'controller', version: 'a1b2c3d', wasStable: true },
  { id: 'fw-new', createdAt: '2026-09-15T10:00:00.000Z', classId: 'class-controller', name: 'controller', version: 'e4f5a6b', wasStable: false },
];

const drawWith = async (device: Device, sockets: Socket[] = []) => {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/devices') return Promise.resolve({ items: [device], nextCursor: null }) as never;
    if (path === '/spaces') return Promise.resolve({ items: [spaceWhere('own')], nextCursor: null }) as never;
    if (path.endsWith('/sockets'))
      return Promise.resolve({ items: sockets, nextCursor: null, capabilities: CAPABILITIES } satisfies SocketPage) as never;
    if (path.endsWith('/firmwares')) return Promise.resolve({ items: BUILDS, nextCursor: null }) as never;
    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DeviceList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByText('Controller'));
};

const advanced = async () => {
  fireEvent.click(await screen.findByText('Advanced', { selector: 'summary' }));
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  who.admin = false;
  for (const call of [api.patch, api.put, api.delete, apiRequest]) vi.mocked(call).mockReset();
  vi.mocked(api.patch).mockImplementation((_path, body) => Promise.resolve(controller(body as Partial<Device>)) as never);
  vi.mocked(api.put).mockResolvedValue({ publishedAt: DateTime.now().toISO(), deviceOnline: true } as never);
  vi.mocked(api.delete).mockResolvedValue(undefined);
  vi.mocked(apiRequest).mockResolvedValue({ publishedAt: DateTime.now().toISO(), deviceOnline: true } as never);
});

describe('updates', () => {
  it('switches automatic updates on the stable channel, re-sending the build it is pinned to', async () => {
    await drawWith(controller({ firmware: { channel: 'manual', targetId: 'fw-old' } }));

    const toggle = screen.getByRole('switch', { name: 'Update automatically' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Off: the device stays on its version/)).toBeInTheDocument();
    fireEvent.click(toggle);

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/sim-controller-1', { firmware: { channel: 'stable', targetId: 'fw-old' } }));
  });

  it('offers the test channels under Advanced, which switch automatic updates on', async () => {
    await drawWith(controller());
    await advanced();

    expect(screen.getByText('Automatic updates are off. Choosing a channel here switches them on.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/sim-controller-1', { firmware: { channel: 'beta', targetId: null } }));
  });

  it('puts a device on a particular build for an administrator only, asked first', async () => {
    await drawWith(controller());
    await advanced();
    expect(screen.queryByRole('combobox', { name: 'Firmware version' })).not.toBeInTheDocument();
  });

  it('lets an administrator pin a build, newest first, and say which one runs', async () => {
    who.admin = true;
    await drawWith(controller());
    await advanced();

    const builds = await screen.findByRole('combobox', { name: 'Firmware version' });
    await waitFor(() => expect(within(builds).getAllByRole('option')).toHaveLength(3));
    expect(
      within(builds)
        .getAllByRole('option')
        .map(option => option.textContent),
    ).toEqual(['Pick a build …', expect.stringMatching(/^e4f5a6b · /), expect.stringMatching(/^a1b2c3d · .* · running · was stable$/)]);
    fireEvent.change(builds, { target: { value: 'fw-new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Install …' }));

    const asked = await screen.findByRole('dialog', { name: 'Firmware for Controller' });
    expect(within(asked).getByText(/installs e4f5a6b and stays on it/)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    fireEvent.click(within(asked).getByRole('button', { name: 'Install' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/sim-controller-1', { firmware: { channel: 'manual', targetId: 'fw-new' } }));
  });
});

describe('giving a device up', () => {
  it('asks twice, with two different buttons, before it leaves the account', async () => {
    await drawWith(controller());
    await advanced();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from account …' }));

    const first = await screen.findByRole('dialog', { name: 'Give Controller up' });
    expect(within(first).getByText(/Its grow plan, its alarms and the camera connected through it go with the device/)).toBeInTheDocument();
    expect(within(first).getByText(/The place Tent 1 and its diary stay/)).toBeInTheDocument();
    fireEvent.click(within(first).getByRole('button', { name: 'Continue' }));

    const second = await screen.findByRole('dialog', { name: 'Really give it up?' });
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(within(second).getByRole('button', { name: 'Remove for good' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/devices/sim-controller-1/claim'));
    expect(await screen.findByText(/has left your account and can now be added by someone else/)).toBeInTheDocument();
  });

  it('is not offered to somebody who manages a device they do not own', async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/devices') return Promise.resolve({ items: [controller({ ownerId: 'user-2' })], nextCursor: null }) as never;
      if (path === '/spaces') return Promise.resolve({ items: [spaceWhere('manage')], nextCursor: null }) as never;
      if (path.endsWith('/sockets')) return Promise.resolve({ items: [], nextCursor: null, capabilities: CAPABILITIES }) as never;
      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <DeviceList />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText('Controller'));
    await advanced();

    expect(screen.getByText('Update channel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from account …' })).not.toBeInTheDocument();
  });
});

describe('pairing a socket by its address', () => {
  it('offers the first one in the device panel, and sends the role, the address and a pump’s timer', async () => {
    await drawWith(controller());
    await advanced();
    fireEvent.click(screen.getByRole('button', { name: 'Pair …' }));

    const sheet = await screen.findByRole('dialog', { name: 'Pair a socket by IP' });
    // The roles the controller always had and the two timed ones; the others wait for a test in a real tent.
    expect(
      within(sheet)
        .getAllByRole('button', { pressed: false })
        .map(button => button.textContent),
    ).toEqual(['Heater', 'Dehumidifier', 'CO₂', 'Light', 'Second light', 'Pump', 'Custom timer']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pump' }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Address' }), { target: { value: ' 192.168.1.57 ' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pair' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/devices/sim-controller-1/sockets/new', {
        role: 'pump',
        address: '192.168.1.57',
        credentials: null,
        timer: { onSeconds: 120, everySeconds: 21600 },
      }),
    );
    expect(await within(sheet).findByText(/The socket appears in the list once Controller reports it/)).toBeInTheDocument();
  });

  it('says what is wrong with an address and sends nothing', async () => {
    await drawWith(controller());
    await advanced();
    fireEvent.click(screen.getByRole('button', { name: 'Pair …' }));

    const sheet = await screen.findByRole('dialog', { name: 'Pair a socket by IP' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Heater' }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Address' }), { target: { value: 'my socket' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pair' }));

    expect(within(sheet).getByText('An address without spaces, 40 characters at most.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('moves under the socket list once the device has a socket', async () => {
    await drawWith(controller(), [socket()]);
    await waitFor(() => expect(screen.getByText(/^Smart sockets · Tent 1/)).toBeInTheDocument());

    // Advanced in the panel, without the pairing, and under the list a section named for it, with it.
    const panel = screen.getByText('Advanced', { selector: 'summary' });
    expect(within(panel.closest('details')!).queryByText('Pair a socket by IP')).not.toBeInTheDocument();
    const list = screen.getByText('Pair another socket', { selector: 'summary' });
    expect(within(list.closest('details')!).getByText('Pair a socket by IP')).toBeInTheDocument();
  });
});

const socket = (over: Partial<Socket> = {}): Socket => ({
  slot: 0,
  role: 'heater',
  hardwareId: '5BAD22AB0B99',
  address: '10.0.0.63',
  state: 'off',
  override: null,
  timer: null,
  stateChangedAt: null,
  ...over,
});

describe('a socket’s timer and its Advanced', () => {
  const drawRow = (one: Socket, capabilities = CAPABILITIES) => {
    const [row] = rowsOf([one]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SocketRow
          row={row}
          deviceId="device-1"
          refusal={null}
          unheard={null}
          mayManage
          runs={null}
          now={DateTime.now()}
          capabilities={capabilities}
          deviceName="Tent controller"
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Details of .*, and how long/ }));
  };

  it('says a pump without a timer stays off, and sends the cycle it is given with its address and role', async () => {
    drawRow(socket({ role: 'pump' }));

    expect(screen.getByText('No timer set – without one the socket stays off.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'How long on' }), { target: { value: '5' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Unit of “How often”' }), { target: { value: 'h' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'How often' }), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/devices/device-1/sockets/0', {
        role: 'pump',
        address: '10.0.0.63',
        credentials: null,
        timer: { onSeconds: 300, everySeconds: 14400 },
      }),
    );
  });

  it('refuses a cycle that is on for as long as it repeats, and says so', () => {
    drawRow(socket({ role: 'custom_timer', timer: { onSeconds: 60, everySeconds: 3600 } }));

    expect(screen.getByText('on for 1 min, every 1 h')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'How long on' }), { target: { value: '60' } });

    expect(screen.getByText(/has to be on for less than its interval/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('says a build without timers cannot take one', () => {
    drawRow(socket({ role: 'pump' }), { ...CAPABILITIES, socketTimer: false });

    expect(screen.getByRole('button', { name: 'Set' })).toBeDisabled();
    expect(screen.getByText('This firmware has no timer. It comes with a firmware update.')).toBeInTheDocument();
  });

  it('asks before it removes a socket, and sends the removal by its slot', async () => {
    drawRow(socket({ slot: 3 }));
    fireEvent.click(screen.getByText('Advanced', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove …' }));

    const asked = await screen.findByRole('dialog', { name: 'Remove Heater?' });
    expect(within(asked).getByText(/forgets the socket \(10.0.0.63\) and resets it/)).toBeInTheDocument();
    fireEvent.click(within(asked).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/devices/device-1/sockets/3', { method: 'DELETE' }));
  });

  it('changes a socket’s address and keeps its credentials unless new ones are typed', async () => {
    drawRow(socket({ slot: 2, role: 'heater', address: '10.0.0.63' }));
    fireEvent.click(screen.getByText('Advanced', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change …' }));

    const sheet = await screen.findByRole('dialog', { name: 'Change Heater' });
    expect(within(sheet).getByRole('textbox', { name: 'Address' })).toHaveValue('10.0.0.63');
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Address' }), { target: { value: '10.0.0.64' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/devices/device-1/sockets/2', { role: 'heater', address: '10.0.0.64', credentials: null, timer: null }),
    );
  });
});

describe('the socket form', () => {
  it('reads a span in the coarsest whole unit and back, and sends only what makes sense for the role', () => {
    expect(spanOf(21600)).toEqual({ value: '6', unit: 'h' });
    expect(spanOf(90)).toEqual({ value: '90', unit: 's' });
    expect(secondsOfSpan({ value: '1,5', unit: 'min' })).toBe(90);
    expect(secondsOfSpan({ value: '', unit: 'min' })).toBeNull();

    const draft = { ...draftFor(null), role: 'heater' as const, address: '10.0.0.9', username: 'admin', password: '' };
    expect(problemOf(draft, CAPABILITIES)).toBeNull();
    expect(updateOf(draft)).toEqual({ role: 'heater', address: '10.0.0.9', credentials: { username: 'admin', password: '' }, timer: null });
    // A role the build does not announce is not offered, and not sent.
    expect(problemOf({ ...draft, role: 'exhaust' }, CAPABILITIES)).toBe('role');
    expect(problemOf({ ...draft, role: 'pump', every: { value: '25', unit: 'h' } }, CAPABILITIES)).toBe('timer');
  });
});
