import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import type { Camera, Device, Space } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import type { Told } from '@/log/log-context';
import { EditPlace } from '@/screens/place/EditPlace';
import { RemovePlace } from '@/screens/place/RemovePlace';
import {
  END,
  NEW_PLACE,
  RELEASE,
  STAY,
  UNCOUPLE,
  choicesOf,
  fatesOf,
  gathered,
  moveTo,
  settled,
  standingIn,
  unusedOf,
  withDevice,
} from '@/screens/place/remove-plan';
import { drawAt } from './harness';
import { spaceWhere } from './session';
import { translate } from './translations';

/**
 * "Ort bearbeiten" and "Ort entfernen": what a place is called, its kind and
 * its room in one save, and a place that ends with everything standing in it
 * sent somewhere first - together, unless told otherwise.
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
  Members: ({ name }: { name: string }) => <div data-testid="members">people of {name}</div>,
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
  /** Who is let in where, as the server answers it: a place's list carries its room's rows, a room's its own. */
  const letIn = (rows: { spaceId: string; handle: string }[]) => {
    const read = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((path: string) => {
      const id = /^\/spaces\/([^/]+)\/members$/.exec(path)?.[1];
      if (!id) return read(path);
      const roomId = state.spaces.find(one => one.id === id)?.roomId ?? null;
      const items = rows
        .filter(row => row.spaceId === id || row.spaceId === roomId)
        .map(row => ({ spaceId: row.spaceId, userId: `user-${row.handle}` }));
      const people = [...new Set(rows.map(row => row.handle))].map(handle => ({ id: `user-${handle}`, handle }));
      return Promise.resolve({ items, nextCursor: null, people, room: null, activity: [] }) as never;
    });
  };

  /** The button once the page knows whom the room lets in, which a change of room waits for. */
  const saveReady = async () => {
    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    return save;
  };

  it('saves the name, the kind and a room still to be made in one write, says what changed and how to take it back', async () => {
    draw('/spaces/tent/edit');

    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: '  Flower   tent ' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value: 'other' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Room' }), { target: { value: 'new' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the room' }), { target: { value: 'Cellar' } });
    fireEvent.click(await saveReady());

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/tent', { name: 'Flower tent', kind: 'other', roomName: 'Cellar' }));
    await waitFor(() => expect(told).toHaveLength(1));
    expect(told[0].label).toBe('Tent is now called Flower tent · Kind of Flower tent: Other place · Flower tent now stands in Cellar');

    // Taken back by the room's name: the room it left may have ended with its last place. The undo says what is back.
    await told[0].undo!();
    expect(api.patch).toHaveBeenLastCalledWith('/spaces/tent', { name: 'Tent', kind: 'tent', roomName: 'Grow room' });
    expect(told[1]).toMatchObject({
      label: 'Undone · Flower tent is now called Tent · Kind of Tent: Tent · Tent now stands in Grow room',
      undo: null,
    });
  });

  it('sends only what changed, and a room that exists by its id', async () => {
    state.spaces = [TENT, FRIDGE, ROOM, ATTIC];
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Room' }), { target: { value: 'attic' } });
    fireEvent.click(await saveReady());
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/tent', { roomId: 'attic' }));

    fireEvent.change(screen.getByRole('combobox', { name: 'Room' }), { target: { value: 'none' } });
    fireEvent.click(await saveReady());
    await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith('/spaces/tent', { roomId: null }));
    expect(told[1].label).toBe('Tent no longer stands in a room');
  });

  it('names a room in the toast as it is stored, not as it was typed', async () => {
    state.spaces = [TENT, FRIDGE, ROOM, ATTIC];
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Room' }), { target: { value: 'new' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the room' }), { target: { value: '  attic ' } });
    fireEvent.click(await saveReady());

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/tent', { roomName: 'attic' }));
    await waitFor(() => expect(told).toHaveLength(1));
    expect(told[0].label).toBe('Tent now stands in Attic');
  });

  it('says in the room´s options whom each room lets in', async () => {
    state.spaces = [TENT, FRIDGE, ROOM, ATTIC, spaceWhere('own', { id: 'shed', name: 'Shed', kind: 'room' })];
    letIn([
      { spaceId: 'room', handle: 'mara' },
      { spaceId: 'room', handle: 'jonas' },
      { spaceId: 'attic', handle: 'lea' },
    ]);
    draw('/spaces/tent/edit');

    const room = await screen.findByRole('combobox', { name: 'Room' });
    await waitFor(() =>
      expect(
        within(room)
          .getAllByRole('option')
          .map(option => option.textContent),
      ).toEqual(['Grow room · 2 people see it too', 'Attic · 1 person sees it too', 'Shed', 'New room …', 'No room']),
    );
  });

  it('says in the toast who sees the place now and who no longer does, and takes both back', async () => {
    state.spaces = [TENT, { ...FRIDGE, roomId: 'room' }, ROOM, ATTIC];
    letIn([
      { spaceId: 'room', handle: 'mara' },
      { spaceId: 'room', handle: 'jonas' },
      // Let into the tent itself as well: the tent stays theirs wherever it stands.
      { spaceId: 'tent', handle: 'jonas' },
      { spaceId: 'attic', handle: 'lea' },
    ]);
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Room' }), { target: { value: 'attic' } });
    await screen.findByRole('option', { name: 'Attic · 1 person sees it too' });
    fireEvent.click(await saveReady());

    // The fridge still stands in the room: it does not end, so nothing is asked.
    await waitFor(() => expect(told).toHaveLength(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(told[0].label).toBe('Tent now stands in Attic · @lea now sees it too · @mara no longer sees it');

    await told[0].undo!();
    expect(api.patch).toHaveBeenLastCalledWith('/spaces/tent', { roomName: 'Grow room' });
    expect(told[1]).toMatchObject({ label: 'Undone · Tent now stands in Grow room · @mara now sees it too · @lea no longer sees it', undo: null });
  });

  it('asks before the last place leaves a room people are let into, names them, and offers no way back afterwards', async () => {
    letIn([
      { spaceId: 'room', handle: 'mara' },
      { spaceId: 'room', handle: 'jonas' },
    ]);
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Room' }), { target: { value: 'none' } });
    fireEvent.click(await saveReady());

    const sheet = await screen.findByRole('dialog', { name: /Take Tent out of Grow room\?/ });
    expect(within(sheet).getByText('That ends Grow room, and @mara and @jonas no longer see any of it.')).toBeInTheDocument();
    expect(within(sheet).getByText('This cannot be taken back.')).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Room' })).toHaveValue('none');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'End Grow room' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/tent', { roomId: null }));
    await waitFor(() => expect(told).toHaveLength(1));
    expect(told[0]).toMatchObject({ label: 'Tent no longer stands in a room · @mara and @jonas no longer see it', undo: null });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says a lost connection like any refused write and can be sent again, also while the browser believes it is offline', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    draw('/spaces/tent/edit');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Loft' } });

    onlineManager.setOnline(false);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('Could not reach the server. Try again.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
      expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Loft');

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(told).toHaveLength(1));
      expect(api.patch).toHaveBeenCalledTimes(2);
    } finally {
      onlineManager.setOnline(true);
    }
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

  it('shows a member who may not manage the place who else is here instead', async () => {
    state.spaces = [spaceWhere('log', { id: 'tent', name: 'Tent' })];
    draw('/spaces/tent/edit');

    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('/spaces/tent/members'));
  });

  it.each(['room', 'ended', 'nowhere'])('has one page for what is not there - a room, a place that has ended, an unknown id (%s)', async id => {
    state.spaces = [...state.spaces, { ...FRIDGE, id: 'ended', archivedAt: '2026-11-01T00:00:00.000Z' }];
    draw(`/spaces/${id}/edit`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Place' })).toBeInTheDocument();
    expect(screen.getByText('This place cannot be opened.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('offers to read again where the places could not be read', async () => {
    vi.mocked(api.get).mockRejectedValue(new TypeError('Failed to fetch'));
    draw('/spaces/tent/edit');

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Place' })).not.toBeInTheDocument();
  });
});

describe('what ending a place does with what stands in it', () => {
  const tent = device({ id: 'ctrl', name: 'Tent controller' });
  const fan = device({ id: 'fan', type: 'fan', name: 'fan' });
  const paired = camera({ id: 'cam-paired', deviceId: 'ctrl', kind: 'terpcam_controller' });
  const loose = camera({ id: 'cam-loose', name: 'Door cam' });
  const grow = { growId: 'grow-1', name: 'Spring run' };
  const LOFT = spaceWhere('own', { id: 'loft', name: 'Loft' });
  const standing = standingIn(
    'tent',
    [fan, tent, device({ id: 'other', spaceId: 'fridge' })],
    [paired, loose, camera({ id: 'gone', removedAt: '2026-01-01T00:00:00.000Z' })],
    [grow],
  );
  const nameOf = () => 'Tent';
  const stepsOf = (choices: Record<string, string>, made = {}) =>
    fatesOf(standing, choices, nameOf, [TENT, FRIDGE], 'room', made).flatMap(fate => fate.step ?? []);

  it('finds the devices standing there - the one that holds a climate first -, their cameras, the cameras on their own and the grows', () => {
    expect(standing.devices.map(one => one.id)).toEqual(['ctrl', 'fan']);
    expect(standing.paired.map(one => one.id)).toEqual(['cam-paired']);
    expect(standing.loose.map(one => one.id)).toEqual(['cam-loose']);
  });

  it('sends the leading device to a place of its kind, a new one where there is none, and keeps the rest with it', () => {
    expect(choicesOf(standing, [FRIDGE, LOFT], {})).toEqual({ ctrl: 'move:loft', fan: STAY, 'cam-paired': STAY, 'cam-loose': STAY, 'grow-1': '' });
    expect(choicesOf(standing, [FRIDGE], {})).toEqual({ ctrl: NEW_PLACE, fan: STAY, 'cam-paired': STAY, 'cam-loose': STAY, 'grow-1': '' });
    // One place, one climate: a tent that holds a controller already does not fit a second one.
    expect(choicesOf(standing, [FRIDGE, LOFT], {}, new Set(['loft'])).ctrl).toBe(NEW_PLACE);
    // What was chosen holds - but nothing stays with a device that is given up: the next one leads.
    expect(choicesOf(standing, [FRIDGE, LOFT], { ctrl: RELEASE, fan: STAY, 'grow-1': END })).toEqual({
      ctrl: RELEASE,
      fan: NEW_PLACE,
      'cam-paired': STAY,
      'cam-loose': STAY,
      'grow-1': END,
    });
    expect(choicesOf(standing, [FRIDGE], { ctrl: RELEASE, fan: RELEASE })['cam-loose']).toBe('move:fridge');
  });

  it('never guesses where the plants stand', () => {
    const first = choicesOf(standing, [FRIDGE], {});

    expect(settled(standing, first)).toBe(false);
    expect(settled(standing, { ...first, 'grow-1': withDevice('ctrl') })).toBe(true);
    // The grow was to go with a device that is given up after all: asked again.
    expect(settled(standing, { ...first, ctrl: RELEASE, 'grow-1': withDevice('ctrl') })).toBe(false);
  });

  it('makes one place at most, with the move of the device it is made for, and sends the rest into it', () => {
    expect(stepsOf({ ...choicesOf(standing, [FRIDGE], {}), 'grow-1': withDevice('ctrl') })).toEqual([
      // Numbered past a name that is taken, and in the room the place stood in.
      { do: 'device', id: 'ctrl', to: { made: 'ctrl' }, make: { kind: 'tent', name: 'Tent 2', roomId: 'room' } },
      { do: 'device', id: 'fan', to: { made: 'ctrl' } },
      { do: 'camera', id: 'cam-loose', to: { made: 'ctrl' } },
      { do: 'grow', id: 'grow-1', to: { made: 'ctrl' } },
    ]);
    // A second place only where one is asked for.
    expect(stepsOf({ ...choicesOf(standing, [FRIDGE], { fan: NEW_PLACE }), 'grow-1': 'nowhere' }).filter(step => 'make' in step)).toEqual([
      { do: 'device', id: 'ctrl', to: { made: 'ctrl' }, make: { kind: 'tent', name: 'Tent 2', roomId: 'room' } },
      { do: 'device', id: 'fan', to: { made: 'fan' }, make: { kind: 'other', name: 'Tent 3', roomId: 'room' } },
    ]);
  });

  it('gives each thing the destination chosen for it: another place, given up, taken off, ended', () => {
    expect(stepsOf({ ctrl: moveTo('fridge'), fan: RELEASE, 'cam-paired': UNCOUPLE, 'cam-loose': UNCOUPLE, 'grow-1': END })).toEqual([
      { do: 'device', id: 'ctrl', to: { spaceId: 'fridge' } },
      { do: 'release', id: 'fan' },
      { do: 'uncouple', id: 'cam-paired' },
      { do: 'uncouple', id: 'cam-loose' },
      { do: 'end', id: 'grow-1' },
    ]);
    // The camera of a device that is given up went with the claim: nothing is sent for it.
    expect(stepsOf({ ctrl: RELEASE, fan: NEW_PLACE, 'cam-paired': UNCOUPLE, 'cam-loose': moveTo('fridge'), 'grow-1': 'nowhere' })).toEqual([
      { do: 'release', id: 'ctrl' },
      { do: 'device', id: 'fan', to: { made: 'fan' }, make: { kind: 'other', name: 'Tent 2', roomId: 'room' } },
      { do: 'camera', id: 'cam-loose', to: { spaceId: 'fridge' } },
      { do: 'grow', id: 'grow-1', to: null },
    ]);
  });

  it('moves into the place an earlier attempt made instead of making a second, and names one nothing is sent to any more', () => {
    const made = { ctrl: { id: 'made-1', name: 'Tent 2' } };
    const first = { ...choicesOf(standing, [FRIDGE], {}), 'grow-1': withDevice('ctrl') };

    expect(stepsOf(first, made)).toEqual([
      { do: 'device', id: 'ctrl', to: { spaceId: 'made-1' } },
      { do: 'device', id: 'fan', to: { spaceId: 'made-1' } },
      { do: 'camera', id: 'cam-loose', to: { spaceId: 'made-1' } },
      { do: 'grow', id: 'grow-1', to: { spaceId: 'made-1' } },
    ]);
    const plan = (choices: Record<string, string>) => fatesOf(standing, choices, nameOf, [TENT, FRIDGE], 'room', made);
    expect(unusedOf(made, plan(first))).toEqual([]);
    expect(unusedOf(made, plan({ ...first, ctrl: moveTo('fridge'), 'grow-1': END }))).toEqual([['ctrl', 'made-1']]);
    expect(unusedOf(made, plan({ ...first, ctrl: RELEASE, fan: moveTo('made-1'), 'grow-1': END }))).toEqual([]);
  });

  it('gathers what became of things: who stands where together, then each way of going - a camera only where it goes away', () => {
    const fates = fatesOf(
      standing,
      { ctrl: NEW_PLACE, fan: RELEASE, 'cam-paired': STAY, 'cam-loose': UNCOUPLE, 'grow-1': withDevice('ctrl') },
      nameOf,
      [TENT, FRIDGE],
      null,
      {},
    );

    expect(gathered(fates)).toEqual([
      { how: 'stands', place: 'Tent 2', ids: ['ctrl', 'grow-1'] },
      { how: 'release', place: null, ids: ['fan'] },
      { how: 'remove', place: null, ids: ['cam-loose'] },
    ]);
  });
});

describe('removing a place', () => {
  const LOFT = spaceWhere('own', { id: 'loft', name: 'Loft' });
  const refused = () => new ApiError({ status: 409, code: 'space_archived', title: 'Conflict', detail: 'That space has ended.', errors: [] });
  const select = (name: string) => screen.getByRole('combobox', { name });
  /** The page's button, and the question it opens. */
  const ask = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Tent' }));
    return screen.findByRole('dialog', { name: 'Remove Tent?' });
  };
  const linesOf = (sheet: HTMLElement) =>
    within(sheet)
      .getAllByRole('listitem')
      .map(line => line.textContent);
  const answer = (sheet: HTMLElement) => fireEvent.click(within(sheet).getByRole('button', { name: 'Remove Tent' }));
  const written = () => [api.post, api.put, api.patch, api.delete].flatMap(method => vi.mocked(method).mock.calls);

  beforeEach(() => {
    state.devices = [device({ name: 'Tent controller' }), device({ id: 'device-2', type: 'fan', name: 'fan' })];
    state.cameras = [camera({ id: 'cam-paired', name: 'Canopy cam', deviceId: 'device-1', kind: 'terpcam_controller' })];
    state.grows = [{ id: 'grow-1', name: 'Spring run', endedAt: null, summary: { dayNumber: 29 } }];
    // The stack as the lists then read it: a place that was made is there, a device that moved stands in it.
    vi.mocked(api.post).mockImplementation((path: string, body: unknown) => {
      if (path !== '/spaces') return Promise.resolve({}) as never;
      const made = { ...TENT, id: `made-${(body as { name: string }).name}`, ...(body as object) } as Space;
      state.spaces = [...state.spaces, made];
      return Promise.resolve(made) as never;
    });
    vi.mocked(api.put).mockImplementation((path: string) => {
      const [, spaceId, deviceId] = /^\/spaces\/(.+)\/devices\/(.+)$/.exec(path)!;
      state.devices = state.devices.map(one => (one.id === deviceId ? { ...one, spaceId } : one));
      return Promise.resolve({ id: deviceId }) as never;
    });
  });

  it('waits for where the plants stand, asks once with every line as it will happen, and writes nothing before that answer', async () => {
    draw('/spaces/tent/remove');

    expect(await screen.findByRole('button', { name: 'Remove Tent' })).toBeDisabled();
    // No other tent to go to: the controller gets a place, and the tent stays together.
    expect(select('Tent controller')).toHaveValue('new');
    expect(select('Fan')).toHaveValue('stay');
    expect(select('Canopy cam')).toHaveValue('stay');
    const plants = select('Spring run · Day 29');
    expect(plants).toHaveValue('');
    expect(
      within(plants)
        .getAllByRole('option')
        .map(option => option.textContent),
    ).toEqual(['Where do the plants stand now?', 'at the new place of Tent controller', 'in KS Black', 'in no fixed place', 'End the grow']);
    expect(screen.getByText('Curves and pictures up to today stay with the grow Spring run.')).toBeInTheDocument();

    fireEvent.change(plants, { target: { value: 'with:device-1' } });
    const sheet = await ask();
    expect(linesOf(sheet)).toEqual([
      'Tent controller gets a new place: Tent 2',
      'Fan stays with Tent controller',
      'Canopy cam stays with Tent controller',
      'Spring run moves along to the new place of Tent controller',
    ]);
    expect(written()).toEqual([]);

    answer(sheet);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spaces/tent'));
    // One place, named as a claim names one, in the room the place stood in - made when its device moves into it.
    expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/spaces')).toEqual([
      ['/spaces', { kind: 'tent', name: 'Tent 2', roomId: 'room' }],
    ]);
    expect(vi.mocked(api.put).mock.calls).toEqual([['/spaces/made-Tent 2/devices/device-1'], ['/spaces/made-Tent 2/devices/device-2']]);
    expect(api.post).toHaveBeenCalledWith('/grows/grow-1/placements', expect.objectContaining({ spaceId: 'made-Tent 2' }));
    expect(api.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(told.map(one => one.label)).toEqual(['Tent removed. Tent controller, Fan, and Spring run now stand in Tent 2.']));
    expect(told[0].undo).toBeNull();
    expect(screen.getByTestId('address')).toHaveTextContent('/');
  });

  it('sends the tent into another tent of the account where there is one, and makes no place', async () => {
    state.spaces = [TENT, FRIDGE, LOFT, ROOM];
    draw('/spaces/tent/remove');

    await screen.findByRole('button', { name: 'Remove Tent' });
    expect(select('Tent controller')).toHaveValue('move:loft');
    expect(select('Fan')).toHaveValue('stay');
    fireEvent.change(select('Spring run · Day 29'), { target: { value: 'move:loft' } });
    const sheet = await ask();
    expect(linesOf(sheet)).toEqual([
      'Tent controller moves to Loft',
      'Fan stays with Tent controller',
      'Canopy cam stays with Tent controller',
      'Spring run moves to Loft',
    ]);

    answer(sheet);
    await waitFor(() => expect(told.map(one => one.label)).toEqual(['Tent removed. Tent controller, Fan, and Spring run now stand in Loft.']));
    expect(api.post).not.toHaveBeenCalledWith('/spaces', expect.anything());
    expect(vi.mocked(api.put).mock.calls).toEqual([['/spaces/loft/devices/device-1'], ['/spaces/loft/devices/device-2']]);
  });

  it('hands the lead on when the controller is given up, and says at the end what was given up and what ended', async () => {
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Tent controller' }), { target: { value: 'release' } });
    expect(select('Fan')).toHaveValue('new');
    // Nobody is left to stay with - nor for the controller, which would lead again were it kept.
    for (const one of ['Fan', 'Tent controller']) expect(within(select(one)).queryByRole('option', { name: /stays with/ })).not.toBeInTheDocument();
    fireEvent.change(select('Spring run · Day 29'), { target: { value: 'end' } });

    const sheet = await ask();
    expect(linesOf(sheet)).toEqual([
      'Tent controller is given up and then no longer belongs to your account',
      'Fan gets a new place: Tent 2',
      'Canopy cam stays with Tent controller',
      'Spring run is ended',
    ]);
    answer(sheet);

    await waitFor(() =>
      expect(told.map(one => one.label)).toEqual(['Tent removed. Tent controller given up. Fan now stands in Tent 2. Spring run ended.']),
    );
    expect(api.delete).toHaveBeenCalledWith('/devices/device-1/claim');
    expect(api.patch).toHaveBeenCalledWith('/grows/grow-1', { endedAt: expect.any(String) });
  });

  it('asks about the grow again when the device it was to go with moves into a place that exists', async () => {
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Spring run · Day 29' }), { target: { value: 'with:device-1' } });
    expect(screen.getByRole('button', { name: 'Remove Tent' })).toBeEnabled();
    fireEvent.change(select('Tent controller'), { target: { value: 'move:fridge' } });

    expect(screen.getByRole('button', { name: 'Remove Tent' })).toBeDisabled();
  });

  it('says after a refusal half-way what is done and what is still here, keeps every answer and goes on from there', async () => {
    const move = vi.mocked(api.put).getMockImplementation()!;
    vi.mocked(api.put).mockImplementation((path: string) => (path.endsWith('device-2') ? Promise.reject(refused()) : move(path)));
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Spring run · Day 29' }), { target: { value: 'with:device-1' } });
    answer(await ask());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Tent is not removed yet. That space has ended.');
    expect(alert).toHaveTextContent('Already done: Tent controller now stands in Tent 2.');
    expect(alert).toHaveTextContent('Still here: Fan and Spring run.');
    expect(api.delete).not.toHaveBeenCalled();
    expect(told).toHaveLength(0);
    // The lists were read again and no longer hold the controller; what was answered about it still stands.
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Tent controller' })).not.toBeInTheDocument());
    expect(select('Fan')).toHaveValue('stay');
    expect(select('Spring run · Day 29')).toHaveValue('with:device-1');

    // The same answers again need no second question, and no second place.
    vi.mocked(api.put).mockImplementation(move);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spaces/tent'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/spaces')).toHaveLength(1);
    expect(api.put).toHaveBeenLastCalledWith('/spaces/made-Tent 2/devices/device-2');
    expect(api.post).toHaveBeenCalledWith('/grows/grow-1/placements', expect.objectContaining({ spaceId: 'made-Tent 2' }));
    await waitFor(() => expect(told.map(one => one.label)).toEqual(['Tent removed. Tent controller, Fan, and Spring run now stand in Tent 2.']));
  });

  it('takes a place away again when its device was refused, so none stands empty', async () => {
    vi.mocked(api.put).mockRejectedValue(refused());
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Spring run · Day 29' }), { target: { value: 'end' } });
    answer(await ask());

    expect(await screen.findByRole('alert')).toHaveTextContent('Still here: Tent controller, Fan, Canopy cam, and Spring run.');
    expect(screen.queryByText(/Already done/)).not.toBeInTheDocument();
    expect(vi.mocked(api.delete).mock.calls).toEqual([['/spaces/made-Tent 2']]);
  });

  it('tells a lost connection from a refusal, and the next attempt moves into the place the first one made', async () => {
    const move = vi.mocked(api.put).getMockImplementation()!;
    vi.mocked(api.put).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(api.delete).mockRejectedValue(new TypeError('Failed to fetch'));
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Spring run · Day 29' }), { target: { value: 'end' } });
    answer(await ask());
    expect(await screen.findByRole('alert')).toHaveTextContent('Tent is not removed yet. Could not reach the server. Try again.');

    vi.mocked(api.put).mockImplementation(move);
    vi.mocked(api.delete)
      .mockReset()
      .mockResolvedValue(null as never);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spaces/tent'));
    expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/spaces')).toHaveLength(1);
    expect(api.put).toHaveBeenCalledWith('/spaces/made-Tent 2/devices/device-1');
    expect(api.delete).not.toHaveBeenCalledWith('/spaces/made-Tent 2');
  });

  it('asks again once an answer changed after a failure, and removes the place the first attempt made for nothing', async () => {
    const move = vi.mocked(api.put).getMockImplementation()!;
    vi.mocked(api.put).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(api.delete).mockRejectedValue(new TypeError('Failed to fetch'));
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Spring run · Day 29' }), { target: { value: 'end' } });
    answer(await ask());
    await screen.findByRole('alert');

    vi.mocked(api.put).mockImplementation(move);
    vi.mocked(api.delete)
      .mockReset()
      .mockResolvedValue(null as never);
    fireEvent.change(select('Tent controller'), { target: { value: 'move:fridge' } });
    const sheet = await ask();
    expect(linesOf(sheet)[0]).toBe('Tent controller moves to KS Black');
    expect(api.delete).not.toHaveBeenCalled();
    answer(sheet);

    await waitFor(() => expect(vi.mocked(api.delete).mock.calls).toEqual([['/spaces/made-Tent 2'], ['/spaces/tent']]));
    expect(api.put).toHaveBeenLastCalledWith('/spaces/fridge/devices/device-2');
    expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/spaces')).toHaveLength(1);
  });

  it('does not end a place people are still let into, and leads to them', async () => {
    state.grows = [];
    state.members = [{ spaceId: 'tent', userId: 'user-2' }];
    draw('/spaces/tent/remove');

    expect(await screen.findByText('1 person is still let in. Let them go first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Tent' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'To who is let in' })).toHaveAttribute('href', '/spaces/tent/edit');
    // No grow keeps the curves: said in one line.
    expect(screen.getByText('After that you see the curves of Tent only with grows that stood here.')).toBeInTheDocument();
  });

  it('is the owner´s, and never ends the last place', async () => {
    state.spaces = [spaceWhere('manage', { id: 'tent', name: 'Tent' }), FRIDGE];
    draw('/spaces/tent/remove');
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('/spaces/tent/edit'));
  });

  it.each([
    ['a place that has ended', '/spaces/tent/remove'],
    ['an address nobody knows', '/spaces/nowhere/remove'],
  ])('is one page for %s: a heading, the way on, and no retry that cannot help', async (_what, at) => {
    state.spaces = [{ ...TENT, archivedAt: '2026-11-01T00:00:00.000Z' }, FRIDGE, LOFT];
    const read = vi.mocked(api.get).getMockImplementation()!;
    // The server knows no grows of a place that is not there.
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === '/grows'
        ? Promise.reject(new ApiError({ status: 404, code: 'space_not_found', title: 'Not found', detail: '', errors: [] }))
        : read(path),
    );
    draw(at);

    expect(await screen.findByRole('heading', { level: 1, name: 'Place' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('offers to read again where the lists could not be read', async () => {
    const read = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((path: string) => (path === '/devices' ? Promise.reject(new TypeError('Failed to fetch')) : read(path)));
    draw('/spaces/tent/remove');

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Place' })).not.toBeInTheDocument();
  });
});
