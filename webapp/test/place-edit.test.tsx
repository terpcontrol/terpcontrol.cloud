import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import type { Camera, Device, Space } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import type { Told } from '@/log/log-context';
import { leaveUnderSheet } from '@/app/places';
import { EditPlace } from '@/screens/place/EditPlace';
import { RemovePlace } from '@/screens/place/RemovePlace';
import { PlaceMembers } from '@/screens/place/PlaceMembers';
import {
  END,
  GUESTS,
  MEMBERS,
  NEW_PLACE,
  RELEASE,
  REMINDERS,
  STAY,
  UNCOUPLE,
  choicesOf,
  fatesOf,
  gathered,
  kept,
  moveTo,
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
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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

/** The room a place's member list names, as the server answers it: the one the place stands in. */
const roomOf = (path: string) => {
  const place = state.spaces.find(one => path === `/spaces/${one.id}/members`);
  const room = state.spaces.find(one => one.id === place?.roomId);

  return room ? { id: room.id, name: room.name } : null;
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
        <Route path="/spaces/:spaceId/members" element={<PlaceMembers />} />
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
  for (const method of [api.get, api.post, api.patch, api.delete]) vi.mocked(method).mockReset();
  vi.mocked(api.get).mockImplementation((path: string, params?: unknown) => {
    // The account's own places that have ended are a list of their own.
    if (path === '/spaces' && (params as { archived?: boolean } | undefined)?.archived)
      return Promise.resolve({ items: state.spaces.filter(one => one.archivedAt), nextCursor: null }) as never;
    if (path === '/spaces') return Promise.resolve({ items: state.spaces, nextCursor: null }) as never;
    if (path === '/devices') return Promise.resolve({ items: state.devices, nextCursor: null }) as never;
    if (path.startsWith('/cameras')) return Promise.resolve({ items: state.cameras, nextCursor: null }) as never;
    if (path === '/grows') return Promise.resolve({ items: state.grows, nextCursor: null }) as never;
    if (path.endsWith('/members'))
      return Promise.resolve({ items: state.members, nextCursor: null, people: [], room: roomOf(path), activity: [] }) as never;
    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });
  vi.mocked(api.patch).mockImplementation((_path: string, body: unknown) => Promise.resolve({ ...TENT, ...(body as object) }) as never);
  vi.mocked(api.post).mockImplementation(
    (path: string, body: unknown) =>
      Promise.resolve(path === '/spaces' ? { ...TENT, id: `made-${(body as { name: string }).name}`, ...(body as object) } : {}) as never,
  );
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
    expect(told[0].label).toBe('Tent is now called Flower tent · Kind: Other · Room: Cellar');

    // Taken back by the room's name: the room it left may have ended with its last place. The toast is handed what is back.
    await told[0].undo!();
    expect(api.patch).toHaveBeenLastCalledWith('/spaces/tent', { name: 'Tent', kind: 'tent', roomName: 'Grow room' });
    expect(told).toMatchObject([{ undone: 'Flower tent is now called Tent · Kind: Tent · Room: Grow room' }]);
  });

  it('is titled as what it does, with the name in its field, and offers the six kinds of a place', async () => {
    draw('/spaces/tent/edit');

    // A long name made the title six lines of the page's largest type: it stands in its field.
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit place' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Tent');
    expect(
      within(screen.getByRole('combobox', { name: 'Kind' }))
        .getAllByRole('option')
        .map(option => option.textContent),
    ).toEqual(['Tent', 'Fridge', 'Balcony', 'Drying box', 'Greenhouse', 'Other']);

    fireEvent.change(screen.getByRole('combobox', { name: 'Kind' }), { target: { value: 'dry_box' } });
    fireEvent.click(await saveReady());
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/tent', { kind: 'dry_box' }));
    await waitFor(() => expect(told[0].label).toBe('Tent · Kind: Drying box'));
  });

  /** A place's name stands by itself in a sentence: before the kind, and only where the toast has not just said it. */
  it('says a kind that changed alone under the place´s name, with no preposition glued to it', async () => {
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Kind' }), { target: { value: 'balcony' } });
    fireEvent.click(await saveReady());

    await waitFor(() => expect(told).toHaveLength(1));
    expect(told[0].label).toBe('Tent · Kind: Balcony');
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
    expect(told[1].label).toBe('Tent is no longer in a room');
  });

  it('names a room in the toast as it is stored, not as it was typed', async () => {
    state.spaces = [TENT, FRIDGE, ROOM, ATTIC];
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Room' }), { target: { value: 'new' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the room' }), { target: { value: '  attic ' } });
    fireEvent.click(await saveReady());

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/tent', { roomName: 'attic' }));
    await waitFor(() => expect(told).toHaveLength(1));
    expect(told[0].label).toBe('Tent · Room: Attic');
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
      ).toEqual(['Grow room · 2 people see it too', 'Attic · 1 person sees it too', 'Shed', 'New room …', 'No room', 'Rename Grow room …']),
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
    expect(told[0].label).toBe('Tent · Room: Attic · @lea now sees it too · @mara no longer sees it');

    await told[0].undo!();
    expect(api.patch).toHaveBeenLastCalledWith('/spaces/tent', { roomName: 'Grow room' });
    expect(told).toMatchObject([{ undone: 'Tent · Room: Grow room · @mara now sees it too · @lea no longer sees it' }]);
  });

  it('asks before the last place leaves a room people are let into, names them, and offers no way back afterwards', async () => {
    letIn([
      { spaceId: 'room', handle: 'mara' },
      { spaceId: 'room', handle: 'jonas' },
    ]);
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Room' }), { target: { value: 'none' } });
    fireEvent.click(await saveReady());

    const sheet = await screen.findByRole('dialog', { name: 'Tent: take it out of the room Grow room?' });
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
    expect(told[0]).toMatchObject({ label: 'Tent is no longer in a room · @mara and @jonas no longer see it', undo: null });
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

  /** A room has no page of its own: the one the place stands in is renamed where it is chosen, in a write of its own. */
  it('renames the room the place stands in from the room field, says so with the way back, and writes nothing to the place', async () => {
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Room' }), { target: { value: 'rename' } });
    const field = screen.getByRole('textbox', { name: 'Name of the room' });
    expect(field).toHaveValue('Grow room');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(field, { target: { value: ' Cellar ' } });
    fireEvent.click(await saveReady());

    await waitFor(() => expect(told).toHaveLength(1));
    expect(vi.mocked(api.patch).mock.calls).toEqual([['/spaces/room', { name: 'Cellar' }]]);
    expect(told[0]).toMatchObject({ label: 'Grow room is now called Cellar', undone: 'Cellar is now called Grow room' });
    await told[0].undo?.();
    expect(api.patch).toHaveBeenLastCalledWith('/spaces/room', { name: 'Grow room' });
  });

  it('says that another room already carries the name before anything is written, and keeps what was typed', async () => {
    state.spaces = [TENT, FRIDGE, ROOM, ATTIC];
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Room' }), { target: { value: 'rename' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the room' }), { target: { value: ' attic' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Another room is already called “Attic”.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Name of the room' })).toHaveValue(' attic');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('says what the server said where it refuses the room´s new name all the same', async () => {
    vi.mocked(api.patch).mockRejectedValue(
      new ApiError({ status: 409, code: 'name_taken', title: 'Refused', detail: 'Another room is already called "Loft".', errors: [] }),
    );
    draw('/spaces/tent/edit');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Room' }), { target: { value: 'rename' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the room' }), { target: { value: 'Loft' } });
    fireEvent.click(await saveReady());

    expect(await screen.findByRole('alert')).toHaveTextContent('Another room is already called "Loft".');
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

  it('calls a device nobody named by its kind, and tells two of a kind apart only within the list they stand in', async () => {
    state.devices = [
      device({}),
      device({ id: 'sim-fan-0a1b', type: 'fan', name: 'fan' }),
      device({ id: 'sim-fan-9z-8y', type: 'fan', name: 'fan' }),
      device({ id: 'sim-controller-77x2', spaceId: 'fridge' }),
    ];
    // The controller's own Terp Cam, which nobody named: the one here needs no tag either.
    state.cameras = [camera({ id: 'cam-1', name: 'controller', deviceId: 'device-1', did: 'VSTC-B07171' } as Partial<Camera>)];
    draw('/spaces/tent/edit');

    // A controller here and one elsewhere: neither list holds two, so neither row carries a scrap of an id.
    expect(await screen.findByRole('link', { name: 'Controller' })).toHaveAttribute('href', '/devices/device-1');
    // The last four letters or figures of the id, whole, and bound to the kind.
    expect(screen.getByRole('link', { name: 'Fan\u00a0·\u00a00A1B' })).toHaveAttribute('href', '/devices/sim-fan-0a1b');
    expect(screen.getByRole('link', { name: 'Fan\u00a0·\u00a09Z8Y' })).toHaveAttribute('href', '/devices/sim-fan-9z-8y');
    expect(screen.getByRole('link', { name: /^Terp Cam\s?Camera$/ })).toHaveAttribute('href', '/cameras/cam-1');

    fireEvent.click(screen.getByRole('button', { name: '+ Bring a device here' }));
    expect(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Controller\s?KS Black$/ })).toBeInTheDocument();
  });

  it('brings a device standing elsewhere through its own sheet, with this place chosen and nothing written yet', async () => {
    state.devices = [device({}), device({ id: 'device-2', type: 'fan', name: 'fan', spaceId: 'fridge' })];
    draw('/spaces/tent/edit');

    fireEvent.click(await screen.findByRole('button', { name: '+ Bring a device here' }));
    const sheet = await screen.findByRole('dialog', { name: 'Tent: bring a device here' });
    expect(within(sheet).getByRole('link', { name: /Add a new device/ })).toHaveAttribute('href', '/claim?space=tent');
    fireEvent.click(within(sheet).getByRole('button', { name: /^Fan\s?KS Black$/ }));

    const moving = await screen.findByRole('dialog', { name: 'Rename or move' });
    expect(within(moving).getByRole('button', { name: 'Tent', pressed: true })).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('shows a member who manages a place nothing stands in no heading over an empty card', async () => {
    state.spaces = [spaceWhere('manage', { id: 'tent', name: 'Tent' }), FRIDGE];
    state.devices = [];
    draw('/spaces/tent/edit');

    expect(await screen.findByRole('combobox', { name: 'Kind' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Devices here' })).not.toBeInTheDocument();
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

  it.each(['room', 'nowhere'])('has one page for what is not there - a room, an unknown id (%s)', async id => {
    draw(`/spaces/${id}/edit`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Place' })).toBeInTheDocument();
    expect(screen.getByText('This place cannot be opened.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
  });

  /** They told the owner the place could not be opened or that somebody had taken them out, as if it were another's. */
  it.each([
    ['/spaces/ended/edit', 'Edit place'],
    ['/spaces/ended/remove', 'Remove KS Black'],
    ['/spaces/ended/members', 'Who sees KS Black'],
  ])('tells the owner at %s that a place of theirs that has ended no longer exists, under the page´s title', async (at, title) => {
    state.spaces = [...state.spaces, { ...FRIDGE, id: 'ended', archivedAt: '2026-11-01T00:00:00.000Z' }];
    draw(at);

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(/^The place KS Black no longer exists\./)).toBeInTheDocument();
    expect(screen.queryByText('This place cannot be opened.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
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
  const grow = { id: 'grow-1', name: 'Spring run', day: 29 };
  const LOFT = spaceWhere('own', { id: 'loft', name: 'Loft' });
  const NOBODY = { reminders: 0, guests: 0, everyone: 0, room: 'Grow room', members: 0 };
  const standing = standingIn(
    'tent',
    [fan, tent, device({ id: 'other', spaceId: 'fridge' })],
    [paired, loose, camera({ id: 'gone', removedAt: '2026-01-01T00:00:00.000Z' })],
    [grow],
  );
  const nameOf = () => 'Tent';
  const stepsOf = (choices: Record<string, string>, made = {}) =>
    fatesOf(standing, choices, nameOf, [TENT, FRIDGE], TENT, made, NOBODY).flatMap(fate => fate.step ?? []);

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
    const plants = (chosen: Record<string, string>) => choicesOf(standing, [FRIDGE], chosen)['grow-1'];

    expect(plants({})).toBe('');
    expect(plants({ 'grow-1': withDevice('ctrl') })).toBe(withDevice('ctrl'));
    // The grow was to go with a device that is given up after all: asked again.
    expect(plants({ ctrl: RELEASE, 'grow-1': withDevice('ctrl') })).toBe('');
  });

  it('keeps what an attempt was about until the place is gone: what it settled and what the account still holds, with what came since', () => {
    const late = device({ id: 'late', type: 'light', name: 'light' });
    // The controller moved and took its camera along, the grow moved, the fan left the account by another way.
    const lasts = (id: string) => ['ctrl', 'grow-1', 'cam-paired', 'cam-loose'].includes(id);
    const now = kept(standingIn('tent', [late], [loose], []), standing, lasts);

    expect(now.devices.map(one => one.id)).toEqual(['ctrl', 'late']);
    expect([now.paired, now.loose, now.grows].map(some => some.map(one => one.id))).toEqual([['cam-paired'], ['cam-loose'], ['grow-1']]);
    // An answer about what is gone is none, and the grow that was to go with it is asked about again.
    const chosen = { ctrl: moveTo('fridge'), fan: NEW_PLACE, 'cam-paired': UNCOUPLE, 'cam-loose': STAY, 'grow-1': withDevice('fan') };
    const still = { ctrl: moveTo('fridge'), 'cam-paired': UNCOUPLE, 'grow-1': '' };
    expect(choicesOf(now, [FRIDGE], chosen)).toEqual({ ...still, late: STAY, 'cam-loose': STAY });
    // Nothing stays or goes with a device that has left: it goes where that one now stands, and the camera is still taken off it.
    const choices = choicesOf(now, [FRIDGE], { ...chosen, 'grow-1': withDevice('ctrl') }, new Set(), { ctrl: 'fridge' });
    expect(choices).toEqual({ ...still, late: moveTo('fridge'), 'cam-loose': moveTo('fridge'), 'grow-1': moveTo('fridge') });
    expect(fatesOf(now, choices, nameOf, [TENT, FRIDGE], TENT, {}, NOBODY).flatMap(fate => fate.step ?? [])).toEqual([
      { do: 'device', id: 'ctrl', to: { spaceId: 'fridge' } },
      { do: 'device', id: 'late', to: { spaceId: 'fridge' } },
      { do: 'uncouple', id: 'cam-paired' },
      { do: 'camera', id: 'cam-loose', to: { spaceId: 'fridge' } },
      { do: 'grow', id: 'grow-1', to: { spaceId: 'fridge' } },
    ]);
  });

  it('lists what ends with the place last: its reminders, who no longer sees it, and its room where that ends with it', () => {
    const moved = { ctrl: moveTo('fridge'), fan: STAY, 'cam-paired': STAY, 'cam-loose': STAY, 'grow-1': END };
    const LET_IN = { reminders: 3, guests: 2, everyone: 3, room: 'Grow room', members: 1 };
    const people = (choices: Record<string, string>, places = [TENT, FRIDGE], made = {}) =>
      fatesOf(standing, choices, nameOf, places, TENT, made, LET_IN).filter(fate => fate.what === 'ends' && fate.id !== REMINDERS);

    expect(fatesOf(standing, moved, nameOf, [TENT, FRIDGE], TENT, {}, { ...NOBODY, reminders: 3 }).filter(fate => fate.id === REMINDERS)).toEqual([
      { id: REMINDERS, what: 'ends', fate: 'reminders', count: 3, place: null, beside: null, step: null },
    ]);
    expect(people(moved)).toEqual([
      { id: GUESTS, what: 'ends', fate: 'unseen', count: 2, place: 'Tent', beside: null, step: null },
      { id: MEMBERS, what: 'ends', fate: 'roomEnds', count: 1, place: 'Grow room', beside: null, step: null },
    ]);
    expect(gathered(fatesOf(standing, moved, nameOf, [TENT, FRIDGE], TENT, {}, LET_IN)).slice(-3)).toEqual([
      { how: 'reminders', place: null, ids: [REMINDERS], count: 3 },
      { how: 'unseen', place: 'Tent', ids: [GUESTS], count: 2 },
      { how: 'roomEnds', place: 'Grow room', ids: [MEMBERS], count: 1 },
    ]);
    // The room goes on where another place stands in it, or what stood here gets a new place in it: its members
    // lose this place with the guests, each person counted once.
    expect(people(moved, [TENT, FRIDGE, { ...LOFT, roomId: 'room' }])).toEqual([
      { id: GUESTS, what: 'ends', fate: 'unseen', count: 3, place: 'Tent', beside: null, step: null },
    ]);
    expect(people({ ...moved, ctrl: NEW_PLACE }).map(fate => fate.id)).toEqual([GUESTS]);
    // A place an earlier attempt made keeps the room only while something is sent into it.
    const made = { ctrl: { id: 'made-1', name: 'Tent 2', roomId: 'room' } };
    expect(people({ ...moved, ctrl: NEW_PLACE }, [TENT, FRIDGE], made).map(fate => fate.id)).toEqual([GUESTS]);
    expect(people(moved, [TENT, FRIDGE], made).map(fate => fate.id)).toEqual([GUESTS, MEMBERS]);
    // A room nobody was let into ends all the same, and is said to; a place in no room ends alone.
    expect(fatesOf(standing, moved, nameOf, [TENT, FRIDGE], TENT, {}, NOBODY).filter(fate => fate.what === 'ends')).toEqual([
      { id: MEMBERS, what: 'ends', fate: 'roomEmpty', count: 0, place: 'Grow room', beside: null, step: null },
    ]);
    expect(fatesOf(standing, moved, nameOf, [TENT, FRIDGE], { ...TENT, roomId: null }, {}, NOBODY).filter(fate => fate.what === 'ends')).toEqual([]);
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
    const made = { ctrl: { id: 'made-1', name: 'Tent 2', roomId: 'room' } };
    const first = { ...choicesOf(standing, [FRIDGE], {}), 'grow-1': withDevice('ctrl') };

    expect(stepsOf(first, made)).toEqual([
      { do: 'device', id: 'ctrl', to: { spaceId: 'made-1' } },
      { do: 'device', id: 'fan', to: { spaceId: 'made-1' } },
      { do: 'camera', id: 'cam-loose', to: { spaceId: 'made-1' } },
      { do: 'grow', id: 'grow-1', to: { spaceId: 'made-1' } },
    ]);
    const plan = (choices: Record<string, string>) => fatesOf(standing, choices, nameOf, [TENT, FRIDGE], TENT, made, NOBODY);
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
      FRIDGE,
      {},
      NOBODY,
    );

    expect(gathered(fates)).toEqual([
      { how: 'stands', place: 'Tent 2', ids: ['ctrl', 'grow-1'], count: 2 },
      { how: 'release', place: null, ids: ['fan'], count: 1 },
      { how: 'remove', place: null, ids: ['cam-loose'], count: 1 },
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
  const written = () => [api.post, api.patch, api.delete].flatMap(method => vi.mocked(method).mock.calls);
  /** A device moved into a place, as it is written. */
  const moved = (deviceId: string, spaceId: string) => [`/devices/${deviceId}`, { spaceId }];
  /** Who is let in besides the owner: a row each, on the place or on its room, by the handle they go by. */
  const letIn = (...rows: [spaceId: string, handle: string][]) => {
    const read = vi.mocked(api.get).getMockImplementation()!;
    const page = {
      items: rows.map(([spaceId, handle]) => ({ spaceId, userId: handle })),
      people: rows.map(([, handle]) => ({ id: handle, handle })),
      room: { id: 'room', name: 'Grow room' },
    };
    vi.mocked(api.get).mockImplementation((path: string) => (path.endsWith('/members') ? (Promise.resolve(page) as never) : read(path)));
  };

  beforeEach(() => {
    state.devices = [device({ name: 'Tent controller' }), device({ id: 'device-2', type: 'fan', name: 'fan' })];
    state.cameras = [camera({ id: 'cam-paired', name: 'Canopy cam', deviceId: 'device-1', kind: 'terpcam_controller' })];
    state.grows = [{ id: 'grow-1', name: 'Spring run', endedAt: null, summary: { dayNumber: 29 } }];
    // The stack as the lists then read it: a place that was made is there, a device that moved stands in it with its camera.
    vi.mocked(api.post).mockImplementation((path: string, body: unknown) => {
      if (path !== '/spaces') return Promise.resolve({}) as never;
      const made = { ...TENT, id: `made-${(body as { name: string }).name}`, ...(body as object) } as Space;
      state.spaces = [...state.spaces, made];
      return Promise.resolve(made) as never;
    });
    vi.mocked(api.patch).mockImplementation((path: string, body: unknown) => {
      const deviceId = /^\/devices\/(.+)$/.exec(path)?.[1];
      const { spaceId } = body as { spaceId?: string };
      if (!deviceId || !spaceId) return Promise.resolve({ ...TENT, ...(body as object) }) as never;
      state.devices = state.devices.map(one => (one.id === deviceId ? { ...one, spaceId } : one));
      state.cameras = state.cameras.map(one => (one.deviceId === deviceId ? { ...one, spaceId } : one));
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
    ).toEqual(['Where do the plants go?', 'to the new place of Tent controller', 'to KS Black', 'to no fixed place', 'End the grow']);
    // A place is named as the devices' select names it.
    expect(within(select('Tent controller')).getByRole('option', { name: 'to KS Black' })).toBeInTheDocument();
    expect(screen.getByText('Curves and pictures up to today stay with the grow Spring run.')).toBeInTheDocument();

    fireEvent.change(plants, { target: { value: 'with:device-1' } });
    // One danger style: the way to the question is outlined in the alarm's red, the yes in it filled.
    expect(screen.getByRole('button', { name: 'Remove Tent' }).className).toMatch(/danger/);
    expect(screen.getByRole('button', { name: 'Remove Tent' }).className).not.toMatch(/dangerFilled/);
    const sheet = await ask();
    expect(within(sheet).getByRole('button', { name: 'Remove Tent' }).className).toMatch(/dangerFilled/);
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
    // Nothing else is patched: no camera is moved by itself and no grow is ended.
    expect(vi.mocked(api.patch).mock.calls).toEqual([moved('device-1', 'made-Tent 2'), moved('device-2', 'made-Tent 2')]);
    expect(api.post).toHaveBeenCalledWith('/grows/grow-1/placements', expect.objectContaining({ spaceId: 'made-Tent 2' }));
    await waitFor(() => expect(told.map(one => one.label)).toEqual(['Tent removed. Tent 2: Tent controller, Fan, and Spring run are here now.']));
    expect(told[0].undo).toBeNull();
    expect(screen.getByTestId('address')).toHaveTextContent('/');
  });

  it('sends the tent into another tent of the account where there is one, and makes no place', async () => {
    state.spaces = [TENT, FRIDGE, LOFT, ROOM];
    draw('/spaces/tent/remove');

    await screen.findByRole('button', { name: 'Remove Tent' });
    expect(select('Tent controller')).toHaveValue('move:loft');
    // A place there is already is named by its name; "new place" is the one the removal makes.
    expect(within(select('Tent controller')).getByRole('option', { name: 'to Loft' })).toBeInTheDocument();
    expect(within(select('Tent controller')).getByRole('option', { name: 'gets a new place' })).toBeInTheDocument();
    expect(select('Fan')).toHaveValue('stay');
    fireEvent.change(select('Spring run · Day 29'), { target: { value: 'move:loft' } });
    const sheet = await ask();
    // The loft stands in no room: the room the tent was the last place of ends, which is said though nobody was let into it.
    expect(linesOf(sheet)).toEqual([
      'Tent controller moves to Loft',
      'Fan stays with Tent controller',
      'Canopy cam stays with Tent controller',
      'Spring run moves to Loft',
      'The room Grow room ends',
    ]);

    answer(sheet);
    await waitFor(() =>
      expect(told.map(one => one.label)).toEqual([
        'Tent removed. Loft: Tent controller, Fan, and Spring run are here now. The room Grow room has ended.',
      ]),
    );
    expect(api.post).not.toHaveBeenCalledWith('/spaces', expect.anything());
    expect(vi.mocked(api.patch).mock.calls).toEqual([moved('device-1', 'loft'), moved('device-2', 'loft')]);
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
      expect(told.map(one => one.label)).toEqual(['Tent removed. Tent controller given up. Tent 2: Fan is here now. Spring run ended.']),
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

  /** A removal with a camera to take off, a socket, a fan to give up, a grow, a guest and a room: its writes, in their order. */
  const WRITES = [
    'post /spaces {"kind":"tent","name":"Tent 2","roomId":"room"}',
    'patch /devices/device-1 {"spaceId":"made-Tent 2"}',
    'patch /devices/plug {"spaceId":"made-Tent 2"}',
    'delete /devices/device-2/claim',
    'delete /cameras/cam-paired',
    'post /grows/grow-1/placements {"spaceId":"made-Tent 2"}',
    'delete /spaces/tent',
  ];
  /** Each row of the page, the write that settles it, and its answer - by the place's name once the controller it stays or goes with has left. */
  const ROWS: [label: string, settledBy: number, answer: string, led?: string][] = [
    ['Tent controller', 2, 'new'],
    ['Plantalytix Socket', 3, 'stay', 'move:made-Tent 2'],
    ['Fan', 4, 'release'],
    ['Canopy cam', 5, 'uncouple'],
    ['Spring run · Day 29', 6, 'with:device-1', 'move:made-Tent 2'],
  ];
  const ALL = 'Tent controller, Plantalytix Socket, Fan, Canopy cam, and Spring run';
  const MOVED = 'Tent 2: Tent controller and Plantalytix Socket are here now.';
  const SETTLED = 'Tent 2: Tent controller, Plantalytix Socket, and Spring run are here now. Fan given up. Canopy cam unpaired.';

  it.each([
    [1, null, ALL],
    // The place made for the controller is taken away again, so none stands empty - and made again by the next attempt.
    [2, null, ALL],
    [3, 'Tent 2: Tent controller is here now.', 'Plantalytix Socket, Fan, Canopy cam, and Spring run'],
    [4, MOVED, 'Fan, Canopy cam, and Spring run'],
    [5, `${MOVED} Fan given up.`, 'Canopy cam and Spring run'],
    [6, `${MOVED} Fan given up. Canopy cam unpaired.`, 'Spring run'],
    [7, SETTLED, null],
  ])(
    'keeps every answer when write %i is refused, says what is done and what is open, and then sends what is left, once',
    async (nth, done, open) => {
      state.devices = [state.devices[0], device({ id: 'plug', type: 'plug', name: 'plug' }), state.devices[1]];
      letIn(['tent', 'guest'], ['room', 'mara']);
      const sent: string[] = [];
      for (const method of ['post', 'patch', 'delete'] as const) {
        const write = vi.mocked(api[method]).getMockImplementation()!;
        vi.mocked(api[method]).mockImplementation((path: string, body?: object) => {
          sent.push(`${method} ${path}${body ? ` ${JSON.stringify({ ...body, startedAt: undefined })}` : ''}`);
          if (sent.length === nth) return Promise.reject(refused());
          // What was given up, taken off, moved away or taken away again is in no list of the place read after it.
          if (method !== 'patch')
            for (const list of ['spaces', 'devices', 'cameras', 'grows'] as const)
              state[list] = state[list].filter(one => one.id !== path.split('/')[2]) as never;
          return write(path, body) as never;
        });
      }
      draw('/spaces/tent/remove');

      fireEvent.change(await screen.findByRole('combobox', { name: 'Spring run · Day 29' }), { target: { value: 'with:device-1' } });
      fireEvent.change(select('Fan'), { target: { value: 'release' } });
      fireEvent.change(select('Canopy cam'), { target: { value: 'uncouple' } });
      answer(await ask());

      const said = ['Tent is not removed yet. That space has ended.', done && `Already done: ${done}`, open && `Still open: ${open}.`];
      expect((await screen.findByRole('alert')).textContent).toBe(said.filter(Boolean).join(''));
      expect(sent).toEqual([...WRITES.slice(0, nth), ...(nth === 2 ? ['delete /spaces/made-Tent 2'] : [])]);
      expect(told).toHaveLength(0);
      // Every answer still owed is shown; nothing "stays with" or goes "to the new place of" a controller that has left.
      const left = ROWS.filter(([, settledBy]) => settledBy >= nth);
      expect(screen.queryAllByRole('combobox').map(one => [one.closest('label')?.firstChild?.textContent, (one as HTMLSelectElement).value])).toEqual(
        left.map(([label, , to, led]) => [label, nth > 2 ? (led ?? to) : to]),
      );
      expect(screen.queryAllByRole('option', { name: /Tent controller$/ })).toHaveLength(nth > 2 ? 0 : 4);

      // The same answers need no second question; a place is made again only where it was taken away.
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(sent.slice(-1)).toEqual(['delete /spaces/tent']));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(sent.slice(nth === 2 ? 3 : nth)).toEqual(WRITES.slice(nth > 2 ? nth - 1 : 0));
      // The room goes on in the place made for the controller: its member loses this place with the guest.
      await waitFor(() => expect(told.map(one => one.label)).toEqual([`Tent removed. ${SETTLED} @guest and @mara no longer see Tent.`]));
    },
  );

  it('tells a lost connection from a refusal, and the next attempt moves into the place the first one made', async () => {
    const move = vi.mocked(api.patch).getMockImplementation()!;
    vi.mocked(api.patch).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(api.delete).mockRejectedValue(new TypeError('Failed to fetch'));
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Spring run · Day 29' }), { target: { value: 'end' } });
    answer(await ask());
    expect(await screen.findByRole('alert')).toHaveTextContent('Tent is not removed yet. Could not reach the server. Try again.');

    vi.mocked(api.patch).mockImplementation(move);
    vi.mocked(api.delete)
      .mockReset()
      .mockResolvedValue(null as never);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spaces/tent'));
    expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/spaces')).toHaveLength(1);
    expect(api.patch).toHaveBeenCalledWith(...moved('device-1', 'made-Tent 2'));
    expect(api.delete).not.toHaveBeenCalledWith('/spaces/made-Tent 2');
  });

  it('asks again once an answer changed after a failure, and removes the place the first attempt made for nothing', async () => {
    const move = vi.mocked(api.patch).getMockImplementation()!;
    vi.mocked(api.patch).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(api.delete).mockRejectedValue(new TypeError('Failed to fetch'));
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Spring run · Day 29' }), { target: { value: 'end' } });
    answer(await ask());
    await screen.findByRole('alert');

    vi.mocked(api.patch).mockImplementation(move);
    vi.mocked(api.delete)
      .mockReset()
      .mockResolvedValue(null as never);
    fireEvent.change(select('Tent controller'), { target: { value: 'move:fridge' } });
    const sheet = await ask();
    expect(linesOf(sheet)[0]).toBe('Tent controller moves to KS Black');
    expect(api.delete).not.toHaveBeenCalled();
    answer(sheet);

    await waitFor(() => expect(vi.mocked(api.delete).mock.calls).toEqual([['/spaces/made-Tent 2'], ['/spaces/tent']]));
    expect(api.patch).toHaveBeenCalledWith(...moved('device-2', 'fridge'));
    expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/spaces')).toHaveLength(1);
  });

  it('names in the question and in the toast what ends with the place - its reminders, and who no longer sees it', async () => {
    state.grows = [];
    letIn(['tent', 'guest'], ['room', 'mara']);
    // Two reminders name the place; a grow's goes where the grow goes, and another place's is not this one's.
    const subjects = ['space:tent', 'space:tent', 'grow:grow-1', 'space:fridge'].map(one => ({
      subject: { type: one.split(':')[0], id: one.split(':')[1] },
    }));
    const read = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === '/reminders' ? (Promise.resolve({ items: subjects, nextCursor: null }) as never) : read(path),
    );
    draw('/spaces/tent/remove');

    const sheet = await ask();
    // The controller gets a new place in the room, so the room goes on: its member loses this place with the guest.
    expect(linesOf(sheet)).toEqual([
      'Tent controller gets a new place: Tent 2',
      'Fan stays with Tent controller',
      'Canopy cam stays with Tent controller',
      '2 reminders end',
      '@guest and @mara then no longer see Tent',
    ]);
    // No grow keeps the curves: said in one line.
    expect(screen.getByText('After that you see this place’s curves only with the grows that grew here.')).toBeInTheDocument();
    expect(screen.queryByText(/let in/)).not.toBeInTheDocument();

    answer(sheet);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spaces/tent'));
    await waitFor(() =>
      expect(told.map(one => one.label)).toEqual([
        'Tent removed. Tent 2: Tent controller and Fan are here now. 2 reminders ended. @guest and @mara no longer see Tent.',
      ]),
    );
  });

  it('says that the room ends with its last place, and who no longer sees it', async () => {
    state.grows = [];
    letIn(['tent', 'guest'], ['room', 'mara'], ['room', 'jonas']);
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Tent controller' }), { target: { value: 'move:fridge' } });
    const sheet = await ask();
    expect(linesOf(sheet).slice(3)).toEqual(['@guest then no longer sees Tent', 'The room Grow room ends – @mara and @jonas then no longer see it']);

    answer(sheet);
    await waitFor(() =>
      expect(told.map(one => one.label)).toEqual([
        'Tent removed. KS Black: Tent controller and Fan are here now. @guest no longer sees Tent. The room Grow room has ended – @mara and @jonas no longer see it.',
      ]),
    );
  });

  it('calls a camera named after its device "Terp Cam", in its row, in the question and in the toast', async () => {
    state.grows = [];
    state.cameras = [camera({ id: 'cam-paired', name: 'Tent controller', did: 'VSTC007171', deviceId: 'device-1', kind: 'terpcam_controller' })];
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Terp Cam' }), { target: { value: 'uncouple' } });
    const sheet = await ask();
    expect(linesOf(sheet)[2]).toBe('Terp Cam is unpaired');
    answer(sheet);
    await waitFor(() =>
      expect(told.map(one => one.label)).toEqual(['Tent removed. Tent 2: Tent controller and Fan are here now. Terp Cam unpaired.']),
    );
  });

  it('tells two cameras and two devices nobody named apart by what is printed on them - those standing here, not the account´s', async () => {
    state.devices = [
      ...state.devices,
      device({ id: 'sim-fan-9zzz', type: 'fan', name: 'fan' }),
      device({ id: 'plug-1', type: 'plug', name: 'plug' }),
      device({ id: 'plug-2', type: 'plug', name: 'plug', spaceId: 'fridge' }),
    ];
    state.cameras = [
      camera({ id: 'cam-paired', name: 'Tent controller', did: 'VSTC007171', deviceId: 'device-1', kind: 'terpcam_controller' }),
      camera({ id: 'cam-2', name: 'fan', did: 'VSTC008282', deviceId: 'device-2', kind: 'terpcam_controller' }),
    ];
    draw('/spaces/tent/remove');

    await screen.findByRole('button', { name: 'Remove Tent' });
    expect(screen.getAllByRole('combobox').map(one => one.closest('label')?.firstChild?.textContent)).toEqual([
      'Tent controller',
      'Fan\u00a0·\u00a0ICE2',
      'Fan\u00a0·\u00a09ZZZ',
      'Plantalytix Socket',
      'Terp Cam\u00a0·\u00a07171',
      'Terp Cam\u00a0·\u00a08282',
      'Spring run · Day 29',
    ]);
  });

  it('reads the place again after a refusal: what left by another way is no longer said to be here, and the same tap goes through', async () => {
    const move = vi.mocked(api.patch).getMockImplementation()!;
    // The fan was given up behind the page: the server knows no such device any more.
    vi.mocked(api.patch).mockImplementation((path: string, body: unknown) => {
      if (!path.endsWith('device-2')) return move(path, body);
      state.devices = state.devices.filter(one => one.id !== 'device-2');
      return Promise.reject(new ApiError({ status: 404, code: 'device_not_found', title: 'Not found', detail: 'No such device.', errors: [] }));
    });
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Spring run · Day 29' }), { target: { value: 'with:device-1' } });
    answer(await ask());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Already done: Tent 2: Tent controller is here now.');
    expect(alert).toHaveTextContent('Still open: Spring run.');
    expect(screen.queryByRole('combobox', { name: 'Fan' })).not.toBeInTheDocument();
    // The answer stands, by the name of the place the controller now stands in.
    expect(select('Spring run · Day 29')).toHaveValue('move:made-Tent 2');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spaces/tent'));
    expect(vi.mocked(api.patch).mock.calls.filter(([path]) => path.endsWith('device-2'))).toHaveLength(1);
    await waitFor(() => expect(told.map(one => one.label)).toEqual(['Tent removed. Tent 2: Tent controller and Spring run are here now.']));
  });

  it('asks again where the lists read after a refusal change what the answers mean', async () => {
    // The controller left behind the page, with its camera: the fan has nobody to stay with and leads now.
    vi.mocked(api.patch).mockImplementation(() => {
      state.devices = state.devices.filter(one => one.id !== 'device-1');
      state.cameras = [];
      return Promise.reject(new ApiError({ status: 404, code: 'device_not_found', title: 'Not found', detail: 'No such device.', errors: [] }));
    });
    // The place made for it is taken away again.
    vi.mocked(api.delete).mockImplementation((path: string) => {
      state.spaces = state.spaces.filter(one => path !== `/spaces/${one.id}`);
      return Promise.resolve(null) as never;
    });
    draw('/spaces/tent/remove');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Spring run · Day 29' }), { target: { value: 'with:device-1' } });
    answer(await ask());
    await screen.findByRole('alert');

    // Where the plants stand is asked again: the device they were to go with is gone.
    expect(select('Spring run · Day 29')).toHaveValue('');
    expect(select('Spring run · Day 29')).toBeInvalid();
    expect(select('Fan')).toHaveValue('new');
    fireEvent.change(select('Spring run · Day 29'), { target: { value: 'end' } });
    expect(linesOf(await ask())).toEqual(['Fan gets a new place: Tent 2', 'Spring run is ended']);
  });

  it('is the owner´s, and asks nobody else´s session who is let in', async () => {
    state.spaces = [spaceWhere('manage', { id: 'tent', name: 'Tent' }), FRIDGE];
    draw('/spaces/tent/remove');
    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('/spaces/tent/edit'));
    // The members route is the owner's: asked by the demo, it answered 404 into the console.
    expect(vi.mocked(api.get).mock.calls.map(([path]) => path)).not.toContain('/spaces/tent/members');
  });

  it('says why the last place cannot be removed, with the way back', async () => {
    state.spaces = [TENT, ROOM];
    draw('/spaces/tent/remove');

    expect(await screen.findByText('Tent is your only place, so it cannot be removed.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Remove Tent' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Back to “Edit place”' }).map(link => link.getAttribute('href'))).toContain('/spaces/tent/edit');
    expect(screen.queryByRole('button', { name: 'Remove Tent' })).not.toBeInTheDocument();
    expect(screen.getByTestId('address')).toHaveTextContent('/spaces/tent/remove');
  });

  it.each([
    ['a place that has ended', '/spaces/tent/remove', 'Remove Tent'],
    ['an address nobody knows', '/spaces/nowhere/remove', 'Place'],
  ])('is one page for %s: a heading, the way on, and no retry that cannot help', async (_what, at, title) => {
    state.spaces = [{ ...TENT, archivedAt: '2026-11-01T00:00:00.000Z' }, FRIDGE, LOFT];
    const read = vi.mocked(api.get).getMockImplementation()!;
    // The server knows no grows of a place that is not there.
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === '/grows'
        ? Promise.reject(new ApiError({ status: 404, code: 'space_not_found', title: 'Not found', detail: '', errors: [] }))
        : read(path),
    );
    draw(at);

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
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

/**
 * A sheet stands on a history entry of its own. A page left for good from one - its place was removed, its device
 * given up - is replaced on its own entry, so Back from where that leads finds no page of what is gone.
 */
describe('leaving a page from a sheet standing on it', () => {
  it('steps back from the sheet´s entry first, and goes at once where no sheet is open', async () => {
    const go = vi.fn(() => window.history.state as { sheet?: number } | null);
    window.history.pushState({ key: 'page' }, '');
    leaveUnderSheet(go);
    expect(go).toHaveBeenCalledTimes(1);

    window.history.pushState({ key: 'page', sheet: 0.5 }, '');
    leaveUnderSheet(go);
    // A second ask while the step back is on its way - the sheet closing itself - is the same leave.
    leaveUnderSheet(go);
    expect(go).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(go).toHaveBeenCalledTimes(2));
    expect(go.mock.results[1].value).toEqual({ key: 'page' });
  });
});
