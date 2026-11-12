import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime, Settings } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DeviceConfiguration, PendingSettings } from '@fg2/shared-types/v1';
import type { Told } from '@/log/log-context';
import { FridgeFansPanel } from '@/screens/control/devices/FridgeFansPanel';
import { fanSummaryOf, ownFactOf, ownStatusOf, plugSummaryOf } from '@/screens/control/devices/own-summary';
import { OwnOutputs } from '@/screens/control/devices/OwnOutputs';
import { PlugPanel } from '@/screens/control/devices/PlugPanel';
import { OwnSettings } from '@/screens/control/OwnSettings';
import { climateDeviceOf, lightWindowOf, rangeVerdictOf, switchRangeOf } from '@/screens/start/place';
import { drawAt, json } from './harness';
import { Toast } from './toast';
import { translate } from './translations';

/**
 * What a Plantalytix Socket, an AIR fan, a LIGHT and a fridge's fans are set
 * to: each built from the parts a controller's climate is - a figure that
 * opens its sheet, a switch written on the tap, the light's own card - and
 * saved the one way every setting of a device is: by the name the contract
 * gives it, answered by the toast with the way back, and for a device that is
 * not heard said as stored and not yet taken, with what the device still
 * holds. Then what Start and a device's card say about them.
 *
 * The page reads in UTC, so a time on the screen is the time in the document.
 */

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');
  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

const PLUG: DeviceConfiguration = {
  workmode: 'heater',
  usedaynight: false,
  daynight: { day: 21600, night: 79200 },
  timer: { timeframes: [] },
  heater: { day: { on: 22, off: 25 }, night: { on: 20, off: 23 } },
  cooler: { day: { on: 28, off: 25 }, night: { on: 26, off: 23 } },
  co2: { mode: 'const', period: 60, duration: 10, on: 600, off: 1000 },
  fan: '',
};

const FAN: DeviceConfiguration = {
  mode: 0,
  min_speed: 30,
  day: { temperature: 25, humidity: 60, fixed_speed: 70, max_speed: 100 },
  night: { temperature: 21, humidity: 55, fixed_speed: 40, max_speed: 60 },
};

const LIGHT: DeviceConfiguration = { day: 21600, night: 79200, limit: 80, sunrise: 15, sunset: 15, max_temperature: 35 };

const FRIDGE: DeviceConfiguration = { workmode: 'small', day: { temperature: 25 }, night: { temperature: 20 }, fans: { external: 60, internal: 30 } };

/** Three in the afternoon, UTC; a silent device was last heard at one. */
const THREE = Date.parse('2026-09-19T15:00:00.000Z');
const HEARD = '2026-09-19T13:00:00.000Z';
const SAVED = '2026-09-19T14:31:00.000Z';

const device = (id: string, type: string, configuration: DeviceConfiguration | null, lastSeenAt = DateTime.now().toISO()): Device =>
  ({
    id,
    type,
    name: type,
    classId: null,
    ownerId: 'user-1',
    spaceId: 'space-1',
    firmware: { channel: 'manual', targetId: null },
    configuration,
    control: null,
    isDemo: false,
    settings: { vpdLeafOffsetDay: 0, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0 },
    state: {
      lastSeenAt,
      firmwareId: null,
      hardware: {},
      maintenanceUntil: null,
      socketStateChangedAt: {},
      socketsReportedAt: null,
    },
  }) as unknown as Device;

const silent = (id: string, type: string, configuration: DeviceConfiguration): Device => device(id, type, configuration, HEARD);

const calls: { method: string; path: string; body: { set?: Record<string, unknown> } }[] = [];
/** What the cloud stored that a silent device has not been handed, as its live read says it. */
let pending: PendingSettings['settings'] | null = null;

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace(/^\/v1/, '');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });

    if (method === 'PATCH') return json(device(path.split('/')[2], 'plug', PLUG));
    if (path.endsWith('/live') && pending)
      return json({ deviceId: path.split('/')[2], metrics: {}, outputs: {}, setpoints: null, pending: { since: HEARD, settings: pending } });
    return json({ status: 404, code: path.endsWith('/plan') ? 'plan_not_found' : 'not_found', title: '', detail: '', errors: [] }, 404);
  }),
);

const patches = () => calls.filter(call => call.method === 'PATCH');

/** What the toast was told: the line, and the way it is taken back. */
const told: Told[] = [];
const said = (at = 0) => told[at]?.label.replace(/\u00a0/g, ' ');

/** What a device is set to that is its own: Steuerung's top where it leads the place, its own page otherwise. */
const draw = (one: Device) =>
  drawAt(
    <Toast told={told}>
      <OwnSettings device={one} />
    </Toast>,
  );

const t = (key: string, options?: Record<string, unknown>) => i18next.t(key, options);

/** The button of a figure or a choice, by the setting it changes. */
const setting = (name: string) => screen.getByRole('button', { name: new RegExp(`^Change ${name}, `) });
const sheet = () => screen.getByRole('dialog');
const type = (name: string, to: number) => {
  const field = within(sheet()).getByRole('spinbutton', { name });
  fireEvent.change(field, { target: { value: String(to) } });
  fireEvent.blur(field);
};
const save = () => fireEvent.click(within(sheet()).getByRole('button', { name: 'Save' }));
/** The text of a note, a figure bound to its unit by a space that does not break. */
const plain = (node: Element) => node.textContent?.replace(/\u00a0/g, ' ');

beforeAll(async () => {
  Settings.defaultZone = 'utc';
  await translate();
});

afterAll(() => {
  Settings.defaultZone = 'system';
});

beforeEach(() => {
  calls.length = 0;
  told.length = 0;
  pending = null;
});

afterEach(() => {
  Settings.now = () => Date.now();
  vi.useRealTimers();
});

describe('a Plantalytix Socket where a controller’s climate stands', () => {
  it('changes what it switches by on a sheet, saves the one setting by name, and takes it back from the toast', async () => {
    draw(device('plug-1', 'plug', PLUG));

    fireEvent.click(setting('Switches by'));
    expect(within(sheet()).getByRole('button', { name: 'Heating' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet()).getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Cooling' }));
    save();

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({ path: '/devices/plug-1/configuration', body: { set: { plugMode: 'cooler' } } });
    await waitFor(() => expect(said()).toBe('Switches by Cooling · saved'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await act(async () => {
      await told[0].undo!();
    });
    expect(patches()[1].body.set).toEqual({ plugMode: 'heater' });
  });

  it('writes the night’s own points on the tap, and answers', async () => {
    draw(device('plug-1', 'plug', PLUG));

    fireEvent.click(screen.getByRole('switch', { name: 'Own switch points at night' }));

    await waitFor(() => expect(patches()[0]?.body.set).toEqual({ dayNight: true }));
    await waitFor(() => expect(said()).toBe('Own switch points at night on · saved'));
  });

  it('draws the night’s points beside the day’s once the night has its own, with the times the day starts and ends at', () => {
    draw(device('plug-1', 'plug', { ...PLUG, usedaynight: 1 }));

    expect(screen.getAllByRole('columnheader').map(head => head.textContent)).toEqual(['', 'By day', 'At night']);
    expect(setting('On below – At night')).toHaveTextContent('20.0 °C');
    expect(setting('Day from')).toHaveTextContent('06:00');
    expect(setting('Night from')).toHaveTextContent('22:00');
  });

  /** A heater that switches on above where it switches off never settles, so the two points are one sheet and one save. */
  it('saves a pair of points from one sheet, and will not save them the wrong way round', async () => {
    draw(device('plug-1', 'plug', PLUG));

    fireEvent.click(setting('On below'));
    type('Switch points: On below', 26);
    expect(within(sheet()).getByText(/The switch-on point has to be below the switch-off point/)).toBeInTheDocument();
    expect(within(sheet()).getByRole('button', { name: 'Save' })).toBeDisabled();
    type('Switch points: On below', 23);
    type('Switch points: Off above', 26);
    save();

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body.set).toEqual({ heaterDayOn: 23, heaterDayOff: 26 });
    await waitFor(() => expect(said()).toBe('Switch points On below 23.0 °C, Off above 26.0 °C · saved'));
  });

  it('adds a timer window at ten on the account’s clock, says when it ends, and sends the windows whole', async () => {
    draw(device('plug-1', 'plug', { ...PLUG, workmode: 'timer' }));

    expect(screen.getByText('No time window: the Plantalytix Socket stays off.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Time window' }));
    expect(within(sheet()).getByLabelText('Time window 1: On at')).toHaveValue('10:00');
    type('Time window 1: Duration', 45);
    expect(within(sheet()).getByText('until 10:45')).toBeInTheDocument();
    save();

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body.set).toEqual({ timerWindows: [{ ontime: 36000, duration: 45 }] });
    await waitFor(() => expect(said()).toBe('Time window 1 10:00–10:45 · saved'));
  });

  it('removes a window from its sheet, and offers the next one an hour after the last ends', async () => {
    draw(device('plug-1', 'plug', { ...PLUG, workmode: 'timer', timer: { timeframes: [{ ontime: 36000, duration: 10 }] } }));

    fireEvent.click(screen.getByRole('button', { name: '+ Time window' }));
    expect(within(sheet()).getByLabelText('Time window 2: On at')).toHaveValue('11:10');
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Close' }));

    fireEvent.click(setting('Time window 1'));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(patches()[0]?.body.set).toEqual({ timerWindows: [] }));
    await waitFor(() => expect(said()).toBe('Time window 10:00–10:10 removed · saved'));
  });

  /** Offline does not lock, and nothing is claimed that nobody knows: stored, when, and what the device was last handed. */
  it('says a setting stored for a silent socket as stored and not yet taken, with what the socket still runs', async () => {
    Settings.now = () => THREE;
    pending = [{ field: 'workmode', held: 'heater', savedAt: SAVED }];
    draw(silent('plug-1', 'plug', { ...PLUG, workmode: 'cooler' }));

    expect(
      await screen.findByText('Switches by: Cooling saved at 14:31. The device still runs Heating until it is back online.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change Switches by, Cooling, not with the device yet' })).toHaveAttribute('data-pending');
    expect(screen.queryByText(/sent to the device/i)).not.toBeInTheDocument();

    fireEvent.click(setting('On above'));
    type('Switch points: On above', 29);
    save();
    await waitFor(() =>
      expect(said()).toBe('Switch points On above 29.0 °C, Off below 25.0 °C · saved, Plantalytix Socket takes it over when it next connects'),
    );
  });

  /** A switch the document kept as `false` and the cloud now stores as 0 is the same switch, off. */
  it('does not call a setting pending that the device holds in another spelling', async () => {
    Settings.now = () => THREE;
    pending = [{ field: 'usedaynight', held: 'false', savedAt: SAVED }];
    draw(silent('plug-1', 'plug', { ...PLUG, usedaynight: 0 }));

    await waitFor(() => expect(calls.some(call => call.path.endsWith('/live'))).toBe(true));
    await act(async () => {});
    expect(screen.queryByText(/until it is back online|takes it over/)).not.toBeInTheDocument();
  });

  it('shows whoever may not manage it the settings as text, and offers no control', () => {
    drawAt(
      <Toast told={told}>
        <PlugPanel device={device('plug-1', 'plug', PLUG)} mayManage={false} />
      </Toast>,
    );

    expect(screen.getByText('Heating')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Switch points' })).toHaveTextContent('22.0 °C');
    expect(screen.queryByRole('button', { name: /^Change/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('says a socket that has sent nothing has nothing to change yet', () => {
    draw(device('plug-1', 'plug', null));
    expect(screen.getByText(/has not sent its settings yet, so there is nothing to change here/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Change/ })).not.toBeInTheDocument();
  });
});

describe('an AIR fan', () => {
  it('is its own control at the top of its place, and at a fixed speed nothing else', async () => {
    draw(device('fan-1', 'fan', FAN));

    expect(setting('The fan runs')).toHaveTextContent('Fixed');
    expect(setting('Speed by day')).toHaveTextContent('70 %');
    expect(screen.queryByRole('table', { name: 'Targets' })).not.toBeInTheDocument();

    fireEvent.click(setting('Speed at night'));
    type('Speed at night', 30);
    save();
    await waitFor(() => expect(patches()[0]).toMatchObject({ path: '/devices/fan-1/configuration', body: { set: { fixedNight: 30 } } }));
    await waitFor(() => expect(said()).toBe('Speed at night 30 % · saved'));
  });

  it('holds the temperature and humidity it reads under its control, once it follows them', async () => {
    draw(device('fan-1', 'fan', { ...FAN, mode: 3 }));

    expect(setting('The fan runs')).toHaveTextContent('By both');
    expect(await screen.findByRole('button', { name: /^Change Day temperature, 25.0 °C/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Change Night humidity, 55 %/ })).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Targets' }))
        .getAllByRole('columnheader')
        .map(head => head.textContent?.replace(/holds now|by the schedule/, '')),
    ).toEqual(['', 'Bright', 'Dark']);
    // A fan has no lamp and no CO2 of its own.
    expect(screen.queryByRole('button', { name: 'Change times' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CO₂/ })).not.toBeInTheDocument();
  });

  it('will not save a highest speed below the lowest', () => {
    draw(device('fan-1', 'fan', { ...FAN, mode: 2 }));

    fireEvent.click(setting('Highest speed at night'));
    type('Highest speed at night', 20);
    expect(within(sheet()).getByText('The highest speed cannot be below the lowest.')).toBeInTheDocument();
    expect(within(sheet()).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  /** Every setting has one place: among the outputs the fan's speed is said, and the row leads to where it is set. */
  it('is said among the outputs with the way to its control, and set there no second time', () => {
    drawAt(<OwnOutputs device={device('fan-1', 'fan', FAN)} mayManage />);

    expect(screen.getByRole('link', { name: /^Fan/ })).toHaveTextContent('Fixed · By day 70 % · At night 40 %');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says a speed stored for a silent fan as stored, with the speed the fan still holds', async () => {
    Settings.now = () => THREE;
    pending = [{ field: 'day.fixed_speed', held: 70, savedAt: SAVED }];
    draw(silent('fan-1', 'fan', { ...FAN, day: { temperature: 25, humidity: 60, fixed_speed: 50, max_speed: 100 } }));

    expect(
      await screen.findByText(/^Speed by day: 50 % saved at 14:31\. The device still holds 70 % until it is back online\.$/),
    ).toBeInTheDocument();
    expect(setting('Speed by day')).toHaveAttribute('data-pending');

    fireEvent.click(setting('The fan runs'));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'By humidity' }));
    save();
    await waitFor(() => expect(said()).toBe('The fan runs By humidity · saved, Fan takes it over when it next connects'));
  });
});

describe('a LIGHT', () => {
  it('has the card a controller’s lamp has, and changes its times on the light plan’s sheet', async () => {
    draw(device('light-1', 'light', LIGHT));

    expect(screen.getByText('On at 06:00 · 16 h')).toBeInTheDocument();
    expect(screen.getAllByText('off at 22:00')[0]).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change times' }));
    const plan = screen.getByRole('dialog', { name: 'Light times' });
    // A LIGHT holds two times of day: it cannot be told a day that never ends.
    expect(within(plan).getByRole('spinbutton', { name: 'Light on for' })).toHaveAttribute('aria-valuemax', '23.5');
    fireEvent.click(within(plan).getByRole('button', { name: 'Light on for: less' }));
    save();

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({ path: '/devices/light-1/configuration', body: { set: { lightsOn: 21600, lightsOff: 75600 } } });
    await waitFor(() => expect(said()).toBe('Light on 06:00–21:00 · 15 h · saved'));
  });

  it('steps its limit where it stands and sends it once it rests', async () => {
    draw(device('light-1', 'light', LIGHT));
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Lower the light limit' }));
    expect(screen.getByRole('spinbutton', { name: 'Light limit' })).toHaveValue('75');
    expect(patches()).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    vi.useRealTimers();

    await waitFor(() => expect(patches()[0]?.body.set).toEqual({ brightness: 75 }));
    await waitFor(() => expect(said()).toBe('Light limit 75 % · saved'));
  });

  it('says in one note what a silent lamp has not been handed, with the window and the limit it still runs', async () => {
    Settings.now = () => THREE;
    pending = [
      { field: 'night', held: 79200, savedAt: SAVED },
      { field: 'limit', held: 100, savedAt: '2026-09-19T14:20:00.000Z' },
    ];
    draw(silent('light-1', 'light', { ...LIGHT, night: 75600 }));

    const note = (await screen.findByText('2 settings saved at 14:31, not with the device yet')).closest('details')!;
    expect(within(note).getAllByRole('listitem', { hidden: true }).map(plain)).toEqual([
      'Light times: On at 06:00 · 15 h · the device still holds On at 06:00 · 16 h',
      'Light limit: 80 % · the device still holds 100 %',
    ]);
    expect(screen.getByRole('spinbutton', { name: 'Light limit' }).closest('[data-pending]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Change times' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Light on for: more' }));
    save();
    await waitFor(() => expect(said()).toBe('Light on 06:00–22:00 · 16 h · saved, Light takes it over when it next connects'));
  });
});

describe('a fridge’s fans, among its outputs', () => {
  const draw = (one: Device) =>
    drawAt(
      <Toast told={told}>
        <FridgeFansPanel device={one} mayManage />
      </Toast>,
    );

  it('are each a figure with its sheet, saved by name', async () => {
    draw(device('fridge-1', 'fridge', FRIDGE));

    fireEvent.click(setting('Clip fan'));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Clip fan: more' }));
    save();

    await waitFor(() => expect(patches()[0]).toMatchObject({ path: '/devices/fridge-1/configuration', body: { set: { clipFan: 65 } } }));
    await waitFor(() => expect(said()).toBe('Clip fan 65 % · saved'));
  });

  it('say what a silent fridge has not been handed, and that it takes a new figure over', async () => {
    Settings.now = () => THREE;
    pending = [{ field: 'fans.external', held: 80, savedAt: SAVED }];
    draw(silent('fridge-1', 'fridge', FRIDGE));

    expect(await screen.findByText(/^Clip fan: 60 % saved at 14:31\. The device still holds 80 % until it is back online\.$/)).toBeInTheDocument();
    fireEvent.click(setting('Inner fans, at least'));
    type('Inner fans, at least', 40);
    save();
    await waitFor(() => expect(said()).toBe('Inner fans, at least 40 % · saved, Fridge module takes it over when it next connects'));
  });
});

describe('what Start and the device panel say about them', () => {
  it('sums a socket up by what it switches by and at', () => {
    const plug = device('plug-1', 'plug', { ...PLUG, usedaynight: 1 });
    expect(plugSummaryOf(t, plug, 0)).toEqual([
      { label: 'Switches by', parts: ['Heating'] },
      { label: 'Day', parts: ['on below 22 °C · off above 25 °C'] },
      { label: 'Night', parts: ['on below 20 °C · off above 23 °C'] },
    ]);
    const timed = device('plug-1', 'plug', { ...PLUG, workmode: 'timer', timer: { timeframes: [{ ontime: 82800, duration: 120 }] } });
    expect(plugSummaryOf(t, timed, 3600)?.at(-1)).toEqual({ label: 'Time windows', parts: ['00:00–02:00'] });
    expect(ownStatusOf(t, plug, 0)).toBe('Readings arrive · Plantalytix Socket: Heating');
    expect(ownFactOf(t, device('fan-1', 'fan', FAN), 0)).toEqual({ label: 'The fan runs', value: 'Fixed' });
    expect(ownFactOf(t, device('light-1', 'light', LIGHT), 7200)).toEqual({ label: 'Light', value: '08:00–00:00' });
  });

  it('judges a socket´s reading by the points it switches at, by its own night where it keeps one', () => {
    const at = (hour: number) => DateTime.fromISO(`2026-07-01T${String(hour).padStart(2, '0')}:00:00Z`);
    const reading = (value: number) => ({ metric: 'temperature' as const, value, measuredAt: at(12).toISO()!, state: 'live' as const });
    const plug = device('plug-1', 'plug', PLUG);

    expect(switchRangeOf(plug, 'temperature', at(12))).toEqual({ low: 22, high: 25 });
    expect(switchRangeOf(plug, 'humidity', at(12))).toBeNull();
    expect(switchRangeOf(device('plug-1', 'plug', { ...PLUG, usedaynight: 1 }), 'temperature', at(23))).toEqual({ low: 20, high: 23 });
    expect(switchRangeOf(device('plug-1', 'plug', { ...PLUG, workmode: 'cooler' }), 'temperature', at(12))).toEqual({ low: 25, high: 28 });

    expect(rangeVerdictOf(reading(23.4), { low: 22, high: 25 }, at(12))).toEqual({ kind: 'in' });
    expect(rangeVerdictOf(reading(21), { low: 22, high: 25 }, at(12))).toEqual({ kind: 'low', delta: 1 });
  });

  it('sums a fan at a fixed speed up by its speeds, and says so in the first line of Start´s targets', () => {
    const fan = device('fan-1', 'fan', FAN);
    expect(fanSummaryOf(t, fan)).toEqual([
      { label: 'The fan runs', parts: ['Fixed'] },
      { label: 'Speed', parts: ['By day 70 %', 'At night 40 %'] },
    ]);
    expect(fanSummaryOf(t, device('fan-1', 'fan', { ...FAN, mode: 2 }))).toBeNull();
    expect(ownStatusOf(t, fan, 0)).toMatch(/fan runs: Fixed$/);
  });

  it('reads a LIGHT’s window from the top of its document, and none from a fan', () => {
    const now = DateTime.fromISO('2026-07-01T12:00:00Z');
    expect(lightWindowOf(device('light-1', 'light', LIGHT), now, 'Europe/Berlin')).toEqual({
      start: 8,
      hours: 16,
      on: '08:00',
      off: '00:00',
      limit: 80,
      always: false,
      never: false,
    });
    expect(lightWindowOf(device('fan-1', 'fan', FAN), now, null)).toBeNull();

    // A tent's controller stands for it, not the fan beside it.
    const fan = device('fan-1', 'fan', FAN);
    const controller = device('controller-1', 'controller', { day: { temperature: 25 }, night: { temperature: 20 } });
    expect(climateDeviceOf([fan, controller], ['fan-1', 'controller-1'])?.id).toBe('controller-1');
  });
});
