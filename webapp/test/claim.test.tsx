import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { useLocation } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DeviceCapabilities, DeviceClaimResult, GrowListItem, Me, NotificationSettings, Space } from '@fg2/shared-types/v1';
import { GERMINATION_CHOICES } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { api } from '@/api/client';
import { expectLayout, takeExpected } from '@/api/layers';
import { ApiError } from '@/api/problem';
import { Claim } from '@/screens/claim/Claim';
import { deviceWith } from './fixtures';
import { drawAt } from './harness';
import { meWith, spaceWhere } from './session';
import { translate } from './translations';

/**
 * Adding a device: what the steps ask and how many of them there are, what
 * each answer puts on the wire, what a code the server will not take says, and
 * what the demo is offered.
 *
 * Where the device hangs is asked once and only of an account that has a place
 * of its own to hang it in; a place's name, kind and room are the place's own
 * page and not this flow's.
 *
 * Every request goes through the app's own client, mocked at that one seam, so
 * what is asserted is what would leave the browser: a claim carries exactly the
 * code that was read, a device sent to a place that exists is moved there and
 * the place its claim made is ended, and a stage is applied to the place the
 * device stands in and nothing else.
 */
vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const who = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (who.demo ? ON_THE_DEMO : SIGNED_IN) };
});

/** The age on the first step is counted from the server's instant, so the clock is a fixture. */
const NOW = DateTime.fromISO('2026-09-22T10:00:00.000Z');

const CAPABILITIES: DeviceCapabilities = {
  socketOverride: true,
  socketTimer: true,
  lightOverride: true,
  roles: ['heater', 'light'],
  pulseSeconds: {},
};

const device: Device = deviceWith({
  id: 'sim-controller-7f3a',
  createdAt: NOW.minus({ days: 2 }).toISO()!,
  classId: 'class-1',
  spaceId: 'space-new',
  name: 'Terp Controller',
  settings: { vpdLeafOffsetDay: 0, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
  state: {
    lastSeenAt: NOW.minus({ seconds: 20 }).toISO()!,
    claimedAt: NOW.toISO()!,
    firmwareId: 'build-uuid',
    hardware: { firmware_version: '2.4.1', webcam_did: 'none' },
    socketsReportedAt: NOW.toISO()!,
  },
});

// The place the claim makes. It is in the list from the start, because nothing reads the list before the claim
// that would tell the difference, and a device is moved into a place by managing it, so every place here says so.
const space: Space = spaceWhere('own', { id: 'space-new', kind: 'other', name: 'Terp Controller' });

/** A tent the account already had before this device was added. */
const mother: Space = spaceWhere('own', { id: 'space-mother', name: 'Mother tent' });

/** Somebody else's tent, which the account was let into and may run. */
const clubTent: Space = spaceWhere('manage', { id: 'space-host', name: 'Club tent' });

/** An AIR fan, which makes no climate of its own: it hangs in the air of a place. */
const fan: Device = { ...device, id: 'sim-fan-1', type: 'fan', name: null };

/** The build the device reports, which is a uuid until the build list gives it a name. */
// As production holds them: the name is the device class, and the version is
// what the build container stamped - which is the half that says which build.
const BUILD = { id: 'build-uuid', createdAt: NOW.toISO()!, classId: 'class-1', name: 'controller', version: '082eda0-stable', wasStable: true };

/** Day 35 of a flowering run in a tent of its own, which is what a move out of it would cost. */
const spring: GrowListItem = {
  id: 'grow-1',
  ownerId: 'user-1',
  name: 'Spring run',
  endedAt: null,
  placements: [{ id: 'placement-1', spaceId: 'space-other', startedAt: NOW.minus({ days: 35 }).toISO()!, endedAt: null, plantIds: null }],
  summary: { locations: [{ spaceId: 'space-other', plantIds: [] }] },
} as unknown as GrowListItem;

/** No way to reach the account at all, which is what every account starts with. */
const UNREACHED: NotificationSettings = {
  channels: { email: null, telegram: null, webhook: null },
  routing: { alerts: [], warnings: [], tasks: [], plan: [], weekly_timelapse: [] },
  quietHours: null,
  mutedUntil: null,
};

/** The account with nothing but the ways it is reached changed. */
const meReaching = (notifications: NotificationSettings): Me =>
  meWith({ email: 'grower@example.org', preferences: { ...meWith().preferences, timezone: 'UTC', notifyLaterUntil: null }, notifications });

const state = {
  spaces: [] as Space[],
  grows: [] as GrowListItem[],
  me: meReaching(UNREACHED),
  /** Every device of the account, as the device list answers it. */
  devices: [device],
  /** What the server answers a claim with. */
  claim: { device, spaceCreated: true } as DeviceClaimResult,
  /** Where a move has put a device, by its id: every read after the move answers that. */
  hangs: {} as Record<string, string>,
};

const standing = (one: Device): Device => ({ ...one, spaceId: state.hangs[one.id] ?? one.spaceId });

const answers = (path: string) => {
  if (path === '/devices/sim-controller-7f3a') return standing(device);
  if (path === '/devices') return { items: state.devices.map(standing), nextCursor: null };
  if (path === '/devices/sim-fan-1') return standing(fan);
  if (path === '/devices/sim-fan-1/sockets') return { items: [], nextCursor: null, capabilities: CAPABILITIES };
  if (path === '/devices/sim-plug-1') return { ...device, id: 'sim-plug-1', type: 'plug' };
  if (path === '/devices/sim-plug-1/sockets') return { items: [], nextCursor: null, capabilities: CAPABILITIES };
  if (path === '/devices/sim-light-1') return { ...device, id: 'sim-light-1', type: 'light' };
  if (path === '/devices/sim-light-1/sockets') return { items: [], nextCursor: null, capabilities: CAPABILITIES };
  if (path === '/devices/sim-controller-7f3a/sockets') return { items: [], nextCursor: null, capabilities: CAPABILITIES };
  if (path === '/devices/sim-controller-7f3a/firmwares') return { items: [BUILD], nextCursor: null };
  if (path === '/spaces') return { items: state.spaces, nextCursor: null };
  if (path === '/grows') return { items: state.grows, nextCursor: null };
  if (path === '/me') return state.me;
  throw new Error(`nothing mocked for ${path}`);
};

/** Where the flow has put itself, because what survives a reload is the address and nothing else. */
function Watch() {
  const location = useLocation();

  return <span data-testid="address">{`${location.pathname}${location.search}`}</span>;
}

const address = () => screen.getByTestId('address').textContent;

const draw = (at = '/claim') =>
  drawAt(
    <>
      <Claim />
      <Watch />
    </>,
    { at },
  );

/** The code typed and sent, which is as far as a test goes that is about what the claim is asked next. */
const claim = (at?: string) => {
  const drawn = draw(at);
  fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: 'ABCD1234' } });
  fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

  return drawn;
};

/** The step of the list that is open, by its heading. */
const openStep = () => document.querySelector('[aria-current="step"] h2');

/** The screen with a device claimed on it, which is every step after the first. */
const drawClaimed = async () => {
  const drawn = claim();
  await screen.findByRole('heading', { level: 2, name: /Claimed/ });
  // The first device of an account is asked nothing about where it hangs: the next question is what it is doing.
  await waitFor(() => expect(openStep()).toHaveTextContent('What is it doing right now?'));

  return drawn;
};

/**
 * Every read and write answered, and what they answered drawn. It is what a
 * test waits for before it says that something is *not* asked: a screen that
 * has not heard about the account's places yet asks nothing either.
 */
const settled = async ({ client }: { client: QueryClient }) => {
  await waitFor(() => expect(client.isFetching() + client.isMutating()).toBe(0));
  // An answer reaches the screen one turn of the event loop after it reaches the client.
  await act(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
};

/** The page that asks where the device hangs, by its question. */
const hangQuestion = (type: string) => screen.findByRole('heading', { level: 1, name: `Where does the ${type} hang?` });

/** What that page offers, in the order it offers it. */
const offered = () => screen.getAllByRole('button', { name: /^(In |At a new place)/ }).map(one => one.firstElementChild?.textContent);

beforeAll(async () => {
  await translate();

  vi.useFakeTimers({ toFake: ['Date'] });
});

afterAll(() => vi.useRealTimers());

beforeEach(() => {
  vi.setSystemTime(NOW.toJSDate());
  who.demo = false;
  state.spaces = [space];
  state.grows = [];
  state.me = meReaching(UNREACHED);
  state.devices = [device];
  state.claim = { device, spaceCreated: true };
  state.hangs = {};
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.post).mockImplementation((path: string) =>
    path === '/devices/claims'
      ? (Promise.resolve(state.claim) as never)
      : path === '/me/email-alarms'
        ? (Promise.resolve(
            meReaching({
              ...UNREACHED,
              channels: { ...UNREACHED.channels, email: 'grower@example.org' },
              routing: { ...UNREACHED.routing, alerts: ['email'] },
            }),
          ) as never)
        : (Promise.resolve({
            spaceId: 'space-new',
            stage: 'flowering',
            preset: null,
            appliedAt: NOW.toISO(),
            deviceIds: ['sim-controller-7f3a'],
            growId: null,
            phaseId: null,
            growDecisionNeeded: true,
            decisions: ['start_grow', 'move_grow', 'climate_only'],
            planEffect: 'none',
          }) as never),
  );
  vi.mocked(api.patch).mockResolvedValue({ ...space, name: 'Tent 1' } as never);
  // The two writes of hanging a device somewhere else, as the server takes them: the device stands in the place
  // it was sent to from then on, and an ended place is gone from the list.
  vi.mocked(api.put).mockImplementation((path: string) => {
    const [, spaceId, deviceId] = /^\/spaces\/([^/]+)\/devices\/([^/]+)$/.exec(path) ?? [];
    if (!deviceId) throw new Error(`nothing mocked for PUT ${path}`);
    state.hangs[deviceId] = spaceId;

    return Promise.resolve(answers(`/devices/${deviceId}`)) as never;
  });
  vi.mocked(api.delete).mockImplementation((path: string) => {
    state.spaces = state.spaces.filter(one => path !== `/spaces/${one.id}`);

    return Promise.resolve(undefined) as never;
  });
});

describe('adding a device', () => {
  it('asks for the code first and offers nothing to skip ahead with', () => {
    draw();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add a device · step 1 of 5$/);
    expect(screen.getByRole('textbox', { name: 'Claim code' })).toHaveValue('');
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    // The code is all that is asked: where the device hangs depends on what it is, which only the code says.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Stop adding' })).toBeEnabled();
  });

  it('stops adding from the head: back to Start before anything is claimed, into the place of the device after', async () => {
    const { unmount } = draw();
    fireEvent.click(screen.getByRole('button', { name: 'Stop adding' }));
    expect(address()).toBe('/');
    unmount();

    await drawClaimed();
    fireEvent.click(screen.getByRole('button', { name: 'Stop adding' }));
    expect(address()).toBe('/spaces/space-new');
  });

  it('folds the way across from the old cloud under the code it asks for', () => {
    draw();
    expect(screen.getByText('Coming from the old Fridge Grow 2.0 / Plantalytix cloud?').closest('details')).not.toHaveAttribute('open');
  });

  it('takes the code the empty home already read', () => {
    draw('/claim?code=ABCD1234');

    expect(screen.getByRole('textbox', { name: 'Claim code' })).toHaveValue('ABCD1234');
  });

  it('claims exactly the code that was read', async () => {
    draw();
    fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: ' abcd1234 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/claims', { code: 'abcd1234' }));
  });

  it('reports what the device itself says, names it in the head and opens the next question', async () => {
    await drawClaimed();

    expect(screen.getByRole('heading', { level: 2, name: /Claimed/ })).toHaveTextContent('Claimed · Terp Controller · 7F3A');
    expect(screen.getByText(/online 20 s ago/)).toHaveTextContent('online 20 s ago · firmware 082eda0-stable · 0 sockets · Cam: none');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add Controller · step 2 of 5$/);
    expect(screen.getByRole('button', { name: /Next/ })).toHaveTextContent('Next · sockets and cam?');
  });

  it('draws every step the count names - the last one, which is a page of its own, too - and says the rest can wait', async () => {
    await drawClaimed();

    const steps = screen.getAllByRole('heading', { level: 2 }).map(one => one.textContent);
    expect(steps).toEqual([
      'Claimed · Terp Controller · 7F3A',
      'What is it doing right now?',
      'Sockets and cam',
      'How will you hear about problems?',
      'What grows here?',
    ]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/of 5$/);
    expect(
      screen.getByText('The preset can be changed later from Control, the sockets and the cam with the devices there, notifications from Me.'),
    ).toBeInTheDocument();
  });

  /**
   * The step named two things and sent both to a tent's Devices tab, which
   * pairs neither: a socket has no control there at all, and the chip that
   * pairs a cam is drawn only on the account-wide list. The cam is the half the
   * app can help with, so that is the half it links.
   */
  it('sends the last step to the screen that really pairs a cam, and says where a socket is paired', async () => {
    draw('/claim?device=sim-controller-7f3a&at=3');

    expect(await screen.findByRole('link', { name: 'Pair a Terp Cam' })).toHaveAttribute('href', '/cameras/add');
    expect(screen.getByText(/A Terp Control socket is paired on the device itself – press the button, then Smart Sockets/)).toBeInTheDocument();
    expect(screen.getByText(/A Tasmota socket you pair later under Control › your device › Pair a socket/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Devices tab/ })).not.toBeInTheDocument();
  });

  /**
   * A Smart Socket and an AIR fan pair a Terp Cam at their own display, as a
   * controller does, and pair no sockets. The step asked a socket's owner
   * nothing at all, so the one place a new owner is walked through the
   * hardware left out the cam they can have.
   */
  it('asks a smart socket about the cam it can pair and nothing about sockets', async () => {
    draw('/claim?device=sim-plug-1&at=2');

    expect(await screen.findByRole('button', { name: 'Next · cam?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add Plantalytix Socket · step 2 of 5');
    // What the first step says it found names the cam and no sockets a plug cannot have.
    expect(screen.getByText(/Cam: none/)).toBeInTheDocument();
    expect(screen.queryByText(/0 sockets/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next · cam?' }));

    expect(await screen.findByRole('link', { name: 'Pair a Terp Cam' })).toHaveAttribute('href', '/cameras/add');
    expect(screen.getByRole('heading', { level: 2, name: 'Cam' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Sockets and cam' })).not.toBeInTheDocument();
    expect(screen.queryByText('Reported sockets')).not.toBeInTheDocument();
    expect(screen.queryByText(/A Terp Control socket is paired on the device itself/)).not.toBeInTheDocument();
    expect(screen.getByText('It can wait: the device works without a cam too.')).toBeInTheDocument();
  });

  it('asks a light nothing about sockets and a cam it cannot have, and counts four steps', async () => {
    draw('/claim?device=sim-light-1&at=2');

    expect(await screen.findByRole('button', { name: 'Next · notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Sockets and cam' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Cam' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add Light · step 2 of 4');
    expect(screen.queryByText(/Cam: none|0 sockets/)).not.toBeInTheDocument();
  });

  /**
   * A new device arms the offline rule the cloud keeps, and a new account has
   * no way to be told about it. The flow asks about that with the one tap that
   * mails critical alarms to the address the account signs in with - written
   * by the server from the tap alone, so nothing of the address is sent.
   */
  it('asks how alarms will reach anybody, and mails critical ones to the login address in one tap', async () => {
    draw('/claim?device=sim-controller-7f3a&at=4');

    expect(await screen.findByRole('heading', { level: 2, name: 'How will you hear about problems?' })).toBeInTheDocument();
    expect(await screen.findByText('to grower@example.org')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next · what grows?' })).toBeEnabled();
    // The bottom button stays the one green action of the screen.
    expect(screen.getByRole('button', { name: 'Notify me by e-mail' }).className).not.toMatch(/primary/);

    fireEvent.click(screen.getByRole('button', { name: 'Notify me by e-mail' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/me/email-alarms'));
    expect(await screen.findByText('Critical alarms now come by e-mail to grower@example.org.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change ›' })).toHaveAttribute('href', '/me/notifications');
  });

  /**
   * The diary is offered from the first day: setting a device up ends by
   * asking what grows there, on a page of its own. An answer starts the grow
   * and its phase and leaves the climate alone, which the step before set.
   */
  it('ends by asking what grows here, and an answer starts the grow and opens the place', async () => {
    vi.mocked(api.post).mockImplementation((path: string) => Promise.resolve(path === '/grows' ? { id: 'grow-new' } : {}) as never);
    draw('/claim?device=sim-controller-7f3a&at=4');
    fireEvent.click(await screen.findByRole('button', { name: 'Next · what grows?' }));

    const question = await screen.findByRole('heading', { level: 1, name: 'What grows in Terp Controller?' });
    expect(question).toHaveFocus();
    // On a page of its own the question is the heading, and the head's line stands above it.
    expect(screen.getByText('Add Controller · step 5 of 5')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toEqual([question]);
    expect(address()).toBe('/claim?device=sim-controller-7f3a&at=5');
    // The steps before are answered and written; this page asks its one question.
    expect(screen.queryByRole('heading', { level: 2, name: /Claimed/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Strain or name' }), { target: { value: 'Blue Dream' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Plants' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Veg' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/grows/grow-new/phases', expect.objectContaining({ stage: 'vegetative', preset: null })),
    );
    expect(api.post).toHaveBeenCalledWith(
      '/grows',
      expect.objectContaining({ name: 'Blue Dream', spaceId: 'space-new', plants: [{ strain: 'Blue Dream', count: 3 }], scheme: null }),
    );
    expect(api.post).not.toHaveBeenCalledWith('/spaces/space-new/preset-applications', expect.anything());
    await waitFor(() => expect(address()).toBe('/spaces/space-new'));
  });

  it('leaves the question for Start when it is skipped, writing nothing', async () => {
    draw('/claim?device=sim-controller-7f3a&at=5');

    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(address()).toBe('/spaces/space-new');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('opens the question on the stage the place was just put on', async () => {
    await drawClaimed();
    fireEvent.click(screen.getByRole('button', { name: 'Flower' }));
    fireEvent.click(screen.getByRole('button', { name: 'Put it on Flower' }));
    await screen.findByText('The targets went to 1 controller.');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Next/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Next · what grows?' }));

    await screen.findByRole('heading', { level: 1, name: /What grows in/ });
    expect(screen.getByRole('button', { name: 'Flower' })).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * The stage picked a step earlier lives in this page and is gone with a locked phone. What the device was set to
   * is not: picked up again, the question opens on the stage whose climate the device holds, never on germination
   * because nothing was at hand to say otherwise.
   */
  it('opens the question, picked up again later, on the stage the device was put on', async () => {
    const flowering = {
      ...device,
      control: { running: true, drying: false, mode: 'standard', energySaving: false },
      configuration: {
        daynight: { day: 6 * 3600, night: 18 * 3600 },
        day: { temperature: 25, humidity: 50 },
        night: { temperature: 20, humidity: 50 },
        co2: { target: 1000 },
        lights: { limit: 100 },
      },
    };
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices' ? { items: [flowering], nextCursor: null } : answers(path)) as never,
    );
    draw('/claim?device=sim-controller-7f3a&at=5');

    await screen.findByRole('heading', { level: 1, name: /What grows in/ });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Flower' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'Germination' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens it on growth where nothing says which stage the place is on', async () => {
    draw('/claim?device=sim-controller-7f3a&at=5');

    await screen.findByRole('heading', { level: 1, name: /What grows in/ });
    expect(screen.getByRole('button', { name: 'Veg' })).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * The grow the answer makes is read by this page too, and "a grow stands here" is what takes the question away.
   * It stays until its own form has been answered, so the list of steps does not flash up under a form still
   * sending, and the shell is told beforehand that the diary about to appear is setup´s own doing.
   */
  it('keeps the question on screen while its answer is on the way, and says the diary it brings is its own doing', async () => {
    let phaseWritten = () => {};
    vi.mocked(api.post).mockImplementation((path: string) => {
      if (path === '/grows') {
        state.grows = [{ ...spring, placements: [{ ...spring.placements[0], spaceId: 'space-new' }] } as GrowListItem];
        return Promise.resolve({ id: 'grow-new' }) as never;
      }
      return new Promise(resolve => (phaseWritten = () => resolve({}))) as never;
    });
    draw('/claim?device=sim-controller-7f3a&at=5');

    await screen.findByRole('heading', { level: 1, name: /What grows in/ });
    expect(takeExpected()).toEqual({ diary: true });
    expectLayout({ diary: true });
    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));

    // The grow exists and the place's grows have been read again; the phase is still on its way.
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/grows/grow-new/phases', expect.anything()));
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/grows').length).toBeGreaterThan(2));
    expect(screen.getByRole('heading', { level: 1, name: /What grows in/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /Claimed/ })).not.toBeInTheDocument();

    phaseWritten();
    await waitFor(() => expect(address()).toBe('/spaces/space-new'));
    // Leaving after a grow was started keeps the word; leaving without one would have taken it back.
    expect(takeExpected()).toEqual({ diary: true });
  });

  it('takes its word about the diary back when the question is left unanswered', async () => {
    draw('/claim?device=sim-controller-7f3a&at=5');

    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(address()).toBe('/spaces/space-new');
    expect(takeExpected()).toEqual({ diary: false });
  });

  it('does not ask what grows where a grow already stands, nor of an account that said no to the diary', async () => {
    state.me = { ...meReaching(UNREACHED), preferences: { ...meReaching(UNREACHED).preferences, diary: 'off' } };
    draw('/claim?device=sim-controller-7f3a&at=4');

    expect(await screen.findByRole('button', { name: 'Done · open the place' })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add Controller · step 4 of 4'));
  });

  /** A grow that already runs elsewhere is moved in rather than started again, and not on one tap. */
  it('offers to move a running grow here instead, in the sheet that says where it stands now', async () => {
    state.grows = [spring];
    state.spaces = [space, { ...space, id: 'space-other', name: 'Blue Dream tent' }];
    // Asked for the grows standing in the new place, the server answers none: Spring run stands in the other tent.
    vi.mocked(api.get).mockImplementation(
      (path: string, query?: unknown) =>
        Promise.resolve(
          path === '/grows' && (query as { spaceId?: string } | undefined)?.spaceId ? { items: [], nextCursor: null } : answers(path),
        ) as never,
    );
    draw('/claim?device=sim-controller-7f3a&at=5');

    fireEvent.click(await screen.findByRole('button', { name: 'Or move a grow here' }));

    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByRole('button', { name: 'Spring run · Blue Dream tent' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('says how alarms already reach an account that has a way, and offers nothing to tap', async () => {
    state.me = meReaching({
      ...UNREACHED,
      channels: { ...UNREACHED.channels, telegram: { chatId: '1', linkedAt: NOW.toISO()! } },
      routing: { ...UNREACHED.routing, alerts: ['telegram'] },
    });
    draw('/claim?device=sim-controller-7f3a&at=4');

    expect(await screen.findByText('Critical alarms reach you by Telegram.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notify me by e-mail' })).not.toBeInTheDocument();
  });

  it('applies a stage to the place and says what that did, and asks nothing about a grow there', async () => {
    await drawClaimed();

    fireEvent.click(screen.getByRole('button', { name: 'Flower' }));
    fireEvent.click(screen.getByRole('button', { name: 'Put it on Flower' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/spaces/space-new/preset-applications', { stage: 'flowering' }));
    expect(await screen.findByText('The targets went to 1 controller.')).toBeInTheDocument();
    expect(screen.getByText('No grow entered the stage; only the climate was written.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Start a grow/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Only the climate/ })).not.toBeInTheDocument();
  });

  /**
   * A stage sets how long the light is on from the hour the device already
   * has: a new fridge put on Veg burnt until two at night, and the step said
   * only that the targets had gone to it. The window is said before the write
   * and again after it.
   */
  it('says the light window a stage puts the controller on, before it is written and after', async () => {
    const configured = { ...device, configuration: { daynight: { day: 6 * 3600, night: 22 * 3600 }, day: { temperature: 25 } } };
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices' ? { items: [configured], nextCursor: null } : answers(path)) as never,
    );
    await drawClaimed();

    fireEvent.click(screen.getByRole('button', { name: 'Veg' }));
    const line = 'Light on 06:00–00:00 · 18 h – when it comes on is changed under Control.';
    expect(await screen.findByText(line)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Flower' }));
    expect(await screen.findByText('Light on 06:00–18:00 · 12 h – when it comes on is changed under Control.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Put it on Flower' }));

    expect(await screen.findByText('The targets went to 1 controller.')).toBeInTheDocument();
    expect(screen.getByText('Light on 06:00–18:00 · 12 h – when it comes on is changed under Control.').tagName).toBe('LI');
  });

  it('offers monitoring without writing anything to the controller', async () => {
    await drawClaimed();
    fireEvent.click(screen.getByRole('button', { name: 'just measure' }));

    expect(screen.getByText(/Nothing is written to the controller/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Put it on/ })).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('says what the server said about a code it would not take', async () => {
    vi.mocked(api.post).mockRejectedValue(
      new ApiError({ status: 409, code: 'device_claimed', title: 'Refused', detail: 'That device already belongs to somebody.', errors: [] }),
    );

    draw();
    fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That device already belongs to somebody.');
    expect(screen.getByRole('textbox', { name: 'Claim code' })).toHaveValue('ABCD1234');
  });

  it('says the claim never reached the server, rather than blaming a page that was not being loaded', async () => {
    vi.mocked(api.post).mockRejectedValue(new TypeError('Failed to fetch'));

    draw();
    fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server. Try again.');
  });

  it('says a controller that has never spoken was claimed all the same', async () => {
    vi.mocked(api.post).mockResolvedValue({
      device: { ...device, state: { ...device.state, lastSeenAt: null } },
      spaceCreated: true,
    } as never);
    vi.mocked(api.get).mockImplementation(
      (path: string) =>
        Promise.resolve(
          path === '/devices/sim-controller-7f3a' ? { ...device, state: { ...device.state, lastSeenAt: null } } : answers(path),
        ) as never,
    );

    await drawClaimed();

    expect(screen.getByText(/has not said anything yet/)).toBeInTheDocument();
  });

  it('names the place it made in a word, and not after the hardware standing in it', async () => {
    await drawClaimed();

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/space-new', { name: 'Tent 1' }));
  });

  it('numbers past a place that already carries the name', async () => {
    state.spaces = [space, { ...space, id: 'space-old', name: 'Tent 1' }];
    // An account with a place is asked where the new device hangs; the place its claim made is named all the same.
    claim();
    await hangQuestion('controller');

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/space-new', { name: 'Tent 2' }));
  });

  it('puts the claimed device and the place its claim made in the address, so nothing of the claim is lost by a reload', async () => {
    await drawClaimed();

    // The address is written by the step's own effect, one tick after the claim
    // has been drawn, so this waits for it rather than for the screen - reading
    // it straight after the heading made this the one test in the suite that
    // failed about a third of the time.
    await waitFor(() => expect(address()).toBe('/claim?device=sim-controller-7f3a&at=1&made=space-new'));
  });

  it('comes back on the step it was left on rather than asking for a code that is spent', async () => {
    draw('/claim?device=sim-controller-7f3a&at=2');

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add Controller · step 2 of 5'));
    expect(openStep()).toHaveTextContent('What is it doing right now?');
    expect(screen.queryByRole('textbox', { name: 'Claim code' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
  });

  it('offers the code field again when the address names a device this account cannot read', async () => {
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === '/devices/sim-controller-7f3a'
        ? (Promise.reject(
            new ApiError({ status: 404, code: 'device_not_found', title: 'Not found', detail: 'There is no device with that id.', errors: [] }),
          ) as never)
        : (Promise.resolve(answers(path)) as never),
    );

    draw('/claim?device=sim-controller-7f3a&at=2');

    expect(await screen.findByRole('textbox', { name: 'Claim code' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add a device · step 1 of 5');
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  it('puts the keyboard on the question that just opened, and says which one it is', async () => {
    await drawClaimed();

    expect(screen.getByRole('heading', { level: 2, name: 'What is it doing right now?' })).toHaveFocus();
    // The open step keeps a region of its own for what its write did, so the screen has two.
    expect(screen.getAllByRole('status').map(one => one.textContent)).toContain('What is it doing right now? · step 2 of 5');
  });

  it('writes the stage that was picked when the bottom button is the one pressed', async () => {
    await drawClaimed();
    fireEvent.click(screen.getByRole('button', { name: 'Seedling · with light' }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/spaces/space-new/preset-applications', { stage: 'seedling' }));
    // Written, it moves on: what grows here is the flow's last question, not this step's.
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add Controller · step 3 of 5'));
    expect(openStep()).toHaveTextContent('Sockets and cam');
  });

  it('offers germination in the dark first, and says what it holds before it is written', async () => {
    await drawClaimed();
    const stages = screen.getAllByRole('button', { name: /· dark|· with light|^Veg$|^Flower$|^Drying$/ }).map(button => button.textContent);
    expect(stages.slice(0, 2)).toEqual(['Germination · dark', 'Seedling · with light']);

    fireEvent.click(screen.getByRole('button', { name: 'Germination · dark' }));
    expect(
      screen.getByText(
        /^Germination · dark: the light goes off, there is no CO₂, and the device holds 24 °C round the clock; a humidifier on a smart socket holds 75 % humidity besides\./,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Put it on Germination · dark' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/spaces/space-new/preset-applications', { stage: 'germination' }));
  });

  /** Owner's decision G2: setting up is a way into germination too, and asks what every other way asks. */
  it('asks what germination does about the humidity, and sends what was moved from either button', async () => {
    const configured = {
      ...device,
      configuration: {
        workmode: 'small',
        daynight: { day: 6 * 3600, night: 22 * 3600 },
        day: { temperature: 25 },
        night: { temperature: 21, humidity: 55 },
      },
      control: { running: true, drying: false, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES },
    } as Device;
    vi.mocked(api.get).mockImplementation(
      (path: string) => Promise.resolve(path === '/devices' ? { items: [configured], nextCursor: null } : answers(path)) as never,
    );
    await drawClaimed();

    fireEvent.click(screen.getByRole('button', { name: 'Germination · dark' }));
    const choices = await screen.findByRole('group', { name: 'During germination' });
    // No humidifier is paired on a device that was claimed a moment ago, so the alarm is all there is to choose.
    expect(
      within(choices)
        .getAllByRole('switch')
        .map(one => one.getAttribute('aria-label')),
    ).toEqual(['Warn when it gets too humid']);
    fireEvent.click(within(choices).getByRole('switch', { name: 'Warn when it gets too humid' }));
    // Away to another stage and back, the choice stays; the bottom button carries it into the write.
    fireEvent.click(screen.getByRole('button', { name: 'Veg' }));
    expect(screen.queryByRole('group', { name: 'During germination' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Germination · dark' }));
    expect(within(screen.getByRole('group', { name: 'During germination' })).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/spaces/space-new/preset-applications', {
        stage: 'germination',
        germinationChoices: { warnTooHumid: true },
      }),
    );
  });

  it('leaves the green to the one action on the screen', async () => {
    await drawClaimed();
    fireEvent.click(screen.getByRole('button', { name: 'Flower' }));

    expect(screen.getByRole('button', { name: 'Put it on Flower' }).className).not.toMatch(/primary/);
    expect(screen.getByRole('button', { name: /Next/ }).className).toMatch(/primary/);
  });

  it('does not report a climate write that no controller took', async () => {
    await drawClaimed();
    vi.mocked(api.post).mockResolvedValue({
      spaceId: 'space-new',
      stage: 'flowering',
      preset: null,
      appliedAt: NOW.toISO(),
      deviceIds: [],
      growId: null,
      phaseId: null,
      growDecisionNeeded: true,
      decisions: ['start_grow', 'climate_only'],
      planEffect: 'none',
    } as never);

    fireEvent.click(screen.getByRole('button', { name: 'Flower' }));
    fireEvent.click(screen.getByRole('button', { name: 'Put it on Flower' }));

    expect(await screen.findByText('No controller here took the targets.')).toBeInTheDocument();
    expect(screen.getByText('No grow entered the stage, and no climate was written.')).toBeInTheDocument();
    // Said to a screen reader too, in the region that was on the page before the write.
    expect(screen.getAllByRole('status').map(one => one.textContent)).toContain(
      'No controller here took the targets. No grow entered the stage, and no climate was written.',
    );
  });

  it('names the build rather than printing the uuid the hardware reports', async () => {
    await drawClaimed();

    // The version and not the name: every build carried over from the old
    // cloud is named after its class, so the name says "controller" about
    // every controller build there has ever been.
    expect(screen.getByText(/online 20 s ago/)).toHaveTextContent('firmware 082eda0-stable');
    expect(screen.getByText(/online 20 s ago/)).not.toHaveTextContent('build-uuid');
  });

  it('leaves the build out altogether rather than naming it after a uuid nobody named', async () => {
    vi.mocked(api.get).mockImplementation((path: string) =>
      Promise.resolve(
        path === '/devices/sim-controller-7f3a/firmwares' ? { items: [{ ...BUILD, name: null, version: '' }], nextCursor: null } : answers(path),
      ),
    );

    await drawClaimed();

    await waitFor(() => expect(screen.getByText(/online 20 s ago/)).toHaveTextContent('online 20 s ago · 0 sockets · Cam: none'));
  });

  /**
   * Where a device hangs is asked once, and only where there is more than one answer: the claim has made a place
   * for the device, and whether that guess stands is a question for an account that has another place of its own.
   */
  it('asks the first device of an account nothing about where it hangs', async () => {
    const drawn = await drawClaimed();
    await settled(drawn);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add Controller · step 2 of 5$/);
    expect(openStep()).toHaveTextContent('What is it doing right now?');
    expect(screen.queryByRole('heading', { name: 'Where it hangs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^At a new place/ })).not.toBeInTheDocument();
    // The claim, and the name of the place it made, are all that was written.
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  /**
   * A fan measures the air it hangs in and makes no climate of its own, so the tent that is already there is the
   * likely answer and stands first. Taking it moves the fan and ends the place its claim made, which then holds
   * nothing - or Start grows an empty place with every fan.
   */
  it('asks a fan where it hangs, the place the account has first, and hangs it there for the place its claim made to end', async () => {
    state.spaces = [space, mother];
    state.claim = { device: fan, spaceCreated: true };
    state.devices = [{ ...device, id: 'sim-controller-0001', spaceId: 'space-mother' }, fan];
    claim();

    const question = await hangQuestion('fan');
    await waitFor(() => expect(question).toHaveFocus());
    expect(screen.getByText('Add Fan · step 2 of 6')).toBeInTheDocument();
    expect(offered()).toEqual(['In Mother tent', 'At a new place']);
    expect(screen.getByRole('button', { name: /^In Mother tent/ })).toHaveAttribute('data-first');
    expect(screen.getByRole('button', { name: /^At a new place/ })).not.toHaveAttribute('data-first');
    expect(await screen.findByText('With Terp Controller: one climate, one camera, one maintenance.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^In Mother tent/ }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spaces/space-new'));
    expect(api.put).toHaveBeenCalledWith('/spaces/space-mother/devices/sim-fan-1');
    // Moved first: a place is only ended once nothing stands in it.
    expect(vi.mocked(api.put).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.delete).mock.invocationCallOrder[0]);
    // On it goes, and the list says where the fan hangs now.
    await waitFor(() => expect(openStep()).toHaveTextContent('What is it doing right now?'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add Fan · step 3 of 6$/);
    expect(await screen.findByText('Mother tent · Tent')).toBeInTheDocument();
    await waitFor(() => expect(address()).toBe('/claim?device=sim-fan-1&at=2&made=space-new'));
  });

  /** A second controller is a second climate more often than not, so the place its claim made stands first - and is already there. */
  it('offers a second controller a place of its own first, and writes nothing when that is the answer', async () => {
    state.spaces = [space, mother];
    claim();

    await hangQuestion('controller');
    expect(screen.getByText('Add Controller · step 2 of 6')).toBeInTheDocument();
    expect(offered()).toEqual(['At a new place', 'In Mother tent']);
    expect(screen.getByRole('button', { name: /^At a new place/ })).toHaveAttribute('data-first');
    expect(screen.getByRole('button', { name: /^In Mother tent/ })).not.toHaveAttribute('data-first');
    expect(screen.getByText('No device stands there yet.')).toBeInTheDocument();
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/space-new', { name: 'Tent 1' }));

    fireEvent.click(screen.getByRole('button', { name: /^At a new place/ }));

    await waitFor(() => expect(openStep()).toHaveTextContent('What is it doing right now?'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add Controller · step 3 of 6$/);
    expect(screen.getByRole('heading', { level: 2, name: 'Where it hangs' })).toBeInTheDocument();
    await waitFor(() => expect(address()).toBe('/claim?device=sim-controller-7f3a&at=2&made=space-new'));
    // The claim made the place and gave it its name; the answer added nothing to that.
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('offers neither a room nor a place that was put away', async () => {
    state.spaces = [
      space,
      mother,
      { ...mother, id: 'space-room', kind: 'room', name: 'Cellar' },
      { ...mother, id: 'space-old', name: 'Old tent', archivedAt: NOW.toISO()! },
    ];
    claim();

    await hangQuestion('controller');
    expect(offered()).toEqual(['At a new place', 'In Mother tent']);
  });

  /**
   * Somebody let into another's tent adds a device of their own, which stands in a place of their own: the host's
   * tent is not theirs to hang it in, so it is no answer and, by itself, no reason to ask.
   */
  it("asks a guest nothing where the only other place is the host's", async () => {
    state.spaces = [space, clubTent];
    const drawn = await drawClaimed();
    await settled(drawn);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add Controller · step 2 of 5$/);
    expect(openStep()).toHaveTextContent('What is it doing right now?');
    expect(screen.queryByRole('heading', { name: 'Where it hangs' })).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("offers a guest who has a place of their own that place, and nothing of the host's", async () => {
    state.spaces = [space, clubTent, mother];
    claim();

    await hangQuestion('controller');
    expect(offered()).toEqual(['At a new place', 'In Mother tent']);
    expect(screen.queryByText(/Club tent/)).not.toBeInTheDocument();
  });

  /** Opened from a place - "bring a device here" - the flow already knows the answer: the claim carries it, and says so first. */
  it('claims into the place the flow was opened from, says so under the field and asks nothing afterwards', async () => {
    state.spaces = [mother, { ...mother, id: 'space-drying', name: 'Drying tent' }];
    state.claim = { device: { ...device, spaceId: 'space-mother' }, spaceCreated: false };
    state.hangs = { [device.id]: 'space-mother' };
    const drawn = draw('/claim?space=space-mother');

    expect(await screen.findByText('Goes into Mother tent.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/claims', { code: 'ABCD1234', spaceId: 'space-mother' }));
    await screen.findByRole('heading', { level: 2, name: /Claimed/ });
    await settled(drawn);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add Controller · step 2 of 5$/);
    expect(openStep()).toHaveTextContent('What is it doing right now?');
    // No place was made, so none is named and none is carried in the address.
    expect(api.patch).not.toHaveBeenCalled();
    expect(address()).toBe('/claim?device=sim-controller-7f3a&at=1');
  });

  it("does not claim into a place of somebody else's that the address names", async () => {
    state.spaces = [clubTent];
    const drawn = draw('/claim?space=space-host');
    await settled(drawn);

    expect(screen.queryByText(/Goes into/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/claims', { code: 'ABCD1234' }));
  });

  /**
   * Which place the claim made is in the address beside the device, because it is what the question turns on: a
   * phone locked on the question comes back to it, and an answer given then still knows which place to end.
   */
  it('asks where it hangs again when the flow is picked up on that question, and still ends the place the claim made', async () => {
    state.spaces = [space, mother];
    draw('/claim?device=sim-controller-7f3a&at=1&made=space-new');

    await hangQuestion('controller');
    expect(screen.getByText('Add Controller · step 2 of 6')).toBeInTheDocument();
    expect(offered()).toEqual(['At a new place', 'In Mother tent']);
    expect(address()).toBe('/claim?device=sim-controller-7f3a&at=1&made=space-new');

    fireEvent.click(screen.getByRole('button', { name: /^In Mother tent/ }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spaces/space-new'));
    expect(api.put).toHaveBeenCalledWith('/spaces/space-mother/devices/sim-controller-7f3a');
    // Picked up, not claimed again: the code is spent.
    expect(api.post).not.toHaveBeenCalled();
  });

  it('says what the server said about a move it refused, stays on the question and ends no place', async () => {
    state.spaces = [space, mother];
    vi.mocked(api.put).mockRejectedValue(
      new ApiError({ status: 403, code: 'forbidden', title: 'Refused', detail: 'You may not put a device there.', errors: [] }),
    );
    claim();

    await hangQuestion('controller');
    fireEvent.click(screen.getByRole('button', { name: /^In Mother tent/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You may not put a device there.');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Where does the controller hang?');
    expect(screen.getByRole('button', { name: /^In Mother tent/ })).toBeEnabled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('goes back from the question to the list, which names it among the steps and leads to it again', async () => {
    state.spaces = [space, mother];
    claim();

    await hangQuestion('controller');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add Controller · step 1 of 6$/));
    expect(screen.getAllByRole('heading', { level: 2 }).map(one => one.textContent)).toEqual([
      'Claimed · Terp Controller · 7F3A',
      'Where it hangs',
      'What is it doing right now?',
      'Sockets and cam',
      'How will you hear about problems?',
      'What grows here?',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Next · where does it hang?' }));

    expect(await hangQuestion('controller')).toBeInTheDocument();
  });

  it('says what the write did, for a screen reader that was told only where the button goes', async () => {
    await drawClaimed();
    // The region is on the page and empty first; a live region filled in the same commit is not read out.
    expect(screen.getAllByRole('status').map(one => one.textContent)).toContain('');

    fireEvent.click(screen.getByRole('button', { name: 'Flower' }));
    fireEvent.click(screen.getByRole('button', { name: 'Put it on Flower' }));

    await waitFor(() =>
      expect(screen.getAllByRole('status').map(one => one.textContent)).toContain(
        'The targets went to 1 controller. No grow entered the stage; only the climate was written.',
      ),
    );
  });

  it('reads the resumed step off the server rather than claiming nothing was set', async () => {
    state.grows = [{ ...spring, summary: { ...spring.summary, stage: 'vegetative' } } as GrowListItem];
    draw('/claim?device=sim-controller-7f3a&at=3');

    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /What is it doing/ })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('on Veg')).toBeInTheDocument());
    expect(screen.queryByText('nothing set yet')).not.toBeInTheDocument();
  });

  it('says the camera was refused rather than letting the overlay vanish', async () => {
    vi.stubGlobal('BarcodeDetector', class {});
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: () => Promise.reject(new Error('NotAllowedError')) } });

    draw();
    fireEvent.click(screen.getByRole('button', { name: /or scan/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The camera was not allowed');
    vi.unstubAllGlobals();
  });

  it('shows the demo why it cannot claim instead of a field it would be refused', () => {
    who.demo = true;
    draw();

    expect(screen.queryByRole('textbox', { name: 'Claim code' })).not.toBeInTheDocument();
    expect(screen.getByText(/cannot claim hardware/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add a device$/);
    expect(screen.queryByRole('button', { name: 'Stop adding' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Start' })).toHaveAttribute('href', '/');
  });
});
