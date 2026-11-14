import { type QueryClient } from '@tanstack/react-query';
import i18next from 'i18next';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, Device, Me } from '@fg2/shared-types/v1';
import { CAPTURE_POLL_MS, CAPTURE_WAIT_MS } from '@/api/cameras';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import { AddCamera } from '@/screens/camera/add/AddCamera';
import { drawAt, testClient } from './harness';
import { spaceWhere } from './session';
import { catalogue, translate } from './translations';

/**
 * Adding a camera: what the two tabs offer, what turns up while somebody
 * stands at the device, and exactly what a stream address sends.
 *
 * Every request goes through the app's own client, mocked at that one seam, so
 * what is asserted is what would go on the wire - which matters most for the
 * RTSP tab, where the device standing in the chosen place is what decides
 * whether the stream is pulled through its tunnel.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const who = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => (who.demo ? ON_THE_DEMO : SIGNED_IN) };
});

const camera = (over: Partial<Camera>): Camera => ({
  id: 'camera-1',
  createdAt: '2026-09-20T08:00:00.000Z',
  ownerId: 'user-1',
  kind: 'terpcam_controller',
  deviceId: 'device-1',
  spaceId: 'space-1',
  name: 'Blue Dream tent',
  looksAt: null,
  plantIds: [],
  did: 'TCAM00A41C',
  uid: null,
  ip: null,
  url: null,
  transport: null,
  tunnel: false,
  model: 'terp_cam',
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

/** The one this account already had when the screen was opened, which is never "found". */
const known = camera({ id: 'camera-old', name: 'Mother tent cam', did: 'TCAM00B002' });
const paired = camera({ id: 'camera-new' });
const madeRtsp = camera({ id: 'camera-rtsp', kind: 'rtsp', did: null, name: 'Balcony cam', url: 'rtsp://192.168.1.40/stream1' });

/** A device as the Devices page reads one: what type it is, and when it last said anything. */
const device = (over: Partial<Device> & { seenSecondsAgo?: number }): Device =>
  ({
    id: 'device-1',
    name: 'Terp Controller',
    type: 'controller',
    spaceId: 'space-1',
    ...over,
    state: { lastSeenAt: new Date(Date.now() - (over.seenSecondsAgo ?? 5) * 1000).toISOString() },
  }) as unknown as Device;

const controller = device({});
const secondController = device({ id: 'device-2', name: 'Veg controller' });
const coldController = device({ id: 'device-3', name: 'Old controller', seenSecondsAgo: 4 * 60 * 60 });
const fridge = device({ id: 'device-4', name: 'fridge', type: 'fridge', spaceId: 'space-2' });
/** A socket stands in a place too, and has no display to pair a cam at. */
const plug = device({ id: 'device-6', name: 'Lamp socket', type: 'plug', spaceId: 'space-2' });
const fan = device({ id: 'device-7', name: 'Exhaust', type: 'fan', spaceId: 'space-2' });
const lamp = device({ id: 'device-8', name: 'Lamp', type: 'light', spaceId: 'space-2' });

/** What every stream body says beyond the place, the name and the address, where nothing else was chosen. */
const plainStream = { username: '', password: '', transport: 'tcp' };

// A camera is put into a place by managing it, so the tents on offer carry the
// standing that decides whether they are offered at all.
const spaces = [spaceWhere('own'), spaceWhere('own', { id: 'space-2', name: 'Balcony' })];

const madeSpace = spaceWhere('own', { id: 'space-3', name: 'Attic', kind: 'other' });

const me = (enforced: boolean): Me =>
  ({ id: 'user-1', premium: { enforced, extendUrl: null, priceLabel: '29 € a year' }, pushPublicKey: null }) as unknown as Me;

const state = { cameras: [known], devices: [controller] as Device[], spaces, premium: true };

const answers = (path: string) => {
  if (path === '/cameras') return { items: state.cameras, nextCursor: null };
  if (path === '/devices') return { items: state.devices, nextCursor: null };
  if (path === '/spaces') return { items: state.spaces, nextCursor: null };
  if (path === '/me') return me(state.premium);
  if (path.endsWith('/frames')) return { items: [], nextCursor: null };
  throw new Error(`nothing mocked for ${path}`);
};

/** Already over, which a test the server could not even start - a refused stream - can be as it answers. */
const refusedStream = {
  id: 'capture-1',
  state: 'failed',
  startedAt: '2026-09-23T12:00:00.000Z',
  finishedAt: '2026-09-23T12:00:00.000Z',
  picture: null,
  reason: 'noAnswer',
  error: 'Connection refused',
};

const posts = (path: string) => {
  if (path === '/cameras') return madeRtsp;
  if (path === '/spaces') return madeSpace;

  return refusedStream;
};

let client: QueryClient;

const draw = () => {
  client = testClient();
  return drawAt(<AddCamera />, { client });
};

/** The Terp Cam tab, once the list this account already had has arrived. */
const drawPairing = async () => {
  draw();
  await screen.findByText('Nothing new yet. This list fills itself for as long as it is open.');
};

/** The tabs are drawn once the devices are known, because which one opens is decided by them. */
const openTab = async (name: string) => {
  draw();
  fireEvent.click(await screen.findByRole('button', { name }));
  await screen.findByRole('region', { name });
};

/**
 * What the next read of `/cameras` answers, brought to the screen the way its
 * own beat would. The interval is react-query's; what is under test is which of
 * the cameras it answers with count as having turned up.
 */
const paires = async (...items: Camera[]) => {
  state.cameras = items;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['cameras'] });
  });
};

const panel = () => within(screen.getByRole('region'));

/**
 * Every read the screen starts, answered and drawn - including the ones a first
 * answer sets off, which is why this is more than one turn of the loop.
 */
const settle = async () => {
  for (let turn = 0; turn < 12; turn += 1) await act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))));
};

beforeAll(() => translate());

beforeEach(() => {
  who.demo = false;
  state.cameras = [known];
  state.devices = [controller];
  state.spaces = spaces;
  state.premium = true;
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.post).mockImplementation((path: string) => Promise.resolve(posts(path)) as never);
  vi.mocked(api.delete).mockResolvedValue(undefined as never);
  vi.mocked(api.patch).mockImplementation((_path: string, body: unknown) => Promise.resolve({ ...paired, ...(body as object) }) as never);
});

describe('pairing a Terp Cam at a device', () => {
  it('says what to press, and waits with nothing to tap', async () => {
    await drawPairing();

    expect(screen.getByText('Plug the Terp Cam in nearby')).toBeInTheDocument();
    // The path the display's own menu takes, word for word.
    expect(screen.getByText('At the controller: press the knob, then Terp Cam › connect cam')).toBeInTheDocument();
    expect(screen.getByText('No phone app, no Wi-Fi password: the device hands the camera its network. One camera per device.')).toBeInTheDocument();
    expect(screen.getByText('It shows up here')).toBeInTheDocument();

    // The camera this account already had is not something that turned up.
    expect(screen.queryByText('Mother tent cam')).not.toBeInTheDocument();
  });

  it('sends the owner of a fridge module to the fridge module, not to a controller they do not have', async () => {
    state.devices = [fridge];
    draw();

    // A fridge module pairs a cam exactly as a controller does, so its owner
    // opens on the pairing rather than on the address form.
    expect(await screen.findByText('At the fridge module: press the knob, then Terp Cam › connect cam')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terp Cam' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('No device yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/controller/)).not.toBeInTheDocument();
  });

  it.each([
    ['plug', plug, 'At the Plantalytix Socket'],
    ['fan', fan, 'At the fan'],
  ])(
    'pairs a cam at a %s as it does at a controller, the only device some accounts have, by the name the device list gives it',
    async (_kind, only, at) => {
      state.devices = [only];
      draw();

      // Both carry the Terp Cam entry in their menu and bridge the cam the same way.
      expect(await screen.findByText(`${at}: press the knob, then Terp Cam › connect cam`)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Terp Cam' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByText('No device yet')).not.toBeInTheDocument();
    },
  );

  it('says "at the device" only to an account with both kinds', async () => {
    state.devices = [controller, fridge];
    await drawPairing();

    expect(screen.getByText('At the device: press the knob, then Terp Cam › connect cam')).toBeInTheDocument();
  });

  it('draws the camera a fridge module paired as reached through it', async () => {
    state.devices = [fridge];
    await drawPairing();
    await paires(known, camera({ id: 'camera-new', deviceId: 'device-4', spaceId: 'space-2' }));

    expect(await screen.findByText('via Fridge module · Balcony')).toBeInTheDocument();
  });

  it('draws the camera that was not there when the screen opened, and how it is reached', async () => {
    await drawPairing();
    await paires(known, paired);

    expect(await screen.findByText('Terp Cam · A41C')).toBeInTheDocument();
    expect(screen.getByText('found')).toBeInTheDocument();
    expect(screen.getByText('via Terp Controller · Tent 1')).toBeInTheDocument();
    expect(screen.queryByText('Mother tent cam')).not.toBeInTheDocument();
  });

  it('names it and says what it looks at, and sends exactly that', async () => {
    await drawPairing();
    await paires(known, paired);

    fireEvent.click(await screen.findByRole('button', { name: 'Name' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Canopy cam' } });
    fireEvent.change(screen.getByLabelText('Looks at'), { target: { value: 'canopy' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(api.patch).toHaveBeenCalledWith('/cameras/camera-new', { name: 'Canopy cam', looksAt: 'canopy' });
    // Once it has a name of its own, the row stops naming the hardware.
    expect(screen.getByText('Canopy cam')).toBeInTheDocument();
  });

  it('keeps the camera it found when another tab is looked at and this one is come back to', async () => {
    await drawPairing();
    await paires(known, paired);
    expect(await screen.findByText('Terp Cam · A41C')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'RTSP' }));
    await screen.findByLabelText('Stream address');
    fireEvent.click(screen.getByRole('button', { name: 'Terp Cam' }));

    // The line "new" is measured from belongs to the screen, so looking away
    // and back does not re-take it with the camera already in it.
    expect(await screen.findByText('Terp Cam · A41C')).toBeInTheDocument();
    expect(screen.queryByText('Nothing new yet. This list fills itself for as long as it is open.')).not.toBeInTheDocument();
  });

  it('calls a controller nobody has named by its type as a word, not by the key a claim stored', async () => {
    state.devices = [device({ name: 'controller' })];
    await drawPairing();
    await paires(known, paired);

    expect(await screen.findByText('via Controller · Tent 1')).toBeInTheDocument();
  });

  it('says the read failed rather than waiting for ever, and gets the watch back on one tap', async () => {
    const offline = (path: string) => (path === '/cameras' ? Promise.reject(new Error('offline')) : Promise.resolve(answers(path)));
    vi.mocked(api.get).mockImplementation(offline as never);
    draw();
    await settle();

    // Both reads have to be looked at for the screen to notice either of them
    // is over; only one of them was, and the screen waited for ever.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });

    expect(await screen.findByText('Nothing new yet. This list fills itself for as long as it is open.')).toBeInTheDocument();
  });

  it('says what the server said when the name was refused', async () => {
    vi.mocked(api.patch).mockRejectedValue(
      new ApiError({ status: 403, title: 'Refused', detail: 'This camera is not yours to name.', code: 'forbidden', errors: [] }),
    );
    await drawPairing();
    await paires(known, paired);

    fireEvent.click(await screen.findByRole('button', { name: 'Name' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('This camera is not yours to name.');
  });
});

describe('an account with no device to pair a cam at', () => {
  beforeEach(() => {
    // A light module has no Terp Cam entry in its menu.
    state.devices = [lamp];
  });

  it('opens on the address form rather than on steps nobody can follow', async () => {
    draw();

    expect(await screen.findByLabelText('Stream address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RTSP' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Terp Cam' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('names the missing part on the Terp Cam tab, and offers the way to one', async () => {
    await openTab('Terp Cam');

    expect(panel().getByText('No device yet')).toBeInTheDocument();
    expect(panel().getByText(/a fridge module, a controller, a fan or a Plantalytix Socket/)).toBeInTheDocument();
    expect(panel().getByRole('link', { name: /Add a device/ })).toHaveAttribute('href', '/claim');
    // A watch that nothing could ever cross is not left running.
    expect(panel().queryByText('Nothing new yet. This list fills itself for as long as it is open.')).not.toBeInTheDocument();
    expect(panel().queryByText(/press the knob/)).not.toBeInTheDocument();
  });
});

describe('the ways in', () => {
  it('offers a Terp Cam paired at a device and a stream, and no Terp Cam without a device', async () => {
    draw();

    const ways = within(await screen.findByRole('group', { name: 'Which camera' })).getAllByRole('button');
    expect(ways.map(way => way.textContent)).toEqual(['Terp Cam', 'RTSP']);
    expect(screen.queryByText(/standalone/i)).not.toBeInTheDocument();
  });
});

describe('a camera at a stream address', () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText('Stream address'), { target: { value: 'rtsp://192.168.1.40/stream1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Balcony cam' } });
  };

  const openRtsp = async () => {
    await openTab('RTSP');
    await screen.findByLabelText('Stream address');
  };

  /** A test of an address has a route of its own, which makes no camera: the test made one and took it away, a row each time. */
  it('asks for one picture through the device standing in the chosen tent, and adds nothing', async () => {
    await openRtsp();
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/cameras/test-captures', {
      spaceId: 'space-1',
      url: 'rtsp://192.168.1.40/stream1',
      deviceId: 'device-1',
      tunnel: true,
      ...plainStream,
    });
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add camera' })).toBeInTheDocument();
    // A wrong address is an ordinary outcome of this button, so the kind of
    // failure is what is drawn, in the screen's language - and the camera's
    // own words, English ffmpeg with the tunnel's port in it, are folded under
    // it as the camera page folds them.
    expect(await screen.findByRole('alert')).toHaveTextContent('No picture: the camera did not answer');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Connection refused');
    expect(screen.getByText('What the camera said')).toBeInTheDocument();
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
  });

  it('shows the picture a good address came back with, which is stored nowhere', async () => {
    const answered = {
      ...refusedStream,
      state: 'done',
      reason: null,
      error: null,
      picture: { capturedAt: new Date(Date.now() - 4_000).toISOString(), jpeg: '/9j/4AAQ' },
    };
    vi.mocked(api.post).mockImplementation((path: string) => Promise.resolve(path === '/cameras/test-captures' ? answered : posts(path)) as never);
    await openRtsp();
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    const shot = await screen.findByRole('img', { name: 'The picture the test came back with' });
    expect(shot).toHaveAttribute('src', 'data:image/jpeg;base64,/9j/4AAQ');
    expect(screen.getByText(/^A picture came back · /)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalledWith('/cameras', expect.anything());
  });

  it('keeps the camera´s own words back where the server did not hand them over', async () => {
    vi.mocked(api.post).mockImplementation(
      (path: string) => Promise.resolve(path === '/cameras' ? madeRtsp : { ...refusedStream, error: null }) as never,
    );
    await openRtsp();
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('No picture: the camera did not answer');
    expect(screen.queryByText('What the camera said')).not.toBeInTheDocument();
  });

  /**
   * This side giving up on a read is not the server being out of reach: the
   * screen said "Could not reach the server" while every poll was answered.
   */
  it('says nothing came back in time where this side gave up, rather than that the server was out of reach', async () => {
    const running = { ...refusedStream, state: 'running', finishedAt: null, reason: null, error: null };
    vi.mocked(api.post).mockImplementation((path: string) => Promise.resolve(path === '/cameras' ? madeRtsp : running) as never);
    vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(path.includes('/test-captures/') ? running : answers(path)) as never);
    await openRtsp();
    fill();

    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      });
      await act(() => vi.advanceTimersByTimeAsync(CAPTURE_WAIT_MS + CAPTURE_POLL_MS));

      expect(await screen.findByRole('alert')).toHaveTextContent('Still no answer after more than 3 minutes. Please try again.');
      expect(screen.queryByText(/Could not reach the server/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says how the cloud reaches the address behind the help beside it, and under the field only where no device stands to fetch it', async () => {
    await openRtsp();
    const field = screen.getByLabelText('Stream address').closest('section')!;

    const help = within(field).getByRole('button', { name: 'About Stream address' });
    expect(help).toHaveAccessibleDescription(/the cloud pulls the stream from your network through it/);
    expect(help).toHaveAccessibleDescription(/Otherwise it opens the stream itself, and the address has to be reachable from the internet\./);
    // A place with a device keeps no sentence about the way in; one without says what that means for the address.
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));
    expect(within(field).queryByRole('paragraph')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Balcony' }));
    expect(within(field).getByRole('paragraph')).toHaveTextContent(
      'Balcony: no device here fetches the stream from your network · an address on your home network will not answer the cloud',
    );
  });

  it('pulls the stream through a fridge module, the only device in the place', async () => {
    state.devices = [device({ id: 'device-5', name: 'fridge', type: 'fridge', spaceId: 'space-1' })];
    await openTab('RTSP');
    await screen.findByLabelText('Stream address');
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    // Every Terp Control device carries the tunnel, the fridge module included.
    expect(api.post).toHaveBeenNthCalledWith(1, '/cameras/test-captures', {
      spaceId: 'space-1',
      url: 'rtsp://192.168.1.40/stream1',
      deviceId: 'device-5',
      tunnel: true,
      ...plainStream,
    });
  });

  it('says how long ago an offline device was heard from, before the test is pressed', async () => {
    state.devices = [coldController];
    await openRtsp();
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));

    expect(screen.getByText(/Old controller is offline · last heard 4 h ago/)).toBeInTheDocument();
  });

  it('lets a place with two devices say which one carries the stream, the one that is reporting first', async () => {
    state.devices = [coldController, controller, secondController];
    await openRtsp();
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));

    const through = within(screen.getByRole('group', { name: 'Through which device?' }));
    expect(through.getByRole('button', { name: 'Terp Controller' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(through.getByRole('button', { name: 'Veg controller' }));

    expect(through.getByRole('button', { name: 'Veg controller' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByText('The cloud pulls the stream from your network through Veg controller.')).toBeInTheDocument();
  });

  it('calls an unnamed device by its type as a word, not as the key a claim stored', async () => {
    state.devices = [device({ name: 'controller' })];
    await openRtsp();
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));
    fireEvent.click(screen.getByText('Advanced'));

    expect(screen.getByText('The cloud pulls the stream from your network through Controller.')).toBeInTheDocument();
  });

  it('offers no choice of device where the place holds only one', async () => {
    await openRtsp();
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));

    expect(screen.queryByRole('group', { name: 'Through which device?' })).not.toBeInTheDocument();
  });

  it('sends the login apart from the address, so that a password with an @ in it arrives whole', async () => {
    await openRtsp();
    fill();
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'tapo' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'p@ss:word' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      '/cameras/test-captures',
      expect.objectContaining({ url: 'rtsp://192.168.1.40/stream1', username: 'tapo', password: 'p@ss:word' }),
    );
  });

  it('keeps a login pasted into the address, and offers no second one beside it', async () => {
    await openRtsp();
    fill();
    fireEvent.change(screen.getByLabelText('Stream address'), { target: { value: 'rtsp://admin:secret@192.168.1.40/stream1' } });

    expect(screen.getByText('The login is already written into the address and is used as it is.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    const body = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>;
    expect(body.url).toBe('rtsp://admin:secret@192.168.1.40/stream1');
    expect(body).not.toHaveProperty('username');
    expect(body).not.toHaveProperty('password');
  });

  it('opens a stream reachable from the internet itself where Advanced turns the device off', async () => {
    await openRtsp();
    fill();
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('switch', { name: 'Pull through the device' }));

    expect(screen.getByText(/The cloud opens the stream itself, which only works for a camera reachable from the internet/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    // The device still stands there, and still pauses the camera in maintenance.
    expect(api.post).toHaveBeenNthCalledWith(1, '/cameras/test-captures', expect.objectContaining({ deviceId: 'device-1', tunnel: false }));
  });

  it('offers UDP only to a stream the cloud opens itself, and reads it the way chosen', async () => {
    await openRtsp();
    fill();
    fireEvent.click(screen.getByText('Advanced'));

    const transports = () => within(screen.getByRole('group', { name: 'Transport' }));
    expect(transports().getByRole('button', { name: 'TCP' })).toHaveAttribute('aria-pressed', 'true');
    expect(transports().queryByRole('button', { name: 'UDP' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Pull through the device' }));
    fireEvent.click(transports().getByRole('button', { name: 'UDP' }));
    // Back through the tunnel, which UDP does not pass: TCP again.
    fireEvent.click(screen.getByRole('switch', { name: 'Pull through the device' }));
    expect(transports().getByRole('button', { name: 'TCP' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(transports().getByRole('button', { name: 'HTTP' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    expect(api.post).toHaveBeenNthCalledWith(1, '/cameras/test-captures', expect.objectContaining({ tunnel: true, transport: 'http' }));
  });

  it('adds the camera as the form stands when the place is changed after a test, and opens it', async () => {
    await openRtsp();
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Balcony' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add camera' }));
    });

    // The tunnel is worked out again on every write, so the camera never keeps
    // a device the screen has stopped promising.
    expect(api.post).toHaveBeenLastCalledWith('/cameras', {
      kind: 'rtsp',
      name: 'Balcony cam',
      spaceId: 'space-2',
      url: 'rtsp://192.168.1.40/stream1',
      deviceId: null,
      tunnel: false,
      ...plainStream,
    });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('says a refused address in the field´s own words, once, whatever language the server wrote it in', async () => {
    vi.mocked(api.post).mockRejectedValue(
      new ApiError({
        status: 422,
        title: 'Unprocessable',
        detail: 'A stream is opened at an address that begins with rtsp:// or rtsps:// and names a host.',
        code: 'not_a_stream_address',
        errors: [{ field: 'url', code: 'not_a_stream_address', detail: 'Write the address as rtsp://host/path.' }],
      } as never),
    );
    await openTab('RTSP');
    await screen.findByLabelText('Stream address');
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add camera' }));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/^A stream is opened at an address/);

    // The server writes English only: German says it in the field's words, and the field's own refusal once.
    i18next.addResourceBundle('de', 'translation', await catalogue('de'));
    await act(() => i18next.changeLanguage('de'));
    try {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /^Eine Stream-Adresse beginnt mit rtsp:\/\/ oder rtsps:\/\/ und nennt die Kamera, etwa rtsp:\/\/192\.168\.1\.40:554\/stream1\.$/,
      );
    } finally {
      await act(() => i18next.changeLanguage('en'));
    }
  });

  it('says what the server said when the test was refused', async () => {
    vi.mocked(api.post).mockRejectedValue(
      new ApiError({ status: 403, title: 'Refused', detail: 'That tent is not yours to hang a camera in.', code: 'insufficient_access', errors: [] }),
    );
    await openRtsp();
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('That tent is not yours to hang a camera in.');
  });

  it('says what is still missing while the two buttons cannot be pressed', async () => {
    await openRtsp();

    expect(screen.getByText('Type the stream address first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Stream address'), { target: { value: 'rtsp://192.168.1.40/stream1' } });
    expect(screen.getByText('Say where it looks first.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));
    expect(screen.getByText('Give it a name first.')).toBeInTheDocument();
    // The reason reaches a screen reader through the button that cannot be pressed; a test needs no name.
    expect(screen.getByRole('button', { name: 'Add camera' })).toHaveAccessibleDescription('Give it a name first.');
    expect(screen.getByRole('button', { name: 'Test' })).toBeEnabled();
    // Beside "give it a name first", a placeholder that reads like a name ("Camera") looked like one already given.
    expect(screen.getByLabelText('Name')).toHaveAttribute('placeholder', expect.stringMatching(/ …$/));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Balcony cam' } });
    expect(screen.getByRole('button', { name: 'Add camera' })).toBeEnabled();
  });

  it('says that the test adds nothing, and adds the camera on "Add camera" alone, opening its page', async () => {
    await openRtsp();
    fill();

    expect(screen.getByText('“Test” asks for one picture and adds nothing.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add camera' }));
    });

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/cameras', expect.not.objectContaining({ logErrors: false }));
    expect(api.delete).not.toHaveBeenCalled();
  });

  /** "quatsch" made a camera that could never show a picture. */
  it('refuses an address that is no stream address under the field, before anything is written', async () => {
    await openRtsp();
    fireEvent.change(screen.getByLabelText('Stream address'), { target: { value: 'rtsp:/' } });
    // Still on its way to rtsp://: not refused yet, only not there.
    expect(screen.getByLabelText('Stream address')).not.toHaveAttribute('aria-invalid');
    fill();
    // The scheme alone is no address yet - it was told "Type the stream address first" over a field that held one.
    fireEvent.change(screen.getByLabelText('Stream address'), { target: { value: 'rtsp://' } });
    expect(screen.getByRole('button', { name: 'Test' })).toHaveAccessibleDescription(
      'That is no stream address yet: the camera is missing, such as rtsp://192.168.1.40:554/stream1.',
    );
    expect(screen.queryByText('Type the stream address first.')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Stream address'), { target: { value: 'quatsch' } });

    const refusal = 'A stream address starts with rtsp:// or rtsps:// and names the camera, such as rtsp://192.168.1.40:554/stream1.';
    expect(screen.getByLabelText('Stream address')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Stream address')).toHaveAccessibleDescription(refusal);
    for (const name of ['Test', 'Add camera']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
      expect(screen.getByRole('button', { name })).toHaveAccessibleDescription(refusal);
    }
    fireEvent.change(screen.getByLabelText('Stream address'), { target: { value: 'http://192.168.1.40/stream1' } });
    expect(screen.getByRole('button', { name: 'Add camera' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Stream address'), { target: { value: 'rtsps://cam.example.org/live' } });
    expect(screen.getByRole('button', { name: 'Add camera' })).toBeEnabled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('makes the place the camera looks at where the account has none', async () => {
    state.spaces = [];
    await openRtsp();

    expect(screen.getByText(/There is no place to put a camera in yet/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name of the place'), { target: { value: 'Attic' } });
    // The kinds of a place a camera looks into: a room that groups places is none of them, nor a fridge.
    expect(
      within(screen.getByRole('group', { name: 'Kind of place' }))
        .getAllByRole('button')
        .map(chip => chip.textContent),
    ).toEqual(['Tent', 'Balcony', 'Drying box', 'Greenhouse', 'Other']);
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    state.spaces = [madeSpace];
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make the place' }));
    });

    expect(api.post).toHaveBeenCalledWith('/spaces', { kind: 'other', name: 'Attic' });
    // The place it just made is the chosen one, so nothing typed is lost.
    expect(await screen.findByRole('button', { name: 'Attic' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says that the Premium tag gates nothing where the install enforces nothing', async () => {
    state.premium = false;
    await openRtsp();

    expect(await screen.findByText('An RTSP camera costs nothing on this installation.')).toBeInTheDocument();
  });
});

describe('a guest with no place of his own', () => {
  it('is told he needs a place of his own first, and offered one, rather than the steps of pairing at a device he may not touch', async () => {
    state.spaces = [spaceWhere('log', { id: 'space-9', name: 'Their tent', ownerId: 'user-2' })];
    state.devices = [device({ id: 'device-9', spaceId: 'space-9', ownerId: 'user-2' } as Partial<Device>)];
    draw();

    expect(await screen.findByText(/A camera goes into a place of your own, and so far you only see other people’s places/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Which camera' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name of the place')).toBeInTheDocument();
  });
});

describe('a session that may only look', () => {
  it('is told that the demo cannot add a camera, and is offered no tab at all', async () => {
    who.demo = true;
    draw();

    expect(await screen.findByText('The demo may look at everything and change nothing, so it cannot add a camera.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Which camera' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });
});
