import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, Device, Me, Space } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import { AddCamera } from '@/screens/camera/add/AddCamera';

/**
 * Adding a camera: what the three tabs offer, what turns up while somebody
 * stands at the controller, and exactly what a stream address sends.
 *
 * Every request goes through the app's own client, mocked at that one seam, so
 * what is asserted is what would go on the wire - which matters most for the
 * RTSP tab, where the controller standing in the chosen tent is what decides
 * whether the stream is pulled through its tunnel.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
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

/** A device as the Devices tab reads one: what type it is, and when it last said anything. */
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
const fridge = device({ id: 'device-4', name: 'Fridge module', type: 'fridge', spaceId: 'space-2' });

const spaces = [{ id: 'space-1', name: 'Tent 1' } as Space, { id: 'space-2', name: 'Balcony' } as Space];

const me = (enforced: boolean): Me =>
  ({ id: 'user-1', premium: { enforced, extendUrl: null, priceLabel: '29 € a year' }, pushPublicKey: null }) as unknown as Me;

const state = { cameras: [known], devices: [controller] as Device[], premium: true };

const answers = (path: string) => {
  if (path === '/cameras') return { items: state.cameras, nextCursor: null };
  if (path === '/devices') return { items: state.devices, nextCursor: null };
  if (path === '/spaces') return { items: spaces, nextCursor: null };
  if (path === '/me') return me(state.premium);
  if (path.endsWith('/frames')) return { items: [], nextCursor: null };
  throw new Error(`nothing mocked for ${path}`);
};

let client: QueryClient;

const draw = () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AddCamera />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

/** The Terp Cam tab, once the list this account already had has arrived. */
const drawPairing = async () => {
  draw();
  await screen.findByText('Nothing new yet. This list fills itself for as long as it is open.');
};

/** The tabs are drawn once the devices are known, because which one opens is decided by them. */
const openTab = async (name: string) => {
  draw();
  fireEvent.click(await screen.findByRole('tab', { name }));
  await screen.findByRole('tabpanel');
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

const panel = () => within(screen.getByRole('tabpanel'));

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  who.demo = false;
  state.cameras = [known];
  state.devices = [controller];
  state.premium = true;
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.post).mockImplementation(
    (path: string) =>
      Promise.resolve(path === '/cameras' ? madeRtsp : { succeeded: false, mediaId: null, capturedAt: null, error: 'Connection refused' }) as never,
  );
  vi.mocked(api.patch).mockImplementation((_path: string, body: unknown) => Promise.resolve({ ...paired, ...(body as object) }) as never);
});

describe('pairing a Terp Cam at the controller', () => {
  it('says what to turn, and waits with nothing to tap', async () => {
    await drawPairing();

    expect(screen.getByText('Plug the cam in near the controller')).toBeInTheDocument();
    expect(screen.getByText('On the controller: turn the knob to Cam › Pair')).toBeInTheDocument();
    expect(screen.getByText('No phone app, no Wi-Fi password: the controller hands the cam its network.')).toBeInTheDocument();
    expect(screen.getByText('It shows up here')).toBeInTheDocument();

    // The camera this account already had is not something that turned up.
    expect(screen.queryByText('Mother tent cam')).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('tab', { name: 'RTSP' }));
    await screen.findByLabelText('Stream address');
    fireEvent.click(screen.getByRole('tab', { name: 'Terp Cam' }));

    // The line "new" is measured from belongs to the screen, so looking away
    // and back does not re-take it with the camera already in it.
    expect(await screen.findByText('Terp Cam · A41C')).toBeInTheDocument();
    expect(screen.queryByText('Nothing new yet. This list fills itself for as long as it is open.')).not.toBeInTheDocument();
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

describe('an account with no controller', () => {
  beforeEach(() => {
    state.devices = [fridge];
  });

  it('opens on the address form rather than on steps nobody can follow', async () => {
    draw();

    expect(await screen.findByLabelText('Stream address')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'RTSP' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Terp Cam' })).toHaveAttribute('aria-selected', 'false');
  });

  it('names the missing part on the Terp Cam tab, and offers the way to one', async () => {
    await openTab('Terp Cam');

    expect(panel().getByText('No controller yet')).toBeInTheDocument();
    expect(panel().getByRole('link', { name: /Claim a controller/ })).toHaveAttribute('href', '/claim');
    // A watch that nothing could ever cross is not left running.
    expect(panel().queryByText('Nothing new yet. This list fills itself for as long as it is open.')).not.toBeInTheDocument();
    expect(panel().queryByText('On the controller: turn the knob to Cam › Pair')).not.toBeInTheDocument();
  });

  it('promises no tunnel under the address before a place has been chosen', async () => {
    draw();
    await screen.findByLabelText('Stream address');

    expect(screen.queryByText(/Pulled through/)).not.toBeInTheDocument();
    expect(screen.getByText(/Pick the place it looks at below/)).toBeInTheDocument();
  });
});

describe('the standalone tab', () => {
  it('says what it will do and offers nothing that could fail', async () => {
    await openTab('Terp Cam · standalone');

    expect(panel().getByText(/Joins your Wi-Fi from this phone/)).toBeInTheDocument();
    expect(panel().getByText('Coming soon.')).toBeInTheDocument();
    expect(panel().queryAllByRole('button')).toHaveLength(0);
    expect(panel().queryAllByRole('textbox')).toHaveLength(0);
  });

  it('stands in the dashed card every other "not here yet" state stands in', async () => {
    await openTab('Terp Cam · standalone');

    expect(panel().getByText('Coming soon.').closest('section')?.className).toMatch(/cardDashed/);
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

  it('makes the camera through the controller standing in the chosen tent, then asks it for one picture', async () => {
    await openRtsp();
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    expect(api.post).toHaveBeenNthCalledWith(1, '/cameras', {
      kind: 'rtsp',
      name: 'Balcony cam',
      spaceId: 'space-1',
      url: 'rtsp://192.168.1.40/stream1',
      deviceId: 'device-1',
      tunnel: true,
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/cameras/camera-rtsp/test-captures');
    // A wrong address is an ordinary outcome of this button, so the reason the
    // camera gave is what is drawn.
    expect(await screen.findByRole('alert')).toHaveTextContent('No picture: Connection refused');
  });

  it('opens the stream itself where no controller stands in the chosen place', async () => {
    await openRtsp();
    fireEvent.change(screen.getByLabelText('Stream address'), { target: { value: 'rtsp://192.168.1.40/stream1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Balcony' }));

    expect(screen.getByText(/the cloud opens the stream itself/)).toBeInTheDocument();
  });

  it('says nothing about a tunnel until a place has been chosen', async () => {
    await openRtsp();

    expect(screen.getByText(/Pick the place it looks at below/)).toBeInTheDocument();
    expect(screen.queryByText(/Pulled through/)).not.toBeInTheDocument();
  });

  it('names the controller the stream is pulled through', async () => {
    await openRtsp();
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));

    expect(screen.getByText('Pulled through Terp Controller on your network; stills every 30 s like a Terp Cam.')).toBeInTheDocument();
  });

  it('opens the stream itself where the only device in the place carries no tunnel', async () => {
    state.devices = [device({ id: 'device-5', name: 'Fridge module', type: 'fridge', spaceId: 'space-1' })];
    await openRtsp();
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    // A fridge module standing in the tent is not a way into the network.
    expect(screen.getByText(/the cloud opens the stream itself/)).toBeInTheDocument();
    expect(api.post).toHaveBeenNthCalledWith(1, '/cameras', {
      kind: 'rtsp',
      name: 'Balcony cam',
      spaceId: 'space-1',
      url: 'rtsp://192.168.1.40/stream1',
      deviceId: null,
      tunnel: false,
    });
  });

  it('says how long ago an offline controller was heard from, before the test is pressed', async () => {
    state.devices = [coldController];
    await openRtsp();
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));

    expect(screen.getByText('Pulled through Old controller on your network; stills every 30 s like a Terp Cam.')).toBeInTheDocument();
    expect(screen.getByText(/Old controller is offline · last heard 4 h ago/)).toBeInTheDocument();
  });

  it('lets a tent with two controllers say which one carries the stream', async () => {
    state.devices = [controller, secondController];
    await openRtsp();
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));

    const through = within(screen.getByRole('group', { name: 'Through which controller?' }));
    expect(through.getByRole('button', { name: 'Terp Controller' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(through.getByRole('button', { name: 'Veg controller' }));

    expect(screen.getByText(/Pulled through Veg controller/)).toBeInTheDocument();
  });

  it('calls an unnamed controller by its type as a word, not as the key a claim stored', async () => {
    state.devices = [device({ name: 'controller' })];
    await openRtsp();
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));

    expect(screen.getByText(/Pulled through Controller on your network/)).toBeInTheDocument();
  });

  it('offers no choice of controller where the place holds only one', async () => {
    await openRtsp();
    fireEvent.click(screen.getByRole('button', { name: 'Tent 1' }));

    expect(screen.queryByRole('group', { name: 'Through which controller?' })).not.toBeInTheDocument();
  });

  it('moves the camera´s controller when the place is changed after a test', async () => {
    await openRtsp();
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Balcony' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add camera' }));
    });

    // The tunnel is worked out again on every write, so the stored camera never
    // keeps a controller the screen has stopped promising.
    expect(api.patch).toHaveBeenCalledWith('/cameras/camera-rtsp', {
      name: 'Balcony cam',
      spaceId: 'space-2',
      url: 'rtsp://192.168.1.40/stream1',
      deviceId: null,
      tunnel: false,
    });
  });

  it('says what the server said when the camera was refused', async () => {
    vi.mocked(api.post).mockRejectedValue(
      new ApiError({ status: 403, title: 'Refused', detail: 'That tent is not yours to hang a camera in.', code: 'forbidden', errors: [] }),
    );
    await openRtsp();
    fill();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('That tent is not yours to hang a camera in.');
  });

  it('says that the Premium tag gates nothing where the install enforces nothing', async () => {
    state.premium = false;
    await openRtsp();

    expect(await screen.findByText('This install enforces nothing, so the tag gates nothing here.')).toBeInTheDocument();
  });
});

describe('a session that may only look', () => {
  it('is told that the demo cannot add a camera, and is offered no tab at all', async () => {
    who.demo = true;
    draw();

    expect(await screen.findByText('The demo may look at everything and change nothing, so it cannot add a camera.')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });
});
