import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DeviceCapabilities, DeviceClaimResult, GrowListItem, Me, NotificationSettings, Space } from '@fg2/shared-types/v1';
import { GERMINATION_CHOICES } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { api } from '@/api/client';
import { expectLayout, takeExpected } from '@/api/layers';
import { ApiError } from '@/api/problem';
import { Claim } from '@/screens/claim/Claim';
import { deviceWith } from './fixtures';
import type { Told } from '@/log/log-context';
import { drawAt } from './harness';
import { meWith, spaceWhere } from './session';
import { Toast } from './toast';
import { translate } from './translations';

/**
 * Adding a device: what the steps ask and how many of them there are, what
 * each answer puts on the wire, what a code the server will not take says, and
 * what the demo is offered.
 *
 * What is asked is decided when the claim answers and counted from then on.
 * Where the device hangs is asked once and only of an account that has a place
 * of its own to hang it in, and a device hung beside a controller is asked
 * nothing else; a place's name, kind and room are the place's own page and not
 * this flow's.
 *
 * Every request goes through the app's own client, mocked at that one seam, so
 * what is asserted is what would leave the browser: a claim carries exactly the
 * code that was read and the place a device without a climate of its own joins,
 * which is the one write of hanging it there; only an answer changed afterwards
 * moves a device, and a stage is applied to the place the device stands in and
 * nothing else.
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

// The place the claim makes, which is in the list once the claim has answered (`state.unsent`). A device is moved
// into a place by managing it, so every place here says so.
const space: Space = spaceWhere('own', { id: 'space-new', kind: 'other', name: 'Terp Controller' });

/** A tent the account already had before this device was added. */
const mother: Space = spaceWhere('own', { id: 'space-mother', name: 'Mother tent' });

/** Somebody else's tent, which the account was let into and may run. */
const clubTent: Space = spaceWhere('manage', { id: 'space-host', name: 'Club tent' });

/** An AIR fan, which makes no climate of its own: it hangs in the air of a place. */
const fan: Device = { ...device, id: 'sim-fan-1', type: 'fan', name: null };

/** A Plantalytix Socket and a LIGHT, which hang in the air of a place as a fan does. */
const plug: Device = { ...device, id: 'sim-plug-1', type: 'plug', name: null };
const light: Device = { ...device, id: 'sim-light-1', type: 'light', name: null };

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
  /** A claim still to be sent: the place it will make is in no list yet, and the claim names the place a device joins from what is. */
  unsent: false,
};

const standing = (one: Device): Device => ({ ...one, spaceId: state.hangs[one.id] ?? one.spaceId });

/** A claim the server answers in its one write for a device that joins a place: it stands there, and no place was made. */
const joins = (one: Device, where: Space) => {
  state.claim = { device: { ...one, spaceId: where.id }, spaceCreated: false };
  state.hangs[one.id] = where.id;
};

const answers = (path: string) => {
  if (path === '/devices/sim-controller-7f3a') return standing(device);
  if (path === '/devices') return { items: state.devices.map(standing), nextCursor: null };
  if (path === '/devices/sim-fan-1') return standing(fan);
  if (path === '/devices/sim-fan-1/sockets') return { items: [], nextCursor: null, capabilities: CAPABILITIES };
  if (path === '/devices/sim-plug-1') return standing(plug);
  if (path === '/devices/sim-plug-1/sockets') return { items: [], nextCursor: null, capabilities: CAPABILITIES };
  if (path === '/devices/sim-light-1') return standing(light);
  if (path === '/devices/sim-light-1/sockets') return { items: [], nextCursor: null, capabilities: CAPABILITIES };
  if (path === '/devices/sim-controller-7f3a/sockets') return { items: [], nextCursor: null, capabilities: CAPABILITIES };
  if (path === '/devices/sim-controller-7f3a/firmwares') return { items: [BUILD], nextCursor: null };
  if (path === '/spaces') return { items: state.spaces.filter(one => !state.unsent || one.id !== 'space-new'), nextCursor: null };
  if (path === '/grows') return { items: state.grows, nextCursor: null };
  if (path === '/me') return state.me;
  throw new Error(`nothing mocked for ${path}`);
};

/** Where the flow has put itself, because what survives a reload is the address and nothing else; and the browser's Back. */
function Watch() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <span data-testid="address">{`${location.pathname}${location.search}`}</span>
      <button type="button" onClick={() => void navigate(-1)}>
        browser back
      </button>
    </>
  );
}

const address = () => screen.getByTestId('address').textContent;

/** What the toast was told, which outlives the flow: it is said on the page the flow ends on. */
const told: Told[] = [];

const draw = (at = '/claim') =>
  drawAt(
    <Toast told={told}>
      <Routes>
        <Route path="/claim" element={<Claim />} />
        <Route path="*" element={null} />
      </Routes>
      <Watch />
    </Toast>,
    { at },
  );

/** What a controller's claim says it will ask of an account nothing reaches yet. */
const ASKED = 'doing.hardware.notify.grow';

/** The address of a flow that was left on a question, as a locked phone comes back to it. */
const left = (at: string, { device: id = 'sim-controller-7f3a', ask = ASKED, made = '' } = {}) =>
  `/claim?device=${id}&ask=${ask}&at=${at}${made ? `&made=${made}` : ''}`;

/** The code typed and sent, which is as far as a test goes that is about what the claim is asked next. */
const claim = (at?: string) => {
  state.unsent = true;
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

/** The page that asks where the device hangs, by its question: the head above it names the window, as on every page of the flow. */
const hangQuestion = (type: string) => screen.findByRole('heading', { level: 2, name: `Where does the ${type} hang?` });

/** What that page offers, in the order it offers it: each answer is a name, and under it what that means. */
const offered = () =>
  screen
    .getAllByRole('button')
    .filter(one => one.childElementCount === 2)
    .map(one => one.firstElementChild?.textContent);

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
  state.unsent = false;
  told.length = 0;
  vi.mocked(api.get).mockImplementation((path: string) => Promise.resolve(answers(path)) as never);
  vi.mocked(api.post).mockImplementation((path: string) =>
    path === '/devices/claims'
      ? (Promise.resolve(state.claim).finally(() => (state.unsent = false)) as never)
      : path === '/me/email-alarms'
        ? (Promise.resolve(
            meReaching({
              ...UNREACHED,
              channels: { ...UNREACHED.channels, email: 'grower@example.org' },
              routing: { ...UNREACHED.routing, alerts: ['email'] },
            }),
          ) as never)
        : path === '/spaces'
          ? (Promise.resolve(state.spaces[state.spaces.push({ ...mother, id: 'space-made', name: 'Made' }) - 1]) as never)
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
  vi.mocked(api.patch).mockResolvedValue({ ...space, name: 'Tent' } as never);
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
  it('asks for the code first, counts no steps before it knows the device and offers nothing to skip ahead with', () => {
    draw();

    // What will be asked depends on the device, which only the code says: no count that a claim would then change.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add a device$/);
    expect(screen.getAllByRole('heading', { level: 2 }).map(one => one.textContent)).toEqual(['Read the code off the display']);
    expect(screen.getByRole('textbox', { name: 'Claim code' })).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Next/ })).not.toBeInTheDocument();
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

  it('claims exactly the code that was read, and names no place in an account that has none', async () => {
    state.spaces = [];
    draw();
    fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: ' abcd1234 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/claims', { code: 'abcd1234' }));
  });

  it('reports what the device itself says, names it in the head and opens the next question', async () => {
    await drawClaimed();

    // The device by its name, and nothing of its id: one controller needs no telling apart.
    expect(screen.getByRole('heading', { level: 2, name: /Claimed/ })).toHaveTextContent(/^Claimed · Terp Controller$/);
    // Its build and its sockets are read once the device is.
    await waitFor(() =>
      expect(screen.getByText(/online 20 s ago/)).toHaveTextContent('online 20 s ago · firmware 082eda0-stable · 0 sockets · Cam: none'),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller · step 2 of 5$/);
    expect(screen.getByRole('button', { name: /Next/ })).toHaveTextContent('Next · sockets and cam?');
  });

  it('draws every step the count names - the last one, which is a page of its own, too - and explains none of them in a paragraph', async () => {
    await drawClaimed();

    const steps = screen.getAllByRole('heading', { level: 2 }).map(one => one.textContent);
    expect(steps).toEqual([
      'Claimed · Terp Controller',
      'What is it doing right now?',
      'Sockets and cam',
      'How will you hear about problems?',
      'What grows here?',
    ]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/of 5$/);
    // What a question is about stands behind the help button beside it; a step still ahead is its title and no more.
    expect(screen.getByRole('button', { name: 'About Climate preset' })).toHaveAccessibleDescription(/^A ready climate for a stage/);
    expect(document.querySelectorAll('[data-state="ahead"] p')).toHaveLength(0);
    // Under the button stands nothing: what can wait is not explained on the way past it.
    expect(document.querySelector('footer')).toHaveTextContent(/^Next · sockets and cam\?$/);
  });

  /**
   * The step named two things and sent both to a tent's Devices tab, which
   * pairs neither: a socket has no control there at all, and the chip that
   * pairs a cam is drawn only on the account-wide list. The cam is the half the
   * app can help with, so that is the half it links.
   */
  it('sends the step to the screen that really pairs a cam, and says where a socket is paired behind the help button', async () => {
    draw(left('hardware'));

    expect(await screen.findByRole('link', { name: 'Pair a Terp Cam' })).toHaveAttribute('href', '/cameras/add');
    expect(screen.getByRole('button', { name: 'About Pairing by IP' })).toHaveAccessibleDescription(
      /a Tasmota socket .* A Terp Control socket is paired on the device itself: press the button, then Smart Sockets\.$/,
    );
    expect(screen.queryByRole('link', { name: /Devices tab/ })).not.toBeInTheDocument();
  });

  /**
   * A Smart Socket and an AIR fan pair a Terp Cam at their own display, as a
   * controller does, and pair no sockets. The step asked a socket's owner
   * nothing at all, so the one place a new owner is walked through the
   * hardware left out the cam they can have.
   */
  it('asks a smart socket about the cam it can pair, and nothing about sockets or a climate', async () => {
    state.claim = { device: plug, spaceCreated: true };
    state.devices = [plug];
    claim();

    // A socket sets no climate of its own, so no stage is asked of it: the cam is its first question.
    await waitFor(() => expect(openStep()).toHaveTextContent('Cam'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add Plantalytix Socket · step 2 of 4$/);
    expect(screen.getAllByRole('heading', { level: 2 }).map(one => one.textContent)).toEqual([
      'Claimed · Plantalytix Socket',
      'Cam',
      'How will you hear about problems?',
      'What grows here?',
    ]);
    // What the first step says it found names the cam and no sockets a plug cannot have.
    expect(screen.getByText(/Cam: none/)).toBeInTheDocument();
    expect(screen.queryByText(/0 sockets/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pair a Terp Cam' })).toHaveAttribute('href', '/cameras/add');
    expect(screen.queryByText('Reported sockets')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'About Pairing by IP' })).not.toBeInTheDocument();
    expect(address()).toBe('/claim?device=sim-plug-1&ask=hardware.notify.grow&at=hardware&made=space-new');
  });

  it('asks a light nothing about sockets and a cam it cannot have, and counts three steps', async () => {
    state.claim = { device: light, spaceCreated: true };
    state.devices = [light];
    claim();

    await waitFor(() => expect(openStep()).toHaveTextContent('How will you hear about problems?'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add light · step 2 of 3$/);
    expect(screen.queryByRole('heading', { level: 2, name: /Cam/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Cam: none|0 sockets/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next · what grows?' })).toBeEnabled();
  });

  /**
   * A new device arms the offline rule the cloud keeps, and a new account has
   * no way to be told about it. The flow asks about that with the one tap that
   * mails critical alarms to the address the account signs in with - written
   * by the server from the tap alone, so nothing of the address is sent.
   */
  it('asks how alarms will reach anybody, and mails critical ones to the login address in one tap', async () => {
    draw(left('notify'));

    expect(await screen.findByRole('heading', { level: 2, name: 'How will you hear about problems?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'About Alarms by e-mail' })).toHaveAccessibleDescription(/^Until a way is set up, nothing reaches you/);
    expect(await screen.findByText('to grower@example.org')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next · what grows?' })).toBeEnabled();
    // The bottom button stays the one green action of the screen.
    expect(screen.getByRole('button', { name: 'Notify me by e-mail' }).className).not.toMatch(/primary/);

    fireEvent.click(screen.getByRole('button', { name: 'Notify me by e-mail' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/me/email-alarms'));
    expect(await screen.findByText('Critical alarms now come by e-mail to grower@example.org.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change ›' })).toHaveAttribute('href', '/me/notifications');
    // Answered, the step is still the fourth of five: the count was said when the device was claimed.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller · step 4 of 5$/);
  });

  /**
   * The diary is offered from the first day: setting a device up ends by
   * asking what grows there, on a page of its own. An answer starts the grow
   * and its phase and leaves the climate alone, which the step before set.
   */
  it('ends by asking what grows here, and an answer starts the grow and opens the place', async () => {
    vi.mocked(api.post).mockImplementation((path: string) => Promise.resolve(path === '/grows' ? { id: 'grow-new' } : {}) as never);
    draw(left('notify'));
    fireEvent.click(await screen.findByRole('button', { name: 'Next · what grows?' }));

    // The place is not glued to the question: it was settled a page earlier, and "here" is where the device hangs.
    const question = await screen.findByRole('heading', { level: 2, name: 'What grows here?' });
    expect(question).toHaveFocus();
    // The head's line names the window on this page as on every other of the flow; the question stands under it.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller · step 5 of 5$/);
    expect(address()).toBe(left('grow'));
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
    draw(left('grow'));

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

    await screen.findByRole('heading', { level: 2, name: 'What grows here?' });
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
    draw(left('grow'));

    await screen.findByRole('heading', { level: 2, name: 'What grows here?' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Flower' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'Germination' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens it on growth where nothing says which stage the place is on', async () => {
    draw(left('grow'));

    await screen.findByRole('heading', { level: 2, name: 'What grows here?' });
    // Not before the place has said so: a device list being read again is waited for (`usePlaceStage`).
    await waitFor(() => expect(screen.getByRole('button', { name: 'Veg' })).toHaveAttribute('aria-pressed', 'true'));
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
    draw(left('grow'));

    await screen.findByRole('heading', { level: 2, name: 'What grows here?' });
    expect(takeExpected()).toEqual({ diary: true });
    expectLayout({ diary: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Veg' })).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Start a grow' }));

    // The grow exists and the place's grows have been read again; the phase is still on its way.
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/grows/grow-new/phases', expect.anything()));
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/grows').length).toBeGreaterThan(2));
    expect(screen.getByRole('heading', { level: 2, name: 'What grows here?' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: /Claimed/ })).not.toBeInTheDocument();

    phaseWritten();
    await waitFor(() => expect(address()).toBe('/spaces/space-new'));
    // Leaving after a grow was started keeps the word; leaving without one would have taken it back.
    expect(takeExpected()).toEqual({ diary: true });
  });

  it('takes its word about the diary back when the question is left unanswered', async () => {
    draw(left('grow'));

    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(address()).toBe('/spaces/space-new');
    expect(takeExpected()).toEqual({ diary: false });
  });

  it('does not ask an account that said no to the diary what grows', async () => {
    state.me = { ...meReaching(UNREACHED), preferences: { ...meReaching(UNREACHED).preferences, diary: 'off' } };
    await drawClaimed();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller · step 2 of 4$/);
    expect(screen.queryByRole('heading', { level: 2, name: 'What grows here?' })).not.toBeInTheDocument();
    expect(address()).toBe('/claim?device=sim-controller-7f3a&ask=doing.hardware.notify&at=doing&made=space-new');
  });

  it('ends a step early where a grow already stands, with the count it said', async () => {
    state.grows = [{ ...spring, placements: [{ ...spring.placements[0], spaceId: 'space-new' }] } as GrowListItem];
    draw(left('notify'));

    expect(await screen.findByRole('button', { name: 'Done · open the place' })).toBeEnabled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller · step 4 of 5$/);
    fireEvent.click(screen.getByRole('button', { name: 'Done · open the place' }));
    expect(address()).toBe('/spaces/space-new');
  });

  it('does not ask an account that alarms already reach how it will hear of them', async () => {
    state.me = meReaching({
      ...UNREACHED,
      channels: { ...UNREACHED.channels, telegram: { chatId: '1', linkedAt: NOW.toISO()! } },
      routing: { ...UNREACHED.routing, alerts: ['telegram'] },
    });
    await drawClaimed();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller · step 2 of 4$/);
    expect(screen.queryByRole('heading', { level: 2, name: 'How will you hear about problems?' })).not.toBeInTheDocument();
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
    draw(left('grow'));

    fireEvent.click(await screen.findByRole('button', { name: 'Or move a grow here' }));

    // The sheet stands over the claim, not on the place's own page: it names the place, by itself.
    const sheet = await screen.findByRole('dialog', { name: 'Terp Controller: move a grow here' });
    expect(await within(sheet).findByRole('button', { name: 'Spring run · Blue Dream tent' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('says how alarms reach an account that set a way up since it was asked, and offers nothing to tap', async () => {
    state.me = meReaching({
      ...UNREACHED,
      channels: { ...UNREACHED.channels, telegram: { chatId: '1', linkedAt: NOW.toISO()! } },
      routing: { ...UNREACHED.routing, alerts: ['telegram'] },
    });
    draw(left('notify'));

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

  /** A place the app names by itself is named for what it is, the first of its kind without a number. */
  it('names the place it made in a word, and not after the hardware standing in it', async () => {
    await drawClaimed();

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/space-new', { name: 'Tent' }));
  });

  it('numbers past a place that already carries the name, from two', async () => {
    state.spaces = [space, { ...space, id: 'space-old', name: 'tent' }, { ...space, id: 'space-older', name: 'Tent 2' }];
    // An account with a place is asked where the new device hangs; the place its claim made is named all the same.
    claim();
    await hangQuestion('controller');

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/space-new', { name: 'Tent 3' }));
  });

  it('calls the place of a fridge module a fridge, and that of a first fan a tent', async () => {
    state.claim = { device: { ...device, type: 'fridge' }, spaceCreated: true };
    const { unmount } = claim();
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/space-new', { name: 'Fridge' }));
    unmount();

    state.claim = { device: fan, spaceCreated: true };
    claim();
    await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith('/spaces/space-new', { name: 'Tent' }));
  });

  it('puts the claimed device and the place its claim made in the address, so nothing of the claim is lost by a reload', async () => {
    await drawClaimed();

    // The address is written by the step's own effect, one tick after the claim
    // has been drawn, so this waits for it rather than for the screen - reading
    // it straight after the heading made this the one test in the suite that
    // failed about a third of the time.
    await waitFor(() => expect(address()).toBe(left('doing', { made: 'space-new' })));
  });

  it('comes back on the step it was left on rather than asking for a code that is spent', async () => {
    draw(left('doing'));

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add controller · step 2 of 5'));
    expect(openStep()).toHaveTextContent('What is it doing right now?');
    expect(screen.queryByRole('textbox', { name: 'Claim code' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
  });

  it('says that a device the address names is not on this account, once, over the field for a code', async () => {
    vi.mocked(api.get).mockImplementation((path: string) =>
      path === '/devices/sim-controller-7f3a'
        ? (Promise.reject(
            new ApiError({ status: 404, code: 'device_not_found', title: 'Not found', detail: 'There is no device with that id.', errors: [] }),
          ) as never)
        : (Promise.resolve(answers(path)) as never),
    );

    const drawn = draw(left('doing'));

    expect(await screen.findByText('This device is not on your account.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Claim code' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add a device$/);
    // A refusal is an answer: the device is not asked for again.
    await settled(drawn);
    expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/devices/sim-controller-7f3a')).toHaveLength(1);
    expect(address()).toBe(left('doing'));
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
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Add controller · step 3 of 5'));
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

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller · step 2 of 5$/);
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
   * likely answer. The claim itself names that tent - the client cannot know the type before the code is read, the
   * server can - so the fan hangs there in the one write: no place is made to be ended again, and a flow left at
   * the question leaves nothing behind.
   */
  it('claims a fan into the tent the account has in the one write, and asks where it hangs without a count', async () => {
    state.spaces = [mother];
    joins(fan, mother);
    state.devices = [{ ...device, id: 'sim-controller-0001', spaceId: 'space-mother' }, fan];
    const drawn = claim();

    const question = await hangQuestion('fan');
    await waitFor(() => expect(question).toHaveFocus());
    expect(api.post).toHaveBeenCalledWith('/devices/claims', { code: 'ABCD1234', joinSpaceId: 'space-mother' });
    // How many steps follow is this answer's to say: beside a controller none does.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add fan$/);
    expect(screen.queryByText(/step \d/)).not.toBeInTheDocument();
    // A place is its name alone; what hanging there means stands under it, by the devices and no preposition.
    expect(offered()).toEqual(['Mother tent', 'At a new place']);
    const tent = screen.getByRole('button', { name: /^Mother tent/ });
    expect(tent).toHaveTextContent(/^Mother tentTerp Controller: one climate, one camera, one maintenance window\.$/);
    // The answer that holds is marked, and the other is there to change it.
    expect(tent).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /^At a new place/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('A drying tent, say, where no other device stands.')).toBeInTheDocument();
    expect(address()).toBe('/claim?device=sim-fan-1&ask=place.hardware.notify.grow&at=place');
    // The claim is all that was written: nothing moved, nothing ended, nothing named.
    await settled(drawn);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  /**
   * What the claim names is the question's first answer: the tent a controller or a fridge module stands in, also
   * where another place is listed before it - a socket by itself holds no climate to join.
   */
  it('names the tent that holds a climate rather than the place listed first, and offers it first', async () => {
    const drying: Space = { ...mother, id: 'space-drying', name: 'Drying tent' };
    state.spaces = [drying, mother];
    joins(fan, mother);
    state.devices = [
      { ...plug, id: 'sim-plug-0001', spaceId: 'space-drying' },
      { ...device, id: 'sim-controller-0001', spaceId: 'space-mother' },
    ];
    claim();

    await hangQuestion('fan');
    expect(api.post).toHaveBeenCalledWith('/devices/claims', { code: 'ABCD1234', joinSpaceId: 'space-mother' });
    expect(offered()).toEqual(['Mother tent', 'Drying tent', 'At a new place']);
  });

  /** A kind says which device is meant; the tail of an id is added only where two of a kind without a name stand in one place. */
  it('calls what stands in a place by its kind, and tells two of a kind apart by the last four of their ids', async () => {
    const drying: Space = { ...mother, id: 'space-drying', name: 'Drying tent' };
    state.spaces = [mother, drying];
    joins(plug, mother);
    state.devices = [
      { ...fan, id: 'sim-fan-0001', spaceId: 'space-mother' },
      { ...fan, id: 'sim-fan-0002', spaceId: 'space-mother' },
      { ...fan, id: 'sim-fan-0003', spaceId: 'space-drying' },
    ];
    claim();

    await screen.findByRole('heading', { level: 2, name: 'Where is the Plantalytix Socket plugged in?' });
    expect(screen.getByRole('button', { name: /^Mother tent/ })).toHaveTextContent(/^Mother tentFan\W+0001, Fan\W+0002: one climate/);
    expect(screen.getByRole('button', { name: /^Drying tent/ })).toHaveTextContent(/^Drying tentFan: one climate/);
  });

  /**
   * Beside a controller a fan hangs in that controller's climate: there is no stage to set, the camera and the
   * alarms are the place's, and what grows there was asked when the controller came. So the answer ends the flow,
   * on the Start of that place, and the toast says what hangs where.
   */
  it('is done once a fan hangs beside a controller: a toast on the Start of that place, and nothing written but the claim', async () => {
    state.spaces = [mother];
    joins(fan, mother);
    state.devices = [{ ...device, id: 'sim-controller-0001', spaceId: 'space-mother' }, fan];
    const drawn = claim();

    await hangQuestion('fan');
    fireEvent.click(screen.getByRole('button', { name: /^Mother tent/ }));

    await waitFor(() => expect(address()).toBe('/spaces/space-mother'));
    // The place by its name, and no preposition glued to it.
    expect(told).toEqual([{ label: 'Mother tent: Fan now hangs here', undo: null }]);
    await settled(drawn);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('says a socket is plugged in, in the question and in the toast', async () => {
    state.spaces = [mother];
    joins(plug, mother);
    state.devices = [{ ...device, id: 'sim-controller-0001', spaceId: 'space-mother' }, plug];
    claim();

    expect(await screen.findByRole('heading', { level: 2, name: 'Where is the Plantalytix Socket plugged in?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Mother tent/ }));

    await waitFor(() => expect(told).toEqual([{ label: 'Mother tent: Plantalytix Socket is now plugged in here', undo: null }]));
  });

  it('counts the steps from the answer on where a fan hangs in a place without a controller, and says the place in the step it settled', async () => {
    const dream: Space = { ...mother, name: 'Blue Dream' };
    state.spaces = [dream];
    joins(fan, dream);
    state.devices = [fan];
    claim();

    await hangQuestion('fan');
    // No climate anywhere: the first of the account's own places is the one the claim named.
    expect(api.post).toHaveBeenCalledWith('/devices/claims', { code: 'ABCD1234', joinSpaceId: 'space-mother' });
    expect(screen.getByText('No device stands there yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Blue Dream/ }));

    await waitFor(() => expect(openStep()).toHaveTextContent('Cam'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add fan · step 3 of 5$/);
    // The step that was asked is ticked and says the place: its name, and the kind where the name does not say it.
    expect(screen.getByRole('button', { name: 'Where it hangs' })).toBeInTheDocument();
    expect(screen.getByText('Blue Dream · Tent')).toBeInTheDocument();
    expect(told).toEqual([]);
    expect(address()).toBe('/claim?device=sim-fan-1&ask=place.hardware.notify.grow&at=hardware');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('makes a place for a fan that is to hang at a new one and moves the fan there - and ends it again if the fan goes back', async () => {
    state.spaces = [mother];
    joins(fan, mother);
    state.devices = [{ ...device, id: 'sim-controller-0001', spaceId: 'space-mother' }, fan];
    claim();

    await hangQuestion('fan');
    fireEvent.click(screen.getByRole('button', { name: /^At a new place/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/spaces', { kind: 'tent', name: 'Tent' }));
    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/spaces/space-made/devices/sim-fan-1'));
    await waitFor(() => expect(openStep()).toHaveTextContent('Cam'));
    expect(address()).toBe('/claim?device=sim-fan-1&ask=place.hardware.notify.grow&at=hardware&made=space-made');

    // Back on the question, whose entry was written before the place was made: the page still knows it made one.
    fireEvent.click(screen.getByRole('button', { name: 'browser back' }));
    await hangQuestion('fan');
    expect(screen.getByRole('button', { name: /^At a new place/ })).toHaveAttribute('aria-current', 'true');
    expect(offered()).toEqual(['Mother tent', 'At a new place']);
    fireEvent.click(screen.getByRole('button', { name: /^Mother tent/ }));

    await waitFor(() => expect(api.delete).toHaveBeenLastCalledWith('/spaces/space-made'));
    expect(api.put).toHaveBeenLastCalledWith('/spaces/space-mother/devices/sim-fan-1');
    await waitFor(() => expect(address()).toBe('/spaces/space-mother'));
  });

  /**
   * A new place is two writes, and the second can be refused. The place it was made for is then taken away again,
   * so the page says why under the answers with nothing left standing empty, and the same tap starts over.
   */
  it('takes the place it made away again where the move into it is refused, says why, and tries again on the same tap', async () => {
    state.spaces = [mother];
    joins(fan, mother);
    claim();

    await hangQuestion('fan');
    vi.mocked(api.put).mockRejectedValueOnce(
      new ApiError({ status: 403, code: 'forbidden', title: 'Refused', detail: 'You may not put a device there.', errors: [] }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^At a new place/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You may not put a device there.');
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spaces/space-made'));
    expect(state.spaces).toEqual([mother]);
    // The fan still hangs where its claim put it.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Mother tent/ })).toHaveAttribute('aria-current', 'true'));

    fireEvent.click(screen.getByRole('button', { name: /^At a new place/ }));
    await waitFor(() => expect(openStep()).toHaveTextContent('Cam'));
    expect(api.put).toHaveBeenLastCalledWith('/spaces/space-made/devices/sim-fan-1');
    expect(state.spaces.map(one => one.id)).toEqual(['space-mother', 'space-made']);
  });

  it('keeps a place it could not take away either - the connection is gone - and moves into it on the next tap, not into a second one', async () => {
    state.spaces = [mother];
    joins(fan, mother);
    claim();

    await hangQuestion('fan');
    vi.mocked(api.put).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(api.delete).mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: /^At a new place/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server. Try again.');
    fireEvent.click(screen.getByRole('button', { name: /^At a new place/ }));

    await waitFor(() => expect(openStep()).toHaveTextContent('Cam'));
    expect(vi.mocked(api.post).mock.calls.filter(([path]) => path === '/spaces')).toHaveLength(1);
    expect(api.put).toHaveBeenLastCalledWith('/spaces/space-made/devices/sim-fan-1');
  });

  /**
   * A second controller is a second climate more often than not: the server gives it a place of its own whatever
   * the claim names, it stays there, and that answer stands first.
   */
  it('leaves a second controller in the place its claim made, offers that first and writes nothing when it is the answer', async () => {
    state.spaces = [space, mother];
    claim();

    await hangQuestion('controller');
    expect(api.post).toHaveBeenCalledWith('/devices/claims', { code: 'ABCD1234', joinSpaceId: 'space-mother' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller$/);
    expect(offered()).toEqual(['At a new place', 'Mother tent']);
    expect(screen.getByRole('button', { name: /^At a new place/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /^Mother tent/ })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('No device stands there yet.')).toBeInTheDocument();
    expect(screen.getByText('A second tent, say, with a climate of its own.')).toBeInTheDocument();
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/space-new', { name: 'Tent' }));

    fireEvent.click(screen.getByRole('button', { name: /^At a new place/ }));

    await waitFor(() => expect(openStep()).toHaveTextContent('What is it doing right now?'));
    // Counted from here on: the code, where it hangs, and the four that follow.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller · step 3 of 6$/);
    expect(screen.getByRole('heading', { level: 2, name: 'Where it hangs' })).toBeInTheDocument();
    expect(address()).toBe(left('doing', { ask: `place.${ASKED}`, made: 'space-new' }));
    // The claim made the place and gave it its name; the answer added nothing to that.
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  /**
   * A stage is written to the place, and so to every device there that takes targets. A second controller hung
   * beside the first is therefore not asked for one - and a step that is not asked is not counted and not ticked.
   */
  it('asks a controller hung beside another for no climate: the step is neither counted nor drawn', async () => {
    state.spaces = [space, mother];
    state.devices = [{ ...device, id: 'sim-controller-0001', spaceId: 'space-mother' }, device];
    const drawn = claim();

    await hangQuestion('controller');
    fireEvent.click(screen.getByRole('button', { name: /^Mother tent/ }));

    await waitFor(() => expect(openStep()).toHaveTextContent('Sockets and cam'));
    expect(api.put).toHaveBeenCalledWith('/spaces/space-mother/devices/sim-controller-7f3a');
    expect(api.delete).toHaveBeenCalledWith('/spaces/space-new');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller · step 3 of 5$/);
    expect(screen.getAllByRole('heading', { level: 2 }).map(one => one.textContent)).toEqual([
      'Claimed · Terp Controller',
      'Where it hangs',
      'Sockets and cam',
      'How will you hear about problems?',
      'What grows here?',
    ]);
    // The name says what kind of place it is, so the kind is not said after it.
    expect(screen.getByText('Mother tent')).toBeInTheDocument();
    expect(address()).toBe('/claim?device=sim-controller-7f3a&ask=place.hardware.notify.grow&at=hardware');
    await settled(drawn);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  /**
   * The name of the place a claim made is a write after the claim. Where it does not get through the page says so
   * with the sentence for it and sends the same write again - the claim is spent and cannot be repeated.
   */
  it('says that the name of the place the claim made did not get through, and sends it again', async () => {
    vi.mocked(api.patch).mockRejectedValueOnce(new Error('offline'));
    await drawClaimed();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(vi.mocked(api.patch).mock.calls).toEqual([
      ['/spaces/space-new', { name: 'Tent' }],
      ['/spaces/space-new', { name: 'Tent' }],
    ]);
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
    expect(offered()).toEqual(['At a new place', 'Mother tent']);
  });

  /**
   * Somebody let into another's tent adds a device of their own, which stands in a place of their own: the host's
   * tent is not theirs to hang it in, so it is no answer, nothing the claim names and, by itself, no reason to ask.
   */
  it("asks a guest nothing where the only other place is the host's", async () => {
    state.spaces = [space, clubTent];
    const drawn = await drawClaimed();
    await settled(drawn);

    expect(api.post).toHaveBeenCalledWith('/devices/claims', { code: 'ABCD1234' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller · step 2 of 5$/);
    expect(openStep()).toHaveTextContent('What is it doing right now?');
    expect(screen.queryByRole('heading', { name: 'Where it hangs' })).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it("offers a guest who has a place of their own that place, and nothing of the host's", async () => {
    state.spaces = [space, clubTent, mother];
    claim();

    await hangQuestion('controller');
    expect(api.post).toHaveBeenCalledWith('/devices/claims', { code: 'ABCD1234', joinSpaceId: 'space-mother' });
    expect(offered()).toEqual(['At a new place', 'Mother tent']);
    expect(screen.queryByText(/Club tent/)).not.toBeInTheDocument();
  });

  /** Opened from a place - "Gerät hinzufügen" behind its ⋯ - the flow already knows the answer: the claim carries it, and says so first. */
  it('claims into the place the flow was opened from, says so under the field and asks nothing afterwards', async () => {
    state.spaces = [mother, { ...mother, id: 'space-drying', name: 'Drying tent' }];
    state.claim = { device: { ...device, spaceId: 'space-mother' }, spaceCreated: false };
    state.hangs = { [device.id]: 'space-mother' };
    const drawn = draw('/claim?space=space-mother');

    // The place's name by itself, after what it is.
    expect(await screen.findByText('Place: Mother tent')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/claims', { code: 'ABCD1234', spaceId: 'space-mother' }));
    await screen.findByRole('heading', { level: 2, name: /Claimed/ });
    await settled(drawn);
    // No place question is asked, so the count is said as soon as the code is taken.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller · step 2 of 5$/);
    expect(openStep()).toHaveTextContent('What is it doing right now?');
    // No place was made, so none is named and none is carried in the address.
    expect(api.patch).not.toHaveBeenCalled();
    expect(address()).toBe(left('doing'));
  });

  it('counts no climate step for a controller brought to a place another one stands in', async () => {
    state.spaces = [mother];
    state.claim = { device: { ...device, spaceId: 'space-mother' }, spaceCreated: false };
    state.hangs = { [device.id]: 'space-mother' };
    state.devices = [{ ...device, id: 'sim-controller-0001', spaceId: 'space-mother' }, device];
    draw('/claim?space=space-mother');

    await screen.findByText('Place: Mother tent');
    fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

    await waitFor(() => expect(openStep()).toHaveTextContent('Sockets and cam'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller · step 2 of 4$/);
    expect(screen.queryByRole('heading', { level: 2, name: 'What is it doing right now?' })).not.toBeInTheDocument();
  });

  it('is done at once where a fan is brought to a place a controller stands in', async () => {
    state.spaces = [mother];
    state.claim = { device: { ...fan, spaceId: 'space-mother' }, spaceCreated: false };
    state.devices = [{ ...device, id: 'sim-controller-0001', spaceId: 'space-mother' }];
    draw('/claim?space=space-mother');

    await screen.findByText('Place: Mother tent');
    fireEvent.change(screen.getByRole('textbox', { name: 'Claim code' }), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Claim it' }));

    await waitFor(() => expect(address()).toBe('/spaces/space-mother'));
    expect(told).toEqual([{ label: 'Mother tent: Fan now hangs here', undo: null }]);
    expect(api.put).not.toHaveBeenCalled();
  });

  it("does not claim into a place of somebody else's that the address names", async () => {
    state.spaces = [clubTent];
    const drawn = draw('/claim?space=space-host');
    await settled(drawn);

    expect(screen.queryByText(/^Place:/)).not.toBeInTheDocument();
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
    const picked = left('place', { ask: `place.${ASKED}`, made: 'space-new' });
    draw(picked);

    await hangQuestion('controller');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Add controller$/);
    expect(offered()).toEqual(['At a new place', 'Mother tent']);
    expect(address()).toBe(picked);

    fireEvent.click(screen.getByRole('button', { name: /^Mother tent/ }));

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
    fireEvent.click(screen.getByRole('button', { name: /^Mother tent/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You may not put a device there.');
    expect(screen.getByRole('heading', { level: 2, name: 'Where does the controller hang?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Mother tent/ })).toBeEnabled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  /**
   * Every question is an entry of the history, so Back is one question back. The code is spent by the claim, so
   * nothing leads back to the field that asked for it: before the first question lies the place the device hangs in.
   */
  it('goes one question back on Back, and from the first to the Start of the place - never to the code', async () => {
    await drawClaimed();
    fireEvent.click(screen.getByRole('button', { name: 'Next · sockets and cam?' }));
    await waitFor(() => expect(openStep()).toHaveTextContent('Sockets and cam'));
    expect(address()).toBe(left('hardware', { made: 'space-new' }));

    fireEvent.click(screen.getByRole('button', { name: 'browser back' }));
    await waitFor(() => expect(openStep()).toHaveTextContent('What is it doing right now?'));
    expect(address()).toBe(left('doing', { made: 'space-new' }));
    // The step that was reached stays answered: Back corrects one, it does not take the others back.
    expect(screen.getByRole('button', { name: 'Sockets and cam' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'browser back' }));
    await waitFor(() => expect(address()).toBe('/spaces/space-new'));
    expect(screen.queryByRole('textbox', { name: 'Claim code' })).not.toBeInTheDocument();
  });

  it('leaves the question of where it hangs by its own Back as by the browser´s: to the place the device hangs in', async () => {
    state.spaces = [space, mother];
    claim();

    await hangQuestion('controller');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(address()).toBe('/spaces/space-new'));
    // The device stays in the place its claim made, which is no stray one: the controller stands in it.
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('opens the question of where it hangs again from the step that says it, and comes back from it by Back', async () => {
    state.spaces = [space, mother];
    claim();
    await hangQuestion('controller');
    fireEvent.click(screen.getByRole('button', { name: /^At a new place/ }));
    await waitFor(() => expect(openStep()).toHaveTextContent('What is it doing right now?'));

    fireEvent.click(screen.getByRole('button', { name: 'Where it hangs' }));
    expect(await hangQuestion('controller')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(openStep()).toHaveTextContent('What is it doing right now?'));
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
    draw(left('hardware'));

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
