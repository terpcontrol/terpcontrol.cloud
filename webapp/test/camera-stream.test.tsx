import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, Device } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { CameraSettings } from '@/screens/camera/CameraSettings';
import { drawAt } from './harness';
import { spaceWhere } from './session';
import { translate } from './translations';

/**
 * A stream camera's address, corrected where it stands, and the Erweitert
 * section under its card: whether the stream is pulled through a device in
 * the place, and how it is read.
 *
 * The login is never served, so what is asserted is what goes on the wire: an
 * address sent alone, which the server reads as "keep the login", and a login
 * only where somebody typed one.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

vi.mock('@/api/layers', async importOriginal => ({ ...(await importOriginal<object>()), useDiaryLayer: () => false }));

const stream = (over: Partial<Camera> = {}): Camera => ({
  id: 'camera-1',
  createdAt: '2026-09-20T08:00:00.000Z',
  ownerId: 'user-1',
  kind: 'rtsp',
  deviceId: null,
  spaceId: 'space-1',
  name: 'Tapo C200',
  looksAt: null,
  plantIds: [],
  did: null,
  uid: null,
  ip: null,
  url: 'rtsp://192.168.1.40:554/stream1',
  transport: null,
  tunnel: false,
  model: null,
  stillIntervalSeconds: 30,
  nightOff: false,
  maintenanceOff: false,
  logErrors: false,
  staleWarning: true,
  entitlement: { validUntil: null, grant: null, tier: 'premium', renewalVisible: false },
  isDemo: false,
  removedAt: null,
  state: { lastStillAt: null, lastError: null, firmwareVersion: null },
  ...over,
});

const fridge = {
  id: 'fridge-1',
  name: 'fridge',
  type: 'fridge',
  spaceId: 'space-1',
  state: { lastSeenAt: new Date().toISOString() },
} as unknown as Device;
const controller = {
  id: 'controller-1',
  name: 'Veg controller',
  type: 'controller',
  spaceId: 'space-1',
  state: { lastSeenAt: new Date().toISOString() },
} as unknown as Device;

const state = { devices: [fridge] as Device[] };

const answers = (path: string) => {
  if (path === '/devices') return { items: state.devices, nextCursor: null };
  if (path === '/spaces') return { items: [spaceWhere('own')], nextCursor: null };
  if (path === '/me') return { id: 'user-1', premium: { enforced: false, extendUrl: null, priceLabel: null, free: {} }, notifications: null };
  throw new Error(`nothing mocked for ${path}`);
};

const draw = (camera: Camera, mayManage = true) => drawAt(<CameraSettings camera={camera} mayManage={mayManage} mayOwn={mayManage} />);

/** Every read the card starts, answered and drawn. */
const settle = async () => {
  for (let turn = 0; turn < 8; turn += 1) await act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))));
};

const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  });
};

beforeAll(() => translate());

beforeEach(() => {
  state.devices = [fridge];
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.patch).mockImplementation((_path: string, body: unknown) => Promise.resolve({ ...stream(), ...(body as object) }) as never);
});

describe('changing a stream´s address in place', () => {
  it('sends the new address alone, which keeps the login the stream is opened with', async () => {
    draw(stream());
    fireEvent.click(screen.getByRole('button', { name: /Change the address/ }));

    // Started from the address as it stands, which is the part a router changes.
    const address = screen.getByRole('textbox', { name: 'Address' });
    expect(address).toHaveValue('rtsp://192.168.1.40:554/stream1');
    expect(screen.getByText(/Left empty, user and password stay as they are/)).toBeInTheDocument();

    fireEvent.change(address, { target: { value: 'rtsp://192.168.1.41:554/stream1' } });
    await save();

    expect(api.patch).toHaveBeenCalledWith('/cameras/camera-1', { url: 'rtsp://192.168.1.41:554/stream1' });
  });

  it('changes the password alone, without touching the address', async () => {
    draw(stream());
    fireEvent.click(screen.getByRole('button', { name: /Change the address/ }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'n3w' } });
    await save();

    expect(api.patch).toHaveBeenCalledWith('/cameras/camera-1', { password: 'n3w' });
  });

  it('leaves the address as it was, with nothing left to save', async () => {
    draw(stream());
    fireEvent.click(screen.getByRole('button', { name: /Change the address/ }));
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'admin' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Leave it as it is/ }));

    expect(screen.queryByRole('textbox', { name: 'Address' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('explains where a brand keeps its stream, beside the address', () => {
    draw(stream());

    expect(screen.getByRole('button', { name: 'About Stream address' })).toHaveAccessibleDescription(
      expect.stringContaining('Reolink: rtsp://IP:554/h264Preview_01_main'),
    );
  });
});

describe('Advanced, under a stream camera´s card', () => {
  const open = async () => {
    await settle();
    fireEvent.click(screen.getByText('Advanced'));
  };

  it('pulls the stream through the fridge module standing there, on the tap', async () => {
    draw(stream());
    await open();

    const tunnel = screen.getByRole('switch', { name: 'Pull through the device' });
    expect(tunnel).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/The cloud opens the stream itself, which only works for a camera reachable from the internet/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(tunnel);
    });

    expect(api.patch).toHaveBeenCalledWith('/cameras/camera-1', { tunnel: true, deviceId: 'fridge-1' });
  });

  it('reads a UDP stream over TCP once it is pulled through the device, which UDP does not pass', async () => {
    draw(stream({ transport: 'udp' }));
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Pull through the device' }));
    });

    expect(api.patch).toHaveBeenCalledWith('/cameras/camera-1', { tunnel: true, deviceId: 'fridge-1', transport: null });
  });

  it('says which device carries it, and lets a place with two choose', async () => {
    state.devices = [fridge, controller];
    draw(stream({ deviceId: 'controller-1', tunnel: true }));
    await open();

    expect(screen.getByText('The cloud pulls the stream from your network through Veg controller.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(screen.getByRole('group', { name: 'Through which device?' })).getByRole('button', { name: 'Fridge module' }));
    });
    expect(api.patch).toHaveBeenLastCalledWith('/cameras/camera-1', { tunnel: true, deviceId: 'fridge-1' });
  });

  it('chooses how the stream is read on the tap, and offers UDP only where the cloud opens it itself', async () => {
    draw(stream({ deviceId: 'fridge-1', tunnel: true, transport: 'tcp' }));
    await open();

    const transports = within(screen.getByRole('group', { name: 'Transport' }));
    expect(transports.queryByRole('button', { name: 'UDP' })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(transports.getByRole('button', { name: 'HTTPS' }));
    });

    expect(api.patch).toHaveBeenCalledWith('/cameras/camera-1', { transport: 'https' });
  });

  it('offers UDP to a stream the cloud opens itself', async () => {
    draw(stream());
    await open();

    expect(within(screen.getByRole('group', { name: 'Transport' })).getByRole('button', { name: 'UDP' })).toBeInTheDocument();
  });

  it('is not there for somebody who may not change the camera, nor for a Terp Cam', async () => {
    const { unmount } = draw(stream(), false);
    await settle();
    expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
    unmount();

    draw(stream({ kind: 'terpcam_controller', url: null, did: 'TCAM01', deviceId: 'fridge-1' }));
    await settle();
    expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
  });
});
