import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Camera, Device, DeviceCapabilities, DeviceConfiguration, PlanTransition, Socket } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { LightOutputRow } from '@/screens/devices/LightOutputRow';
import { lightOutputOf } from '@/screens/devices/lights';
import { DEFAULT_HOLD_SECONDS, HOLD_SECONDS, rowsOf, runsOf } from '@/screens/devices/sockets';
import { cameraFreshness } from '@/screens/devices/cameras';
import { durationLabel } from '@/ui/age';
import type { OutputLevel, OverrideRequest } from '@/api/devices';
import { drawDevicePages } from './device-pages';
import { deviceWith } from './fixtures';
import { announced, drawAt } from './harness';
import { spaceWhere, THE_HOST } from './session';
import { translate } from './translations';

/**
 * What a device's own page and the page of one of its smart sockets let a
 * person do, and the controller's own light output.
 *
 * A socket and the light output are different controls because they are
 * different hardware and travel by different roads. A plug is on or off and is
 * forced by a command a device either hears or does not; the output runs at a
 * level, and that level is a key of the configuration document, which is stored
 * whether anybody is listening or not. Neither control claims the device did
 * what it was told.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
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
    mutate: (request: OverrideRequest, options?: { onSuccess?: (answer: { deviceOnline: boolean }) => void }) => {
      sent.push(request);
      if (state.answer) options?.onSuccess?.(state.answer);
    },
    data: state.answer,
    error: null,
    isPending: false,
  }),
  useTestSocket: () => ({ mutate: () => {}, data: undefined, error: null, isPending: false }),
  useSaveConfiguration: () => ({
    mutate: (request: { deviceId: string; configuration: DeviceConfiguration }) => saved.push(request),
    mutateAsync: (request: { deviceId: string; configuration: DeviceConfiguration }) => {
      saved.push(request);
      return Promise.resolve(true);
    },
    isPending: false,
    isSuccess: false,
    error: null,
  }),
}));

/**
 * The plan the light output's own device is being run by. The dimmer writes the
 * same document a plan's steps write, so the row reads the plan before it saves
 * - and by default there is none, which is the answer the route gives for a
 * device nothing is steering.
 */
const moves: PlanTransition[] = [];
const planState = vi.hoisted(() => ({ status: null as string | null, pauseReason: null as string | null }));

vi.mock('@/api/plans', async importOriginal => {
  const { ApiError } = await import('@/api/problem');
  const missing = new ApiError({ status: 404, code: 'plan_not_found', title: 'Not found', detail: '', errors: [] });

  return {
    ...(await importOriginal<object>()),
    useDevicePlan: () => ({
      data: planState.status === null ? undefined : { state: { status: planState.status, pauseReason: planState.pauseReason } },
      isPending: false,
      isError: planState.status === null,
      error: planState.status === null ? missing : null,
    }),
    usePlanTransition: () => ({
      mutate: (body: PlanTransition) => moves.push(body),
      mutateAsync: (body: PlanTransition) => {
        moves.push(body);
        return Promise.resolve(undefined);
      },
      error: null,
      isPending: false,
    }),
  };
});

/** What the pages said in a toast, which is the app's and not theirs to draw. */
const told: { label: string }[] = [];
vi.mock('@/log/log-context', async importOriginal => ({
  ...(await importOriginal<object>()),
  useLog: () => ({ tell: (one: { label: string }) => told.push(one) }),
}));

/** Steuerung's own parts, which a device's page draws only for a device that is not the place's climate. */
const place = vi.hoisted(() => ({ leads: true }));
vi.mock('@/screens/control/lead', () => ({ useLeads: () => place.leads }));
vi.mock('@/screens/control/OwnSettings', () => ({ OwnSettings: ({ device }: { device: Device }) => <p>{`own settings of ${device.id}`}</p> }));

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

/** What the API answers the pages with; a test sets what it is about and draws. */
const wire = {
  devices: [] as Device[],
  sockets: [] as Socket[],
  capabilities: CAPABILITIES,
  youMay: 'own' as AccessNeed,
  builds: (() => Promise.resolve({ items: [], nextCursor: null })) as () => Promise<unknown>,
  verdict: undefined as unknown,
};

const answer = () =>
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/devices') return Promise.resolve({ items: wire.devices, nextCursor: null }) as never;
    if (path === '/spaces') return Promise.resolve({ items: [spaceWhere(wire.youMay)], nextCursor: null }) as never;
    if (path === '/me') return Promise.resolve({ id: 'user-1', handle: 'you' }) as never;
    if (path === '/spaces/space-1/overview') return Promise.resolve({ verdict: wire.verdict }) as never;
    if (path.endsWith('/sockets')) return Promise.resolve({ items: wire.sockets, nextCursor: null, capabilities: wire.capabilities }) as never;
    if (path.endsWith('/firmwares')) return wire.builds() as never;
    if (path.endsWith('/co2-report')) return Promise.resolve({ cylinders: [], openingsPerGram: null, restGrams: null }) as never;
    if (path.endsWith('/live')) return Promise.resolve({ deviceId: 'device-1', metrics: {}, outputs: {}, setpoints: null, pending: null }) as never;

    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });

/** A controller somebody else owns, standing in the tent the reader may do `wire.youMay` in, heard a moment ago. */
const controller = ({ state, ...over }: Partial<Omit<Device, 'state'>> & { state?: Partial<Device['state']> } = {}): Device =>
  deviceWith({ ownerId: THE_HOST, ...over, state: { lastSeenAt: NOW.minus({ seconds: 20 }).toISO()!, ...state } });

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

  return drawAt(<LightOutputRow output={output} unheard={unheard} mayManage={mayManage} runs={null} now={NOW} />);
};

beforeAll(async () => {
  await translate();
  // The pages age what they draw against the clock, so it stands still at the instant the fixtures are dated from.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW.toJSDate());
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  sent.length = 0;
  saved.length = 0;
  moves.length = 0;
  told.length = 0;
  planState.status = null;
  planState.pauseReason = null;
  state.answer = { deviceOnline: true };
  place.leads = true;
  Object.assign(wire, {
    devices: [controller()],
    sockets: [],
    capabilities: CAPABILITIES,
    youMay: 'own',
    builds: () => Promise.resolve({ items: [], nextCursor: null }),
    verdict: undefined,
  });
  localStorage.clear();
  for (const call of [api.post, api.patch, api.put, api.delete]) vi.mocked(call).mockReset();
  answer();
});

describe('a smart socket on its own page', () => {
  /** Whether the page has read what the reader may do: the holds are there for whoever may manage, and for nobody else. */
  const settled = () => waitFor(() => expect(screen.queryByText('Hold for') !== null).toBe(wire.youMay === 'own' || wire.youMay === 'manage'));

  /** The page of the one socket the device reports, once it is drawn. */
  const draw = async (one: Socket, title = 'Socket Heater') => {
    wire.sockets = [one];
    drawDevicePages(`/devices/device-1/sockets/${rowsOf([one])[0].key}`);
    await screen.findByRole('heading', { name: title });
    await settled();
  };

  it('forces the socket the other way, for an hour', async () => {
    await draw(socket());

    expect(screen.getByText('off · Auto')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Force Heater' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'on', forSeconds: 3600 }]);
  });

  it('hands the socket back to its role while something is forcing it', async () => {
    await draw(socket({ state: 'on', override: { state: 'on', validUntil: NOW.plus({ minutes: 42 }).toISO()! } }));

    expect(screen.getByText(/forced on · 42 min/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Force Heater' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'auto', forSeconds: 0 }]);
  });

  it('says a command went out and never that the socket switched', async () => {
    await draw(socket());

    fireEvent.click(screen.getByRole('switch', { name: 'Force Heater' }));

    await waitFor(() => expect(announced()).toHaveTextContent('Asked. The device reports back within half a minute.'));
    expect(screen.getByRole('switch', { name: 'Force Heater' })).toHaveAttribute('aria-checked', 'false');
  });

  it('says so when nobody was listening', async () => {
    state.answer = { deviceOnline: false };
    await draw(socket());

    await waitFor(() => expect(announced()).toHaveTextContent('Nobody was listening'));
  });

  /** Finding a socket is a command every build in the field takes, so only holding is refused for an old build. */
  it('holds nothing on a build that takes no override, says why where the grey chips are, and still finds the socket', async () => {
    wire.capabilities = { ...CAPABILITIES, socketOverride: false };
    await draw(socket());

    expect(screen.getByRole('switch', { name: 'Force Heater' })).toBeDisabled();
    expect(screen.getByText(/This build takes no override\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find it' })).toBeEnabled();
  });

  it('sends nothing to a device nobody hears, says so, and keeps removing the socket for when it is back', async () => {
    wire.devices = [controller({ state: { lastSeenAt: NOW.minus({ days: 4 }).toISO()! } })];
    wire.capabilities = { ...CAPABILITIES, socketOverride: false };
    await draw(socket());

    expect(screen.getByRole('button', { name: 'Find it' })).toBeDisabled();
    // Being unreachable stops more than an old build does, so it is the reason that is said.
    expect(screen.getByText('Offline · nothing is listening, so nothing is sent.')).toBeInTheDocument();
    expect(screen.queryByText(/This build takes no override\./)).not.toBeInTheDocument();
    const remove = screen.getByRole('button', { name: /^Remove the socket/ });
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(remove).toHaveTextContent('has to wait until the device is back online');
    fireEvent.click(remove);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // What is drawn is the device's last report, and the line says as of when.
    expect(screen.getByText(/^as of /)).toBeInTheDocument();
  });

  it('gives somebody who may only write lines the state, and no switch, hold or change', async () => {
    wire.youMay = 'log';
    await draw(socket());

    expect(screen.getByText('off · Auto')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText('Hold for')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Find it' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Address, role, credentials' })).not.toBeInTheDocument();
  });

  it('offers the three-way where the device does not say what the socket is doing', async () => {
    await draw(socket({ state: 'unknown', stateChangedAt: null }));

    expect(screen.getByText('not reported')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'on' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'on', forSeconds: 3600 }]);
  });

  it('says a socket has stopped answering, and since when', async () => {
    await draw(socket({ state: 'unknown', stateChangedAt: NOW.minus({ minutes: 7 }).toISO()! }));

    expect(screen.getByText(/no answer · 7 min/)).toBeInTheDocument();
  });

  it('holds it for the time chosen, shows where it is reached and offers the way back to its role', async () => {
    await draw(socket({ state: 'on', override: { state: 'on', validUntil: NOW.plus({ hours: 1 }).toISO()! } }));

    expect(screen.getByText('10.0.0.63')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to auto' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch Heater off for 15 min' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'off', forSeconds: 900 }]);
  });

  /** How often an output came on is the place's own 24 h verdict, which the page asks the place for. */
  it('counts how often its output came on from the place the device stands in', async () => {
    wire.verdict = { actuators: [{ output: 'heater', runCount: 3, forSeconds: 900 }] };
    await draw(socket());

    expect(await screen.findByText('3× in the last 24 h')).toBeInTheDocument();
    expect(runsOf(undefined, 'heater')).toBeNull();
  });

  it('is named by its role, numbered where the role holds several, and leads back to the device it hangs on', async () => {
    wire.sockets = [socket({ slot: 0, role: 'light', address: '10.0.0.61' }), socket({ slot: 1, role: 'light', address: '10.0.0.62' })];
    drawDevicePages('/devices/device-1/sockets/socket-1-light');

    expect(await screen.findByRole('heading', { name: 'Socket Light 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'via Controller' })).toHaveAttribute('href', '/devices/device-1');
    // Opened by its address alone, the way back is Steuerung of the place the device stands in.
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/control?space=space-1');
  });

  /** A role changed from the page changes the key the address was built from; the slot is what stays. */
  it('is still found by its slot once its role was changed', async () => {
    wire.sockets = [socket({ slot: 2, role: 'pump', timer: { onSeconds: 120, everySeconds: 21600 } })];
    drawDevicePages('/devices/device-1/sockets/socket-2-heater');

    expect(await screen.findByRole('heading', { name: 'Socket Pump' })).toBeInTheDocument();
    expect(await screen.findByText('on for 2 min, every 6 h')).toBeInTheDocument();
  });

  it('says a socket the device no longer reports is gone, with the way back', async () => {
    wire.sockets = [];
    drawDevicePages('/devices/device-1/sockets/socket-0-heater');

    expect(await screen.findByText('Controller no longer reports this socket.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toBeInTheDocument();
  });
});

describe('what a socket is made of', () => {
  it('is the device´s table and nothing else: an output is not a socket', () => {
    expect(rowsOf([socket()]).map(row => row.key)).toEqual(['socket-0-heater']);
  });

  it('numbers the sockets of a role that has several, so two lamps are two a person can tell apart', () => {
    const rows = rowsOf([
      socket({ slot: 0, role: 'light', address: '10.0.0.61' }),
      socket({ slot: 1, role: 'light', address: '10.0.0.62' }),
      socket({ slot: 2, role: 'secondary_light', address: '10.0.0.63' }),
    ]);

    expect(rows.map(row => row.ordinal)).toEqual([1, 2, null]);
  });

  it('offers every hold whatever is being held, because the pulse is a failsafe and not a minimum', () => {
    // `pulseSeconds` is the time after the last command at which the socket
    // switches itself off, so a role that carries one is held no differently
    // from a role that does not.
    expect(HOLD_SECONDS).toEqual([900, 3600, 4 * 3600, 8 * 3600, 86400]);
    expect(DEFAULT_HOLD_SECONDS).toBe(3600);
  });
});

/**
 * The controller's own light output, which is the row that is not a socket:
 * what the lamp runs at, and holding it on or off. The firmware takes no
 * command carrying a level - `socket_override` holds the output on or off and
 * nothing else - and how bright the lamp may get is a setting, which stands
 * with the light's hours on Steuerung.
 */
describe("the controller's own light output", () => {
  it('says what the lamp is running at and how old that is, and offers neither a switch nor a second place for the limit', () => {
    drawOutput();

    expect(screen.getByText(/80 % · 20 s ago/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
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

  it('holds the output on for a while, and hands it back with no duration at all', () => {
    drawOutput();

    fireEvent.click(screen.getByRole('button', { name: 'on' }));
    fireEvent.click(screen.getByRole('button', { name: 'auto' }));

    expect(sent).toEqual([
      { deviceId: 'device-1', target: { kind: 'output', output: 'light' }, state: 'on', forSeconds: 3600 },
      { deviceId: 'device-1', target: { kind: 'output', output: 'light' }, state: 'auto', forSeconds: 0 },
    ]);
  });

  it('marks the hold it sent, and until when, since the device reports none back', () => {
    drawOutput();

    expect(screen.getByRole('button', { name: 'auto' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'on' }));

    expect(screen.getByRole('button', { name: 'on' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'auto' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/^on until \d\d:\d\d$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'auto' }));
    expect(screen.getByRole('button', { name: 'auto' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('holds 1 h')).toBeInTheDocument();
  });

  /**
   * How long a hold lasts is a mandatory part of the command - the server
   * refuses one with no end - so the row says it before the tap and offers the
   * times a smart socket is held for.
   */
  it('says how long it holds the output for, before the tap and again after it', async () => {
    drawOutput();

    expect(screen.getByText('holds 1 h')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Hold the light output for 1 h' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'on' }));

    await waitFor(() => expect(announced()).toHaveTextContent('Asked, to hold for 1 h.'));
  });

  it('offers the times a socket is held for, and holds the output for whichever was chosen', async () => {
    drawOutput();
    fireEvent.click(screen.getByRole('button', { name: /Details of Light output/ }));

    expect(HOLD_SECONDS.map(durationLabel)).toEqual(['15 min', '1 h', '4 h', '8 h', '24 h']);
    fireEvent.click(screen.getByRole('button', { name: '4 h' }));

    expect(screen.getByRole('button', { name: '4 h' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('holds 4 h')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'on' }));
    fireEvent.click(screen.getByRole('button', { name: 'auto' }));

    expect(sent).toEqual([
      { deviceId: 'device-1', target: { kind: 'output', output: 'light' }, state: 'on', forSeconds: 4 * 3600 },
      { deviceId: 'device-1', target: { kind: 'output', output: 'light' }, state: 'auto', forSeconds: 0 },
    ]);
    // Handing the output back carries no duration, so the receipt names none.
    await waitFor(() => expect(announced()).toHaveTextContent('Asked. The device reports back within half a minute.'));
  });

  it('offers no hold and no hold times on a build that never announced one, and says why once', () => {
    drawOutput({ lights: LIGHTS }, { ...CAPABILITIES, lightOverride: false });
    fireEvent.click(screen.getByRole('button', { name: /Details of Light output/ }));

    // No button nobody can press: greyed, they read as any unchosen option.
    expect(screen.queryByRole('button', { name: 'on' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '4 h' })).not.toBeInTheDocument();
    expect(screen.getAllByText('This build cannot be told to hold its light output.')).toHaveLength(1);
    // Nor does the row name the length of a hold nobody can ask for.
    expect(screen.queryByText(/^holds /)).not.toBeInTheDocument();
  });

  it('offers no hold to a device nobody is listening on, and says that it waits for the device', () => {
    drawOutput({ lights: LIGHTS }, CAPABILITIES, null, 'Offline · nothing is listening, so nothing is sent.');

    expect(screen.queryByRole('button', { name: 'off' })).not.toBeInTheDocument();
    expect(screen.getByText(/^Offline: holding the light/)).toBeInTheDocument();
    expect(screen.getByText('nothing reported')).toBeInTheDocument();
  });

  it('states the limit behind the chevron as a fact, and none where none is stored', () => {
    const { unmount } = drawOutput();
    fireEvent.click(screen.getByRole('button', { name: /Details of Light output/ }));
    expect(screen.getByText('Set to').nextElementSibling).toHaveTextContent('80 %');
    unmount();

    drawOutput({ lights: { sunrise: 15, sunset: 15 } });
    fireEvent.click(screen.getByRole('button', { name: /Details of Light output/ }));
    expect(screen.getByText('Set to').nextElementSibling).toHaveTextContent('not stated');
    expect(screen.queryByText('100 %')).toBeNull();
  });

  it('is there for a build that announced the override, for one that states a brightness, and for a lamp that reported one', () => {
    const none: DeviceCapabilities = { ...CAPABILITIES, lightOverride: false };

    expect(lightOutputOf(device(null), CAPABILITIES, null)).not.toBeNull();
    expect(lightOutputOf(device({ lights: LIGHTS }), none, null)?.limitPercent).toBe(80);
    expect(lightOutputOf(device({}), none, { percent: 40, measuredAt: NOW.toISO()!, state: 'live' })?.level?.percent).toBe(40);
    expect(lightOutputOf(device({}), none, null)).toBeNull();
  });

  it('reads the brightness whether the document states it nested or flat', () => {
    expect(lightOutputOf(device({ 'lights.limit': 60 }), CAPABILITIES, null)?.limitPercent).toBe(60);
  });

  /** A Light keeps its brightness at the top of its document and reads nothing else, so a lamp capped at 0 % read as "not stated". */
  it('reads a Light´s brightness where the Light keeps it, and tells it of no hold it could never take', () => {
    const lamp = { day: 21600, night: 79200, sunrise: 0, sunset: 0, limit: 0 };
    const light = { ...device(lamp), type: 'light' } as Device;

    expect(lightOutputOf(light, { ...CAPABILITIES, lightOverride: false }, null)?.limitPercent).toBe(0);

    drawAt(<LightOutputRow output={lightOutputOf(light, CAPABILITIES, null)!} unheard={null} mayManage runs={null} now={NOW} />);
    // No Light build takes a hold, so it is not told to wait for one.
    expect(screen.queryByRole('button', { name: 'on' })).not.toBeInTheDocument();
    expect(screen.getByText('This kind of device cannot be told to hold its light output.')).toBeInTheDocument();
    expect(screen.queryByText(/This build/)).not.toBeInTheDocument();
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

describe('a device on its own page', () => {
  /** A page of the device, once it is drawn and has read the places - which say where it stands and what the reader may do. */
  const draw = async (at = '/devices/device-1', title = 'Controller') => {
    drawDevicePages(at);
    await screen.findByRole('heading', { name: title });
    await waitFor(() =>
      expect(
        vi.mocked(api.get).mock.results.some((result, at) => vi.mocked(api.get).mock.calls[at][0] === '/spaces' && result.type === 'return'),
      ).toBe(true),
    );
    if (!/\/(sockets|advanced|details)$/.test(at)) await screen.findAllByRole('link', { name: /Tent 1$/ });
  };

  const BUILD = {
    id: 'fw-old',
    createdAt: '2026-08-01T10:00:00.000Z',
    classId: 'class-1',
    name: 'controller',
    version: 'a1b2c3d',
    wasStable: true,
    channels: [],
  };
  const NEWER = { ...BUILD, id: 'fw-new', createdAt: '2026-09-15T10:00:00.000Z', version: 'e4f5a6b', channels: ['stable'] };
  const builds = (...items: object[]) => {
    wire.builds = () => Promise.resolve({ items, nextCursor: null });
  };

  it('says where the device stands and that it is heard, and leads back to Steuerung of its place', async () => {
    await draw();

    expect(screen.getByRole('link', { name: 'Back to Control' })).toHaveAttribute('href', '/control?space=space-1');
    expect(screen.getByRole('link', { name: 'in Tent 1' })).toHaveAttribute('href', '/spaces/space-1');
    expect(screen.getByText('connected')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
  });

  it('names a device´s type in the catalogue rather than printing the contract´s key', async () => {
    wire.devices = [controller({ type: 'fridge' })];
    await draw('/devices/device-1', 'Fridge module');

    expect(screen.queryByText('fridge')).toBeNull();
  });

  it('prints a type from a newer contract rather than a missing key', async () => {
    wire.devices = [controller({ type: 'dehydrator' })];
    await draw('/devices/device-1', 'dehydrator');

    expect(screen.queryByText(/devices\.type/)).toBeNull();
  });

  it('tells two unnamed devices of a kind apart by the tail of their ids, and keeps a name a grower gave', async () => {
    wire.devices = [controller({ id: 'device-aaaabbbb-c0ffee' }), controller({ id: 'device-3' }), controller({ id: 'device-2', name: 'East tent' })];
    drawDevicePages('/devices/device-aaaabbbb-c0ffee');
    expect(await screen.findByRole('heading', { name: /^Controller · \w+$/ })).toBeInTheDocument();
    cleanup();

    await draw('/devices/device-2', 'East tent');
  });

  /** Migrated devices carry a `lastSeenAt` older than their own samples; the page dates the device by the newer of the two. */
  it('dates a device by its own newest reading where that is later than the last message from it', async () => {
    wire.devices = [controller({ state: { lastSeenAt: NOW.minus({ days: 3 }).toISO()! } })];
    answer();
    const drawn = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation((path: string, ...rest) =>
      path.endsWith('/live')
        ? (Promise.resolve({
            deviceId: 'device-1',
            metrics: { temperature: { value: 24, measuredAt: NOW.minus({ seconds: 30 }).toISO()!, state: 'live' } },
            outputs: {},
            setpoints: null,
            pending: null,
          }) as never)
        : drawn(path, ...rest),
    );
    await draw();

    expect(await screen.findByText('live')).toBeInTheDocument();
    expect(screen.queryByText(/^Offline since/)).not.toBeInTheDocument();
  });

  it('says a device that was never heard is waiting for its first values, and offers it neither a window nor a restart', async () => {
    wire.devices = [controller({ state: { lastSeenAt: null } })];
    await draw();

    expect(screen.getByText('waiting for first values')).toBeInTheDocument();
    expect(screen.getByText('has never reported')).toBeInTheDocument();
    expect(screen.queryByText(/^Offline since/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Maintenance · 15 min' })).not.toBeInTheDocument();
  });

  describe('its firmware', () => {
    it('names the build by its day, keeps the version for the technical details, and never prints the uuid', async () => {
      // Every build carried over from the old cloud is named after its class, so
      // two fridges on two different builds both read "fridge"; the version is a
      // commit and a branch - so the plain line names the day the build was made.
      const build = {
        ...BUILD,
        id: 'eac2f377-729c-483c-ad31-0b41eba4276d',
        createdAt: '2026-09-12T10:00:00.000Z',
        version: '082eda0-fix-smart-socket-wipe',
      };
      wire.devices = [controller({ state: { firmwareId: build.id } })];
      builds(build);
      await draw();

      expect(await screen.findByText('from 12 Sep 2026')).toBeInTheDocument();
      expect(screen.queryByText('082eda0-fix-smart-socket-wipe')).toBeNull();
      expect(screen.queryByText(new RegExp(build.id))).toBeNull();
      cleanup();

      await draw('/devices/device-1/details', 'Technical details');
      expect(await screen.findByText('082eda0-fix-smart-socket-wipe')).toBeInTheDocument();
      expect(screen.queryByText(new RegExp(build.id))).toBeNull();
    });

    /** A build list that never came back ended as the words a device with no known build gets. */
    it('says a build it could not read could not be read, and reads it again on asking', async () => {
      let fails = true;
      wire.devices = [controller({ state: { firmwareId: BUILD.id } })];
      wire.builds = () => (fails ? Promise.reject(new Error('timed out')) : Promise.resolve({ items: [BUILD], nextCursor: null }));
      await draw();

      expect(await screen.findByText(/could not be read/, undefined, { timeout: 8000 })).toBeInTheDocument();
      fails = false;
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('from 1 Aug 2026')).toBeInTheDocument();
    }, 10000);

    /** Only the diary used to say that a device owed an update, or that one had not taken. */
    it('says that new firmware is on its way, and that it did not take once the wait ran out', async () => {
      const pinned = (updateFailedAt: string | null) =>
        controller({ firmware: { channel: 'manual', targetId: NEWER.id }, state: { firmwareId: BUILD.id, updateFailedAt } });
      builds(BUILD, NEWER);
      wire.devices = [pinned(null)];
      await draw();
      expect(await screen.findByText(/New firmware is being installed/)).toBeInTheDocument();
      // What it owes is not offered a second time.
      expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
      cleanup();

      // Which build, by its version, is for the technical details.
      await draw('/devices/device-1/details', 'Technical details');
      expect((await screen.findByText('To be installed')).nextElementSibling).toHaveTextContent('e4f5a6b');
      cleanup();

      wire.devices = [pinned(NOW.minus({ minutes: 5 }).toISO()!)];
      await draw();
      expect(await screen.findByText(/New firmware did not install \(.* ago\)/)).toBeInTheDocument();
    });

    it('switches automatic updates on the stable channel, re-sending the build it is pinned to, and says what holds now', async () => {
      wire.devices = [controller({ firmware: { channel: 'manual', targetId: 'fw-old' } })];
      vi.mocked(api.patch).mockImplementation((_path, body) => Promise.resolve({ ...wire.devices[0], ...(body as object) }) as never);
      await draw();

      const toggle = screen.getByRole('switch', { name: 'Update automatically' });
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByText(/Off: the device stays on its version/)).toBeInTheDocument();
      // Switched off there is no channel to choose, only the version to install by hand.
      expect(screen.queryByRole('combobox', { name: 'Update channel' })).not.toBeInTheDocument();
      fireEvent.click(toggle);

      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { firmware: { channel: 'stable', targetId: 'fw-old' } }));
      await waitFor(() => expect(told.map(one => one.label)).toEqual(['Automatic updates on · stable versions']));
    });

    it('offers the release channels while the device updates itself, and no version to pick', async () => {
      wire.devices = [controller({ classId: 'class-1', firmware: { channel: 'stable', targetId: null } })];
      vi.mocked(api.patch).mockImplementation((_path, body) => Promise.resolve({ ...wire.devices[0], ...(body as object) }) as never);
      await draw();

      const channel = screen.getByRole('combobox', { name: 'Update channel' });
      expect(
        within(channel)
          .getAllByRole('option')
          .map(option => option.textContent),
      ).toEqual(['Stable', 'Beta', 'Alpha']);
      expect(screen.getByText('Only released versions.')).toBeInTheDocument();
      // On a release channel there is no version to pick: the channel decides it.
      expect(screen.queryByRole('combobox', { name: 'Firmware version' })).not.toBeInTheDocument();
      fireEvent.change(channel, { target: { value: 'beta' } });

      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { firmware: { channel: 'beta', targetId: null } }));
    });

    /**
     * Builds carry no version to compare, so "newer" is the stable channel's
     * current build, made after the one the device is known to run - and only a
     * device whose updates are off is offered it, since nothing else installs it.
     */
    it('offers a device whose updates are off the newer stable build, and asks before it installs', async () => {
      wire.devices = [controller({ classId: 'class-1', firmware: { channel: 'manual', targetId: null }, state: { firmwareId: BUILD.id } })];
      builds(BUILD, NEWER);
      vi.mocked(api.patch).mockImplementation((_path, body) => Promise.resolve({ ...wire.devices[0], ...(body as object) }) as never);
      await draw();

      expect(await screen.findByText('Newer firmware of 15 Sep 2026 is available')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Update now' }));

      const asked = await screen.findByRole('dialog', { name: 'Firmware for Controller' });
      expect(within(asked).getByText(/While it updates the device switches its outputs off for a moment and restarts/)).toBeInTheDocument();
      expect(api.patch).not.toHaveBeenCalled();
      fireEvent.click(within(asked).getByRole('button', { name: 'Install' }));

      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { firmware: { channel: 'manual', targetId: 'fw-new' } }));
    });

    it('says a newer build comes by itself to a device that follows its channel, and offers no button for it', async () => {
      wire.devices = [controller({ classId: 'class-1', firmware: { channel: 'stable', targetId: null }, state: { firmwareId: BUILD.id } })];
      builds(BUILD, NEWER);
      await draw();

      expect(await screen.findByText('Newer firmware of 15 Sep 2026 installs by itself')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
    });

    it('calls no build newer where the cloud does not know the one the device runs, or where that one is the later', async () => {
      wire.devices = [controller({ classId: 'class-1', firmware: { channel: 'manual', targetId: null }, state: { firmwareId: 'unknown-build' } })];
      builds(NEWER);
      await draw();
      expect(await screen.findByText('version not known')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
      cleanup();

      const later = { ...BUILD, id: 'fw-test', createdAt: '2026-09-18T10:00:00.000Z', channels: [] };
      wire.devices = [controller({ classId: 'class-1', firmware: { channel: 'manual', targetId: null }, state: { firmwareId: later.id } })];
      builds(later, NEWER);
      await draw();
      expect(await screen.findByText('from 18 Sep 2026')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
    });

    it('says nothing about an update where the device runs what it was pinned to', async () => {
      wire.devices = [controller({ firmware: { channel: 'manual', targetId: BUILD.id }, state: { firmwareId: BUILD.id } })];
      builds(BUILD);
      await draw();

      expect(await screen.findByText('from 1 Aug 2026')).toBeInTheDocument();
      expect(screen.queryByText(/New firmware/)).toBeNull();
    });
  });

  describe('what is done to the hardware', () => {
    const fridge = (state: Partial<Device['state']> = {}) => controller({ type: 'fridge', state });

    beforeEach(() => {
      vi.mocked(api.post).mockResolvedValue({ publishedAt: NOW.toISO(), deviceOnline: true } as never);
    });

    it('asks before it restarts the device, says what a restart costs, and sends nothing until asked', async () => {
      wire.devices = [fridge()];
      await draw('/devices/device-1', 'Fridge module');
      fireEvent.click(screen.getByRole('button', { name: 'Restart' }));

      const asked = await screen.findByRole('dialog', { name: 'Restart Fridge module?' });
      expect(within(asked).getByText(/Anything you switched by hand – the light or a socket – ends with the restart/)).toBeInTheDocument();
      expect(api.post).not.toHaveBeenCalled();

      fireEvent.click(within(asked).getByRole('button', { name: 'Restart now' }));

      expect(await within(asked).findByText('Restart asked for. The device will be back in a moment.')).toBeInTheDocument();
      expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'reboot' });
    });

    it('starts a quarter of an hour of maintenance on this device with one tap', async () => {
      wire.devices = [fridge()];
      await draw('/devices/device-1', 'Fridge module');
      fireEvent.click(screen.getByRole('button', { name: 'Maintenance · 15 min' }));

      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 900 }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('says a window is standing, until when, and offers its end and another quarter of an hour', async () => {
      wire.devices = [fridge({ maintenanceUntil: NOW.plus({ minutes: 8 }).toISO()! })];
      await draw('/devices/device-1', 'Fridge module');

      expect(screen.getByText(/^Maintenance until \d\d:\d\d/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Extend' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'End' }));

      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 0 }));
    });

    it('holds both back while the device is offline, says why once, and what to try', async () => {
      wire.devices = [fridge({ lastSeenAt: NOW.minus({ minutes: 25 }).toISO()! })];
      await draw('/devices/device-1', 'Fridge module');

      const box = screen.getByRole('heading', { name: /^Fridge module has been offline since \d\d:\d\d\.$/ }).closest('section')!;
      expect(within(box).getByText('What you set here reaches the device as soon as it is heard again.')).toBeInTheDocument();
      fireEvent.click(within(box).getByRole('button', { name: 'What you can do ›' }));
      expect(within(box).getByText('Unplug the device, wait 10 seconds, plug it back in.')).toBeInTheDocument();
      expect(screen.getByText('Maintenance, restart and update have to wait until the device is back online.')).toBeInTheDocument();
      for (const name of ['Restart', 'Maintenance · 15 min']) {
        const button = screen.getByRole('button', { name });
        expect(button).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(button);
      }
      expect(api.post).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      // A setting is no command: where its updates come from stays changeable.
      expect(screen.getByRole('switch', { name: 'Update automatically' })).toBeEnabled();
    });

    /** A plug parks nothing, so it is offered the restart and no maintenance that would only be a promise. */
    it('offers a plug the restart and no maintenance', async () => {
      wire.devices = [controller({ type: 'plug' })];
      await draw('/devices/device-1', 'Plantalytix Socket');

      expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Maintenance/ })).not.toBeInTheDocument();
    });
  });

  describe('its regulation', () => {
    const regulating = (over: Partial<NonNullable<Device['control']>> = {}): Device =>
      controller({
        type: 'fridge',
        configuration: { workmode: over.running === false ? 'off' : 'small', day: { temperature: 25, humidity: 60 } },
        control: { running: true, drying: false, mode: 'standard', energySaving: false, ...over } as Device['control'],
      });

    it('asks before it switches control off, and pauses a running plan first', async () => {
      planState.status = 'running';
      wire.devices = [regulating()];
      vi.mocked(api.patch).mockResolvedValue(regulating({ running: false }) as never);
      await draw('/devices/device-1', 'Fridge module');
      fireEvent.click(screen.getByRole('button', { name: 'Switch control off' }));

      const asked = await screen.findByRole('dialog', { name: 'Switch control off?' });
      expect(within(asked).getByText(/Heater, compressor, light, CO₂ valve and fans go off/)).toBeInTheDocument();
      expect(within(asked).getByText(/is paused, or its next step would switch control back on/)).toBeInTheDocument();
      expect(api.patch).not.toHaveBeenCalled();

      fireEvent.click(within(asked).getByRole('button', { name: 'Switch off' }));

      expect(await within(asked).findByText('Control is off.')).toBeInTheDocument();
      expect(moves).toEqual([{ kind: 'pause', reason: 'Control was switched off.' }]);
      expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { control: false } });
    });

    it('says that control is off, switches it back on with one tap, and says that it did', async () => {
      wire.devices = [regulating({ running: false })];
      vi.mocked(api.patch).mockResolvedValue(regulating() as never);
      await draw('/devices/device-1', 'Fridge module');

      expect(screen.getByText('Control off')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Switch control on/ }));

      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { control: true } }));
      await waitFor(() => expect(told.map(one => one.label)).toEqual(['Control switched on']));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('says a fridge that germinates in the dark regulates, and in which mode', async () => {
      wire.devices = [regulating({ mode: 'germination' })];
      await draw('/devices/device-1', 'Fridge module');

      expect(screen.getByText('Control on · germination · dark')).toBeInTheDocument();
    });

    it('has no control row for hardware with no work mode', async () => {
      wire.devices = [controller({ type: 'plug', control: null })];
      await draw('/devices/device-1', 'Plantalytix Socket');

      expect(screen.queryByRole('button', { name: /control/i })).not.toBeInTheDocument();
    });
  });

  describe('by who is reading', () => {
    it('gives its owner every row, each saying what is behind it', async () => {
      wire.devices = [controller({ ownerId: 'user-1', configuration: { lights: LIGHTS } })];
      wire.sockets = [socket()];
      await draw();

      expect(screen.getByRole('button', { name: /^Rename or move/ })).toHaveTextContent('stands in Tent 1');
      const sockets = await screen.findByRole('link', { name: /^Smart sockets/ });
      expect(sockets).toHaveTextContent('1 paired · pair another');
      expect(sockets).toHaveAttribute('href', '/devices/device-1/sockets');
      expect(screen.getByRole('link', { name: /^Advanced/ })).toHaveAttribute('href', '/devices/device-1/advanced');
      expect(screen.getByRole('link', { name: /^Technical details/ })).toHaveAttribute('href', '/devices/device-1/details');
      expect(screen.getByRole('button', { name: 'Give the device up' })).toBeInTheDocument();
    });

    it('keeps giving the device up for its owner alone', async () => {
      wire.youMay = 'manage';
      await draw();

      expect(screen.getByRole('button', { name: /^Rename or move/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Give the device up' })).not.toBeInTheDocument();
    });

    /** What may be done is the device's answer and not the screen's: the same reader owns one tent and only writes lines in the next. */
    it('offers somebody who may only write lines nothing to change, and leads them back to the place', async () => {
      wire.youMay = 'log';
      wire.devices = [controller({ configuration: { lights: LIGHTS } })];
      await draw();

      expect(screen.getByRole('link', { name: 'Back to Tent 1' })).toHaveAttribute('href', '/spaces/space-1');
      for (const name of [/^Rename or move/, 'Restart', 'Maintenance · 15 min', 'Give the device up']) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
      }
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /^Advanced/ })).not.toBeInTheDocument();
      // No sockets, nothing to read behind their row.
      expect(screen.queryByRole('link', { name: /^Smart sockets/ })).not.toBeInTheDocument();
      expect(screen.getByText('automatic – stable releases')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^Technical details/ })).toBeInTheDocument();
    });
  });

  describe('beside Steuerung', () => {
    it('leaves what the place is held at to Steuerung for the device that is its climate', async () => {
      await draw();

      expect(screen.queryByText('own settings of device-1')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /curves/ })).not.toBeInTheDocument();
    });

    it('draws what another device of the place is set to, with the way to its curves', async () => {
      place.leads = false;
      await draw();

      expect(screen.getByText('own settings of device-1')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /This device's curves/ })).toHaveAttribute('href', '/timeline?space=space-1&device=device-1');
    });
  });

  describe('the pages under it', () => {
    it('lists the device´s sockets as the ways to their pages, says what is true of the device once, and pairs another', async () => {
      wire.devices = [controller({ state: { lastSeenAt: NOW.minus({ days: 4 }).toISO()! } })];
      wire.sockets = [socket(), socket({ slot: 1, role: 'pump', timer: { onSeconds: 120, everySeconds: 21600 } })];
      wire.capabilities = { ...CAPABILITIES, socketOverride: false };
      await draw('/devices/device-1/sockets', 'Smart sockets');

      // Being unreachable stops more than an old build does, so it is said first and the old build after it.
      const offline = await screen.findByText('Offline · nothing is listening, so nothing is sent.');
      const build = screen.getByText(/This build takes no override\./);
      expect(offline.compareDocumentPosition(build)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(screen.getByRole('link', { name: /^Heater/ })).toHaveAttribute('href', '/devices/device-1/sockets/socket-0-heater');
      expect(screen.getByRole('link', { name: /^Pump/ })).toHaveTextContent('on 2 min every 6 h');
      expect(screen.getByRole('link', { name: 'Back to Controller' })).toHaveAttribute('href', '/devices/device-1');
      expect(screen.getByRole('button', { name: '+ Pair another socket' })).toBeInTheDocument();
    });

    it('holds what few growers set on a page of its own, without what has its place elsewhere', async () => {
      wire.devices = [controller({ ownerId: 'user-1', type: 'fridge', classId: 'class-1', configuration: { workmode: 'small', lights: LIGHTS } })];
      await draw('/devices/device-1/advanced', 'Advanced');

      expect(screen.getByText('Sunrise')).toBeInTheDocument();
      // The work mode and the fans are Steuerung's, the channel is the firmware card's, giving it up a row of its own.
      for (const elsewhere of ['Operating mode', 'Update channel', 'Give the device up', 'Clip fan', 'Pair a socket by IP']) {
        expect(screen.queryByText(elsewhere)).not.toBeInTheDocument();
      }
    });

    it('prints what only support asks for, and what the build takes only of a device that drives sockets', async () => {
      await draw('/devices/device-1/details', 'Technical details');

      expect(screen.getByText('Device id').nextElementSibling).toHaveTextContent('device-1');
      expect(screen.getByText('Serial number').nextElementSibling).toHaveTextContent('42');
      expect(screen.getByText('Type').nextElementSibling).toHaveTextContent('Controller');
      expect((await screen.findByText('Takes')).nextElementSibling).toHaveTextContent('overrides · socket timers · light override');
      cleanup();

      wire.devices = [controller({ type: 'plug' })];
      await draw('/devices/device-1/details', 'Technical details');
      expect(screen.queryByText('Takes')).toBeNull();
    });

    it('leads a page a device has not got to the device itself', async () => {
      wire.devices = [controller({ type: 'plug' })];
      await draw('/devices/device-1/sockets', 'Plantalytix Socket');
      cleanup();

      await draw('/devices/device-1/whatever', 'Plantalytix Socket');
    });

    it('says a device the reader cannot open cannot be opened, rather than offering to try again', async () => {
      const { ApiError } = await import('@/api/problem');
      const drawn = vi.mocked(api.get).getMockImplementation()!;
      vi.mocked(api.get).mockImplementation((path: string, ...rest) =>
        path === '/devices/someone-elses'
          ? (Promise.reject(new ApiError({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] })) as never)
          : drawn(path, ...rest),
      );
      drawDevicePages('/devices/someone-elses');

      expect(await screen.findByText('This device cannot be opened.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });
  });
});
