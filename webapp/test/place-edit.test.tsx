import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import type { Camera, Device, Space } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import type { Told } from '@/log/log-context';
import { EditPlace } from '@/screens/place/EditPlace';
import { RemovePlace } from '@/screens/place/RemovePlace';
import { END, NEW_PLACE, RELEASE, UNCOUPLE, firstChoices, moveTo, settled, standingIn, stepsOf, withDevice } from '@/screens/place/remove-plan';
import { drawAt } from './harness';
import { spaceWhere } from './session';
import { translate } from './translations';

/**
 * "Ort bearbeiten" and "Ort entfernen": what a place is called, its kind and
 * its room in one save, and a place that ends with everything standing in it
 * sent somewhere of its own.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

const told: Told[] = [];
vi.mock('@/log/log-context', async importOriginal => ({
  ...(await importOriginal<object>()),
  useLog: () => ({ tell: (one: Told) => told.push(one) }),
}));

// The people of a place are their own screen's business (`members.test.tsx`).
vi.mock('@/screens/space/members/Members', () => ({
  Members: ({ name, scope }: { name: string; scope?: React.ReactNode }) => (
    <div data-testid="members">
      people of {name}
      {scope}
    </div>
  ),
}));

beforeAll(() => translate());

const TENT = spaceWhere('own', { id: 'tent', name: 'Tent', roomId: 'room' });
const FRIDGE = spaceWhere('own', { id: 'fridge', name: 'KS Black', kind: 'fridge' });
const ROOM = spaceWhere('own', { id: 'room', name: 'Grow room', kind: 'room' });
const ATTIC = spaceWhere('own', { id: 'attic', name: 'Attic', kind: 'room' });

const device = (over: Partial<Device>): Device =>
  ({ id: 'device-1', type: 'controller', name: 'controller', ownerId: 'user-1', spaceId: 'tent', state: { hardware: {} }, ...over }) as Device;
const camera = (over: Partial<Camera>): Camera =>
  ({ id: 'cam', name: 'Canopy cam', kind: 'rtsp', spaceId: 'tent', deviceId: null, removedAt: null, ...over }) as Camera;

const state = {
  spaces: [] as Space[],
  devices: [] as Device[],
  cameras: [] as Camera[],
  grows: [] as { id: string; name: string; endedAt: string | null; summary: { dayNumber: number | null } }[],
  members: [] as { spaceId: string; userId: string }[],
};

function Watch() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname}</span>;
}

const draw = (at: string) =>
  drawAt(
    <>
      <Routes>
        <Route path="/spaces/:spaceId/edit" element={<EditPlace />} />
        <Route path="/spaces/:spaceId/remove" element={<RemovePlace />} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
      <Watch />
    </>,
    { at },
  );

beforeEach(() => {
  told.length = 0;
  state.spaces = [TENT, FRIDGE, ROOM];
  state.devices = [device({})];
  state.cameras = [];
  state.grows = [];
  state.members = [];
  for (const method of [api.get, api.post, api.patch, api.put, api.delete]) vi.mocked(method).mockReset();
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/spaces') return Promise.resolve({ items: state.spaces, nextCursor: null }) as never;
    if (path === '/devices') return Promise.resolve({ items: state.devices, nextCursor: null }) as never;
    if (path.startsWith('/cameras')) return Promise.resolve({ items: state.cameras, nextCursor: null }) as never;
    if (path === '/grows') return Promise.resolve({ items: state.grows, nextCursor: null }) as never;
    if (path.endsWith('/members')) return Promise.resolve({ items: state.members, nextCursor: null, people: [], room: null, activity: [] }) as never;
    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });
  vi.mocked(api.patch).mockImplementation((_path: string, body: unknown) => Promise.resolve({ ...TENT, ...(body as object) }) as never);
  vi.mocked(api.post).mockImplementation(
    (path: string, body: unknown) =>
      Promise.resolve(path === '/spaces' ? { ...TENT, id: `made-${(body as { name: string }).name}`, ...(body as object) } : {}) as never,
  );
  vi.mocked(api.put).mockResolvedValue({ id: 'device-1' } as never);
  vi.mocked(api.delete).mockResolvedValue(null as never);
});

describe('editing a place', () => {
  it('saves the name, the kind and a room still to be made in one write, says what changed and how to take it back', async () => {
    draw('/spaces/tent/edit');

    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: '  Flower   tent ' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value: 'other' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Room' }), { target: { value: 'new' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the room' }), { target: { value: 'Cellar' } });
    fireEvent.click(save);

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/tent', { name: 'Flower tent', kind: 'other', roomName: 'Cellar' }));
    await waitFor(() => expect(told).toHaveLength(1));
    expect(told[0].label).toBe('Tent is now called Flower tent · Kind of Flower tent: Other place · Flower tent now stands in Cellar');

    // Taken back by the room's name: the room it left may have ended with its last place.
    await told[0].undo!();
    expect(api.patch).toHaveBeenLastCalledWith('/spaces/tent', { name: 'Tent', kind: 'tent', roomName: 'Grow room' });
  });

  it('sends only what changed, and a room that exists by its id', async () => {
    state.spaces = [TENT, FRIDGE, ROOM, ATTIC];
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Room' }), { target: { value: 'attic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/tent', { roomId: 'attic' }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Room' }), { target: { value: 'none' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith('/spaces/tent', { roomId: null }));
    expect(told[1].label).toBe('Tent no longer stands in a room');
  });

  it('says a name another of the owner´s places carries before anything is sent, however it is typed', async () => {
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: ' ks  BLACK ' } });

    expect(screen.getByRole('alert')).toHaveTextContent('Another place is already called “KS Black”.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInvalid();
    // A room may carry the name of a place.
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Grow room' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('shows the sentence of a server that refused the name all the same, and keeps what was typed', async () => {
    vi.mocked(api.patch).mockRejectedValue(
      new ApiError({ status: 409, code: 'name_taken', title: 'Conflict', detail: 'Another place is already called "Loft".', errors: [] }),
    );
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Loft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Another place is already called "Loft"\./)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Loft');
    expect(told).toHaveLength(0);
  });

  it('asks about a room only from the second place on, and offers no end for the only place', async () => {
    state.spaces = [spaceWhere('own', { id: 'tent', name: 'Tent' })];
    draw('/spaces/tent/edit');

    expect(await screen.findByRole('combobox', { name: 'Kind' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Room' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Remove Tent/ })).not.toBeInTheDocument();
  });

  it('lists what stands here, each leading to its own page, and leads to the page that ends the place', async () => {
    state.devices = [device({ name: 'Tent controller' }), device({ id: 'device-2', type: 'fan', name: 'fan', spaceId: 'fridge' })];
    state.cameras = [camera({ id: 'cam-1', name: 'Canopy cam' })];
    draw('/spaces/tent/edit');

    expect(await screen.findByRole('link', { name: /Tent controller/ })).toHaveAttribute('href', '/devices/device-1');
    expect(screen.getByRole('link', { name: /Canopy cam/ })).toHaveAttribute('href', '/cameras/cam-1');
    expect(screen.queryByRole('link', { name: /^Fan/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Remove Tent …' })).toHaveAttribute('href', '/spaces/tent/remove');
  });

  it('brings a device standing elsewhere through its own sheet, with this place chosen and nothing written yet', async () => {
    state.devices = [device({}), device({ id: 'device-2', type: 'fan', name: 'fan', spaceId: 'fridge' })];
    draw('/spaces/tent/edit');

    fireEvent.click(await screen.findByRole('button', { name: '+ Bring a device here' }));
    const sheet = await screen.findByRole('dialog', { name: 'Bring a device to Tent' });
    expect(within(sheet).getByRole('link', { name: /Add a new device/ })).toHaveAttribute('href', '/claim?space=tent');
    fireEvent.click(within(sheet).getByRole('button', { name: /Fan.*stands in KS Black/ }));

    const moving = await screen.findByRole('dialog', { name: 'Rename or move' });
    expect(within(moving).getByRole('button', { name: 'Tent', pressed: true })).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('offers a member who manages the place no device to bring: a device stands only in a place of its owner', async () => {
    state.spaces = [spaceWhere('manage', { id: 'tent', name: 'Tent' }), FRIDGE];
    state.devices = [device({ ownerId: 'user-host' }), device({ id: 'device-2', type: 'fan', name: 'fan', spaceId: 'fridge' })];
    draw('/spaces/tent/edit');

    expect(await screen.findByRole('link', { name: /Controller/ })).toBeInTheDocument();
    expect(screen.queryByText('+ Bring a device here')).not.toBeInTheDocument();
  });

  it('leads straight to adding a device where none stands anywhere else', async () => {
    draw('/spaces/tent/edit');

    expect(await screen.findByRole('link', { name: '+ Bring a device here' })).toHaveAttribute('href', '/claim?space=tent');
  });

  it('lets the owner choose whether an invitation is for the place or for its room', async () => {
    draw('/spaces/tent/edit');

    expect(await screen.findByTestId('members')).toHaveTextContent('people of Tent');
    fireEvent.change(screen.getByRole('combobox', { name: /An invitation is for/ }), { target: { value: 'room' } });
    expect(screen.getByTestId('members')).toHaveTextContent('people of Grow room');
  });

  it('shows a member who may not manage the place who else is here instead', async () => {
    state.spaces = [spaceWhere('log', { id: 'tent', name: 'Tent' })];
    draw('/spaces/tent/edit');

    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('/spaces/tent/members'));
  });

  it('has no page for a room, nor for a place that has ended', async () => {
    draw('/spaces/room/edit');

    expect(await screen.findByText('This place cannot be opened.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
  });
});

describe('what ending a place does with what stands in it', () => {
  const tent = device({ id: 'ctrl', name: 'Tent controller' });
  const fan = device({ id: 'fan', type: 'fan', name: 'fan' });
  const paired = camera({ id: 'cam-paired', deviceId: 'ctrl', kind: 'terpcam_controller' });
  const loose = camera({ id: 'cam-loose', name: 'Door cam' });
  const grow = { growId: 'grow-1', name: 'Spring run' };
  const standing = standingIn(
    'tent',
    [tent, fan, device({ id: 'other', spaceId: 'fridge' })],
    [paired, loose, camera({ id: 'gone', removedAt: '2026-01-01T00:00:00.000Z' })],
    [grow],
  );
  const nameOf = (one: Device) => (one.id === 'ctrl' ? 'Tent controller' : 'Fan');

  it('finds the devices standing there, their cameras, the cameras on their own and the grows', () => {
    expect(standing.devices.map(one => one.id)).toEqual(['ctrl', 'fan']);
    expect(standing.paired.map(one => one.id)).toEqual(['cam-paired']);
    expect(standing.loose.map(one => one.id)).toEqual(['cam-loose']);
  });

  it('sends each device to a place of its own until told otherwise, and never guesses where the plants stand', () => {
    const first = firstChoices(standing, [FRIDGE]);

    expect(first).toEqual({ ctrl: 'new', fan: 'new', 'cam-paired': 'stay', 'cam-loose': 'move:fridge', 'grow-1': '' });
    expect(settled(standing, first)).toBe(false);
    expect(settled(standing, { ...first, 'grow-1': withDevice('ctrl') })).toBe(true);
    // The grow was to go with a device that is given up after all: asked again.
    expect(settled(standing, { ...first, ctrl: RELEASE, 'grow-1': withDevice('ctrl') })).toBe(false);
  });

  it('makes a place per device that gets one, numbered past a name that is taken, in the room the place stood in', () => {
    const steps = stepsOf(standing, { ...firstChoices(standing, [FRIDGE]), 'grow-1': withDevice('ctrl') }, nameOf, ['Tent', 'Fan'], 'room');

    expect(steps).toEqual([
      { do: 'make', key: 'ctrl', body: { kind: 'tent', name: 'Tent controller', roomId: 'room' } },
      { do: 'device', deviceId: 'ctrl', to: { made: 'ctrl' } },
      { do: 'make', key: 'fan', body: { kind: 'other', name: 'Fan 2', roomId: 'room' } },
      { do: 'device', deviceId: 'fan', to: { made: 'fan' } },
      { do: 'camera', cameraId: 'cam-loose', spaceId: 'fridge' },
      { do: 'grow', growId: 'grow-1', to: { made: 'ctrl' } },
    ]);
  });

  it('gives each thing the destination chosen for it: another place, given up, taken off, ended', () => {
    const steps = stepsOf(
      standing,
      { ctrl: moveTo('fridge'), fan: RELEASE, 'cam-paired': UNCOUPLE, 'cam-loose': UNCOUPLE, 'grow-1': END },
      nameOf,
      [],
      null,
    );

    expect(steps).toEqual([
      { do: 'device', deviceId: 'ctrl', to: { spaceId: 'fridge' } },
      { do: 'release', deviceId: 'fan' },
      { do: 'uncouple', cameraId: 'cam-paired' },
      { do: 'uncouple', cameraId: 'cam-loose' },
      { do: 'end', growId: 'grow-1' },
    ]);
    expect(
      stepsOf(
        standing,
        { ctrl: RELEASE, fan: NEW_PLACE, 'cam-paired': UNCOUPLE, 'cam-loose': moveTo('fridge'), 'grow-1': 'nowhere' },
        nameOf,
        [],
        null,
      ),
    ).toEqual([
      { do: 'release', deviceId: 'ctrl' },
      { do: 'make', key: 'fan', body: { kind: 'other', name: 'Fan' } },
      { do: 'device', deviceId: 'fan', to: { made: 'fan' } },
      // The camera of a device that is given up went with the claim: nothing is sent for it.
      { do: 'camera', cameraId: 'cam-loose', spaceId: 'fridge' },
      { do: 'grow', growId: 'grow-1', to: null },
    ]);
  });
});

describe('removing a place', () => {
  beforeEach(() => {
    state.devices = [device({ name: 'Tent controller' })];
    state.cameras = [camera({ id: 'cam-paired', name: 'Canopy cam', deviceId: 'device-1', kind: 'terpcam_controller' })];
    state.grows = [{ id: 'grow-1', name: 'Spring run', endedAt: null, summary: { dayNumber: 29 } }];
  });

  it('waits for where the plants stand, then makes the device its place, moves the grow there and ends the place', async () => {
    draw('/spaces/tent/remove');

    const remove = await screen.findByRole('button', { name: 'Remove Tent' });
    expect(remove).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Tent controller' })).toHaveValue('new');
    expect(screen.getByRole('combobox', { name: 'Canopy cam' })).toHaveValue('stay');
    const plants = screen.getByRole('combobox', { name: 'Spring run · Day 29' });
    expect(plants).toHaveValue('');
    expect(
      within(plants)
        .getAllByRole('option')
        .map(option => option.textContent),
    ).toEqual(['Where do the plants stand now?', 'at the new place of Tent controller', 'in KS Black', 'in no fixed place', 'End the grow']);
    expect(screen.getByText('Curves and pictures up to today stay with the grow Spring run.')).toBeInTheDocument();

    fireEvent.change(plants, { target: { value: 'with:device-1' } });
    fireEvent.click(remove);

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spaces/tent'));
    // The place made for the device is named as a claim names one, and stands in the room the place stood in.
    expect(api.post).toHaveBeenCalledWith('/spaces', { kind: 'tent', name: 'Tent 1', roomId: 'room' });
    expect(api.put).toHaveBeenCalledWith('/spaces/made-Tent 1/devices/device-1');
    expect(api.post).toHaveBeenCalledWith('/grows/grow-1/placements', expect.objectContaining({ spaceId: 'made-Tent 1' }));
    expect(api.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(told.map(one => one.label)).toEqual(['Tent removed']));
    expect(told[0].undo).toBeNull();
    expect(screen.getByTestId('address')).toHaveTextContent('/');
  });

  it('asks about the grow again when the device it was to go with moves into a place that exists', async () => {
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Spring run · Day 29' }), { target: { value: 'with:device-1' } });
    expect(screen.getByRole('button', { name: 'Remove Tent' })).toBeEnabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tent controller' }), { target: { value: 'move:fridge' } });

    expect(screen.getByRole('button', { name: 'Remove Tent' })).toBeDisabled();
  });

  it('says what the server refused, leaves the place standing and reads again what still stands in it', async () => {
    vi.mocked(api.put).mockRejectedValue(
      new ApiError({ status: 409, code: 'space_archived', title: 'Conflict', detail: 'That space has ended.', errors: [] }),
    );
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Spring run · Day 29' }), { target: { value: 'end' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Tent controller' }), { target: { value: 'move:fridge' } });
    const reads = vi.mocked(api.get).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tent' }));

    expect(await screen.findByText(/That space has ended\./)).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
    expect(told).toHaveLength(0);
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(reads));
  });

  it('does not end a place people are still let into, and leads to them', async () => {
    state.grows = [];
    state.members = [{ spaceId: 'tent', userId: 'user-2' }];
    draw('/spaces/tent/remove');

    expect(await screen.findByText('1 person is still let in. Let them go first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Tent' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'To who is let in' })).toHaveAttribute('href', '/spaces/tent/edit');
  });

  it('is the owner´s, and never ends the last place', async () => {
    state.spaces = [spaceWhere('manage', { id: 'tent', name: 'Tent' }), FRIDGE];
    draw('/spaces/tent/remove');
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('/spaces/tent/edit'));
  });
});
