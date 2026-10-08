import { fireEvent, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime, Settings } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DeviceConfiguration } from '@fg2/shared-types/v1';
import { fanSummaryOf, ownFactOf, ownStatusOf, plugSummaryOf } from '@/screens/control/devices/own-summary';
import { Targets } from '@/screens/control/targets/Targets';
import { climateDeviceOf, lightWindowOf, rangeVerdictOf, switchRangeOf } from '@/screens/cockpit/place';
import { drawAt, json } from './harness';
import { translate } from './translations';

/**
 * What a smart socket, an AIR fan and a LIGHT are set to under Steuerung: each
 * a panel of its own, saved with one Save that sends only what changed, by the
 * names the contract gives the settings - and what the cockpit and the device
 * panel say about them.
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

const device = (id: string, type: string, configuration: DeviceConfiguration | null): Device =>
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
      lastSeenAt: DateTime.now().toISO(),
      firmwareId: null,
      hardware: {},
      maintenanceUntil: null,
      socketStateChangedAt: {},
      socketsReportedAt: null,
    },
  }) as unknown as Device;

const calls: { method: string; path: string; body: { set?: Record<string, unknown> } }[] = [];

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace(/^\/v1/, '');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });

    if (method === 'PATCH') return json(device(path.split('/')[2], 'plug', PLUG));
    if (path.endsWith('/plan')) return json({ status: 404, code: 'plan_not_found', title: '', detail: '', errors: [] }, 404);
    return json({ status: 404, code: 'not_found', title: '', detail: '', errors: [] }, 404);
  }),
);

const patches = () => calls.filter(call => call.method === 'PATCH');

const draw = (devices: Device[]) => drawAt(<Targets spaceId="space-1" devices={devices} mayManage />);

const t = (key: string, options?: Record<string, unknown>) => i18next.t(key, options);

beforeAll(async () => {
  Settings.defaultZone = 'utc';
  await translate();
});

afterAll(() => {
  Settings.defaultZone = 'system';
});

beforeEach(() => {
  calls.length = 0;
});

describe('a smart socket under Steuerung', () => {
  it('saves a new mode and its own night by name, sending nothing it did not change', async () => {
    draw([device('plug-1', 'plug', PLUG)]);

    expect(screen.getByRole('button', { name: 'Heating' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Cooling' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Own switch points at night' }));

    // The night has its own block, and the day's times are asked for.
    expect(screen.getByRole('slider', { name: 'On above – At night' })).toHaveValue('26');
    expect(screen.getByLabelText('Day from')).toHaveValue('06:00');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({ path: '/devices/plug-1/configuration', body: { set: { plugMode: 'cooler', dayNight: true } } });
  });

  it('will not save a pair of points the wrong way round, and says why', () => {
    draw([device('plug-1', 'plug', PLUG)]);

    fireEvent.change(screen.getByRole('slider', { name: 'On below – Switch points' }), { target: { value: '26' } });

    expect(screen.getByText(/The switch-on point has to be below the switch-off point/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('adds a timer window at ten on the account’s clock, says when it ends, and sends the windows whole', async () => {
    draw([device('plug-1', 'plug', PLUG)]);

    fireEvent.click(screen.getByRole('button', { name: 'Timer' }));
    expect(screen.getByText('No time window: the socket stays off.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Time window' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Time window' }));
    fireEvent.change(screen.getByLabelText('Time window 2: minutes'), { target: { value: '45' } });

    expect(screen.getByLabelText('Time window 1: on at')).toHaveValue('10:00');
    // The next one an hour after the last ends.
    expect(screen.getByLabelText('Time window 2: on at')).toHaveValue('11:10');
    expect(screen.getByText('until 11:55')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove time window 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body.set).toEqual({ plugMode: 'timer', timerWindows: [{ ontime: 40200, duration: 45 }] });
  });

  it('says a socket that has sent nothing has nothing to change yet', () => {
    draw([device('plug-1', 'plug', null)]);
    expect(screen.getByText(/has not sent its settings yet, so there is nothing to change here/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Heating' })).not.toBeInTheDocument();
  });
});

describe('an AIR fan under Steuerung', () => {
  it('sets only the temperature and humidity it reads, once it follows them', async () => {
    draw([device('fan-1', 'fan', { ...FAN, mode: 3 })]);

    expect(await screen.findByRole('spinbutton', { name: 'Day temperature' })).toBeInTheDocument();
    // A fan has no lamp and no CO2 of its own.
    expect(screen.queryByLabelText('Light on at')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: /CO₂/ })).not.toBeInTheDocument();
  });

  it('starts with what its speed follows, offers no targets at a fixed speed, and sets its speeds by what they follow', async () => {
    draw([device('fan-1', 'fan', FAN)]);

    expect(await screen.findByRole('slider', { name: 'Speed by day' })).toHaveValue('70');
    expect(screen.queryByRole('spinbutton', { name: 'Day temperature' })).not.toBeInTheDocument();
    expect(screen.getByText(/^In “Fixed” mode the fan runs at the speeds above and follows no target/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'By humidity' }));
    expect(screen.getByRole('slider', { name: 'Lowest speed' })).toHaveValue('30');
    fireEvent.change(screen.getByRole('slider', { name: 'Highest speed at night' }), { target: { value: '20' } });
    expect(screen.getByText('The highest speed cannot be below the lowest.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: 'Highest speed at night' }), { target: { value: '50' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' }).at(-1)!);

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toMatchObject({ path: '/devices/fan-1/configuration', body: { set: { fanMode: 'humidity', mostNight: 50 } } });
  });
});

describe('a LIGHT under Steuerung', () => {
  it('sets when it comes on and goes off, and how bright it gets', async () => {
    draw([device('light-1', 'light', LIGHT)]);

    expect(screen.getByLabelText('Light on at')).toHaveValue('06:00');
    expect(screen.getByText('on 16 h')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Light off at'), { target: { value: '18:30' } });
    expect(screen.getByText('on 12.5 h')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: 'Light limit' }), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body.set).toEqual({ lightsOff: 66600, brightness: 60 });
  });
});

describe('what the cockpit and the device panel say about them', () => {
  it('sums a socket up by what it switches by and at', () => {
    const plug = device('plug-1', 'plug', { ...PLUG, usedaynight: 1 });
    expect(plugSummaryOf(t, plug, 0)).toEqual([
      { label: 'Switches by', parts: ['Heating'] },
      { label: 'Day', parts: ['on below 22 °C · off above 25 °C'] },
      { label: 'Night', parts: ['on below 20 °C · off above 23 °C'] },
    ]);
    const timed = device('plug-1', 'plug', { ...PLUG, workmode: 'timer', timer: { timeframes: [{ ontime: 82800, duration: 120 }] } });
    expect(plugSummaryOf(t, timed, 3600)?.at(-1)).toEqual({ label: 'Time windows', parts: ['00:00–02:00'] });
    expect(ownStatusOf(t, plug, 0)).toBe('Readings arrive · socket: Heating');
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

  it('sums a fan at a fixed speed up by its speeds, and says so in the cockpit´s first line', () => {
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
