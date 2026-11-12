import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { type InitialEntry, Route, Routes, useLocation } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Device, DeviceCapabilities, DeviceConfiguration, Socket, SocketPage as SocketTable } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import type { OutputLevel, OverrideRequest } from '@/api/devices';
import { HandHold, type Held } from '@/screens/devices/HandHold';
import { LightOutputRow } from '@/screens/devices/LightOutputRow';
import { lightOutputOf, rememberLightHold, useLightHold } from '@/screens/devices/lights';
import { SocketPage } from '@/screens/devices/SocketPage';
import { PairSocketRow } from '@/screens/devices/SocketSheets';
import { HOLD_SECONDS, rowsOf, runsOf } from '@/screens/devices/sockets';
import { durationLabel } from '@/ui/age';
import { Rows } from '@/ui/Rows';
import { deviceWith } from './fixtures';
import { announced, drawAt } from './harness';
import { spaceWhere, THE_HOST } from './session';
import { translate } from './translations';

/**
 * Holding an output by hand - a smart socket on its own page, the controller's
 * light output under Ausgänge - and pairing and removing a socket.
 *
 * One control holds both: Auto, On, Off, and the lengths of a hold under a
 * head that names the way. It sends what a tap names and nothing else, once,
 * and claims nothing the device has not reported.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

type Receipt = { deviceOnline: boolean };

/** What the device's commands were asked and how they are answered; `answer` undefined leaves a request on its way. */
const wire = vi.hoisted(() => ({
  answer: { deviceOnline: true } as Receipt | undefined,
  open: false,
  said: undefined as Receipt | undefined,
}));
const sent: OverrideRequest[] = [];
const tested: { deviceId: string; slot: number }[] = [];

vi.mock('@/api/devices', async importOriginal => ({
  ...(await importOriginal<object>()),
  useSetOverride: () => ({
    mutate: (request: OverrideRequest, options?: { onSuccess?: (answer: Receipt) => void }) => {
      sent.push(request);
      wire.said = wire.answer;
      if (wire.answer) options?.onSuccess?.(wire.answer);
      else wire.open = true;
    },
    data: wire.said,
    error: null,
    isPending: wire.open,
  }),
  useTestSocket: () => ({
    mutate: (request: { deviceId: string; slot: number }, options?: { onSuccess?: (answer: Receipt) => void }) => {
      tested.push(request);
      options?.onSuccess?.({ deviceOnline: true });
    },
    data: undefined,
    error: null,
    isPending: false,
  }),
}));

/** What the pages said in a toast, which is the app's and not theirs to draw. */
const told: { label: string; undo: unknown }[] = [];
vi.mock('@/log/log-context', async importOriginal => ({
  ...(await importOriginal<object>()),
  useLog: () => ({ tell: (one: { label: string; undo: unknown }) => told.push(one) }),
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

/** What the API answers the pages with; a test sets what it is about and draws. */
const account = {
  devices: [] as Device[],
  sockets: [] as Socket[],
  capabilities: CAPABILITIES,
  youMay: 'own' as AccessNeed,
  verdict: undefined as unknown,
};

const table = (): SocketTable => ({ items: account.sockets, nextCursor: null, capabilities: account.capabilities });

const answer = () =>
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/devices') return Promise.resolve({ items: account.devices, nextCursor: null }) as never;
    if (path === '/spaces') return Promise.resolve({ items: [spaceWhere(account.youMay)], nextCursor: null }) as never;
    if (path === '/me') return Promise.resolve({ id: 'user-1', handle: 'you' }) as never;
    if (path === '/spaces/space-1/overview') return Promise.resolve({ verdict: account.verdict }) as never;
    if (path.endsWith('/sockets')) return Promise.resolve(table()) as never;
    if (path.endsWith('/live')) return Promise.resolve({ deviceId: 'device-1', metrics: {}, outputs: {}, setpoints: null, pending: null }) as never;

    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });

/** A controller somebody else owns, standing in the tent the reader may do `account.youMay` in, heard a moment ago. */
const controller = (lastSeenAt = NOW.minus({ seconds: 20 })): Device => deviceWith({ ownerId: THE_HOST, state: { lastSeenAt: lastSeenAt.toISO()! } });

function Elsewhere() {
  const { pathname, search } = useLocation();
  return <p>{`at ${pathname}${search}`}</p>;
}

/** The page of the one socket the device reports, at its address, once it is drawn and knows what the reader may do. */
const drawSocket = async (one: Socket | null, at?: InitialEntry) => {
  if (one) account.sockets = [one];
  const drawn = drawAt(
    <Routes>
      <Route path="/devices/:deviceId/sockets/:socket" element={<SocketPage />} />
      <Route path="*" element={<Elsewhere />} />
    </Routes>,
    { at: at ?? `/devices/device-1/sockets/${one ? rowsOf([one])[0].key : 'socket-0-heater'}` },
  );
  await screen.findByRole('heading');
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(call => call[0] === '/spaces')).toBe(true));
  if (account.youMay === 'own' && one) await screen.findByRole('button', { name: /address, role/i });

  return drawn;
};

const way = (name: 'Auto' | 'On' | 'Off') => screen.getByRole('button', { name });
const pressed = () => (['Auto', 'On', 'Off'] as const).filter(name => way(name).getAttribute('aria-pressed') === 'true');

beforeAll(async () => {
  await translate();
  // The pages age what they draw against the clock, so it stands still at the instant the fixtures are dated from.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW.toJSDate());
});
afterAll(() => vi.useRealTimers());

beforeEach(() => {
  sent.length = 0;
  tested.length = 0;
  told.length = 0;
  Object.assign(wire, { answer: { deviceOnline: true }, open: false, said: undefined });
  Object.assign(account, { devices: [controller()], sockets: [], capabilities: CAPABILITIES, youMay: 'own', verdict: undefined });
  localStorage.clear();
  for (const call of [api.post, api.patch, api.put, api.delete]) vi.mocked(call).mockReset();
  answer();
});

describe('holding an output by hand', () => {
  const hold = (held: Held | null = null, now = NOW, onHeard?: (hold: Held | null) => void) => (
    <HandHold name="Exhaust" deviceId="device-1" target={{ kind: 'socket', slot: 2 }} held={held} help="socketHold" now={now} onHeard={onHeard} />
  );

  it('sends nothing for On or Off until a length is chosen, under a head that names the way', () => {
    drawAt(hold());

    expect(pressed()).toEqual(['Auto']);
    fireEvent.click(way('Off'));

    expect(sent).toEqual([]);
    const lengths = screen.getByRole('group', { name: 'Hold off for' });
    expect(within(lengths).getAllByRole('button', { name: /^Switch Exhaust off for / })).toHaveLength(HOLD_SECONDS.length);
    expect(HOLD_SECONDS.map(durationLabel)).toEqual(['15 min', '1 h', '4 h', '8 h', '24 h']);
    // Not in force yet, so not marked as though it were.
    expect(pressed()).toEqual(['Auto']);
    expect(way('Off')).toHaveAttribute('aria-expanded', 'true');
  });

  it('sends the way its head names with one write, marks it at once and names it in a toast', () => {
    drawAt(hold());

    fireEvent.click(way('On'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch Exhaust on for 15 min' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 2 }, state: 'on', forSeconds: 900 }]);
    expect(told).toEqual([{ label: 'Exhaust on · for 15 min', undo: null }]);
    expect(pressed()).toEqual(['On']);
    expect(screen.getByText('switching …')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Hold on for' })).not.toBeInTheDocument();
  });

  /** The blocker this control replaces: a chip under "Hold for" that sent whichever way the socket was not in. */
  it.each([
    ['On', 'on'],
    ['Off', 'off'],
  ] as const)('holds %s whatever the output is doing, never the other way', (name, state) => {
    drawAt(hold());

    fireEvent.click(way(name));
    for (const length of screen.getAllByRole('button', { name: /^Switch Exhaust / }))
      expect(length).toHaveAccessibleName(new RegExp(` ${state} for `));
    fireEvent.click(screen.getByRole('button', { name: `Switch Exhaust ${state} for 4 h` }));

    expect(sent.map(one => [one.state, one.forSeconds])).toEqual([[state, 4 * 3600]]);
  });

  it('sends nothing on a second tap while the first is on its way', () => {
    wire.answer = undefined;
    drawAt(hold());

    fireEvent.click(way('On'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch Exhaust on for 1 h' }));
    expect(screen.getByText('switching …')).toBeInTheDocument();

    fireEvent.click(way('Off'));
    fireEvent.click(way('Auto'));

    expect(screen.queryByRole('group', { name: 'Hold off for' })).not.toBeInTheDocument();
    expect(sent).toHaveLength(1);
    // Nothing is said to have happened before the server has answered.
    expect(told).toEqual([]);
  });

  it('hands a held output back with one tap and no length, and does not send the way that already holds again', () => {
    drawAt(hold({ state: 'on', until: NOW.plus({ minutes: 42 }).toISO()! }));

    expect(pressed()).toEqual(['On']);
    fireEvent.click(way('On'));
    expect(screen.queryByRole('group', { name: 'Hold on for' })).not.toBeInTheDocument();

    fireEvent.click(way('Auto'));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 2 }, state: 'auto', forSeconds: 0 }]);
    expect(told).toEqual([{ label: 'Exhaust back on auto', undo: null }]);
    expect(pressed()).toEqual(['Auto']);
  });

  it('takes the device´s word once it reports, and stops waiting for one that says nothing', () => {
    const { rerender } = drawAt(hold());
    fireEvent.click(way('On'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch Exhaust on for 15 min' }));

    rerender(hold({ state: 'on', until: NOW.plus({ minutes: 15 }).toISO()! }, NOW.plus({ seconds: 30 })));
    expect(screen.queryByText('switching …')).not.toBeInTheDocument();
    expect(pressed()).toEqual(['On']);

    fireEvent.click(way('Auto'));
    expect(screen.getByText('switching …')).toBeInTheDocument();
    rerender(hold({ state: 'on', until: NOW.plus({ minutes: 15 }).toISO()! }, NOW.plus({ seconds: 70 })));

    // The table still says it is held: the app's own word is not kept past a minute.
    expect(screen.getByText('The device did not confirm it.')).toBeInTheDocument();
    expect(pressed()).toEqual(['On']);
  });

  it('marks nothing and tells nothing where nobody was listening, and says so', async () => {
    wire.answer = { deviceOnline: false };
    const heard = vi.fn();
    drawAt(hold(null, NOW, heard));

    fireEvent.click(way('On'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch Exhaust on for 15 min' }));

    await waitFor(() => expect(announced()).toHaveTextContent('Nobody was listening'));
    expect(pressed()).toEqual(['Auto']);
    expect(told).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
  });

  it('closes the lengths again on a second tap of the way, and on Auto, without a write', () => {
    drawAt(hold());

    fireEvent.click(way('On'));
    fireEvent.click(way('On'));
    expect(screen.queryByRole('group', { name: 'Hold on for' })).not.toBeInTheDocument();

    fireEvent.click(way('Off'));
    fireEvent.click(way('Auto'));
    expect(screen.queryByRole('group', { name: 'Hold off for' })).not.toBeInTheDocument();
    expect(sent).toEqual([]);
  });
});

describe('a smart socket on its own page', () => {
  it('says what the socket is doing, in the device´s words, and holds it by the one control', async () => {
    await drawSocket(socket());

    expect(screen.getByText('off · Auto')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Hold Heater by hand' })).getByRole('button', { name: 'On' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch Heater on for 1 h' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'on', forSeconds: 3600 }]);
    expect(told.map(one => one.label)).toEqual(['Heater on · for 1 h']);
    // What the device last reported stays on the page until it reports again.
    expect(screen.getByText('off · Auto')).toBeInTheDocument();
  });

  /** The page's chips used to mean "the other way for this long": under "Hold for" a socket that was on was switched off. */
  it('holds a socket that is on by itself on when On is asked, and off only when Off is', async () => {
    await drawSocket(socket({ state: 'on' }));

    expect(screen.getByText('on · Auto')).toBeInTheDocument();
    fireEvent.click(way('On'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch Heater on for 15 min' }));

    expect(sent.map(one => [one.state, one.forSeconds])).toEqual([['on', 900]]);
    expect(screen.queryByRole('button', { name: /Switch Heater off/ })).not.toBeInTheDocument();
  });

  it('takes the device´s answer when its table comes', async () => {
    const { client } = await drawSocket(socket());
    fireEvent.click(way('On'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch Heater on for 15 min' }));
    expect(screen.getByText('switching …')).toBeInTheDocument();

    account.sockets = [socket({ state: 'on', override: { state: 'on', validUntil: NOW.plus({ minutes: 15 }).toISO()! } })];
    await act(() => client.invalidateQueries());

    expect(await screen.findByText(/held on · 15 min/)).toBeInTheDocument();
    expect(screen.queryByText('switching …')).not.toBeInTheDocument();
    expect(pressed()).toEqual(['On']);
  });

  it('finds the socket by a row of its own, and says what that does to it', async () => {
    await drawSocket(socket());

    const find = screen.getByRole('button', { name: /^Find it/ });
    expect(find).toHaveTextContent('switches it on for 2 seconds and off again');
    fireEvent.click(find);

    expect(tested).toEqual([{ deviceId: 'device-1', slot: 0, forSeconds: 5 }]);
    expect(told.map(one => one.label)).toEqual(['Heater comes on for 2 seconds and goes off · the device puts the socket back within a minute']);
    expect(sent).toEqual([]);
  });

  /** Finding a socket is a command every build in the field takes, so only holding is refused for an old build. */
  it('draws no control for a build that holds nothing, says why once, and still finds the socket', async () => {
    account.capabilities = { ...CAPABILITIES, socketOverride: false };
    await drawSocket(socket());

    expect(screen.queryByRole('group', { name: 'Hold Heater by hand' })).not.toBeInTheDocument();
    expect(screen.getAllByText(/^This firmware holds no socket by hand\./)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Find it/ })).not.toHaveAttribute('aria-disabled');
  });

  it('draws no control for a device nobody hears, dates what it shows, and makes finding and removing wait', async () => {
    account.devices = [controller(NOW.minus({ days: 4 }))];
    account.capabilities = { ...CAPABILITIES, socketOverride: false };
    await drawSocket(socket());

    expect(screen.queryByRole('group', { name: 'Hold Heater by hand' })).not.toBeInTheDocument();
    // Being unreachable stops more than an old build does, so it is the reason that is said.
    expect(screen.getByText('Offline · nothing is listening, so nothing is sent.')).toBeInTheDocument();
    expect(screen.queryByText(/This firmware holds no socket/)).not.toBeInTheDocument();
    expect(screen.getByText(/^as of /)).toBeInTheDocument();
    for (const name of [/^Find it/, /^Address, role, credentials/, /^Remove the socket/]) {
      const row = screen.getByRole('button', { name });
      expect(row).toHaveAttribute('aria-disabled', 'true');
      expect(row).toHaveTextContent('has to wait until the device is back online');
      fireEvent.click(row);
    }
    expect(tested).toEqual([]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('gives somebody who may only write lines the state, and nothing to hold, find or change', async () => {
    account.youMay = 'log';
    await drawSocket(socket({ state: 'on', override: { state: 'on', validUntil: NOW.plus({ minutes: 42 }).toISO()! } }));

    expect(await screen.findByText(/held on · 42 min/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Hold Heater by hand' })).not.toBeInTheDocument());
    for (const name of [/^Find it/, 'Address, role, credentials', /^Remove the socket/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/Offline|firmware/)).not.toBeInTheDocument();
  });

  it('holds a socket the device says nothing about like any other, and says since when one stopped answering', async () => {
    const { unmount } = await drawSocket(socket({ state: 'unknown', stateChangedAt: null }));
    expect(screen.getByText('not reported')).toBeInTheDocument();
    expect(pressed()).toEqual(['Auto']);
    unmount();

    await drawSocket(socket({ state: 'unknown', stateChangedAt: NOW.minus({ minutes: 7 }).toISO()! }));
    expect(screen.getByText(/no answer · 7 min/)).toBeInTheDocument();
  });

  /** How often an output came on is the place's own 24 h verdict, which the page asks the place for. */
  it('shows where it is reached and counts how often its output came on in the place the device stands in', async () => {
    account.verdict = { actuators: [{ output: 'heater', runCount: 3, forSeconds: 900 }] };
    await drawSocket(socket());

    expect(screen.getByText('10.0.0.63')).toBeInTheDocument();
    expect(await screen.findByText('3× in the last 24 h')).toBeInTheDocument();
    expect(runsOf(undefined, 'heater')).toBeNull();
  });

  it('is named by its role, numbered where the role holds several, and leads back to the device it hangs on', async () => {
    account.sockets = [socket({ slot: 0, role: 'light', address: '10.0.0.61' }), socket({ slot: 1, role: 'light', address: '10.0.0.62' })];
    await drawSocket(null, '/devices/device-1/sockets/socket-1-light');

    expect(await screen.findByRole('heading', { name: 'Socket Light 2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'via Controller' })).toHaveAttribute('href', '/devices/device-1');
    // Opened by its address alone, the way back is Steuerung of the place the device stands in.
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/control?space=space-1');
  });

  /** A role changed from the page changes the key the address was built from; the slot is what stays. */
  it('is still found by its slot once its role was changed', async () => {
    account.sockets = [socket({ slot: 2, role: 'pump', timer: { onSeconds: 120, everySeconds: 21600 } })];
    const drawn = await drawSocket(null, '/devices/device-1/sockets/socket-2-heater');

    expect(await screen.findByRole('heading', { name: 'Socket Pump' })).toBeInTheDocument();
    expect(await screen.findByText('on 2 min every 6 h')).toBeInTheDocument();
    // The cycle is changed with the rest of the socket, and a timed socket without one says that it stays off.
    expect(screen.getByRole('button', { name: 'Timer, address, role' })).toBeInTheDocument();
    account.sockets = [socket({ slot: 2, role: 'pump' })];
    await act(() => drawn.client.invalidateQueries());
    expect(await screen.findByRole('button', { name: /^Timer, address, role/ })).toHaveTextContent('No timer set – without one the socket stays off');
  });

  /** An address that names no socket of the device is a page all the same: a heading, which titles the window, and a way on. */
  it('says a socket the device no longer reports is gone, under a heading, with the way back and the way on to its device', async () => {
    await drawSocket(null, '/devices/device-1/sockets/x');

    expect(screen.getByRole('heading', { level: 1, name: 'Socket' })).toBeInTheDocument();
    expect(await screen.findByText('Controller no longer reports this socket.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/control?space=space-1');
    expect(screen.getByRole('link', { name: 'Everything about Controller' })).toHaveAttribute('href', '/devices/device-1');
    // Nothing of a socket is offered where there is none.
    expect(screen.queryByRole('button', { name: /address, role|Find|Auto/i })).not.toBeInTheDocument();
  });

  describe('removing it', () => {
    const FROM_OUTPUTS = { pathname: '/devices/device-1/sockets/socket-0-heater', state: { back: '/control/outputs?space=space-1' } };

    it('asks first, then says so in a toast and leads back to where the socket was opened from', async () => {
      vi.mocked(api.delete).mockResolvedValue({ publishedAt: NOW.toISO(), deviceOnline: true } as never);
      account.sockets = [socket(), socket({ slot: 1, role: 'pump', hardwareId: 'AA', address: '10.0.0.64' })];
      const { client } = await drawSocket(null, FROM_OUTPUTS);

      fireEvent.click(await screen.findByRole('button', { name: /^Remove the socket/ }));
      expect(api.delete).not.toHaveBeenCalled();
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove Heater?' })).getByRole('button', { name: 'Remove' }));

      expect(await screen.findByText('at /control/outputs?space=space-1')).toBeInTheDocument();
      expect(api.delete).toHaveBeenCalledExactlyOnceWith('/devices/device-1/sockets/0');
      expect(told).toEqual([{ label: 'Socket Heater removed', undo: null }]);
      // Off the screen at once: no row offers it while the device's next table is on its way.
      expect(client.getQueryData<SocketTable>(['devices', 'device-1', 'sockets'])?.items.map(one => one.role)).toEqual(['pump']);
    });

    it('keeps the question open and the socket where it is when nobody was listening', async () => {
      vi.mocked(api.delete).mockResolvedValue({ publishedAt: NOW.toISO(), deviceOnline: false } as never);
      await drawSocket(socket(), FROM_OUTPUTS);

      fireEvent.click(screen.getByRole('button', { name: /^Remove the socket/ }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Nobody was listening');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(told).toEqual([]);
    });
  });

  it('answers a change with a toast and closes the sheet', async () => {
    vi.mocked(api.put).mockResolvedValue({ publishedAt: NOW.toISO(), deviceOnline: true } as never);
    await drawSocket(socket());

    fireEvent.click(screen.getByRole('button', { name: 'Address, role, credentials' }));
    const sheet = screen.getByRole('dialog', { name: 'Change Heater' });
    // Nothing is explained above the fields; what there is to know stands behind the (i).
    expect(within(sheet).queryByText(/Tasmota|local network/)).not.toBeInTheDocument();
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Address' }), { target: { value: '10.0.0.70' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.put).toHaveBeenCalledExactlyOnceWith('/devices/device-1/sockets/0', {
      role: 'heater',
      address: '10.0.0.70',
      credentials: null,
      timer: null,
    });
    expect(told).toEqual([{ label: 'Socket Heater changed', undo: null }]);
  });
});

describe('pairing a socket from the device´s page', () => {
  const row = (sockets: Socket[] | null, { unheard = false, now = NOW } = {}) => (
    <Rows>
      <PairSocketRow
        deviceId="device-1"
        deviceName="Controller"
        table={sockets ? { items: sockets, nextCursor: null, capabilities: CAPABILITIES } : undefined}
        failed={false}
        unheard={unheard}
        now={now}
      />
    </Rows>
  );

  it('counts the sockets, pairs another by its address, says so in a toast and shows it on its way at once', async () => {
    vi.mocked(api.put).mockResolvedValue({ publishedAt: NOW.toISO(), deviceOnline: true } as never);
    const { rerender } = drawAt(row([socket()]));

    const pair = screen.getByRole('button', { name: /^Pair a socket/ });
    expect(pair).toHaveTextContent('1 paired');
    fireEvent.click(pair);
    const sheet = screen.getByRole('dialog', { name: 'Pair a socket by IP' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pump' }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Address' }), { target: { value: '10.0.0.70' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pair' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.put).toHaveBeenCalledExactlyOnceWith('/devices/device-1/sockets/new', {
      role: 'pump',
      address: '10.0.0.70',
      credentials: null,
      timer: { onSeconds: 120, everySeconds: 21600 },
    });
    expect(told).toEqual([{ label: 'Socket Pump paired · it shows up once the device reports it', undo: null }]);
    expect(screen.getByRole('button', { name: /^Pair a socket/ })).toHaveTextContent('1 paired · one is being paired …');

    // The device's table holds it: the count is its word again.
    rerender(row([socket(), socket({ slot: 1, role: 'pump' })]));
    expect(screen.getByRole('button', { name: /^Pair a socket/ })).toHaveTextContent(/^Pair a socket2 paired$/);
  });

  it('keeps the sheet and what was typed when nobody was listening', async () => {
    vi.mocked(api.put).mockResolvedValue({ publishedAt: NOW.toISO(), deviceOnline: false } as never);
    drawAt(row([]));

    expect(screen.getByRole('button', { name: /^Pair a socket/ })).toHaveTextContent('none paired');
    fireEvent.click(screen.getByRole('button', { name: /^Pair a socket/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Heater' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Address' }), { target: { value: '10.0.0.70' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Controller is not listening right now, so nothing changed.');
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue('10.0.0.70');
    expect(told).toEqual([]);
  });

  it('waits for a device nobody hears, and for a table that is not read yet', () => {
    const { rerender } = drawAt(row([socket()], { unheard: true }));

    const pair = screen.getByRole('button', { name: /^Pair a socket/ });
    expect(pair).toHaveAttribute('aria-disabled', 'true');
    expect(pair).toHaveTextContent('1 paired · has to wait until the device is back online');
    fireEvent.click(pair);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(row(null));
    expect(screen.getByRole('button', { name: /^Pair a socket/ })).toHaveAttribute('aria-disabled', 'true');
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
  const device = (configuration: DeviceConfiguration | null, type = 'controller'): Device => ({ id: 'device-1', type, configuration }) as Device;
  const LIGHTS = { sunrise: 15, sunset: 15, limit: 80 };
  const LIVE: OutputLevel = { percent: 80, measuredAt: NOW.minus({ seconds: 20 }).toISO()!, state: 'live' };

  const drawOutput = ({
    capabilities = CAPABILITIES,
    level = LIVE as OutputLevel | null,
    offline = false,
    mayManage = true,
    of = device({ lights: LIGHTS }),
  } = {}) =>
    drawAt(
      <ul>
        <LightOutputRow output={lightOutputOf(of, capabilities, level)!} offline={offline} mayManage={mayManage} runs={null} now={NOW} />
      </ul>,
    );

  it('says what the lamp is running at and how old that is, and offers neither a switch nor a second place for the limit', () => {
    drawOutput();

    expect(screen.getByText('Light output').nextElementSibling).toHaveTextContent('now 80 % · 20 s ago');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('says a lamp that fell silent four days ago was at its level as of then, not now', () => {
    drawOutput({ level: { percent: 60, measuredAt: NOW.minus({ days: 4 }).toISO()!, state: 'offline' } });

    expect(screen.getByText('Light output').nextElementSibling).toHaveTextContent(/^60 % · as of 15 Sep/);
    expect(screen.queryByText(/now/)).not.toBeInTheDocument();
  });

  it('holds the output by the control a socket is held by, for the length chosen, and hands it back with none', () => {
    drawOutput();

    fireEvent.click(within(screen.getByRole('group', { name: 'Hold Light output by hand' })).getByRole('button', { name: 'On' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch Light output on for 4 h' }));
    fireEvent.click(way('Auto'));

    expect(sent).toEqual([
      { deviceId: 'device-1', target: { kind: 'output', output: 'light' }, state: 'on', forSeconds: 4 * 3600 },
      { deviceId: 'device-1', target: { kind: 'output', output: 'light' }, state: 'auto', forSeconds: 0 },
    ]);
    expect(told.map(one => one.label)).toEqual(['Light output on · for 4 h', 'Light output back on auto']);
  });

  it('marks the hold it sent, and until when, since the device reports none back - here and wherever else it is read', () => {
    const elsewhere = renderHook(() => useLightHold('device-1', DateTime.fromMillis(Date.now())));
    drawOutput();

    expect(pressed()).toEqual(['Auto']);
    fireEvent.click(way('Off'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch Light output off for 1 h' }));

    expect(pressed()).toEqual(['Off']);
    expect(screen.getByText(/^held off until \d\d:\d\d$/)).toBeInTheDocument();
    expect(elsewhere.result.current).toEqual({ state: 'off', until: NOW.plus({ hours: 1 }).toUTC().toISO() });

    fireEvent.click(way('Auto'));
    expect(pressed()).toEqual(['Auto']);
    expect(screen.queryByText(/until/)).not.toBeInTheDocument();
    expect(elsewhere.result.current).toBeNull();
  });

  it('forgets a hold whose time is up, and remembers nothing nobody heard', () => {
    act(() => rememberLightHold('device-1', { state: 'on', until: NOW.plus({ minutes: 15 }).toISO()! }));
    expect(renderHook(() => useLightHold('device-1', NOW.plus({ minutes: 14 }))).result.current?.state).toBe('on');
    expect(renderHook(() => useLightHold('device-1', NOW.plus({ minutes: 16 }))).result.current).toBeNull();
    expect(renderHook(() => useLightHold('device-2', NOW)).result.current).toBeNull();
    act(() => rememberLightHold('device-1', null));

    wire.answer = { deviceOnline: false };
    drawOutput();
    fireEvent.click(way('On'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch Light output on for 1 h' }));

    expect(pressed()).toEqual(['Auto']);
    expect(localStorage.getItem('terp.lightHold.device-1')).toBeNull();
  });

  it('draws no control for a build that never announced a hold, and says why once', () => {
    drawOutput({ capabilities: { ...CAPABILITIES, lightOverride: false } });

    expect(screen.queryByRole('button', { name: 'On' })).not.toBeInTheDocument();
    expect(screen.getAllByText('This firmware cannot be told to hold its light output.')).toHaveLength(1);
  });

  it('draws no control for a device nobody is listening on, and says that it waits for the device', () => {
    drawOutput({ level: null, offline: true });

    expect(screen.queryByRole('button', { name: 'Off' })).not.toBeInTheDocument();
    expect(screen.getByText(/^Offline: holding the light by hand/)).toBeInTheDocument();
    expect(screen.getByText('nothing reported')).toBeInTheDocument();
  });

  it('gives a reader who may not manage the level alone', () => {
    drawOutput({ mayManage: false, offline: true });

    expect(screen.getByText(/now 80 %/)).toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });

  it('is there for a build that announced the override, for one that states a brightness, and for a lamp that reported one', () => {
    const none: DeviceCapabilities = { ...CAPABILITIES, lightOverride: false };

    expect(lightOutputOf(device(null), CAPABILITIES, null)).not.toBeNull();
    expect(lightOutputOf(device({ lights: LIGHTS }), none, null)).not.toBeNull();
    // Nested or flat, as a client once wrote it.
    expect(lightOutputOf(device({ 'lights.limit': 60 }), none, null)).not.toBeNull();
    expect(lightOutputOf(device({}), none, { percent: 40, measuredAt: NOW.toISO()!, state: 'live' })?.level?.percent).toBe(40);
    expect(lightOutputOf(device({}), none, null)).toBeNull();
  });

  /** A Light keeps its brightness at the top of its document and reads nothing else, so a lamp capped at 0 % was no light output at all. */
  it('reads a Light´s brightness where the Light keeps it, and tells it of no hold it could never take', () => {
    const lamp = device({ day: 21600, night: 79200, sunrise: 0, sunset: 0, limit: 0 }, 'light');

    expect(lightOutputOf(lamp, { ...CAPABILITIES, lightOverride: false }, null)).not.toBeNull();

    drawOutput({ of: lamp, level: null });
    // No Light build takes a hold, so it is not told to wait for one.
    expect(screen.queryByRole('button', { name: 'On' })).not.toBeInTheDocument();
    expect(screen.getByText('This kind of device cannot be told to hold its light output.')).toBeInTheDocument();
    expect(screen.queryByText(/This firmware/)).not.toBeInTheDocument();
  });
});
