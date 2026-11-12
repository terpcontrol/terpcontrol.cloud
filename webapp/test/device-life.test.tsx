import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Camera, Device, Socket, Space } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import type { Told } from '@/log/log-context';
import { drawDevicePages } from './device-pages';
import { spaceWhere, THE_HOST } from './session';
import { translate } from './translations';

/**
 * What a grower may do to a device once it is theirs: call it something, and
 * put it where it really stands.
 *
 * Both are `PATCH /devices/{id}`, behind the first row of the device's own
 * page, on one sheet with one button: nothing is written before it - a place
 * chip only chooses - and what was written is said in the toast, with the way
 * to take it back.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

/** What the sheet said in a toast, each with the way it is taken back. */
const told: Told[] = [];
vi.mock('@/log/log-context', async importOriginal => ({
  ...(await importOriginal<object>()),
  useLog: () => ({ tell: (one: Told) => told.push(one) }),
}));
vi.mock('@/screens/control/lead', () => ({ useLeads: () => true }));
vi.mock('@/screens/control/OwnSettings', () => ({ OwnSettings: () => null }));

const NOW = DateTime.fromISO('2026-09-19T12:00:00.000Z');

const THE_PLUG = {
  id: 'device-1',
  type: 'plug',
  name: null,
  ownerId: THE_HOST,
  spaceId: 'space-1',
  configuration: null,
  firmware: { channel: 'manual', targetId: null },
  state: { lastSeenAt: NOW.minus({ seconds: 20 }).toISO()!, firmwareId: null, hardware: {} },
} as unknown as Device;

const ELSEWHERE = spaceWhere('own', { id: 'space-2', name: 'Fridge 1', kind: 'fridge' });

/** What the device list answers, which a write changes as the server would. */
const wire = { devices: [] as Device[], cameras: [] as Camera[], sockets: [] as Socket[] };

/** What the API answers: the devices and the places a test names, and nothing else worth reading. */
const answer = (devices: Device[], spaces: Space[]) => {
  wire.devices = devices;
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/devices') return Promise.resolve({ items: wire.devices, nextCursor: null }) as never;
    if (path === '/spaces') return Promise.resolve({ items: spaces, nextCursor: null }) as never;
    if (path === '/me') return Promise.resolve({ premium: { enforced: true } }) as never;
    if (path === '/cameras') return Promise.resolve({ items: wire.cameras, nextCursor: null }) as never;
    if (path.endsWith('/sockets')) return Promise.resolve({ items: wire.sockets, nextCursor: null, capabilities: { roles: [] } }) as never;
    if (path.endsWith('/live')) return Promise.resolve({ deviceId: 'device-1', metrics: {}, outputs: {}, setpoints: null, pending: null }) as never;

    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });
};

/** The device's own page, read through to the place it stands in. */
const drawPage = async (title: string | RegExp) => {
  drawDevicePages('/devices/device-1');
  await screen.findByRole('heading', { name: title });
  await screen.findAllByRole('link', { name: /Tent 1$/ });
};

/** The plug's page, standing in a place the reader may do `youMay` in. */
const drawTab = async (youMay: AccessNeed = 'own') => {
  answer([THE_PLUG], [spaceWhere(youMay), ELSEWHERE]);

  // The account's one plug is called a plug: the tail of its id is for telling two apart.
  await drawPage('Plantalytix Socket');
};

const RENAME = { name: /^Rename or move/ };

/** The sheet, opened from its row. */
const openSheet = async () => {
  fireEvent.click(await screen.findByRole('button', RENAME));
  return within(await screen.findByRole('dialog', { name: 'Rename or move' }));
};

beforeAll(() => translate());

beforeEach(() => {
  told.length = 0;
  wire.cameras = [];
  wire.sockets = [];
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  // The server answers the device as it stored it, and lists it that way from then on.
  vi.mocked(api.patch).mockImplementation((_path: string, body: unknown) => {
    wire.devices = wire.devices.map(one => ({ ...one, ...(body as object) }));
    return Promise.resolve(wire.devices[0]) as never;
  });
});

describe('naming a device and moving it', () => {
  it('offers the correction as the first row of the page, saying where the device stands', async () => {
    await drawTab();

    expect(await screen.findByRole('button', RENAME)).toHaveTextContent('in Tent 1');
  });

  /** What may be done is the device's answer and not the screen's: the same reader owns one tent and only writes lines in the next. */
  it('offers it to nobody who may only write lines where the device stands', async () => {
    await drawTab('log');

    expect(screen.queryByRole('button', RENAME)).not.toBeInTheDocument();
  });

  it('writes the typed name with the one button, closes the sheet, and says what the device is called now', async () => {
    await drawTab();
    const sheet = await openSheet();
    // Nothing to save yet, and nothing explained beside the field: what an empty name means is behind its (i).
    expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(sheet.getByRole('button', { name: 'About Name' })).toHaveAttribute('aria-expanded', 'false');
    expect(sheet.queryByText(/Leave it empty/)).not.toBeInTheDocument();
    fireEvent.change(sheet.getByRole('textbox', { name: 'Name' }), { target: { value: '  East lamp  ' } });

    expect(api.patch).not.toHaveBeenCalled();

    // The list is not answered again here: what the page shows next is what the write itself answered.
    const drawn = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((path: string, ...rest) =>
      path === '/devices' ? (new Promise(() => undefined) as never) : drawn(path, ...rest),
    );
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { name: 'East lamp' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(told.map(one => one.label)).toEqual(['Plantalytix Socket is now called East lamp']);
    // The page is called by the new name at once, without waiting for the list.
    expect(await screen.findByRole('heading', { level: 1, name: 'East lamp' })).toBeInTheDocument();

    // Taken back, the device has no name of its own again.
    await told[0].undo!();
    expect(api.patch).toHaveBeenLastCalledWith('/devices/device-1', { name: null });
  });

  /**
   * An empty field is a device with no name of its own rather than one called
   * nothing: the list then falls back to the type and the characters printed on
   * the hardware, which is the state every unnamed device is already in.
   */
  it('holds the name a device was given, and gives the device its fallback back when the field is emptied', async () => {
    answer([{ ...THE_PLUG, name: 'East lamp' }], [spaceWhere('own'), ELSEWHERE]);
    await drawPage('East lamp');
    const sheet = await openSheet();
    expect(sheet.getByRole('textbox', { name: 'Name' })).toHaveValue('East lamp');
    fireEvent.change(sheet.getByRole('textbox', { name: 'Name' }), { target: { value: '' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { name: null }));
    await waitFor(() => expect(told.map(one => one.label)).toEqual(['East lamp is now called Plantalytix Socket']));
  });

  /** A tap on a place moved the device there at once, with nothing said and no way back. */
  it('only chooses a place on a chip, moves with the button, and says where the device stands now', async () => {
    await drawTab();
    const sheet = await openSheet();
    // The place it stands in is the one marked, so a move is a correction and not a guess.
    expect(sheet.getByRole('button', { name: 'Tent 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(sheet.getByRole('button', { name: 'Fridge 1' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(sheet.getByRole('button', { name: 'Fridge 1' }));

    expect(sheet.getByRole('button', { name: 'Fridge 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(api.patch).not.toHaveBeenCalled();
    // A plug carries no camera and no sockets, so nothing is said to go with it.
    expect(sheet.queryByText(/Moves with it/)).not.toBeInTheDocument();

    fireEvent.click(sheet.getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { spaceId: 'space-2' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(told.map(one => one.label)).toEqual(['Plantalytix Socket is now in Fridge 1']);

    // Taken back, it stands where it stood.
    await told[0].undo!();
    expect(api.patch).toHaveBeenLastCalledWith('/devices/device-1', { spaceId: 'space-1' });
  });

  it('leaves a device where it is when the chip of its own place is tapped again', async () => {
    await drawTab();
    const sheet = await openSheet();
    fireEvent.click(sheet.getByRole('button', { name: 'Fridge 1' }));
    fireEvent.click(sheet.getByRole('button', { name: 'Tent 1' }));

    expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('says before the move what goes with the device - the camera it answers for and its sockets - and names them in the toast', async () => {
    wire.cameras = [
      { id: 'camera-1', name: 'Canopy cam', deviceId: 'device-1', spaceId: 'space-1', removedAt: null } as Camera,
      { id: 'camera-2', name: 'Door cam', deviceId: null, spaceId: 'space-1', removedAt: null } as Camera,
    ];
    wire.sockets = [{ slot: 0, role: 'heater' } as Socket, { slot: 1, role: 'light' } as Socket];
    answer([{ ...THE_PLUG, type: 'controller', name: 'East tent' }], [spaceWhere('own'), ELSEWHERE]);
    await drawPage('East tent');
    const sheet = await openSheet();
    expect(sheet.queryByText(/Moves with it/)).not.toBeInTheDocument();
    fireEvent.click(sheet.getByRole('button', { name: 'Fridge 1' }));

    // The camera standing there on its own stays.
    expect(await sheet.findByText(/Moves with it/)).toBeInTheDocument();
    expect(sheet.getByText(/Moves with it/).closest('p')).toHaveTextContent(/^Moves with it: camera Canopy cam · 2 sockets$/);
    fireEvent.change(sheet.getByRole('textbox', { name: 'Name' }), { target: { value: 'Fridge module' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Move' }));

    // A name typed beside the move is written with it, and both are taken back together.
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { name: 'Fridge module', spaceId: 'space-2' }));
    await waitFor(() =>
      expect(told.map(one => one.label)).toEqual([
        'East tent is now called Fridge module · Fridge module is now in Fridge 1 · with camera Canopy cam, 2 sockets',
      ]),
    );
    await told[0].undo!();
    expect(api.patch).toHaveBeenLastCalledWith('/devices/device-1', { name: 'East tent', spaceId: 'space-1' });
  });

  /**
   * Taking one device out of a place it shares - a fridge module stood beside a
   * tent controller - needs a place of its own, which may not exist yet. It is
   * made in the room the device leaves, with the kind a claim would give it.
   */
  it('moves the device into a new place, made in the room it leaves, and offers no way back that would leave the place behind', async () => {
    answer(
      [{ ...THE_PLUG, type: 'fridge' }],
      [spaceWhere('own', { roomId: 'room-1' }), spaceWhere('own', { id: 'room-1', kind: 'room', name: 'Grow room' })],
    );
    vi.mocked(api.post).mockResolvedValue(spaceWhere('own', { id: 'space-new', name: 'KS Black', kind: 'fridge', roomId: 'room-1' }) as never);
    await drawPage('Fridge module');
    const sheet = await openSheet();
    // A room holds no hardware, so it is no place to move into.
    expect(sheet.queryByRole('button', { name: 'Grow room' })).not.toBeInTheDocument();
    fireEvent.click(sheet.getByRole('button', { name: '+ New place' }));
    // A place without a name is not made.
    expect(sheet.getByRole('button', { name: 'Move' })).toBeDisabled();
    fireEvent.change(sheet.getByRole('textbox', { name: 'Name of the place' }), { target: { value: ' KS Black ' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/spaces', { kind: 'fridge', name: 'KS Black', roomId: 'room-1' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { spaceId: 'space-new' }));
    await waitFor(() => expect(told).toEqual([{ label: 'Fridge module is now in KS Black', undo: null, from: 'device-device-1' }]));
  });

  it('keeps the sheet open with what the server said when the move is refused, and makes no second place on the next try', async () => {
    const { ApiError } = await import('@/api/problem');
    answer([{ ...THE_PLUG, type: 'fridge' }], [spaceWhere('own')]);
    vi.mocked(api.post).mockResolvedValue(spaceWhere('own', { id: 'space-new', name: 'KS Black', kind: 'fridge' }) as never);
    vi.mocked(api.patch).mockRejectedValueOnce(new ApiError({ status: 409, code: 'conflict', title: 'Conflict', detail: 'Not now.', errors: [] }));
    await drawPage('Fridge module');
    const sheet = await openSheet();
    fireEvent.click(sheet.getByRole('button', { name: '+ New place' }));
    fireEvent.change(sheet.getByRole('textbox', { name: 'Name of the place' }), { target: { value: 'KS Black' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Move' }));

    expect(await sheet.findByRole('alert')).toHaveTextContent('Not now.');
    expect(told).toEqual([]);
    fireEvent.click(sheet.getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(told).toHaveLength(1));
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
