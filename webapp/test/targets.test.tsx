import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime, Settings } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GERMINATION_CHOICES } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import type { Device, DeviceConfiguration, DeviceLive, Me, PendingSettings, Plan, PlanStep, Setpoints } from '@fg2/shared-types/v1';
import type { Told } from '@/log/log-context';
import { Climate } from '@/screens/control/climate/Climate';
import { vapourPressureDeficit } from '@fg2/shared-types/v1-schemas/vpd.js';
import { nowHoldingOf, ownedBy, phaseOf, shapeOf } from '@/screens/control/targets/day-night';
import { draftOf, vpdOf, withDraft } from '@/screens/control/targets/targets-draft';
import { secondsOf, wallClock } from '@/ui/wall-clock';
import { STAGES_WITH_CLIMATE } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { CLIMATE_CHOICES, presetsOf } from '@/ui/presets';
import { deviceWith } from './fixtures';
import { drawAt, json } from './harness';
import { meWith } from './session';
import { Toast } from './toast';
import { translate } from './translations';

/**
 * What the climate cards under Steuerung promise: that nothing on the page is
 * a draft - each figure is saved from its own sheet as the device's whole
 * document with that one figure changed - that a write is answered by the
 * toast and can be taken back, that a plan which would write the figure back
 * is paused first and said so before the tap, that what a silent device has
 * not been handed is marked with what it still holds, and that a session
 * which may only look is offered nothing that writes.
 *
 * The API is stubbed at the wire rather than at the hook, because what matters
 * here is the exact document that leaves - a section written as `{ target }`
 * would take the rest of that section with it, and only the body says whether
 * it did.
 */

const NOW = DateTime.fromISO('2026-09-19T12:00:00.000Z');

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

/** What the controller is running: the six targets, and beside each the tuning a save must keep. */
const CONFIGURATION: DeviceConfiguration = {
  workmode: 'breed',
  day: { temperature: 25, humidity: 60, heating: 'hard' },
  night: { temperature: 20, humidity: 55 },
  co2: { target: 800, sunsetOff: 1 },
  lights: { sunrise: 15, sunset: 15 },
  'lights.limit': 80,
  daynight: { day: 21600, night: 64800, maxDehumidifySeconds: 120 },
};

const device = (over: Partial<Device> = {}, hardware: Record<string, string> = { co2: 'on' }): Device =>
  deviceWith({
    createdAt: NOW.minus({ days: 60 }).toISO()!,
    name: 'Blue Dream tent',
    configuration: CONFIGURATION,
    state: {
      lastSeenAt: DateTime.now().minus({ seconds: 20 }).toISO()!,
      claimedAt: NOW.minus({ days: 60 }).toISO()!,
      firmwareId: 'build-1',
      hardware,
    },
    ...over,
  });

/** A device with a control of its own, on its standard day and night. */
const CONTROL: NonNullable<Device['control']> = {
  running: true,
  drying: false,
  mode: 'standard',
  energySaving: false,
  germinationChoices: GERMINATION_CHOICES,
};

/** The step a running plan stands on: its own figures and twelve hours of light, the hour it comes on left to the device. */
const STEP: PlanStep = {
  id: 'step-1',
  name: 'Flower',
  stage: 'flowering',
  preset: null,
  duration: { value: 42, unit: 'days' },
  settings: { day: { temperature: 25, humidity: 50 }, night: { temperature: 20, humidity: 50 }, co2: { target: 1000 }, lights: { limit: 100 } },
  lightHours: 12,
  waitForConfirmation: false,
  confirmationMessage: null,
  germinationChoices: null,
};

const plan = (status: Plan['state']['status']): Plan => ({
  id: 'plan-1',
  createdAt: NOW.minus({ days: 30 }).toISO()!,
  deviceId: 'device-1',
  templateId: null,
  name: 'Autoflower, 12 weeks',
  steps: [STEP],
  loop: false,
  notify: { mode: 'off', email: null, writeEntries: true },
  state: {
    status,
    activeStepIndex: 0,
    stepStartedAt: NOW.minus({ days: 4 }).toISO()!,
    pausedElapsedMs: 0,
    pauseReason: null,
    lastAppliedAt: NOW.minus({ minutes: 20 }).toISO()!,
    confirmationNotifiedAt: null,
    confirmationAskedAt: null,
    confirmationAskTriedAt: null,
  },
});

/** The account, for the one thing this page reads off it: the zone its clock times are in. */
const account = (timezone: string): Me =>
  meWith({ preferences: { units: { temperature: 'celsius', weight: 'grams', volume: 'liters' }, locale: 'en', timezone } });

/* ------------------------------------------------------------- the wire */

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const wire = {
  plan: null as Plan | null,
  /** What the server says of the device right now; none answers 404, which leaves the page to the schedule. */
  live: null as Partial<Setpoints> | null,
  /** What the cloud stored that a silent device has not been handed. */
  pending: null as PendingSettings | null,
  /** The account's zone; none leaves the page on the browser's, which the test keeps on UTC. */
  zone: null as string | null,
  /** What PUT /configuration answers with instead of the document, when a refusal is wanted. */
  refuseSave: null as { status: number; code: string; detail: string } | null,
  /** The roles of the sockets paired at the device; none answers 404, a device that reports no table. */
  sockets: null as string[] | null,
  /** The grow standing in the place, as its overview names it; none answers a place nothing grows in. */
  grow: null as { stage: string; preset: string | null } | null,
  /** The document the server holds, which every save replaces. */
  stored: CONFIGURATION,
  calls: [] as Call[],
};

const problem = (status: number, code: string, detail: string) => json({ status, code, title: code, detail, errors: [] }, status);

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace(/^\/v1/, '');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    wire.calls.push({ method, path, body });

    if (method === 'GET' && path === '/me') {
      return wire.zone ? json(account(wire.zone)) : problem(404, 'not_found', 'No account here.');
    }
    if (method === 'GET' && path === '/devices/device-1') return json(device({ configuration: wire.stored }));
    if (method === 'GET' && path === '/devices/device-1/live') {
      return wire.live
        ? json({
            deviceId: 'device-1',
            metrics: {},
            outputs: {},
            setpoints: { day: {}, night: {}, active: 'day', ...wire.live },
            pending: wire.pending,
          })
        : problem(404, 'not_found', 'Nothing heard.');
    }
    if (method === 'GET' && path === '/devices/device-1/sockets') {
      return wire.sockets
        ? json({
            items: wire.sockets.map((role, slot) => ({
              slot,
              role,
              hardwareId: '',
              address: `10.0.0.${slot + 2}`,
              state: 'off',
              override: null,
              timer: null,
              stateChangedAt: null,
            })),
            nextCursor: null,
          })
        : problem(404, 'not_found', 'No socket table.');
    }
    if (method === 'GET' && path === '/spaces/space-1/overview') {
      return json({ spaceId: 'space-1', name: 'Tent', grows: wire.grow ? [{ growId: 'grow-1', ...wire.grow }] : [], climates: [] });
    }
    if (method === 'GET' && path === '/devices/device-1/plan') {
      return wire.plan ? json(wire.plan) : problem(404, 'plan_not_found', 'This device is not being run by a plan.');
    }
    if (method === 'DELETE' && path === '/devices/device-1/plan') {
      wire.plan = plan('stopped');
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && path === '/devices/device-1/plan/transitions') {
      wire.plan = plan(body.kind === 'pause' ? 'paused' : 'running');
      return json(wire.plan);
    }
    if (method === 'PATCH' && path === '/devices/device-1/configuration') {
      return json({
        ...device({ type: 'fridge' }),
        control: { running: true, drying: false, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES, ...body.set },
      });
    }
    if (method === 'PUT' && path === '/devices/device-1/configuration') {
      if (wire.refuseSave) return problem(wire.refuseSave.status, wire.refuseSave.code, wire.refuseSave.detail);
      wire.stored = body.configuration;
      return json(body);
    }
    return problem(404, 'not_found', `No stub for ${method} ${path}`);
  }),
);

const sent = (method: string) => wire.calls.filter(call => call.method === method);

/** What the toast was told: the line, and the way it is taken back. */
const told: Told[] = [];
/** A line of the toast as it reads: a figure is bound to its unit by a space that does not break. */
const said = () => told[0]?.label.replace(/\u00a0/g, ' ');

const draw = (one: Device = device(), mayManage = true) =>
  drawAt(
    <Toast told={told}>
      <Climate device={one} stored={one.configuration!} mayManage={mayManage} />
    </Toast>,
  );

/** The cards once the plan has been read, which is when they are drawn. */
const drawn = async (one?: Device, mayManage?: boolean) => {
  draw(one, mayManage);
  return screen.findByRole('table', { name: 'Targets' });
};

/** A figure's button, by the figure it changes. */
const figure = (name: string) => screen.getByRole('button', { name: new RegExp(`^Change ${name}, `) });

const tap = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

/** Types a figure into the stepper of the sheet that is open, and leaves the field. */
const type = (name: string, to: number) => {
  const field = within(screen.getByRole('dialog')).getByRole('spinbutton', { name });
  fireEvent.change(field, { target: { value: String(to) } });
  fireEvent.blur(field);
};

const save = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

beforeAll(async () => {
  // The light window is said in the reader's own time; the document holds UTC, so the test reads in UTC.
  Settings.defaultZone = 'utc';
  await translate(['en', 'de']);
});

afterEach(async () => {
  await i18next.changeLanguage('en');
  Settings.now = () => Date.now();
  vi.useRealTimers();
});

afterAll(() => {
  Settings.defaultZone = 'system';
});

beforeEach(() => {
  wire.plan = null;
  wire.live = null;
  wire.pending = null;
  wire.zone = null;
  wire.refuseSave = null;
  wire.sockets = null;
  wire.grow = null;
  wire.stored = CONFIGURATION;
  wire.calls = [];
  told.length = 0;
});

describe('the climate under Steuerung', () => {
  /**
   * Two cards and no draft: when the light burns with the one button that
   * changes it, its limit stepped in place, and each target a button that
   * says what it changes - the day's beside the night's.
   */
  it('draws the light, its limit and each target as a button, the day beside the night', async () => {
    // Noon, so the schedule the test reads is on its day whatever the hour the suite runs at.
    Settings.now = () => NOW.toMillis();
    await drawn();

    expect(screen.getByText('On at 06:00 · 12 h')).toBeInTheDocument();
    expect(screen.getAllByText('off at 18:00')[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change times' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Light limit' })).toHaveValue('80');
    expect(screen.getAllByRole('columnheader').map(head => head.textContent)).toEqual(['', 'Dayby the schedule', 'Night']);
    // Every figure of a reading carries its decimals, so the day's stands under the night's digit for digit.
    expect(figure('Day temperature')).toHaveTextContent('25.0 °C');
    expect(figure('Night temperature')).toHaveTextContent('20.0 °C');
    expect(figure('Day humidity')).toHaveTextContent('60 %');
    expect(figure('Night humidity')).toHaveTextContent('55 %');
    expect(figure('CO₂ target')).toHaveTextContent('800 ppm');
    expect(screen.getByText('no CO₂')).toBeInTheDocument();
    // Nothing on the page is a draft: no save bar, and the one figure stepped in place is the light limit.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('marks the half that holds now on the device’s word', async () => {
    wire.live = { active: 'night', period: 'night' };
    await drawn();

    await waitFor(() => expect(screen.getAllByRole('columnheader').map(head => head.textContent)).toEqual(['', 'Day', 'Nightholds now']));
  });

  /**
   * A section written as `{ target }` would take the rest of that section
   * with it, and only the body says whether it did: a figure's sheet sends
   * the device's whole document with that one figure changed.
   */
  it('saves one figure from its sheet as the whole document with nothing else moved, and says so in the toast', async () => {
    await drawn();

    fireEvent.click(figure('Day temperature'));
    expect(screen.getByRole('dialog', { name: 'Day temperature' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' })).toBeDisabled();
    type('Day temperature', 24);
    save();

    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect(sent('PUT')[0].body).toEqual({
      configuration: {
        workmode: 'breed',
        day: { temperature: 24, humidity: 60, heating: 'hard' },
        night: { temperature: 20, humidity: 55 },
        co2: { target: 800, sunsetOff: 1 },
        lights: { sunrise: 15, sunset: 15, limit: 80 },
        daynight: { day: 21600, night: 64800, maxDehumidifySeconds: 120 },
      },
    });
    await waitFor(() => expect(told).toHaveLength(1));
    expect(said()).toBe('Day temperature 24.0 °C · saved');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(sent('POST')).toHaveLength(0);
  });

  it('takes a figure back from the toast by writing the one figure back', async () => {
    await drawn();
    fireEvent.click(figure('Night humidity'));
    type('Night humidity', 50);
    save();
    await waitFor(() => expect(told).toHaveLength(1));

    await act(async () => {
      await told[0].undo!();
    });

    expect(sent('PUT')).toHaveLength(2);
    expect((sent('PUT')[1].body as { configuration: DeviceConfiguration }).configuration.night).toEqual({ temperature: 20, humidity: 55 });
  });

  /** The route replaces the document whole, so the way back reads it again: what was saved after the figure is not its to take back. */
  it('takes back only the figure that save moved, and keeps a setting saved after it', async () => {
    await drawn();
    fireEvent.click(figure('Day temperature'));
    type('Day temperature', 24);
    save();
    await waitFor(() => expect(told).toHaveLength(1));
    wire.stored = { ...wire.stored, lights: { sunrise: 15, sunset: 15, limit: 60 }, night: { temperature: 20, humidity: 50 } };

    await act(async () => {
      await told[0].undo!();
    });

    expect((sent('PUT')[1].body as { configuration: DeviceConfiguration }).configuration).toEqual({
      workmode: 'breed',
      day: { temperature: 25, humidity: 60, heating: 'hard' },
      night: { temperature: 20, humidity: 50 },
      co2: { target: 800, sunsetOff: 1 },
      lights: { sunrise: 15, sunset: 15, limit: 60 },
      daynight: { day: 21600, night: 64800, maxDehumidifySeconds: 120 },
    });
  });

  it('says why a save was refused in the sheet that asked, and keeps the sheet', async () => {
    wire.refuseSave = { status: 422, code: 'validation_failed', detail: 'The settings do not fit what the device reads.' };
    await drawn();
    fireEvent.click(figure('Day temperature'));
    type('Day temperature', 24);
    save();

    expect(await within(screen.getByRole('dialog')).findByText(/The settings do not fit what the device reads/)).toBeInTheDocument();
    expect(told).toHaveLength(0);
  });

  /** The first step of a series would already pause a running plan, so the steps of one are one write. */
  it('sends the light limit once it rests, as one write for the steps of a series', async () => {
    await drawn();
    vi.useFakeTimers();

    tap('Lower the light limit');
    tap('Lower the light limit');
    expect(screen.getByRole('spinbutton', { name: 'Light limit' })).toHaveValue('70');
    expect(sent('PUT')).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    vi.useRealTimers();

    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect((sent('PUT')[0].body as { configuration: DeviceConfiguration }).configuration.lights).toEqual({ sunrise: 15, sunset: 15, limit: 70 });
    await waitFor(() => expect(said()).toBe('Light limit 70 % · saved'));
  });

  it('opens the light’s times on a sheet and saves them with the light plan’s own editor', async () => {
    await drawn();

    tap('Change times');
    const sheet = screen.getByRole('dialog', { name: 'Light times' });
    expect(within(sheet).getByRole('group', { name: 'Light plan' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Light on for: more' }));
    expect(within(sheet).getByText(/draft/i)).toBeInTheDocument();
    save();

    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect((sent('PUT')[0].body as { configuration: DeviceConfiguration }).configuration.daynight).toEqual({
      day: 21600,
      night: 68400,
      maxDehumidifySeconds: 120,
    });
    await waitFor(() => expect(said()).toBe('Light on 06:00–19:00 · 13 h · saved'));
  });

  describe('with a plan running', () => {
    /**
     * The engine re-applies the step it stands on within the hour, so saving
     * a figure the step writes pauses the plan first - said before the tap -
     * and taking the save back sets the plan going again.
     */
    it('says before the tap that saving a figure the plan writes pauses it, pauses first, and resumes on undo', async () => {
      wire.plan = plan('running');
      await drawn();
      expect(screen.getByText(/set by the running plan “Autoflower, 12 weeks”/)).toBeInTheDocument();

      fireEvent.click(figure('Day temperature'));
      type('Day temperature', 24);
      expect(within(screen.getByRole('dialog')).getByText(/This pauses the plan “Autoflower, 12 weeks”/)).toBeInTheDocument();
      save();

      await waitFor(() => expect(sent('PUT')).toHaveLength(1));
      const order = wire.calls.filter(call => call.method !== 'GET').map(call => `${call.method} ${call.path}`);
      expect(order).toEqual(['POST /devices/device-1/plan/transitions', 'PUT /devices/device-1/configuration']);
      expect(sent('POST')[0].body).toEqual({ kind: 'pause', reason: 'Targets set by hand' });

      await waitFor(() => expect(told).toHaveLength(1));
      await act(async () => {
        await told[0].undo!();
      });
      expect(sent('POST')[1].body).toEqual({ kind: 'resume' });
    });

    it('leaves the plan running where the figure is none of the step’s', async () => {
      wire.plan = { ...plan('running'), steps: [{ ...STEP, settings: { day: { humidity: 50 } }, lightHours: null }] };
      await drawn();

      fireEvent.click(figure('Day temperature'));
      type('Day temperature', 24);
      expect(within(screen.getByRole('dialog')).queryByText(/pauses the plan/)).not.toBeInTheDocument();
      save();

      await waitFor(() => expect(sent('PUT')).toHaveLength(1));
      expect(sent('POST')).toHaveLength(0);
    });

    /** A paused plan is continued and stopped in one place, its own page: the cards neither say it nor offer it. */
    it('leaves a paused plan to the plan page', async () => {
      wire.plan = { ...plan('paused'), state: { ...plan('paused').state, pauseReason: 'Targets set by hand' } };
      await drawn();

      expect(screen.queryByText(/paused/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Resume|Stop/ })).not.toBeInTheDocument();
    });

    it('marks the light hours and the limit the plan sets, as it marks the targets', async () => {
      wire.plan = plan('running');
      await drawn();

      const light = screen.getByRole('region', { name: 'Light' });
      expect(within(light).getAllByRole('img', { name: 'set by the running plan' })).toHaveLength(2);
      expect(within(light).getByText('On at 06:00 · 12 h').parentElement).toContainElement(within(light).getAllByRole('img')[0]);
    });
  });

  describe('a preset', () => {
    it('is named on its button where the figures are its own', async () => {
      await drawn(
        device({
          configuration: {
            ...CONFIGURATION,
            day: { temperature: 25, humidity: 50 },
            night: { temperature: 20, humidity: 50 },
            co2: { target: 1000 },
            'lights.limit': 100,
          },
        }),
      );

      expect(screen.getByRole('button', { name: 'Climate preset: Flower' })).toBeInTheDocument();
    });

    /** One figure set by hand does not make the place nameless: the server still knows what stage it is on. */
    it('is named by the stage the server knows the place is on, once a figure was set by hand', async () => {
      wire.grow = { stage: 'flowering', preset: 'late_flowering' };
      await drawn();

      expect(await screen.findByRole('button', { name: 'Climate preset: Late flower' })).toBeInTheDocument();
    });

    it('is named by the spell the device runs, whatever the grow is recorded in, and by nothing where nothing is known', async () => {
      const bare = draw();
      await screen.findByRole('table', { name: 'Targets' });
      expect(screen.getByRole('button', { name: 'Climate preset' })).toBeInTheDocument();
      bare.unmount();

      wire.grow = { stage: 'flowering', preset: null };
      await drawn(device({ type: 'fridge', control: { ...CONTROL, drying: true } }));
      expect(await screen.findByRole('button', { name: 'Climate preset: Drying' })).toBeInTheDocument();
    });

    /** A chip only shows what it would set; nothing is written before "Apply". */
    it('says what it would change before it is taken, and writes on Apply', async () => {
      await drawn();

      tap('Climate preset');
      const sheet = screen.getByRole('dialog', { name: 'Apply a climate preset' });
      expect(within(sheet).getByRole('button', { name: 'Apply' })).toBeDisabled();
      fireEvent.click(within(sheet).getByRole('button', { name: 'Flower' }));
      const sets = within(sheet).getByRole('list', { name: 'What the climate preset changes' });
      expect(within(sets).getByText('Day humidity').parentElement).toHaveTextContent('60 % → 50 %');
      expect(within(sets).getByText('CO₂ target').parentElement).toHaveTextContent('800 ppm → 1000 ppm');
      expect(sent('PUT')).toHaveLength(0);

      fireEvent.click(within(sheet).getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(sent('PUT')).toHaveLength(1));
      const body = sent('PUT')[0].body as { configuration: DeviceConfiguration; drying?: boolean; germination?: boolean };
      expect(body.configuration.day).toEqual({ temperature: 25, humidity: 50, heating: 'hard' });
      expect(body.configuration.co2).toEqual({ target: 1000, sunsetOff: 1 });
      await waitFor(() => expect(said()).toBe('Climate preset Flower · saved'));
      expect(told[0].undo).not.toBeNull();
    });

    /** Drying is a mode of the device as well as figures: the chip starts the spell, which is more than one write to take back. */
    it('starts a drying spell with the drying chip, says so first and offers no undo', async () => {
      await drawn(device({ type: 'fridge', control: CONTROL }));

      tap('Climate preset');
      const sheet = screen.getByRole('dialog');
      fireEvent.click(within(sheet).getByRole('button', { name: 'Drying' }));
      expect(within(sheet).getByText(/Applying starts drying/)).toBeInTheDocument();
      fireEvent.click(within(sheet).getByRole('button', { name: 'Apply' }));

      await waitFor(() => expect(sent('PUT')).toHaveLength(1));
      expect(sent('PUT')[0].body).toMatchObject({ drying: true, germination: false });
      await waitFor(() => expect(told).toHaveLength(1));
      expect(told[0].undo).toBeNull();
    });

    it('offers what germination does about the humidity with the germination chip, and sends what was chosen', async () => {
      wire.sockets = ['humidifier'];
      await drawn(device({ type: 'fridge', control: CONTROL }));

      tap('Climate preset');
      const sheet = screen.getByRole('dialog');
      fireEvent.click(within(sheet).getByRole('button', { name: 'Germination · dark' }));
      fireEvent.click(await within(sheet).findByRole('switch', { name: 'Warn when it gets too humid' }));
      fireEvent.click(within(sheet).getByRole('button', { name: 'Apply' }));

      await waitFor(() => expect(sent('PUT')).toHaveLength(1));
      expect(sent('PUT')[0].body).toMatchObject({ germination: true, germinationChoices: { warnTooHumid: true, humidifierHolds: true } });
    });

    /** The preset is the one place germination is set, so what it does about the humidity is changed there while it runs. */
    it('changes what a running germination does about the humidity without taking the preset again', async () => {
      wire.sockets = ['humidifier'];
      await drawn(device({ type: 'fridge', control: { ...CONTROL, mode: 'germination' } }));

      tap(/^Climate preset/);
      const sheet = screen.getByRole('dialog');
      expect(within(sheet).getByRole('button', { name: 'Apply' })).toBeDisabled();
      fireEvent.click(await within(sheet).findByRole('switch', { name: 'Hold the humidity with the humidifier' }));
      fireEvent.click(within(sheet).getByRole('button', { name: 'Apply' }));

      await waitFor(() => expect(sent('PUT')).toHaveLength(1));
      const body = sent('PUT')[0].body as { configuration: DeviceConfiguration };
      expect(body).toMatchObject({ germination: true, germinationChoices: { warnTooHumid: false, humidifierHolds: false } });
      expect(body.configuration.night).toEqual(CONFIGURATION.night);
      await waitFor(() => expect(said()).toBe('During germination · saved'));
    });

    /**
     * A spell is ended where it was begun. Ending it is the server's own return - the mode it ran before, and the
     * figures the spell wrote over - so the sheet names those figures before the tap, and nothing takes it back.
     */
    it('ends a drying spell by itself: says what holds again, writes that it no longer dries and offers no undo', async () => {
      const afterDrying = { dayTemperature: 26, dayHumidity: 60, nightTemperature: 21, nightHumidity: 55, co2: 900, lightLimit: 100 };
      await drawn(device({ type: 'fridge', control: { ...CONTROL, drying: true, afterDrying } }));

      tap(/^Climate preset/);
      const sheet = screen.getByRole('dialog');
      expect(within(sheet).queryByRole('button', { name: 'End germination' })).not.toBeInTheDocument();
      fireEvent.click(within(sheet).getByRole('button', { name: 'End drying' }));
      expect(within(sheet).getByRole('button', { name: 'End drying' })).toHaveAttribute('aria-pressed', 'true');
      const back = within(sheet).getByRole('list', { name: 'What holds again afterwards' });
      expect(within(back).getByText('Day temperature').parentElement).toHaveTextContent('25.0 °C → 26.0 °C');
      expect(within(back).getByText('Light limit').parentElement).toHaveTextContent('80 % → 100 %');
      // A figure the spell left where it was is not listed.
      expect(within(back).queryByText('Day humidity')).not.toBeInTheDocument();
      expect(within(sheet).getByText(/Applying ends drying/)).toBeInTheDocument();
      expect(sent('PATCH')).toHaveLength(0);

      fireEvent.click(within(sheet).getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(sent('PATCH')).toHaveLength(1));
      expect(sent('PATCH')[0]).toMatchObject({ path: '/devices/device-1/configuration', body: { set: { drying: false } } });
      expect(sent('PUT')).toHaveLength(0);
      await waitFor(() => expect(said()).toBe('Drying ended · saved'));
      expect(told[0].undo).toBeNull();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('ends a germination by itself with the standard mode, and pauses a plan that would begin it again', async () => {
      wire.plan = plan('running');
      const afterGermination = { dayTemperature: null, dayHumidity: null, nightTemperature: 18, nightHumidity: 50, co2: null, lightLimit: null };
      await drawn(device({ type: 'fridge', control: { ...CONTROL, mode: 'germination', afterGermination } }));

      tap(/^Climate preset/);
      const sheet = screen.getByRole('dialog');
      fireEvent.click(within(sheet).getByRole('button', { name: 'End germination' }));
      const back = within(sheet).getByRole('list', { name: 'What holds again afterwards' });
      expect(within(back).getByText('Night temperature').parentElement).toHaveTextContent('20.0 °C → 18.0 °C');
      expect(within(sheet).getByText(/Applying ends germination/)).toBeInTheDocument();
      expect(within(sheet).getByText(/This pauses the plan “Autoflower, 12 weeks”/)).toBeInTheDocument();
      // What germination does about the humidity is no question for one that ends.
      expect(within(sheet).queryByRole('switch')).not.toBeInTheDocument();

      fireEvent.click(within(sheet).getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(sent('PATCH')).toHaveLength(1));
      expect(sent('POST')[0].body).toEqual({ kind: 'pause', reason: 'Targets set by hand' });
      expect(sent('PATCH')[0].body).toEqual({ set: { mode: 'standard' } });
      await waitFor(() => expect(said()).toBe('Germination ended · saved'));
    });

    it('offers to end nothing while no spell runs', async () => {
      await drawn(device({ type: 'fridge', control: CONTROL }));

      tap('Climate preset');
      expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /^End / })).not.toBeInTheDocument();
    });

    /** Germination begun by a preset is one write to take back: the figures from before, and the dark ended. */
    it('takes a preset into germination back with the figures from before', async () => {
      await drawn(device({ type: 'fridge', control: CONTROL }));

      tap('Climate preset');
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Germination · dark' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(told).toHaveLength(1));
      expect(sent('PUT')[0].body).toMatchObject({ germination: true, configuration: { night: { temperature: 24, humidity: 75 } } });

      await told[0].undo!();
      expect(sent('PUT')).toHaveLength(2);
      expect(sent('PUT')[1].body).toMatchObject({ germination: false, configuration: { night: CONFIGURATION.night, day: CONFIGURATION.day } });
    });

    /** Out of germination the way back is two writes: the figures from before with the night germination had kept, then germination with its own night and choices. */
    it('takes a preset out of germination back so that it keeps the same night again', async () => {
      const afterGermination = { dayTemperature: null, dayHumidity: null, nightTemperature: 18, nightHumidity: 50, co2: null, lightLimit: null };
      const germinating = device({ type: 'fridge', control: { ...CONTROL, mode: 'germination', afterGermination } });
      await drawn(germinating);

      tap(/^Climate preset/);
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Flower' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(told).toHaveLength(1));
      expect(sent('PUT')[0].body).toMatchObject({ germination: false });

      await told[0].undo!();
      const [, night, again] = sent('PUT').map(call => call.body as { configuration: DeviceConfiguration; germination?: boolean });
      // In the dark the server keeps the day it finds, so the day from before is written while the device is in the light.
      expect(night.configuration).toMatchObject({ day: CONFIGURATION.day, night: { temperature: 18, humidity: 50 }, co2: CONFIGURATION.co2 });
      expect(night.germination).toBeUndefined();
      const { 'lights.limit': limit, ...before } = CONFIGURATION;
      expect(again).toMatchObject({
        germination: true,
        germinationChoices: { warnTooHumid: false },
        configuration: { ...before, lights: { sunrise: 15, sunset: 15, limit } },
      });
    });

    it('offers no way back from a germination whose humidifier rested: its band is not kept across the two writes', async () => {
      wire.sockets = ['humidifier'];
      const choices = { warnTooHumid: false, humidifierHolds: false };
      await drawn(device({ type: 'fridge', control: { ...CONTROL, mode: 'germination', germinationChoices: choices } }));

      tap(/^Climate preset/);
      const sheet = screen.getByRole('dialog');
      await within(sheet).findByRole('switch', { name: 'Hold the humidity with the humidifier' });
      fireEvent.click(within(sheet).getByRole('button', { name: 'Flower' }));
      fireEvent.click(within(sheet).getByRole('button', { name: 'Apply' }));

      await waitFor(() => expect(told).toHaveLength(1));
      expect(told[0].undo).toBeNull();
    });
  });

  describe('a device that is not heard', () => {
    /** Three in the afternoon, UTC, with a device last heard at one. */
    const THREE = Date.parse('2026-09-19T15:00:00.000Z');
    const HEARD = '2026-09-19T13:00:00.000Z';
    const silent = (): Device => ({ ...device(), state: { ...device().state, lastSeenAt: HEARD } });
    beforeEach(() => {
      Settings.now = () => THREE;
    });

    /**
     * Offline does not lock. What the cloud stored since the device was last
     * heard is marked and said with what the device still holds - by the
     * server's reckoning, which is all anybody knows of it.
     */
    it('marks a figure the device has not been handed and says what it still holds', async () => {
      wire.live = {};
      wire.pending = {
        since: HEARD,
        settings: [
          { field: 'day.temperature', held: 26, savedAt: '2026-09-19T14:31:00.000Z' },
          { field: 'lights.limit', held: null, savedAt: '2026-09-19T14:32:00.000Z' },
        ],
      };
      await drawn(silent());

      expect(
        await screen.findByText('Day temperature: 25.0 °C saved at 14:31. The device still holds 26.0 °C until it is back online.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Change Day temperature, 25.0 °C, not with the device yet' })).toHaveAttribute('data-pending');
      expect(figure('Night temperature')).not.toHaveAttribute('data-pending');
      // What it held is said only where the cloud knows it, and the limit is marked as the figures are: pending is one colour.
      expect(screen.getByText('Light limit: 80 % saved at 14:32. The device takes it over once it is back online.')).toBeInTheDocument();
      const limit = screen.getByRole('spinbutton', { name: 'Light limit' }).closest('[data-pending]');
      expect(limit).not.toBeNull();
      expect(limit).not.toHaveAttribute('data-changed');
    });

    /** A preset applied to a silent device moves six figures at once: one note for the card, which unfolds what the device still holds. */
    it('says several figures of a card in one note that unfolds them, each keeping its mark', async () => {
      wire.live = {};
      wire.pending = {
        since: HEARD,
        settings: [
          { field: 'day.temperature', held: 26, savedAt: '2026-09-19T14:30:00.000Z' },
          { field: 'day.humidity', held: 65, savedAt: '2026-09-19T14:31:00.000Z' },
          { field: 'night.humidity', held: null, savedAt: '2026-09-19T14:31:00.000Z' },
        ],
      };
      await drawn(silent());

      const note = (await screen.findByText('3 settings saved at 14:31, not with the device yet')).closest('details')!;
      expect(within(screen.getByRole('region', { name: 'Targets' })).queryAllByRole('status')).toHaveLength(0);
      expect(
        within(note)
          .getAllByRole('listitem', { hidden: true })
          .map(item => item.textContent?.replace(/\u00a0/g, ' ')),
      ).toEqual([
        'Day temperature: 25.0 °C · the device still holds 26.0 °C',
        'Day humidity: 60 % · the device still holds 65 %',
        'Night humidity: 55 %',
      ]);
      for (const name of ['Day temperature', 'Day humidity', 'Night humidity']) expect(figure(name)).toHaveAttribute('data-pending');
      expect(figure('Night temperature')).not.toHaveAttribute('data-pending');
    });

    it('says the light window the device still runs where a new one was stored', async () => {
      wire.live = {};
      wire.pending = { since: HEARD, settings: [{ field: 'daynight.night', held: 61200, savedAt: '2026-09-19T14:31:00.000Z' }] };
      await drawn(silent());

      expect(
        await screen.findByText('Light times: On at 06:00 · 12 h saved at 14:31. The device still runs On at 06:00 · 11 h until it is back online.'),
      ).toBeInTheDocument();
    });

    /** A stored mode changes what the card draws, so the card says that the device has not taken it. */
    it('says under the targets that a work mode stored since has not reached the device', async () => {
      wire.live = {};
      wire.pending = { since: HEARD, settings: [{ field: 'workmode', held: 'small', savedAt: '2026-09-19T14:31:00.000Z' }] };
      await drawn({ ...silent(), type: 'fridge', control: { ...CONTROL, drying: true } });

      expect(
        await screen.findByText('Operating mode: Drying saved at 14:31. The device still runs Standard until it is back online.'),
      ).toBeInTheDocument();
    });

    /**
     * Switched off while it was silent, the device regulates on: off is a setting it has not been handed. The page says
     * so with the way back, and the cards stay as the device still runs them.
     */
    it('keeps the cards of a device switched off while it was not heard, and says it still regulates', async () => {
      wire.live = {};
      wire.pending = { since: HEARD, settings: [{ field: 'workmode', held: 'small', savedAt: '2026-09-19T14:31:00.000Z' }] };
      await drawn({ ...silent(), type: 'fridge', control: { ...CONTROL, running: false } });

      expect(
        await screen.findByText('Control off saved at 14:31, not with the device yet: Blue Dream tent goes on controlling until it is back online.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('table', { name: 'Targets' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Light' })).toBeInTheDocument();
      expect(screen.queryByText('Control off.')).not.toBeInTheDocument();
      tap('Switch control on');
      await waitFor(() => expect(sent('PATCH')[0]?.body).toEqual({ set: { control: true } }));
      await waitFor(() => expect(said()).toBe('Control on · saved, not with the device yet'));
    });

    it('still saves, and the toast says when the device takes it over', async () => {
      await drawn(silent());

      fireEvent.click(figure('Day temperature'));
      type('Day temperature', 24);
      save();

      await waitFor(() => expect(told).toHaveLength(1));
      expect(said()).toBe('Day temperature 24.0 °C · saved, not with the device yet');
    });
  });

  /** A control the reader may not use is absent, not disabled. */
  it('shows a session that may only look the figures as text and offers nothing that writes', async () => {
    await drawn(device(), false);

    expect(screen.getByRole('table', { name: 'Targets' })).toHaveTextContent('25.0 °C');
    expect(screen.queryByRole('button', { name: /^Change|^Climate preset|light limit$/ })).not.toBeInTheDocument();
    expect(screen.getByText('80 %')).toBeInTheDocument();
  });

  describe('the shape of the grid', () => {
    it('leaves CO₂ out for a device without the sensor', async () => {
      await drawn(device({}, { co2: 'off' }));

      expect(screen.queryByRole('button', { name: /CO₂ target/ })).not.toBeInTheDocument();
    });

    it('is one column round the clock while drying, with no light to plan', async () => {
      await drawn(device({ type: 'fridge', control: { ...CONTROL, drying: true } }));

      expect(screen.getAllByRole('columnheader').map(head => head.textContent)).toEqual(['', 'Drying']);
      expect(screen.getByText('Light off · drying')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Change times' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Change Temperature while drying, 20.0 °C/ })).toBeInTheDocument();
      expect(screen.queryByRole('spinbutton', { name: 'Light limit' })).not.toBeInTheDocument();
    });

    it('holds no humidity in greenhouse mode', async () => {
      await drawn(device({ type: 'fridge', control: { ...CONTROL, mode: 'greenhouse' } }));

      expect(screen.queryByRole('button', { name: /humidity/ })).not.toBeInTheDocument();
      expect(figure('Day temperature')).toBeInTheDocument();
    });

    it('keeps the night it cannot show at 24 hours of light, and says so', async () => {
      await drawn(device({ configuration: { ...CONFIGURATION, daynight: { day: 21600, night: 21599 } } }));

      expect(screen.getAllByRole('columnheader').map(head => head.textContent)).toEqual(['', 'round the clock']);
      expect(screen.getByText('Light on round the clock · 24 h')).toBeInTheDocument();
      expect(screen.getByText(/Night figures – hold again as soon as there is a night/)).toHaveTextContent('20 °C · 55 %');
    });

    /** Switched off there is no table, because the device holds none of it - and the one way out stands beside the sentence. */
    it('is the sentence and the way to switch on alone while control is off', async () => {
      draw(device({ type: 'fridge', control: { ...CONTROL, running: false } }));

      expect(await screen.findByText('Control off.')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      tap('Switch control on');
      await waitFor(() => expect(sent('PATCH')[0]?.body).toEqual({ set: { control: true } }));
      await waitFor(() => expect(said()).toBe('Control on · saved'));
    });
  });
});

/**
 * The chips here and the preset sheet on the overview used to read two lists:
 * one offered "Auto · Flower", the other had never heard of it. Both read the
 * one list now, and every chip is a stage and a preset the sheet offers too.
 */
describe('the one list of presets', () => {
  it('offers on every screen each preset a chip stands for', () => {
    for (const chip of CLIMATE_CHOICES) {
      expect(STAGES_WITH_CLIMATE).toContain(chip.stage);
      if (chip.preset) expect(presetsOf(chip.stage)).toContain(chip.preset);
    }
    expect(presetsOf('vegetative')).toEqual(['autoflower']);
    expect(presetsOf('flowering')).toEqual(['late_flowering', 'autoflower']);
    expect(presetsOf('curing')).toEqual([]);
  });
});

describe('the document a draft becomes', () => {
  it('turns the account´s wall clock into the document´s seconds and back, round midnight where it must', () => {
    const kolkata = 5.5 * 3600;
    const berlinInWinter = 3600;

    expect(wallClock(21600, kolkata)).toBe('11:30');
    expect(secondsOf('11:30', kolkata)).toBe(21600);
    expect(secondsOf('03:00', kolkata)).toBe(21.5 * 3600);
    expect(wallClock(21.5 * 3600, kolkata)).toBe('03:00');
    expect(secondsOf('00:30', berlinInWinter)).toBe(23.5 * 3600);
    expect(secondsOf('24:00', 0)).toBeNull();
    expect(secondsOf('', 0)).toBeNull();
    // A second before midnight is midnight on a clock.
    expect(wallClock(86399, 7200)).toBe('02:00');
  });

  it('writes a day-long light as a day that never ends, keeping the hour it came on, and reads the older form as 24 hours too', () => {
    const draft = { ...draftOf(CONFIGURATION), lightHours: 24 };
    const written = withDraft(CONFIGURATION, draft);

    expect(written.daynight).toMatchObject({ day: 2 * 86400 + 21601, night: 2 * 86400 + 21600 });
    expect(draftOf(written)).toMatchObject({ lightHours: 24, lightsOn: 21600 });
    // One second short of a day, as 24 hours was written before.
    expect(draftOf({ daynight: { day: 21600, night: 21599 } })).toMatchObject({ lightHours: 24, lightsOn: 21600 });
  });

  /** The firmware compares strictly: off at the second it comes on is never day. An older client wrote that for "24 hours" and kept the tent dark. */
  it('reads a light that goes off the second it comes on as the firmware does: no light at all', () => {
    expect(draftOf({ daynight: { day: 21600, night: 21600 } }).lightHours).toBe(0);
  });

  it('keeps the hour the light comes on and moves when it goes off, past midnight if it must', () => {
    const draft = { ...draftOf(CONFIGURATION), lightHours: 20 };

    expect(withDraft(CONFIGURATION, draft).daynight).toEqual({ day: 21600, night: (21600 + 20 * 3600) % 86400, maxDehumidifySeconds: 120 });
  });

  it('never writes a light that goes off at midnight UTC on the dot, which the firmware would cut without its ramp, and reads it back whole', () => {
    const written = withDraft(CONFIGURATION, { ...draftOf(CONFIGURATION), lightHours: 18 });

    expect(written.daynight).toMatchObject({ day: 21600, night: 86399 });
    expect(draftOf(written).lightHours).toBe(18);
  });

  it('writes the drying figures into both halves, and every other half as the draft has it', () => {
    const draft = { ...draftOf(CONFIGURATION), dayTemperature: 26, nightTemperature: 18, nightHumidity: 58 };

    expect(withDraft(CONFIGURATION, draft, false, 'drying')).toMatchObject({
      day: { temperature: 18, humidity: 58 },
      night: { temperature: 18, humidity: 58 },
    });
    expect(withDraft(CONFIGURATION, draft, false, 'both')).toMatchObject({
      day: { temperature: 26, humidity: 60 },
      night: { temperature: 18, humidity: 58 },
    });
  });

  it("reads a document that states nothing yet with the firmware's own defaults", () => {
    expect(draftOf({})).toEqual({
      dayTemperature: 25,
      dayHumidity: 60,
      nightTemperature: 25,
      nightHumidity: 60,
      lightLimit: 100,
      lightsOn: 21600,
      lightHours: 16,
      co2: 400,
    });
  });

  it('works the VPD out along the contract´s own curve, which is the one the server charts a reading with', () => {
    // The server rounds the same figure to two decimals before it stores it;
    // the page shows one. Neither side draws the curve itself any more.
    expect(vpdOf(26, 60, -2)).toBe(vapourPressureDeficit(26, 24, 60));
    expect(vapourPressureDeficit(26, 24, 60)).toBeCloseTo(0.97, 2);
  });
});

/**
 * Day and night are the firmware's clock: strict comparisons, a window past
 * midnight wrapping round it, and the ramps inside the day.
 */
describe('which half holds when', () => {
  const ramps = { up: 15, down: 15 };
  const H = 3600;
  /** The phase a schedule of `hours` from `on` (seconds past midnight UTC) is in at `t` seconds past midnight UTC. */
  const phaseAt = (on: number, hours: number, t: number, with_ = ramps) =>
    phaseOf({ ...draftOf(CONFIGURATION), lightsOn: on, lightHours: hours }, with_, DateTime.fromISO('2026-09-19T00:00:00.000Z').plus({ seconds: t }));

  it('is day strictly between on and off, and night otherwise', () => {
    expect(phaseAt(6 * H, 12, 12 * H)).toBe('day');
    expect(phaseAt(6 * H, 12, 6 * H)).toBe('night');
    expect(phaseAt(6 * H, 12, 18 * H)).toBe('night');
    expect(phaseAt(6 * H, 12, 2 * H)).toBe('night');
  });

  it('wraps a window that runs past midnight', () => {
    expect(phaseAt(22 * H, 12, 2 * H)).toBe('day');
    expect(phaseAt(22 * H, 12, 23 * H)).toBe('day');
    expect(phaseAt(22 * H, 12, 12 * H)).toBe('night');
  });

  it('is never day with no hours of light, and day on every second at 24 hours, without a dip', () => {
    expect(phaseAt(6 * H, 0, 12 * H)).toBe('night');
    expect(phaseAt(6 * H, 24, 6 * H)).toBe('day');
    expect(phaseAt(6 * H, 24, 6 * H - 300)).toBe('day');
    expect(phaseAt(6 * H, 24, 6 * H + 300)).toBe('day');
    expect(phaseAt(6 * H, 24, 18 * H)).toBe('day');
  });

  it('names the ramps inside the day, the evening one before a light that goes off at midnight UTC included', () => {
    expect(phaseAt(6 * H, 12, 6 * H + 600)).toBe('sunrise');
    expect(phaseAt(6 * H, 12, 18 * H - 600)).toBe('sunset');
    expect(phaseAt(6 * H, 18, 24 * H - 600)).toBe('sunset');
    expect(phaseAt(22 * H, 12, 10 * H - 60, { up: 30, down: 15 })).toBe('sunset');
  });
});

/**
 * What a device's targets are made of, by its mode and its light schedule:
 * which table the page draws, and what every other screen calls a target.
 */
describe('the shape of a device’s day', () => {
  const fridge = (control: Partial<NonNullable<Device['control']>>) =>
    device({
      type: 'fridge',
      control: { running: true, drying: false, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES, ...control },
    });
  const draft = draftOf(CONFIGURATION);

  it('is a day and a night in the standard and greenhouse modes, the greenhouse holding no humidity', () => {
    expect(shapeOf(fridge({}), draft)).toEqual({ regime: 'cycle', greenhouse: false });
    expect(shapeOf(fridge({ mode: 'greenhouse' }), draft)).toEqual({ regime: 'cycle', greenhouse: true });
  });

  it('is one climate round the clock while drying or germinating, whatever the schedule says', () => {
    expect(shapeOf(fridge({ drying: true }), draft).regime).toBe('drying');
    expect(shapeOf(fridge({ mode: 'germination' }), draft).regime).toBe('germination');
    // The chip tapped last decides, before it is saved.
    expect(shapeOf(fridge({}), draft, { drying: true }).regime).toBe('drying');
  });

  it('is a day without a night at 24 hours, a night without a day at none, and nothing with control off', () => {
    expect(shapeOf(fridge({}), { ...draft, lightHours: 24 }).regime).toBe('always');
    expect(shapeOf(fridge({}), { ...draft, lightHours: 0 }).regime).toBe('never');
    expect(shapeOf(fridge({ running: false }), draft).regime).toBe('off');
  });

  it('is an AIR fan’s light sensor for a fan', () => {
    expect(shapeOf(device({ type: 'fan' }), draft).regime).toBe('sensor');
  });
});

describe('what holds now', () => {
  const live = (setpoints: object): DeviceLive => ({
    deviceId: 'device-1',
    pending: null,
    metrics: {},
    outputs: {},
    setpoints: { day: {}, night: {}, active: 'day', ...setpoints },
  });
  const holdingAt = (time: string, over: Partial<Parameters<typeof nowHoldingOf>[0]> = {}) =>
    nowHoldingOf({
      device: device({ type: 'fridge' }),
      shape: { regime: 'cycle', greenhouse: false },
      stored: draftOf(CONFIGURATION),
      live: undefined,
      offline: false,
      now: DateTime.fromISO(`2026-09-19T${time}:00.000Z`),
      clock: seconds => wallClock(seconds, 0),
      ...over,
    });

  it('is the server’s period, else its active half, for a device that is heard', () => {
    expect(holdingAt('12:00', { live: live({ active: 'night' }) })).toMatchObject({ half: 'night', by: 'device' });
    expect(holdingAt('12:00', { live: live({ active: 'day', period: 'night' }) })).toMatchObject({ half: 'night', by: 'device' });
    expect(holdingAt('12:00', { live: live({ active: 'night', period: 'constant' }) })).toMatchObject({ half: 'night', by: 'device' });
  });

  it('is the schedule’s for a device that is not heard, or whose word has not come', () => {
    expect(holdingAt('12:00', { live: live({ active: 'night' }), offline: true })).toMatchObject({ half: 'day', by: 'schedule' });
    expect(holdingAt('02:00')).toMatchObject({ half: 'night', by: 'schedule' });
    // While the word of a device that is heard is on its way, the schedule stands in without naming itself.
    expect(holdingAt('02:00', { awaiting: true })).toMatchObject({ half: 'night', by: 'device' });
    expect(holdingAt('02:00', { awaiting: true, offline: true })).toMatchObject({ half: 'night', by: 'schedule' });
  });

  it('is the one column of a regime with one climate, and none with control off', () => {
    expect(holdingAt('12:00', { shape: { regime: 'drying', greenhouse: false } }).half).toBe('night');
    expect(holdingAt('12:00', { shape: { regime: 'always', greenhouse: false } }).half).toBe('day');
    expect(holdingAt('12:00', { shape: { regime: 'off', greenhouse: false } }).half).toBeNull();
  });

  it('glides a fridge over its ramps, by the server’s word where it gives one', () => {
    const transition = { until: '2026-09-19T19:00:00.000Z', from: 'day', to: 'night', gliding: true, targets: {} };
    // Until the lamp's switch, not until the hour the climate is given after it.
    expect(holdingAt('17:50', { live: live({ transition }) }).glide).toEqual({ to: 'night', until: '18:00' });
    // The hour after the switch is no glide: the targets have arrived.
    expect(holdingAt('18:30', { live: live({ active: 'night', period: 'night', transition: { ...transition, gliding: false } }) }).glide).toBeNull();
    // A device whose answer says no transition is not gliding; one that says nothing of it, or is not heard yet, glides by the schedule.
    expect(holdingAt('06:05', { live: live({ transition: null }) }).glide).toBeNull();
    expect(holdingAt('06:05', { live: live({}) }).glide).toEqual({ to: 'day', until: '06:15' });
    expect(holdingAt('06:05').glide).toEqual({ to: 'day', until: '06:15' });
    expect(holdingAt('06:05', { device: device() }).glide).toBeNull();
  });
});

describe('what a running plan writes', () => {
  it('is the figures its step carries and the light hours it names, and the hour only where it carries one', () => {
    expect([...ownedBy(STEP)].sort()).toEqual([
      'co2',
      'dayHumidity',
      'dayTemperature',
      'lightHours',
      'lightLimit',
      'nightHumidity',
      'nightTemperature',
    ]);
    expect([...ownedBy({ ...STEP, lightHours: null, settings: { daynight: { day: 3600, night: 50400 } } })].sort()).toEqual([
      'lightHours',
      'lightsOn',
    ]);
    expect(ownedBy(null).size).toBe(0);
  });
});
