import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccessNeed,
  Camera,
  Device,
  DeviceCapabilities,
  DeviceConfiguration,
  DeviceFirmware,
  PendingSettings,
  PlanTransition,
  Socket,
} from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { ApiError } from '@/api/problem';
import type { Told } from '@/log/log-context';
import { cameraFreshness } from '@/screens/devices/cameras';
import { UpdateButton } from '@/screens/devices/DeviceActions';
import { buildDay } from '@/screens/devices/firmware-builds';
import { drawDevicePages } from './device-pages';
import { deviceWith } from './fixtures';
import { drawAt } from './harness';
import { spaceWhere, THE_HOST } from './session';
import { translate } from './translations';

/** What a device's own page lets a person do. Its smart sockets and the light output are `sockets.test.tsx`'s. */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

const saved: { deviceId: string; configuration: DeviceConfiguration }[] = [];

vi.mock('@/api/devices', async importOriginal => ({
  ...(await importOriginal<object>()),
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

/** What the pages said in a toast, which is the app's and not theirs to draw, each with the way it is taken back. */
const told: Told[] = [];
vi.mock('@/log/log-context', async importOriginal => ({
  ...(await importOriginal<object>()),
  useLog: () => ({ tell: (one: Told) => told.push(one) }),
}));
const said = () => told.map(one => one.label);

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
  /** What a silent device has not been handed, as its live read says it. */
  pending: null as PendingSettings | null,
};

const answer = () =>
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.endsWith('/plan'))
      return Promise.reject(new ApiError({ status: 404, code: 'plan_not_found', title: 'Not found', detail: '', errors: [] }));
    if (path === '/devices') return Promise.resolve({ items: wire.devices, nextCursor: null }) as never;
    if (path === '/spaces') return Promise.resolve({ items: [spaceWhere(wire.youMay)], nextCursor: null }) as never;
    if (path === '/me') return Promise.resolve({ id: 'user-1', handle: 'you' }) as never;
    if (path === '/spaces/space-1/overview') return Promise.resolve({ verdict: wire.verdict }) as never;
    if (path.endsWith('/sockets')) return Promise.resolve({ items: wire.sockets, nextCursor: null, capabilities: wire.capabilities }) as never;
    if (path.endsWith('/firmwares')) return wire.builds() as never;
    if (path.endsWith('/co2-report')) return Promise.resolve({ cylinders: [], openingsPerGram: null, restGrams: null }) as never;
    if (path.endsWith('/live'))
      return Promise.resolve({ deviceId: 'device-1', metrics: {}, outputs: {}, setpoints: null, pending: wire.pending }) as never;

    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });

/** A controller somebody else owns, standing in the tent the reader may do `wire.youMay` in, heard a moment ago. */
const controller = ({ state, ...over }: Partial<Omit<Device, 'state'>> & { state?: Partial<Device['state']> } = {}): Device =>
  deviceWith({ ownerId: THE_HOST, ...over, state: { lastSeenAt: NOW.minus({ seconds: 20 }).toISO()!, ...state } });

const LIGHTS = { sunrise: 15, sunset: 15, limit: 80 };
const CONTROL = { running: true, drying: false, mode: 'standard', energySaving: false } as Device['control'];

beforeAll(async () => {
  await translate();
  // The pages age what they draw against the clock, so it stands still at the instant the fixtures are dated from.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW.toJSDate());
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  saved.length = 0;
  moves.length = 0;
  told.length = 0;
  planState.status = null;
  planState.pauseReason = null;
  place.leads = true;
  Object.assign(wire, {
    devices: [controller()],
    sockets: [],
    capabilities: CAPABILITIES,
    youMay: 'own',
    builds: () => Promise.resolve({ items: [], nextCursor: null }),
    verdict: undefined,
    pending: null,
  });
  localStorage.clear();
  for (const call of [api.post, api.patch, api.put, api.delete]) vi.mocked(call).mockReset();
  answer();
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

/** What the pill in the head dates the device as. */
const pill = () => document.querySelector('[data-liveness]')?.getAttribute('data-liveness');

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
    if (!/\/(advanced|details)$/.test(at)) await screen.findAllByRole('link', { name: /Tent 1$/ });
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

  it('says where the device stands and, once, how it is heard, and leads back to Steuerung of its place', async () => {
    await draw();

    expect(screen.getByRole('link', { name: 'Back to Control' })).toHaveAttribute('href', '/control?space=space-1');
    expect(screen.getByRole('link', { name: 'Tent 1' })).toHaveAttribute('href', '/spaces/space-1');
    // How it is heard is the pill's to say: the line under the name does not say it a second time, in a second word.
    expect(pill()).toBe('live');
    expect(screen.getByRole('link', { name: 'Tent 1' }).closest('p')).toHaveTextContent(/^Tent 1$/);
    expect(screen.queryByText(/connected/)).not.toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { name: /^Controller\s·\s\w{4}$/ })).toBeInTheDocument();
    cleanup();

    await draw('/devices/device-2', 'East tent');
  });

  /** The card under Steuerung tells a device from the others standing in its place, and the page it opens is headed the same. */
  it('is headed as its card names it: one of its kind standing in another place adds no scrap of an id', async () => {
    wire.devices = [controller({}), controller({ id: 'device-2', spaceId: 'space-2' })];

    await draw('/devices/device-1', 'Controller');
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

    await waitFor(() => expect(pill()).toBe('live'));
    expect(screen.queryByText(/^Offline since/)).not.toBeInTheDocument();
  });

  it('says a device that was never heard is waiting for its first values, and offers it neither a window nor a restart', async () => {
    wire.devices = [controller({ state: { lastSeenAt: null } })];
    await draw();

    expect(screen.getByText('waiting for first values')).toBeInTheDocument();
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

    /** A device that was never heard reports no build and installs none: the rollout's target is not an update under way. */
    it('says of a device that never reported that no firmware is being installed', async () => {
      builds(BUILD, NEWER);
      wire.devices = [controller({ firmware: { channel: 'stable', targetId: NEWER.id }, state: { lastSeenAt: null, firmwareId: null } })];
      await draw();

      expect(await screen.findByText(/version not known/i)).toBeInTheDocument();
      expect(screen.queryByText(/New firmware/)).toBeNull();
    });

    it('switches automatic updates on the stable channel, re-sending the build it is pinned to, and says what holds now', async () => {
      wire.devices = [controller({ firmware: { channel: 'manual', targetId: 'fw-old' } })];
      vi.mocked(api.patch).mockImplementation((_path, body) => Promise.resolve({ ...wire.devices[0], ...(body as object) }) as never);
      await draw();

      const toggle = screen.getByRole('switch', { name: 'Update automatically' });
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      // Switched off there is no channel to choose, only the version to install by hand.
      expect(screen.queryByRole('combobox', { name: 'Update channel' })).not.toBeInTheDocument();
      fireEvent.click(toggle);

      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { firmware: { channel: 'stable', targetId: 'fw-old' } }));
      await waitFor(() => expect(said()).toEqual(['Automatic updates on · stable versions']));
      // Taken back, the device is on no channel again.
      await told[0].undo!();
      expect(api.patch).toHaveBeenLastCalledWith('/devices/device-1', { firmware: { channel: 'manual', targetId: 'fw-old' } });
    });

    /**
     * A control disabled while its write is on its way drops the focus, which
     * then lands on the (i) beside it - and that opened by itself. So nothing
     * is disabled: the change shows at once and a second one waits.
     */
    it('shows a change at once, keeps the control that was used in reach and opens no explanation by itself', async () => {
      wire.devices = [controller({ classId: 'class-1', firmware: { channel: 'stable', targetId: null } })];
      let answerWrite: (device: Device) => void = () => undefined;
      vi.mocked(api.patch).mockImplementation(() => new Promise<Device>(resolve => (answerWrite = resolve)) as never);
      await draw();

      const toggle = screen.getByRole('switch', { name: 'Update automatically' });
      toggle.focus();
      fireEvent.click(toggle);

      await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
      expect(api.patch).toHaveBeenCalledTimes(1);
      expect(toggle).toBeEnabled();
      expect(toggle).toHaveFocus();
      // A second tap while the first is on its way sends nothing.
      fireEvent.click(toggle);
      expect(api.patch).toHaveBeenCalledTimes(1);

      answerWrite({ ...wire.devices[0], firmware: { channel: 'manual', targetId: null } });
      await waitFor(() => expect(said()).toEqual(['Automatic updates off']));
      expect(toggle).toHaveFocus();
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      // Nothing is explained beside the controls: what they mean is behind their (i).
      expect(screen.queryByText(/the device stays on its version|Only released versions/)).not.toBeInTheDocument();
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
      // On a release channel there is no version to pick: the channel decides it.
      expect(screen.queryByRole('combobox', { name: 'Firmware version' })).not.toBeInTheDocument();
      fireEvent.change(channel, { target: { value: 'beta' } });

      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1', { firmware: { channel: 'beta', targetId: null } }));
      expect(channel).toBeEnabled();
      await waitFor(() => expect(said()).toEqual(['Automatic updates on · beta too']));
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
      // The sheet goes and the toast says what was asked of the device - not that it took it, and with nothing to take back.
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(told).toEqual([
        { label: 'Update to e4f5a6b asked for · Controller restarts with it', undo: null, from: expect.stringMatching(/^firmware-/) },
      ]);
    });

    /**
     * "Newer firmware of 15 Sep" beside a build "from 15 Sep" told nobody which is which: builds of one day carry
     * their hour, which stands where the year stood while the year is this one.
     */
    it('tells two builds of one day apart by their hour, on the card, on the update it offers and in the list', async () => {
      // Twenty minutes apart at an hour that is midnight in no zone, so the two share their day wherever this runs.
      const [first, second] = [
        { ...BUILD, createdAt: '2026-09-15T13:35:00.000Z' },
        { ...NEWER, createdAt: '2026-09-15T13:55:00.000Z' },
      ];
      wire.devices = [controller({ classId: 'class-1', firmware: { channel: 'manual', targetId: null }, state: { firmwareId: first.id } })];
      builds(first, second);
      await draw();

      // The card's two lines, each with the hour that tells it from the other.
      const WHEN = /1[56] Sep \d\d:\d\d/;
      const [running] = (await screen.findByText(new RegExp(`^from ${WHEN.source}$`))).textContent!.match(WHEN)!;
      const [offered] = screen.getByText(new RegExp(`^Newer firmware of ${WHEN.source} is available$`)).textContent!.match(WHEN)!;
      expect(offered).not.toBe(running);
      const list = screen.getByRole('combobox', { name: 'Firmware version' });
      await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(3));
      expect(
        within(list)
          .getAllByRole('option')
          .map(option => option.textContent),
      ).toEqual(['Pick a build …', `e4f5a6b · ${offered} · current Stable`, `a1b2c3d · ${running} · running · was stable`]);
      // Two builds of one day of another year keep that year, and a build alone on its day is named by the day.
      const [early, late, alone] = ['2025-03-03T10:02:00.000Z', '2025-03-03T16:30:00.000Z', '2025-03-04T16:30:00.000Z'].map((createdAt, at) => ({
        ...BUILD,
        id: `fw-${at}`,
        createdAt,
      })) as DeviceFirmware[];
      expect([early, late, alone].map(one => buildDay(one, [early, late, alone], 'UTC'))).toEqual([
        '3 Mar 2025 10:02',
        '3 Mar 2025 16:30',
        '4 Mar 2025',
      ]);
      cleanup();

      // Steuerung's card offers the same build under its own button, which names it the same way.
      drawAt(<UpdateButton device={wire.devices[0]} offline={false} />);
      expect(await screen.findByRole('button', { name: `Update of ${offered}` })).toBeInTheDocument();
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

      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'reboot' }));
      // Heard, the sheet goes and the toast says so; a restart is not taken back.
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(told).toEqual([{ label: 'Restart asked for · Fridge module will be back in a moment', undo: null }]);
    });

    it('keeps the question open and says so where the device was not there to hear the restart', async () => {
      vi.mocked(api.post).mockResolvedValue({ publishedAt: NOW.toISO(), deviceOnline: false } as never);
      wire.devices = [fridge()];
      await draw('/devices/device-1', 'Fridge module');
      fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
      const asked = await screen.findByRole('dialog', { name: 'Restart Fridge module?' });
      fireEvent.click(within(asked).getByRole('button', { name: 'Restart now' }));

      expect(await within(asked).findByText(/could not be reached just now and most likely did not get the command/)).toBeInTheDocument();
      expect(told).toEqual([]);
    });

    it('starts a quarter of an hour of maintenance on this device with one tap, says until when, and ends it again when taken back', async () => {
      wire.devices = [fridge()];
      await draw('/devices/device-1', 'Fridge module');
      const start = screen.getByRole('button', { name: 'Maintenance · 15 min' });
      start.focus();
      fireEvent.click(start);

      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 900 }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      // The button that was tapped is not disabled under the hand while the command is on its way.
      expect(start).toBeEnabled();
      await waitFor(() => expect(said()).toEqual([expect.stringMatching(/^Maintenance started · until \d\d:\d\d$/)]));

      await told[0].undo!();
      expect(api.post).toHaveBeenLastCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 0 });
    });

    it('says a window is standing, until when, and offers its end and another quarter of an hour', async () => {
      wire.devices = [fridge({ maintenanceUntil: NOW.plus({ minutes: 8 }).toISO()! })];
      await draw('/devices/device-1', 'Fridge module');

      expect(screen.getByText(/^Maintenance until \d\d:\d\d/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Extend' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'End' }));

      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 0 }));
      await waitFor(() => expect(said()).toEqual(['Maintenance ended']));
      // Taken back, the window stands until the minute it stood until.
      await told[0].undo!();
      expect(api.post).toHaveBeenLastCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 480 });
    });

    it('says until when a window holds once it was extended, and puts it back as it stood when taken back', async () => {
      wire.devices = [fridge({ maintenanceUntil: NOW.plus({ minutes: 8 }).toISO()! })];
      await draw('/devices/device-1', 'Fridge module');
      fireEvent.click(screen.getByRole('button', { name: 'Extend' }));

      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 23 * 60 }));
      await waitFor(() => expect(said()).toEqual([expect.stringMatching(/^Maintenance extended · until \d\d:\d\d$/)]));
      await told[0].undo!();
      expect(api.post).toHaveBeenLastCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 480 });
    });

    it('says nothing was started where the device was not there to hear it', async () => {
      vi.mocked(api.post).mockResolvedValue({ publishedAt: NOW.toISO(), deviceOnline: false } as never);
      wire.devices = [fridge()];
      await draw('/devices/device-1', 'Fridge module');
      fireEvent.click(screen.getByRole('button', { name: 'Maintenance · 15 min' }));

      expect(await screen.findByText('A device could not be reached just now and may not have got the command.')).toBeInTheDocument();
      expect(told).toEqual([]);
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
      // The one danger style: filled in the alarm's red, never the brand green of a primary action.
      expect(within(asked).getByRole('button', { name: 'Switch off' }).className).toMatch(/dangerFilled/);

      fireEvent.click(within(asked).getByRole('button', { name: 'Switch off' }));

      // Answered as every setting of a device is: the sheet goes, the toast says it is stored and that the plan paused.
      await waitFor(() => expect(said()).toEqual(['Control off saved · plan paused']));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(moves).toEqual([{ kind: 'pause', reason: 'Control was switched off.' }]);
      expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { control: false } });

      // Taken back, control is on again and the plan it paused goes on.
      await told[0].undo!();
      expect(api.patch).toHaveBeenLastCalledWith('/devices/device-1/configuration', { set: { control: true } });
      expect(moves).toEqual([{ kind: 'pause', reason: 'Control was switched off.' }, { kind: 'resume' }]);
    });

    it('says of a device that is not heard that the switch is saved and not with the device yet', async () => {
      wire.devices = [{ ...regulating(), state: { ...regulating().state, lastSeenAt: NOW.minus({ minutes: 25 }).toISO()! } }];
      vi.mocked(api.patch).mockResolvedValue(regulating({ running: false }) as never);
      await draw('/devices/device-1', 'Fridge module');
      fireEvent.click(screen.getByRole('button', { name: 'Switch control off' }));
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Switch control off?' })).getByRole('button', { name: 'Switch off' }));

      await waitFor(() => expect(said()).toEqual(['Control off saved, not with the device yet']));
    });

    it('says that control is off, switches it back on with one tap, and says that it did', async () => {
      wire.devices = [regulating({ running: false })];
      vi.mocked(api.patch).mockResolvedValue(regulating() as never);
      await draw('/devices/device-1', 'Fridge module');

      expect(screen.getByText('Control off')).toBeInTheDocument();
      // One control switches it on, the one Steuerung has: no second row for it among the device's rows.
      // One sentence, listing what stands still as the question that switched it off listed it; the rest is behind the help.
      expect(screen.getByText('Control off.').closest('p')).toHaveTextContent(
        /^Control off\. Heater, compressor, light, CO₂ valve and fans are off; the device only measures\.$/,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Switch control on' }));

      await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/devices/device-1/configuration', { set: { control: true } }));
      await waitFor(() => expect(said()).toEqual(['Control on saved']));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    /** What the row under the device's rows said of the tap, the one control says: the plan the switch paused goes on with it. */
    it('says that the plan paused with the switch goes on, and sets it going', async () => {
      planState.status = 'paused';
      planState.pauseReason = 'Control was switched off.';
      wire.devices = [regulating({ running: false })];
      vi.mocked(api.patch).mockResolvedValue(regulating() as never);
      await draw('/devices/device-1', 'Fridge module');

      fireEvent.click(screen.getByRole('button', { name: 'Switch control on' }));

      await waitFor(() => expect(moves).toEqual([{ kind: 'resume' }]));
      // Said in the answer, not in a second sentence of the note.
      await waitFor(() => expect(said()).toEqual(['Control on saved · plan running again']));
    });

    /**
     * Switched off while nobody heard it, the device goes on regulating: off is a setting it has not been handed,
     * and the page says so in Steuerung's words - not that control is off, which is what the device will do later.
     */
    it('says control switched off for a silent device as stored and not with the device yet, in its head and over the switch', async () => {
      const silent = { ...regulating({ running: false }), state: { ...regulating().state, lastSeenAt: NOW.minus({ minutes: 25 }).toISO()! } };
      wire.devices = [silent];
      wire.pending = {
        since: silent.state.lastSeenAt!,
        settings: [{ field: 'workmode', held: 'small', savedAt: NOW.minus({ minutes: 9 }).toISO()! }],
      };
      await draw('/devices/device-1', 'Fridge module');

      const stored = /Control off saved at \d\d:\d\d, not with the device yet$/;
      const head = await screen.findByText(stored, { selector: 'p strong' });
      expect(head.closest('p')).toHaveTextContent(/^Tent 1 · Control off saved at/);
      // The block Steuerung draws for it: since when it is stored, that the device goes on, and the one tap.
      const block = screen.getByRole('button', { name: 'Switch control on' }).closest('[data-tone="warn"]') as HTMLElement;
      expect(block).toHaveTextContent(
        /Control off saved at \d\d:\d\d, not with the device yet: Fridge module goes on controlling until it is back online\./,
      );
      expect(screen.queryByText('Control off')).not.toBeInTheDocument();
    });

    /** Off that the device was there to hear, or has been handed since, is what it does: said plainly, and on waits for it. */
    it('says plainly that control is off once nothing of it is waiting for the device', async () => {
      wire.devices = [{ ...regulating({ running: false }), state: { ...regulating().state, lastSeenAt: NOW.minus({ minutes: 25 }).toISO()! } }];
      wire.pending = {
        since: NOW.minus({ minutes: 25 }).toISO()!,
        settings: [{ field: 'day.temperature', held: 24, savedAt: NOW.minus({ minutes: 9 }).toISO()! }],
      };
      await draw('/devices/device-1', 'Fridge module');

      expect(screen.getByText('Control off')).toBeInTheDocument();
      // Switched on, the answer says it is not with the device yet: the note itself stays one sentence.
      expect(screen.getByText('Control off.').closest('p')).toHaveTextContent(/^Control off\. [^.]+\.$/);
      expect(screen.queryByText(/not with the device yet/)).not.toBeInTheDocument();
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

      expect(screen.getByRole('button', { name: /^Rename or move/ })).toHaveTextContent('Tent 1');
      // The sockets themselves are listed where they are switched, under Steuerung: here they are counted, and another is paired.
      await waitFor(() => expect(screen.getByRole('button', { name: /^Pair a socket/ })).toHaveTextContent('1 paired'));
      expect(screen.queryByRole('link', { name: /Heater/ })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^Advanced/ })).toHaveAttribute('href', '/devices/device-1/advanced');
      expect(screen.getByRole('link', { name: /^Technical details/ })).toHaveAttribute('href', '/devices/device-1/details');
      expect(screen.getByRole('button', { name: 'Give the device up' })).toBeInTheDocument();
    });

    it('keeps giving the device up for its owner alone', async () => {
      wire.youMay = 'manage';
      await draw();

      // Where a device stands is asked of its owner alone: whoever manages it is offered its name.
      expect(screen.getByRole('button', { name: /^Rename\s?Tent 1$/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Give the device up' })).not.toBeInTheDocument();
    });

    /** What may be done is the device's answer and not the screen's: the same reader owns one tent and only writes lines in the next. */
    it('offers somebody who may only write lines nothing to change, and leads them back to the place', async () => {
      wire.youMay = 'log';
      wire.devices = [controller({ configuration: { lights: LIGHTS } })];
      await draw();

      expect(screen.getByRole('link', { name: 'Back: Tent 1' })).toHaveAttribute('href', '/spaces/space-1');
      for (const name of [/^Rename or move/, 'Restart', 'Maintenance · 15 min', 'Give the device up']) {
        expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
      }
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /^Advanced/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Pair a socket/ })).not.toBeInTheDocument();
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
      expect(screen.getByRole('link', { name: /This device’s curves/ })).toHaveAttribute('href', '/timeline?space=space-1&device=device-1');
    });

    /** Everything of a second device is one tap from its page, and nothing of it is built a second time. */
    it('leads another device of the place to its own part of the pages behind Steuerung´s rows, each only where it has something there', async () => {
      place.leads = false;
      wire.devices = [controller({ type: 'fridge', configuration: { workmode: 'small', day: { temperature: 25, humidity: 60 } }, control: CONTROL })];
      wire.sockets = [socket()];
      await draw('/devices/device-1', 'Fridge module');

      const rows = within(screen.getByRole('navigation', { name: 'Under Control' }));
      await waitFor(() => expect(rows.getAllByRole('link')).toHaveLength(5));
      for (const [name, page] of [
        [/^Alarms/, 'alarms'],
        [/^Grow plan/, 'plan'],
        [/^Outputs/, 'outputs'],
        [/^Operating mode/, 'mode'],
      ] as const) {
        expect(rows.getByRole('link', { name })).toHaveAttribute('href', `/control/${page}?space=space-1&device=device-1`);
      }
      // Each row says what stands behind it, as Steuerung's own rows do.
      expect(rows.getByRole('link', { name: /^Grow plan/ })).toHaveTextContent('off');
      expect(rows.getByRole('link', { name: /^Outputs/ })).toHaveTextContent('Heater off');
    });

    it('offers a Plantalytix Socket no plan, no outputs and no mode, and an AIR fan no outputs that would only lead back', async () => {
      place.leads = false;
      // Neither build announces a light output of its own, which is what would give it one under Ausgänge.
      wire.capabilities = { ...CAPABILITIES, lightOverride: false };
      wire.devices = [controller({ type: 'plug', control: null, configuration: { mode: 2 } })];
      await draw('/devices/device-1', 'Plantalytix Socket');
      const rows = () => within(screen.getByRole('navigation', { name: 'Under Control' }));

      expect(await rows().findByRole('link', { name: /^Alarms/ })).toBeInTheDocument();
      for (const name of [/^Grow plan/, /^Outputs/, /^Operating mode/]) expect(rows().queryByRole('link', { name })).not.toBeInTheDocument();
      cleanup();

      wire.devices = [controller({ type: 'fan', control: null, configuration: { mode: 0, day: { speed: 70 }, night: { speed: 40 } } })];
      await draw('/devices/device-1', 'Fan');
      expect(await rows().findByRole('link', { name: /^Alarms/ })).toBeInTheDocument();
      expect(rows().queryByRole('link', { name: /^Outputs/ })).not.toBeInTheDocument();
    });

    /** What a device has under Ausgänge is asked as that page asks it, so a lamp module is led to the hold of its lamp. */
    it('leads a LIGHT to its lamp under Ausgänge, and says there what this browser holds it at', async () => {
      place.leads = false;
      wire.devices = [controller({ type: 'light', control: null, configuration: { limit: 80, lightsOn: 0, lightsOff: 43200 } })];
      localStorage.setItem('terp.lightHold.device-1', JSON.stringify({ state: 'off', until: NOW.plus({ minutes: 30 }).toISO() }));
      await draw('/devices/device-1', 'Light');

      const outputs = await within(screen.getByRole('navigation', { name: 'Under Control' })).findByRole('link', { name: /^Outputs/ });
      expect(outputs).toHaveAttribute('href', '/control/outputs?space=space-1&device=device-1');
      expect(outputs).toHaveTextContent(/held off/);
    });

    it('offers somebody who may not steer the curves alone', async () => {
      place.leads = false;
      wire.youMay = 'log';
      await draw();

      expect(within(screen.getByRole('navigation', { name: 'Under Control' })).getAllByRole('link')).toHaveLength(1);
    });
  });

  describe('the pages under it', () => {
    /** The list of a device's sockets went: they stand under Steuerung and under Ausgänge, and a third list was one too many. */
    it('has no page listing the device´s sockets: that address is the device´s own page', async () => {
      wire.sockets = [socket()];
      await draw('/devices/device-1/sockets');

      expect(screen.getByRole('button', { name: /^Rename/ })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Heater/ })).not.toBeInTheDocument();
    });

    it('holds what few growers set on a page of its own, without what has its place elsewhere', async () => {
      wire.devices = [controller({ ownerId: 'user-1', type: 'fridge', classId: 'class-1', configuration: { workmode: 'small', lights: LIGHTS } })];
      await draw('/devices/device-1/advanced', 'Advanced');

      expect(screen.getByText('Sunrise')).toBeInTheDocument();
      // The work mode and the fans are Steuerung's, the channel is the firmware card's, giving it up a row of its own.
      for (const elsewhere of ['Operating mode', 'Update channel', 'Give the device up', 'Clip fan', 'Pair a socket']) {
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

      // A page all the same: a heading that titles the window, the sentence, and a way on.
      expect(await screen.findByRole('heading', { level: 1, name: 'Device' })).toBeInTheDocument();
      expect(screen.getByText('This device cannot be opened.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });
  });
});
