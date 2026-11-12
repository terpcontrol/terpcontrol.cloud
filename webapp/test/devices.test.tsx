import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Camera, Device, DeviceCapabilities, DeviceConfiguration, PlanTransition, Socket } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { cameraFreshness } from '@/screens/devices/cameras';
import { drawDevicePages } from './device-pages';
import { deviceWith } from './fixtures';
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

const LIGHTS = { sunrise: 15, sunset: 15, limit: 80 };

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
      expect(screen.getByRole('link', { name: /This device's curves/ })).toHaveAttribute('href', '/timeline?space=space-1&device=device-1');
    });
  });

  describe('the pages under it', () => {
    /** The list of a device's sockets went: they stand under Steuerung and under Ausgänge, and a third list was one too many. */
    it('has no page listing the device´s sockets: that address is the device´s own page', async () => {
      wire.sockets = [socket()];
      await draw('/devices/device-1/sockets');

      expect(screen.getByRole('button', { name: /^Rename or move/ })).toBeInTheDocument();
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

      expect(await screen.findByText('This device cannot be opened.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });
  });
});
