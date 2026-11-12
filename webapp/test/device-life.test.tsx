import { fireEvent, screen, waitFor } from '@testing-library/react';
import { DateTime } from 'luxon';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Device, Space } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { drawDevicePages } from './device-pages';
import { spaceWhere, THE_HOST } from './session';
import { translate } from './translations';

/**
 * What a grower may do to a device once it is theirs: call it something, and
 * put it where it really stands.
 *
 * Both are `PATCH /devices/{id}`, behind the first row of the device's own
 * page. The two are tested together because the sheet writes them differently
 * on purpose - a name is typed and saved, a place is written on the tap.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

vi.mock('@/log/log-context', async importOriginal => ({ ...(await importOriginal<object>()), useLog: () => ({ tell: () => undefined }) }));
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

/** What the API answers: the devices and the places a test names, and nothing else worth reading. */
const answer = (devices: Device[], spaces: Space[]) =>
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/devices') return Promise.resolve({ items: devices, nextCursor: null }) as never;
    if (path === '/spaces') return Promise.resolve({ items: spaces, nextCursor: null }) as never;
    if (path === '/me') return Promise.resolve({ premium: { enforced: true } }) as never;
    if (path.endsWith('/live')) return Promise.resolve({ deviceId: 'device-1', metrics: {}, outputs: {}, setpoints: null, pending: null }) as never;

    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });

/** The device's own page, read through to the place it stands in. */
const drawPage = async (title: string | RegExp) => {
  drawDevicePages('/devices/device-1');
  await screen.findByRole('heading', { name: title });
  await screen.findAllByRole('link', { name: /Tent 1$/ });
};

/** The plug's page, standing in a place the reader may do `youMay` in. */
const drawTab = async (youMay: AccessNeed = 'own') => {
  answer([THE_PLUG], [spaceWhere(youMay), ELSEWHERE]);
  vi.mocked(api.patch).mockImplementation((_path: string, body: unknown) => Promise.resolve({ ...THE_PLUG, ...(body as object) }) as never);

  // The account's one plug is called a plug: the tail of its id is for telling two apart.
  await drawPage('Plantalytix Socket');
};

const RENAME = { name: /^Rename or move/ };

beforeAll(() => translate());

beforeEach(() => {
  vi.mocked(api.patch).mockClear();
});

describe('naming a device and moving it', () => {
  it('offers the correction as the first row of the page, saying where the device stands', async () => {
    await drawTab();

    expect(await screen.findByRole('button', RENAME)).toHaveTextContent('stands in Tent 1');
  });

  /** What may be done is the device's answer and not the screen's: the same reader owns one tent and only writes lines in the next. */
  it('offers it to nobody who may only write lines where the device stands', async () => {
    await drawTab('log');

    expect(screen.queryByRole('button', RENAME)).not.toBeInTheDocument();
  });

  it('writes the typed name to the device, and nothing until it is saved', async () => {
    await drawTab();
    fireEvent.click(await screen.findByRole('button', RENAME));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: '  East lamp  ' } });

    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save the name' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { name: 'East lamp' }));
  });

  /**
   * An empty field is a device with no name of its own rather than one called
   * nothing: the list then falls back to the type and the characters printed on
   * the hardware, which is the state every unnamed device is already in.
   */
  it('gives a named device its fallback back when the field is emptied', async () => {
    answer([{ ...THE_PLUG, name: 'East lamp' }], [spaceWhere('own'), ELSEWHERE]);
    await drawPage('East lamp');
    fireEvent.click(await screen.findByRole('button', RENAME));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the name' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { name: null }));
  });

  it('moves the device into another place it is not standing in, on the tap', async () => {
    await drawTab();
    fireEvent.click(await screen.findByRole('button', RENAME));
    fireEvent.click(screen.getByRole('button', { name: 'Fridge 1' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { spaceId: 'space-2' }));
  });

  it('says which place it is standing in now, so a move is a correction and not a guess', async () => {
    await drawTab();
    fireEvent.click(await screen.findByRole('button', RENAME));

    expect(screen.getByRole('button', { name: 'Tent 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Fridge 1' })).toHaveAttribute('aria-pressed', 'false');
  });

  /**
   * Taking one device out of a place it shares - a fridge module stood beside a
   * tent controller - needs a place of its own, which may not exist yet. It is
   * made in the room the device leaves, with the kind a claim would give it.
   */
  it('moves the device into a new place, made in the room it leaves', async () => {
    answer(
      [{ ...THE_PLUG, type: 'fridge' }],
      [spaceWhere('own', { roomId: 'room-1' }), spaceWhere('own', { id: 'room-1', kind: 'room', name: 'Grow room' })],
    );
    vi.mocked(api.post).mockResolvedValue(spaceWhere('own', { id: 'space-new', name: 'KS Black', kind: 'fridge', roomId: 'room-1' }) as never);
    await drawPage('Fridge module');
    fireEvent.click(await screen.findByRole('button', RENAME));
    fireEvent.click(screen.getByRole('button', { name: '+ New place' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the place' }), { target: { value: ' KS Black ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and move' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/spaces', { kind: 'fridge', name: 'KS Black', roomId: 'room-1' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { spaceId: 'space-new' }));
  });
});
