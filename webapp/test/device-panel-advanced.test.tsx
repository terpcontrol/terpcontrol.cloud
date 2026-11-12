import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DeviceCapabilities, Socket, SocketPage } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { draftFor, problemOf, rolesFor, secondsOfSpan, spanOf, updateOf } from '@/screens/devices/socket-form';
import { rowsOf } from '@/screens/devices/sockets';
import { drawDevicePages } from './device-pages';
import { SIGNED_IN, spaceWhere } from './session';
import { translate } from './translations';

/**
 * What a device's own page lets its owner do beyond the everyday: which build
 * it is put on by hand, giving it up, and pairing, timing, changing and
 * removing the smart sockets it drives.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
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

vi.mock('@/log/log-context', async importOriginal => ({ ...(await importOriginal<object>()), useLog: () => ({ tell: () => undefined }) }));
vi.mock('@/screens/control/lead', () => ({ useLeads: () => true }));
vi.mock('@/screens/control/OwnSettings', () => ({ OwnSettings: () => null }));

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
  {
    id: 'fw-old',
    createdAt: '2026-08-01T10:00:00.000Z',
    classId: 'class-controller',
    name: 'controller',
    version: 'a1b2c3d',
    wasStable: true,
    channels: [],
  },
  {
    id: 'fw-new',
    createdAt: '2026-09-15T10:00:00.000Z',
    classId: 'class-controller',
    name: 'controller',
    version: 'e4f5a6b',
    wasStable: false,
    channels: ['beta'],
  },
];

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

/** What the API answers: the one device, the place it stands in, its sockets and the builds it is offered. */
const answer = (device: Device, sockets: Socket[] = [], capabilities = CAPABILITIES, youMay: 'own' | 'manage' = 'own') =>
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/devices') return Promise.resolve({ items: [device], nextCursor: null }) as never;
    if (path === '/spaces') return Promise.resolve({ items: [spaceWhere(youMay)], nextCursor: null }) as never;
    if (path.endsWith('/sockets')) return Promise.resolve({ items: sockets, nextCursor: null, capabilities } satisfies SocketPage) as never;
    if (path.endsWith('/firmwares')) return Promise.resolve({ items: BUILDS, nextCursor: null }) as never;
    if (path.endsWith('/live')) return Promise.resolve({ deviceId: device.id, metrics: {}, outputs: {}, setpoints: null, pending: null }) as never;
    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });

/** The device's own page, read through to the place it stands in. */
const drawWith = async (device: Device) => {
  answer(device);
  drawDevicePages(`/devices/${device.id}`);
  await screen.findByRole('heading', { name: 'Controller' });
  await screen.findAllByRole('link', { name: /Tent 1$/ });
};

/** The sheet that pairs a socket, opened from its row on the device's page once the device's table is read. */
const openPairing = async () => {
  await drawWith(controller());
  await waitFor(() => expect(screen.getByRole('button', { name: /^Pair a socket/ })).toHaveTextContent('none paired'));
  fireEvent.click(screen.getByRole('button', { name: /^Pair a socket/ }));

  return screen.findByRole('dialog', { name: 'Pair a socket by IP' });
};

/** The page of one socket, once it offers what its manager may do. */
const drawSocket = async (one: Socket, capabilities = CAPABILITIES) => {
  answer(controller(), [one], capabilities);
  drawDevicePages(`/devices/sim-controller-1/sockets/${rowsOf([one])[0].key}`);
  await screen.findByRole('button', { name: /address, role/i });
};

beforeAll(() => translate());

beforeEach(() => {
  who.admin = false;
  for (const call of [api.patch, api.put, api.delete]) vi.mocked(call).mockReset();
  vi.mocked(api.patch).mockImplementation((_path, body) => Promise.resolve(controller(body as Partial<Device>)) as never);
  vi.mocked(api.put).mockResolvedValue({ publishedAt: DateTime.now().toISO(), deviceOnline: true } as never);
  vi.mocked(api.delete).mockResolvedValue({ publishedAt: DateTime.now().toISO(), deviceOnline: true } as never);
});

describe('the build a device is put on by hand', () => {
  it('switches automatic updates off without moving the device, and only then offers the versions', async () => {
    let now = controller({ firmware: { channel: 'stable', targetId: 'fw-old' } });
    await drawWith(now);
    // The list answers with what was saved, as the server does.
    const drawn = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((path: string, ...rest) =>
      path === '/devices' ? (Promise.resolve({ items: [now], nextCursor: null }) as never) : drawn(path, ...rest),
    );
    vi.mocked(api.patch).mockImplementation((_path, body) => {
      now = { ...now, ...(body as Partial<Device>) } as Device;
      return Promise.resolve(now) as never;
    });
    expect(screen.queryByRole('combobox', { name: 'Firmware version' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Update automatically' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/sim-controller-1', { firmware: { channel: 'manual', targetId: 'fw-old' } }));
    expect(await screen.findByRole('combobox', { name: 'Firmware version' })).toBeInTheDocument();
  });

  it('lets a grower pick a version, newest first, says which one runs and where each stands, and asks first', async () => {
    await drawWith(controller());

    expect(screen.getByText(/Off: the device stays on its version/)).toBeInTheDocument();
    expect(screen.getByText(/Every version that was ever stable, and anything newer/)).toBeInTheDocument();
    const builds = await screen.findByRole('combobox', { name: 'Firmware version' });
    await waitFor(() => expect(within(builds).getAllByRole('option')).toHaveLength(3));
    expect(
      within(builds)
        .getAllByRole('option')
        .map(option => option.textContent),
    ).toEqual([
      'Pick a build …',
      expect.stringMatching(/^e4f5a6b · .* · current Beta$/),
      expect.stringMatching(/^a1b2c3d · .* · running · was stable$/),
    ]);
    fireEvent.change(builds, { target: { value: 'fw-new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Install …' }));

    const asked = await screen.findByRole('dialog', { name: 'Firmware for Controller' });
    expect(within(asked).getByText(/installs e4f5a6b and stays on it/)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    fireEvent.click(within(asked).getByRole('button', { name: 'Install' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/sim-controller-1', { firmware: { channel: 'manual', targetId: 'fw-new' } }));
  });

  /** The newest build here is a beta: the stable channel points at none, so nothing is called an update. */
  it('offers no update where no stable build is newer than the one that runs', async () => {
    await drawWith(controller());

    await screen.findByRole('combobox', { name: 'Firmware version' });
    expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
  });

  it('tells an administrator that the list holds every build of the class', async () => {
    who.admin = true;
    await drawWith(controller());

    expect(await screen.findByText(/As an admin you see every build of this device class/)).toBeInTheDocument();
  });
});

describe('giving a device up', () => {
  it('asks twice, with two different buttons, before it leaves the account - and its page with it', async () => {
    await drawWith(controller());
    fireEvent.click(screen.getByRole('button', { name: 'Give the device up' }));

    const first = await screen.findByRole('dialog', { name: 'Give Controller up' });
    expect(within(first).getByText(/Its grow plan, its alarms and the camera connected through it go with the device/)).toBeInTheDocument();
    expect(within(first).getByText(/The place Tent 1 and its diary stay/)).toBeInTheDocument();
    fireEvent.click(within(first).getByRole('button', { name: 'Continue' }));

    const second = await screen.findByRole('dialog', { name: 'Really give it up?' });
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(within(second).getByRole('button', { name: 'Remove for good' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/devices/sim-controller-1/claim'));
    expect(await screen.findByText(/has left your account and can now be added by someone else/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    // The page of a device that is gone is no page to be left on.
    expect(await screen.findByText('elsewhere')).toBeInTheDocument();
  });

  it('is not offered to somebody who manages a device they do not own', async () => {
    const theirs = controller({ ownerId: 'user-2' });
    answer(theirs, [], CAPABILITIES, 'manage');
    drawDevicePages('/devices/sim-controller-1');

    expect(await screen.findByRole('switch', { name: 'Update automatically' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Give the device up' })).not.toBeInTheDocument();
  });
});

describe('pairing a socket by its address', () => {
  it('is offered on the device´s page, and sends the role, the address and a pump’s timer', async () => {
    const sheet = await openPairing();
    // The roles the controller always had, the humidifier this build announces and the two timed ones; the others wait for a test in a real tent.
    expect(
      within(sheet)
        .getAllByRole('button', { pressed: false })
        .map(button => button.textContent),
    ).toEqual(['Heater', 'Dehumidifier', 'Humidifier', 'CO₂', 'Light', 'Second light', 'Pump', 'Custom timer']);
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
    // Sent to a device that was listening, the sheet has nothing left to ask.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says what is wrong with an address and sends nothing', async () => {
    const sheet = await openPairing();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Heater' }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Address' }), { target: { value: 'my socket' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pair' }));

    expect(within(sheet).getByText('An address without spaces, 40 characters at most.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('a socket’s timer, its address and its removal', () => {
  it('says a pump without a timer stays off, and sends the cycle it is given with its address and role', async () => {
    await drawSocket(socket({ role: 'pump' }));

    const change = screen.getByRole('button', { name: /^Timer, address, role/ });
    expect(change).toHaveTextContent('No timer set – without one the socket stays off');
    fireEvent.click(change);
    fireEvent.change(screen.getByRole('textbox', { name: 'How long on' }), { target: { value: '5' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Unit of “How often”' }), { target: { value: 'h' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'How often' }), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/devices/sim-controller-1/sockets/0', {
        role: 'pump',
        address: '10.0.0.63',
        credentials: null,
        timer: { onSeconds: 300, everySeconds: 14400 },
      }),
    );
  });

  it('refuses a cycle that is on for as long as it repeats, and says so', async () => {
    await drawSocket(socket({ role: 'custom_timer', timer: { onSeconds: 60, everySeconds: 3600 } }));

    expect(screen.getByText('on 1 min every 1 h')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Timer, address, role' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'How long on' }), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByText(/has to be on for less than its interval/)).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('says a build without timers cannot take one', async () => {
    await drawSocket(socket({ role: 'pump' }), { ...CAPABILITIES, socketTimer: false });

    fireEvent.click(screen.getByRole('button', { name: /^Timer, address, role/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByText('This firmware has no timer. It comes with a firmware update.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('asks before it removes a socket, and sends the removal by its slot', async () => {
    await drawSocket(socket({ slot: 3 }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove the socket' }));

    const asked = await screen.findByRole('dialog', { name: 'Remove Heater?' });
    expect(within(asked).getByText(/forgets the socket \(10.0.0.63\) and resets it/)).toBeInTheDocument();
    fireEvent.click(within(asked).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/devices/sim-controller-1/sockets/3'));
  });

  it('changes a socket’s address and keeps its credentials unless new ones are typed', async () => {
    await drawSocket(socket({ slot: 2, role: 'heater', address: '10.0.0.63' }));
    fireEvent.click(screen.getByRole('button', { name: 'Address, role, credentials' }));

    const sheet = await screen.findByRole('dialog', { name: 'Change Heater' });
    expect(within(sheet).getByRole('textbox', { name: 'Address' })).toHaveValue('10.0.0.63');
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Address' }), { target: { value: '10.0.0.64' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/devices/sim-controller-1/sockets/2', {
        role: 'heater',
        address: '10.0.0.64',
        credentials: null,
        timer: null,
      }),
    );
  });

  /**
   * A fridge's exhaust socket opened its Change sheet with no role chosen, and
   * offered neither the exhaust nor the humidifier: whoever only wanted a new
   * address had to make the exhaust a heater first.
   */
  it('changes an exhaust socket as an exhaust, where the build announces one', async () => {
    await drawSocket(socket({ slot: 1, role: 'exhaust', address: '10.0.0.70' }), { ...CAPABILITIES, roles: [...CAPABILITIES.roles, 'exhaust'] });
    fireEvent.click(screen.getByRole('button', { name: 'Address, role, credentials' }));

    const sheet = await screen.findByRole('dialog', { name: 'Change Exhaust' });
    expect(within(sheet).getByRole('button', { name: 'Exhaust' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('button', { name: 'Humidifier' })).toBeInTheDocument();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Address' }), { target: { value: '10.0.0.71' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/devices/sim-controller-1/sockets/1', {
        role: 'exhaust',
        address: '10.0.0.71',
        credentials: null,
        timer: null,
      }),
    );
  });
});

describe('the socket form', () => {
  it('offers the exhaust and the humidifier where the build announces them, and a socket´s own role whatever it is', () => {
    const all: DeviceCapabilities = { ...CAPABILITIES, roles: [...CAPABILITIES.roles, 'exhaust', 'circulation'] };

    expect(rolesFor(all)).toEqual(['heater', 'dehumidifier', 'humidifier', 'exhaust', 'co2', 'light', 'secondary_light', 'pump', 'custom_timer']);
    expect(rolesFor(CAPABILITIES)).not.toContain('exhaust');
    // A circulation fan is not offered for a new socket, and stays what it is when only its address changes.
    expect(rolesFor(all, 'circulation')).toContain('circulation');
    expect(draftFor({ role: 'circulation', address: '10.0.0.5', timer: null }).role).toBe('circulation');
    expect(draftFor({ role: '', address: '10.0.0.5', timer: null }).role).toBeNull();
  });

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
