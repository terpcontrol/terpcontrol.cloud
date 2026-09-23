import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Camera, Device, DeviceCapabilities, DeviceConfiguration, Socket, Space } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { DeviceList } from '@/screens/devices/DeviceList';
import { LightOutputRow } from '@/screens/devices/LightOutputRow';
import { lightOutputOf, withLightLimit } from '@/screens/devices/lights';
import { SocketRow } from '@/screens/devices/SocketRow';
import { defaultHold, holdsFor, rowsOf } from '@/screens/devices/sockets';
import { cameraFreshness } from '@/screens/devices/cameras';
import type { OutputLevel, OverrideRequest } from '@/api/devices';
import { spaceWhere, THE_HOST } from './session';

/**
 * The two things the Devices tab lets a person move: the switch on a socket, and
 * the dimmer on the controller's own light output.
 *
 * They are different controls because they are different hardware and travel by
 * different roads. A plug is on or off and is forced by a command a device
 * either hears or does not; the output runs at a level, and that level is a key
 * of the configuration document, which is stored whether anybody is listening or
 * not. Neither control claims the device did what it was told.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

const sent: OverrideRequest[] = [];
const saved: { deviceId: string; configuration: DeviceConfiguration }[] = [];
const state = vi.hoisted(() => ({ answer: { deviceOnline: true } as { deviceOnline: boolean } | undefined }));

vi.mock('@/api/devices', async importOriginal => ({
  ...(await importOriginal<object>()),
  useSetOverride: () => ({
    mutate: (request: OverrideRequest) => sent.push(request),
    data: state.answer,
    error: null,
    isPending: false,
  }),
  useTestSocket: () => ({ mutate: () => {}, data: undefined, error: null, isPending: false }),
  useSaveConfiguration: () => ({
    mutate: (request: { deviceId: string; configuration: DeviceConfiguration }) => saved.push(request),
    isPending: false,
    isSuccess: false,
    error: null,
  }),
}));

const NOW = DateTime.fromISO('2026-09-19T12:00:00.000Z');

const CAPABILITIES: DeviceCapabilities = {
  socketOverride: true,
  socketTimer: true,
  lightOverride: true,
  roles: ['heater', 'light', 'pump'],
  pulseSeconds: { heater: 300, light: 1800 },
};

const socket = (over: Partial<Socket> = {}): Socket => ({
  slot: 0,
  role: 'heater',
  hardwareId: '5BAD22AB0B99',
  address: '10.0.0.63',
  state: 'off',
  override: null,
  timer: null,
  stateChangedAt: NOW.minus({ minutes: 4 }).toISO()!,
  ...over,
});

const wrap = (children: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );

const draw = (one: Socket, refusal: string | null = null, mayManage = true, unheard: string | null = null) => {
  const [row] = rowsOf([one]);

  return wrap(<SocketRow row={row} deviceId="device-1" refusal={refusal} unheard={unheard} mayManage={mayManage} runs={null} now={NOW} />);
};

const device = (configuration: DeviceConfiguration | null): Device => ({ id: 'device-1', type: 'controller', configuration }) as Device;

const LIGHTS = { sunrise: 15, sunset: 15, limit: 80 };

const drawOutput = (
  configuration: DeviceConfiguration | null = { lights: LIGHTS },
  capabilities = CAPABILITIES,
  level: OutputLevel | null = { percent: 80, measuredAt: NOW.minus({ seconds: 20 }).toISO()!, state: 'live' },
  unheard: string | null = null,
  mayManage = true,
) => {
  const output = lightOutputOf(device(configuration), capabilities, level)!;

  return wrap(<LightOutputRow output={output} unheard={unheard} mayManage={mayManage} runs={null} now={NOW} />);
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  sent.length = 0;
  saved.length = 0;
  state.answer = { deviceOnline: true };
});

describe('the switch on a socket row', () => {
  it('forces the row the other way, for a time the role allows', () => {
    draw(socket());

    fireEvent.click(screen.getByRole('switch', { name: 'Force Heater' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'on', forSeconds: 3600 }]);
  });

  it('hands the row back to its role while something is forcing it', () => {
    draw(socket({ state: 'on', override: { state: 'on', validUntil: NOW.plus({ minutes: 42 }).toISO()! } }));

    expect(screen.getByText(/forced on · 42 min/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Force Heater' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'auto', forSeconds: 0 }]);
  });

  it('says a command went out and never that the socket switched', () => {
    draw(socket());

    fireEvent.click(screen.getByRole('switch', { name: 'Force Heater' }));

    expect(screen.getByRole('status')).toHaveTextContent('Asked. The device reports back within half a minute.');
    expect(screen.getByRole('switch', { name: 'Force Heater' })).toHaveAttribute('aria-checked', 'false');
  });

  it('says so when nobody was listening', () => {
    state.answer = { deviceOnline: false };
    draw(socket());

    expect(screen.getByRole('status')).toHaveTextContent('Nobody was listening');
  });

  it('is drawn disabled when the build takes no override', () => {
    draw(socket(), 'This build takes no override.');

    expect(screen.getByRole('switch', { name: 'Force Heater' })).toBeDisabled();
  });

  it('is not drawn at all for somebody who may only look', () => {
    draw(socket(), null, false);

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('off')).toBeInTheDocument();
  });

  it('offers the three-way where the device does not say what the row is doing', () => {
    draw(socket({ state: 'unknown' }));

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'on' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'on', forSeconds: 3600 }]);
  });

  it('says a socket has stopped answering, and since when', () => {
    draw(socket({ state: 'unknown', stateChangedAt: NOW.minus({ minutes: 7 }).toISO()! }));

    expect(screen.getByText(/no answer · 7 min/)).toBeInTheDocument();
  });

  it('still offers to find a socket on a build that is too old to hold one', () => {
    draw(socket(), 'This build takes no override.');

    fireEvent.click(screen.getByRole('button', { name: /What Heater is/ }));

    expect(screen.getByRole('button', { name: 'Find it' })).toBeEnabled();
  });

  it('refuses to find a socket only where nobody is listening', () => {
    draw(socket(), 'Offline', true, 'Offline');

    fireEvent.click(screen.getByRole('button', { name: /What Heater is/ }));

    expect(screen.getByRole('button', { name: 'Find it' })).toBeDisabled();
  });

  it('opens the times, the address and the way back when the row is opened', () => {
    draw(socket({ state: 'on', override: { state: 'on', validUntil: NOW.plus({ hours: 1 }).toISO()! } }));

    fireEvent.click(screen.getByRole('button', { name: /What Heater is/ }));

    expect(screen.getByText('10.0.0.63')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to auto' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '15 min' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'off', forSeconds: 900 }]);
  });
});

describe('what a row is made of', () => {
  it('is the device´s table and nothing else: an output is not a socket', () => {
    expect(rowsOf([socket()]).map(row => row.key)).toEqual(['socket-0-heater']);
  });

  it('numbers the sockets of a role that has several, so two lamps are two rows a person can tell apart', () => {
    const rows = rowsOf([
      socket({ slot: 0, role: 'light', address: '10.0.0.61' }),
      socket({ slot: 1, role: 'light', address: '10.0.0.62' }),
      socket({ slot: 2, role: 'secondary_light', address: '10.0.0.63' }),
    ]);

    expect(rows.map(row => row.ordinal)).toEqual([1, 2, null]);
    draw(socket({ slot: 1, role: 'light' }));
    expect(screen.getByRole('switch', { name: 'Force Light' })).toBeInTheDocument();
  });

  it('says a socket is a plug, because the row above it may be the module´s own output', () => {
    draw(socket({ role: 'light', address: '10.0.0.61' }));

    expect(screen.getByText(/smart plug · 10.0.0.61/)).toBeInTheDocument();
  });

  it('offers every hold whatever is being held, because the pulse is a failsafe and not a minimum', () => {
    // `pulseSeconds` is the time after the last command at which the socket
    // switches itself off, so a role that carries one is held no differently
    // from a role that does not.
    expect(holdsFor()).toEqual([900, 3600, 4 * 3600, 8 * 3600, 86400]);
    expect(defaultHold()).toBe(3600);
  });
});

/**
 * The controller's own light output, which is the row that is not a socket.
 *
 * The firmware takes no command carrying a level: `socket_override` holds the
 * output on or off and nothing else, and "on" means the brightness the stored
 * configuration names. So the dimmer writes the configuration and the three
 * buttons beside it send the command, and the two are refused for different
 * reasons - which is the whole reason they are drawn apart.
 */
describe("the controller's own light output", () => {
  it('says what the lamp is running at and how old that is, and offers no switch', () => {
    drawOutput();

    expect(screen.getByText(/80 % · 20 s ago/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Brightness' })).toHaveValue('80');
  });

  it('still says what a lamp that fell silent four days ago was running at, dimmed and dated', () => {
    // The honest-state rule: a value that is old is dimmed and dated, never
    // hidden. The store holds this level and the device's own live answer
    // carries it with the server's verdict on its age.
    drawOutput({ lights: LIGHTS }, CAPABILITIES, { percent: 60, measuredAt: NOW.minus({ days: 4 }).toISO()!, state: 'offline' });

    expect(screen.getByText(/60 % · 4 d ago/)).toBeInTheDocument();
    expect(screen.getByText(/60 % · 4 d ago/)).toHaveAttribute('data-age', 'offline');
    expect(screen.queryByText('nothing reported')).not.toBeInTheDocument();
  });

  it('dims the lamp by writing the whole document back, keeping the ramps it was tuned with', () => {
    drawOutput();

    const slider = screen.getByRole('slider', { name: 'Brightness' });
    fireEvent.change(slider, { target: { value: '40' } });
    fireEvent.blur(slider);

    expect(saved).toEqual([{ deviceId: 'device-1', configuration: { lights: { sunrise: 15, sunset: 15, limit: 40 } } }]);
  });

  it('holds the output on for a while, and hands it back with no duration at all', () => {
    drawOutput();

    fireEvent.click(screen.getByRole('button', { name: 'on' }));
    fireEvent.click(screen.getByRole('button', { name: 'auto' }));

    expect(sent).toEqual([
      { deviceId: 'device-1', target: { kind: 'output', output: 'light' }, state: 'on', forSeconds: 3600 },
      { deviceId: 'device-1', target: { kind: 'output', output: 'light' }, state: 'auto', forSeconds: 0 },
    ]);
  });

  it('refuses to hold the output on a build that never announced it, and dims it all the same', () => {
    drawOutput({ lights: LIGHTS }, { ...CAPABILITIES, lightOverride: false });

    expect(screen.getByRole('button', { name: 'on' })).toBeDisabled();
    expect(screen.getByText(/cannot be told to hold its light output/)).toBeInTheDocument();

    const slider = screen.getByRole('slider', { name: 'Brightness' });
    expect(slider).toBeEnabled();
    fireEvent.change(slider, { target: { value: '55' } });
    fireEvent.blur(slider);

    expect(saved).toEqual([{ deviceId: 'device-1', configuration: { lights: { sunrise: 15, sunset: 15, limit: 55 } } }]);
  });

  it('stores a brightness for a device nobody is listening on, because a setting is not a command', () => {
    drawOutput({ lights: LIGHTS }, CAPABILITIES, null, 'Offline · nothing is listening, so nothing is sent.');

    expect(screen.getByRole('button', { name: 'off' })).toBeDisabled();
    fireEvent.change(screen.getByRole('slider', { name: 'Brightness' }), { target: { value: '25' } });
    fireEvent.blur(screen.getByRole('slider', { name: 'Brightness' }));

    expect(saved).toHaveLength(1);
    expect(screen.getByText('nothing reported')).toBeInTheDocument();
  });

  it('has nothing to write a brightness into until the device has sent its settings', () => {
    drawOutput(null);

    expect(screen.getByRole('slider', { name: 'Brightness' })).toBeDisabled();
    expect(screen.getByText(/has not sent its settings yet/)).toBeInTheDocument();
  });

  it('states no brightness where none is stored, rather than the top of the slider´s scale', () => {
    // The slider has to stand somewhere; 100 % printed beside it in the same
    // weight as a real setting read as a ceiling the lamp was running at.
    drawOutput(null);

    expect(screen.getAllByText('not stated').length).toBeGreaterThan(0);
    expect(screen.queryByText('100 %')).toBeNull();
    // The spoken value agrees with the drawn one.
    expect(screen.getByRole('slider', { name: 'Brightness' })).toHaveAttribute('aria-valuetext', 'not stated');
  });

  it('says nothing either where a configuration exists but names no brightness', () => {
    // Sixty-four of the restored devices are like this: a document, no limit in
    // it, and a slider that is enabled - so the figure was invented beside a
    // control that works.
    drawOutput({ lights: { sunrise: 15, sunset: 15 } });

    const slider = screen.getByRole('slider', { name: 'Brightness' });
    expect(slider).toBeEnabled();
    expect(slider).toHaveAttribute('aria-valuetext', 'not stated');

    // Until somebody drags it, and then it says what they asked for.
    fireEvent.change(slider, { target: { value: '45' } });

    expect(screen.getByRole('slider', { name: 'Brightness' })).toHaveAttribute('aria-valuetext', '45 %');
  });

  it('is there for a build that announced the override, for one that states a brightness, and for a lamp that reported one', () => {
    const none: DeviceCapabilities = { ...CAPABILITIES, lightOverride: false };

    expect(lightOutputOf(device(null), CAPABILITIES, null)).not.toBeNull();
    expect(lightOutputOf(device({ lights: LIGHTS }), none, null)?.limitPercent).toBe(80);
    expect(lightOutputOf(device({}), none, { percent: 40, measuredAt: NOW.toISO()!, state: 'live' })?.level?.percent).toBe(40);
    expect(lightOutputOf(device({}), none, null)).toBeNull();
  });

  it('reads the brightness whether the document states it nested or flat, and writes only the nested one back', () => {
    expect(lightOutputOf(device({ 'lights.limit': 60 }), CAPABILITIES, null)?.limitPercent).toBe(60);
    expect(withLightLimit({ 'lights.limit': 60, day: { temperature: 25 } }, 30)).toEqual({ lights: { limit: 30 }, day: { temperature: 25 } });
  });
});

describe('how late a camera is', () => {
  const camera = (lastStillAt: string | null, stillIntervalSeconds = 30): Camera =>
    ({ stillIntervalSeconds, state: { lastStillAt, lastError: null, firmwareVersion: null } }) as Camera;

  it('is judged against the camera´s own interval and not against a reading´s two minutes', () => {
    expect(cameraFreshness(camera(NOW.minus({ seconds: 45 }).toISO()!), NOW)).toBe('live');
    expect(cameraFreshness(camera(NOW.minus({ seconds: 45 }).toISO()!, 10), NOW)).toBe('stale');
    expect(cameraFreshness(camera(NOW.minus({ minutes: 10 }).toISO()!), NOW)).toBe('offline');
    expect(cameraFreshness(camera(null), NOW)).toBe('offline');
  });
});

/**
 * What the tab calls the hardware on it.
 *
 * A claim stores the device's type where nobody has named it, so the list would
 * otherwise be the lowercase English word "controller" repeated once per
 * device - in the German app as well - and the camera the controller answers
 * for would inherit it. These rows are what a grower reads first after
 * onboarding, so what they print is worth asserting.
 */
/**
 * The same list, read by the owner of the tent and by somebody let into it to
 * write in its diary. A socket's override and the lamp's brightness are the
 * device's configuration, which the decision record puts at `manage` where the
 * device stands - so on a tent's own tab the switches are gone for a member and
 * the list says once whose they are.
 */
describe('what the sockets offer, by who is reading', () => {
  const standing = {
    id: 'device-1',
    name: 'Blue Dream tent',
    type: 'controller',
    ownerId: THE_HOST,
    spaceId: 'space-1',
    configuration: { lights: LIGHTS },
    firmware: { channel: 'stable' },
    state: { lastSeenAt: NOW.minus({ seconds: 20 }).toISO()!, firmwareId: null },
  } as unknown as Device;

  const drawTab = async (youMay: AccessNeed) => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/devices') return Promise.resolve({ items: [standing], nextCursor: null }) as never;
      if (path === '/cameras') return Promise.resolve({ items: [], nextCursor: null }) as never;
      if (path === '/spaces') return Promise.resolve({ items: [spaceWhere(youMay)], nextCursor: null }) as never;
      if (path === '/me') return Promise.resolve({ premium: { enforced: true } }) as never;
      if (path.endsWith('/sockets')) return Promise.resolve({ items: [socket({ role: 'light' })], capabilities: CAPABILITIES }) as never;
      if (path.endsWith('/series')) return Promise.resolve({ readings: [], outputs: [] }) as never;

      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
    wrap(<DeviceList spaceId="space-1" />);
    await screen.findByText('Cameras');
  };

  it('gives the owner the lamp’s brightness and the three states of the plug', async () => {
    await drawTab('own');

    expect(await screen.findByRole('slider', { name: 'Brightness' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'auto' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/A socket or the lamp is switched by whoever steers this tent\./)).not.toBeInTheDocument();
  });

  it('gives a member the readings, no switch at all, and the reason once', async () => {
    await drawTab('log');

    expect(await screen.findByText(/A socket or the lamp is switched by whoever steers this tent\./)).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'Brightness' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'auto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'on' })).not.toBeInTheDocument();
  });
});

describe('what the Devices tab calls a device', () => {
  const standing = (over: Partial<Device>): Device =>
    ({
      id: 'device-aaaabbbb-c0ffee',
      name: 'controller',
      type: 'controller',
      spaceId: 'space-1',
      firmware: { channel: 'stable' },
      state: { lastSeenAt: NOW.minus({ seconds: 20 }).toISO()!, firmwareId: null },
      ...over,
    }) as Device;

  const hanging = (over: Partial<Camera>): Camera =>
    ({
      id: 'camera-1',
      kind: 'terpcam_controller',
      deviceId: 'device-aaaabbbb-c0ffee',
      spaceId: 'space-1',
      name: 'Terp Cam · A41C',
      looksAt: null,
      stillIntervalSeconds: 30,
      state: { lastStillAt: NOW.minus({ seconds: 10 }).toISO()!, lastError: null, firmwareVersion: null },
      ...over,
    }) as Camera;

  // `enforced` is what `/me` says about this install, which is the only thing
  // that makes a feature tag worth drawing on a row.
  const list = { devices: [] as Device[], cameras: [] as Camera[], enforced: true };

  const drawList = async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/devices') return Promise.resolve({ items: list.devices, nextCursor: null }) as never;
      if (path === '/cameras') return Promise.resolve({ items: list.cameras, nextCursor: null }) as never;
      if (path === '/spaces') return Promise.resolve({ items: [{ id: 'space-1', name: 'Tent 1' } as Space], nextCursor: null }) as never;
      if (path === '/me') return Promise.resolve({ premium: { enforced: list.enforced } }) as never;
      if (path.endsWith('/series')) return Promise.resolve({ readings: [], outputs: [] }) as never;
      if (path.endsWith('/sockets')) return Promise.resolve({ items: [], capabilities: CAPABILITIES }) as never;

      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
    wrap(<DeviceList />);
    await screen.findByText('Cameras');
  };

  /**
   * The tag says a stream the cloud pulls is a Premium feature, and an install
   * that charges nothing has no such feature to point at - the camera's own page
   * one tap away calls the same camera "everything included on this install", so
   * the word on the row would be the list contradicting it.
   */
  it('tags a pulled stream as Premium where the install charges for it', async () => {
    list.devices = [standing({})];
    list.cameras = [hanging({ kind: 'rtsp', name: 'Side cam' })];
    list.enforced = true;
    await drawList();

    expect(await screen.findByText('Premium')).toBeInTheDocument();
  });

  it('draws no such tag where the install gates nothing', async () => {
    list.devices = [standing({})];
    list.cameras = [hanging({ kind: 'rtsp', name: 'Side cam' })];
    list.enforced = false;
    await drawList();

    expect(await screen.findByText('Side cam')).toBeInTheDocument();
    expect(screen.queryByText('Premium')).toBeNull();
  });

  it('names a device´s type in the catalogue rather than printing the contract´s key', async () => {
    list.devices = [standing({ type: 'fridge', name: null })];
    list.cameras = [];
    await drawList();

    fireEvent.click(await screen.findByRole('button', { name: /What Fridge module · C0FFEE is/ }));

    expect(await screen.findByText('Fridge module')).toBeInTheDocument();
    // The raw key would read as lowercase English under a translated title.
    expect(screen.queryByText('fridge')).toBeNull();
  });

  it('prints a type from a newer contract rather than a missing key', async () => {
    list.devices = [standing({ type: 'hydro' as Device['type'], name: null })];
    list.cameras = [];
    await drawList();

    fireEvent.click(await screen.findByRole('button', { name: /C0FFEE is/ }));

    expect(await screen.findByText('hydro')).toBeInTheDocument();
    expect(screen.queryByText('devices.type.hydro')).toBeNull();
  });

  it('heads the list with what it holds rather than calling a socket a controller', async () => {
    // The section covers whatever the account has claimed - a light, a fan and
    // a plug among them - and "Smart sockets" further down is a different list.
    list.devices = [standing({ type: 'plug' }), standing({ id: 'device-2', type: 'fan' })];
    list.cameras = [];
    await drawList();

    expect(screen.getByText('Devices')).toBeInTheDocument();
    expect(screen.queryByText('Controllers')).toBeNull();
  });

  it('draws a device nobody has named by its type as a word, with enough of its id to tell two apart', async () => {
    list.devices = [standing({})];
    list.cameras = [];
    await drawList();

    expect(await screen.findByText('Controller · C0FFEE')).toBeInTheDocument();
    expect(screen.queryByText('controller')).not.toBeInTheDocument();
  });

  it('keeps the name a grower gave, and says which device a camera hangs on by that name', async () => {
    list.devices = [standing({ name: 'Blue Dream tent' })];
    list.cameras = [hanging({})];
    await drawList();

    expect(await screen.findByText('Blue Dream tent')).toBeInTheDocument();
    expect(screen.getByText('via Blue Dream tent · Tent 1')).toBeInTheDocument();
  });

  it('says a camera hangs on a Controller rather than on the key a claim stored', async () => {
    list.devices = [standing({})];
    list.cameras = [hanging({})];
    await drawList();

    expect(await screen.findByText('via Controller · Tent 1')).toBeInTheDocument();
  });

  it('names the build a device runs and never prints the uuid it reports', async () => {
    // Every build carried over from the old cloud is named after its class, so
    // two fridges on two different builds both read "fridge"; the version is
    // the one field that says which build a device is on.
    const build = { id: 'eac2f377-729c-483c-ad31-0b41eba4276d', name: 'fridge', version: '082eda0-fix-smart-socket-wipe' };
    list.devices = [standing({ state: { lastSeenAt: NOW.minus({ seconds: 20 }).toISO()!, firmwareId: build.id } } as Partial<Device>)];
    list.cameras = [];
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/devices') return Promise.resolve({ items: list.devices, nextCursor: null }) as never;
      if (path === '/cameras') return Promise.resolve({ items: [], nextCursor: null }) as never;
      if (path === '/spaces') return Promise.resolve({ items: [{ id: 'space-1', name: 'Tent 1' } as Space], nextCursor: null }) as never;
      if (path === '/me') return Promise.resolve({ premium: { enforced: true } }) as never;
      if (path.endsWith('/firmwares')) return Promise.resolve({ items: [build], nextCursor: null }) as never;
      if (path.endsWith('/sockets')) return Promise.resolve({ items: [], capabilities: CAPABILITIES }) as never;

      return Promise.resolve({ items: [], nextCursor: null }) as never;
    });
    wrap(<DeviceList />);

    fireEvent.click(await screen.findByRole('button', { name: /What Controller · C0FFEE is/ }));

    expect(await screen.findByText('082eda0-fix-smart-socket-wipe')).toBeInTheDocument();
    expect(await screen.findByText(/firmware 082eda0-fix-smart-socket-wipe/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(build.id))).toBeNull();
  });

  it('draws a camera that inherited its controller´s type key by what is printed on the cam', async () => {
    list.devices = [standing({})];
    list.cameras = [hanging({ name: 'controller', did: 'TCAM00A41C' })];
    await drawList();

    expect(await screen.findByText('Terp Cam · A41C')).toBeInTheDocument();
    expect(screen.queryByText('controller')).not.toBeInTheDocument();
  });
});
