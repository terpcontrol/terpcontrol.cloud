import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime, Settings } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { createMemoryRouter, Link, MemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GERMINATION_CHOICES } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import type { Device, DeviceConfiguration, DeviceLive, Me, Plan, PlanStep, Setpoints } from '@fg2/shared-types/v1';
import { Targets } from '@/screens/control/targets/Targets';
import { vapourPressureDeficit } from '@fg2/shared-types/v1-schemas/vpd.js';
import { nowHoldingOf, ownedBy, phaseOf, shapeOf } from '@/screens/control/targets/day-night';
import { draftOf, vpdOf, withDraft } from '@/screens/control/targets/targets-draft';
import { secondsOf, wallClock } from '@/ui/wall-clock';
import { STAGES_WITH_CLIMATE } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import { CLIMATE_CHOICES, presetsOf } from '@/ui/presets';

/**
 * What the targets page promises: that a chip only moves the figures,
 * that one Save sends the device's whole document with nothing but the targets
 * changed, that a plan which would write them back is paused first, and that a
 * session which may only look is offered nothing that writes.
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

const device = (over: Partial<Device> = {}, hardware: Record<string, string> = { co2: 'on' }): Device => ({
  id: 'device-1',
  createdAt: NOW.minus({ days: 60 }).toISO()!,
  type: 'controller',
  classId: null,
  serialNumber: 42,
  ownerId: 'user-1',
  spaceId: 'space-1',
  name: 'Blue Dream tent',
  firmware: { channel: 'stable', targetId: null },
  configuration: CONFIGURATION,
  settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
  control: null,
  isDemo: false,
  state: {
    lastSeenAt: DateTime.now().minus({ seconds: 20 }).toISO()!,
    claimedAt: NOW.minus({ days: 60 }).toISO()!,
    firmwareId: 'build-1',
    updateStartedAt: null,
    updateEndedAt: null,
    updateFailedAt: null,
    maintenanceUntil: null,
    hardware,
    socketStateChangedAt: {},
    socketsReportedAt: null,
  },
  ...over,
});

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
const account = (timezone: string): Me => ({
  id: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  email: 'login@example.org',
  isAdmin: false,
  isActive: true,
  handle: 'you',
  bio: null,
  avatarMediaId: null,
  publicProfile: false,
  privacy: { hideWeights: false, hideCounts: false },
  preferences: { units: { temperature: 'celsius', weight: 'grams', volume: 'liters' }, locale: 'en', timezone },
  retention: { climateDays: null },
  climateRetention: { installDays: null, appliesDays: null },
  notifications: { channels: { email: null, telegram: null, webhook: null }, routing: {}, quietHours: null, mutedUntil: null },
  deletionStartedAt: null,
  premium: { enforced: false, extendUrl: null, priceLabel: null, free: { stillWidth: null, stillDays: null, timelapseDays: null } },
  pushPublicKey: null,
  telegramAvailable: false,
  pushSubscribed: false,
  layers: { diary: true },
});

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
  /** The account's zone; none leaves the page on the browser's, which the test keeps on UTC. */
  zone: null as string | null,
  /** What PUT /configuration answers with instead of the document, when a refusal is wanted. */
  refuseSave: null as { status: number; code: string; detail: string } | null,
  /** The roles of the sockets paired at the device; none answers 404, a device that reports no table. */
  sockets: null as string[] | null,
  calls: [] as Call[],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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
    if (method === 'GET' && path === '/devices/device-1/live') {
      return wire.live
        ? json({ deviceId: 'device-1', metrics: {}, outputs: {}, setpoints: { day: {}, night: {}, active: 'day', ...wire.live } })
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
    if (method === 'GET' && path === '/devices/device-1/plan') {
      return wire.plan ? json(wire.plan) : problem(404, 'plan_not_found', 'This device is not being run by a plan.');
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
      return wire.refuseSave ? problem(wire.refuseSave.status, wire.refuseSave.code, wire.refuseSave.detail) : json(body);
    }
    return problem(404, 'not_found', `No stub for ${method} ${path}`);
  }),
);

const sent = (method: string) => wire.calls.filter(call => call.method === method);

const draw = (devices: Device[] = [device()], mayManage = true, crumb = false) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>
        <Targets spaceId="space-1" devices={devices} mayManage={mayManage} crumb={crumb} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The page once the plan has been read, which is when the table is drawn. */
const drawn = async (devices?: Device[], mayManage?: boolean) => {
  draw(devices, mayManage);
  return screen.findByRole('spinbutton', { name: 'Day temperature' });
};

/** A figure's field in the table, by the name a screen reader gives it. */
const field = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;

/** Types a figure into its field and leaves it, which is when a typed figure counts. */
const type = (name: string, to: number) => {
  fireEvent.change(field(name), { target: { value: String(to) } });
  fireEvent.blur(field(name));
};

const tap = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

const lightsOn = () => screen.getByLabelText('Light on at', { selector: 'input' }) as HTMLInputElement;

/** The column heads that say they hold now: the one shaded. */
const holding = () => screen.getAllByRole('columnheader').filter(head => within(head).queryByText(/^(holds now|by the schedule)$/));

/** The light plan over the table. */
const plan_ = () => screen.getByRole('group', { name: 'Light plan' });

/** The save bar, by the button it carries. */
const bar = () => screen.getByRole('button', { name: 'Save' }).parentElement!;

beforeAll(async () => {
  // The light window is said in the reader's own time; the document holds UTC, so the test reads in UTC.
  Settings.defaultZone = 'utc';
  const [en, de] = await Promise.all(
    ['en', 'de'].map(async language => JSON.parse(await readFile(resolve(process.cwd(), `public/assets/i18n/${language}.json`), 'utf8'))),
  );
  await i18next.use(initReactI18next).init({
    lng: 'en',
    resources: { en: { translation: en }, de: { translation: de } },
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  await i18next.changeLanguage('en');
  Settings.now = () => Date.now();
});

afterAll(() => {
  Settings.defaultZone = 'system';
});

beforeEach(() => {
  wire.plan = null;
  wire.live = null;
  wire.zone = null;
  wire.refuseSave = null;
  wire.sockets = null;
  wire.calls = [];
});

/** The clock the page reads "now" off, set to a time of day in UTC. */
const at = (time: string) => {
  const instant = DateTime.fromISO(`2026-09-19T${time}:00.000Z`).toMillis();
  Settings.now = () => instant;
};

describe('the targets page', () => {
  it('says so when nothing standing here states a climate or has settings of its own, and offers the one thing that helps', () => {
    draw([device({ id: 'cam-hub', type: 'cam', configuration: { anything: 1 } })]);

    expect(screen.getByText(/Nothing standing here states a climate/)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a device' })).toHaveAttribute('href', '/claim');
    expect(screen.queryByRole('link', { name: '‹ back to the plan' })).not.toBeInTheDocument();
  });

  /** A smart socket on its own is its owner's whole tent: what it switches by is set here, not asked for a device it has no use for. */
  it('draws what a smart socket standing here alone switches by, instead of asking for another device', () => {
    draw([device({ id: 'plug-1', type: 'plug', configuration: { workmode: 'heater', heater: { day: { on: 24, off: 27 } } } })]);

    expect(screen.getByRole('button', { name: 'Heating' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('slider', { name: 'On below – Switch points' })).toHaveValue('24');
    expect(screen.queryByText(/Nothing standing here states a climate/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a device' })).not.toBeInTheDocument();
  });

  /**
   * A controller reporting live values a tab away, whose document has simply
   * not arrived, was told that nothing standing here states a climate and
   * offered a second device it has no use for. Both halves were false, and the
   * Devices tab of the same tent has always said the true one.
   *
   * What brings the document is the other half of being honest here: the
   * firmware publishes it when a setting is changed on its own menu and at no
   * other time, so a page that names the next connection is naming the one
   * thing that will never help.
   */
  it('says a controller’s settings are still on their way rather than asking for another device', () => {
    draw([device({ id: 'controller-1', name: null, configuration: null })]);

    expect(screen.getByText(/Controller · LLER-1 has not sent its settings yet/)).toBeInTheDocument();
    expect(screen.getByText(/Changing any setting on the device itself sends them; connecting alone does not/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing standing here states a climate/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a device' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('says a smart socket that has sent nothing has nothing to change yet, rather than asking for another device', () => {
    draw([device({ id: 'plug-1', type: 'plug', configuration: null })]);

    expect(screen.getByText(/has not sent its settings yet, so there is nothing to change here/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a device' })).not.toBeInTheDocument();
  });

  /**
   * One card: the light plan on top - what it is, the day it makes, what holds
   * now and the two figures it is set by - and under it the table, the day's
   * column beside the night's, each headed by when it runs. The night is what
   * the day leaves: its times are read, never set.
   */
  it('keeps under the targets the same Erweitert the device has under Geräte, so Start leads to every setting', async () => {
    await drawn([
      device({
        type: 'fridge',
        control: { running: true, drying: false, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES },
      }),
    ]);
    fireEvent.click(screen.getByText('Advanced', { selector: 'summary' }));

    // A fridge's own tuning and the update channel, exactly as its panel offers them.
    expect(screen.getByRole('textbox', { name: 'Compressor rest' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Sunrise' })).toBeInTheDocument();
    expect(screen.getByText('Update channel')).toBeInTheDocument();
    // But not the mode a second time beside the chips that set it: the section says where the rest of it is.
    expect(screen.getAllByRole('button', { name: 'Germination · dark' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Operating mode under Devices ›' })).toHaveAttribute('href', '/devices?space=space-1');
  });

  it('names the device each Erweitert belongs to where two devices stand here', async () => {
    await drawn([device(), device({ id: 'device-2', name: 'Cellar fridge', type: 'fridge' })]);

    expect(screen.getByText('Advanced · Blue Dream tent', { selector: 'summary' })).toBeInTheDocument();
    expect(screen.getByText('Advanced · Cellar fridge', { selector: 'summary' })).toBeInTheDocument();
  });

  it('draws the light plan over the table, the day beside the night, each headed by when it runs', async () => {
    await drawn();

    expect(within(plan_()).getByText('Light on 06:00–18:00 · 12 h')).toBeInTheDocument();
    expect(lightsOn().value).toBe('06:00');
    expect(field('Light on for').value).toBe('12');
    expect(within(plan_()).getByText('The night follows from it: 18:00–06:00 · 12 h.')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Targets' });
    const [, day, night] = within(table).getAllByRole('columnheader');
    expect(day).toHaveTextContent(/^Light on \(day\)06:00–18:00· 12 h/);
    expect(night).toHaveTextContent(/^Light off \(night\)18:00–06:00· 12 h/);
    // Read off the light plan, never set in the table.
    expect(within(night).queryByRole('spinbutton')).not.toBeInTheDocument();

    expect(field('Day temperature').value).toBe('25');
    expect(field('Day humidity').value).toBe('60');
    expect(field('Night temperature').value).toBe('20');
    expect(field('Night humidity').value).toBe('55');
    expect(field('Light limit').value).toBe('80');
    expect(field('CO₂ target').value).toBe('800');
    // What the night does not have, said where it would stand.
    expect(within(screen.getByRole('row', { name: /^CO₂ target/ })).getByText('no CO₂')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /^Light limit/ })).getByText('lamp off')).toBeInTheDocument();
    // 25 °C at 60 % with the leaf two degrees cooler, worked out as the server
    // works a reading's, to the two decimals a deficit is written to.
    expect(within(screen.getByRole('row', { name: /^Humidity/ })).getByText('VPD 0.91')).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    // The page is what the tab opens on, so there is no way back to anywhere.
    expect(screen.queryByRole('link', { name: '‹ back to the plan' })).not.toBeInTheDocument();
  });

  /**
   * Which half holds is the device's word, as the server answers it for a
   * device that is heard - by its clock and its mode, never by the lamp. The
   * page used to work it out itself and said "day" where the cockpit beside it
   * said "night".
   */
  it('shades the column the device says holds now, and says until when', async () => {
    at('12:00');
    wire.live = { active: 'day' };
    await drawn();

    await waitFor(() => expect(holding()).toHaveLength(1));
    expect(holding()[0]).toHaveTextContent(/^Light on \(day\)/);
    expect(holding()[0]).toHaveTextContent('holds now');
    expect(within(plan_()).getByText('Day now · light off at 18:00')).toBeInTheDocument();
  });

  it('takes the server’s word over the schedule’s, and its period over its active half where it says one', async () => {
    at('12:00');
    wire.live = { active: 'day', period: 'night' };
    await drawn();

    await waitFor(() => expect(holding()[0]).toHaveTextContent(/^Light off \(night\)/));
    expect(within(plan_()).getByText('Night now · light on at 06:00')).toBeInTheDocument();
  });

  it('works the half out from the schedule while the device’s word has not come, and says it is the schedule’s', async () => {
    at('02:00');
    await drawn();

    // Answered with nothing, the schedule's half stands, called the schedule's.
    await waitFor(() => expect(holding()[0]).toHaveTextContent('by the schedule'));
    expect(holding()[0]).toHaveTextContent(/^Light off \(night\)/);
    expect(within(plan_()).getByText('Night now · light on at 06:00')).toBeInTheDocument();
  });

  it('says a fridge is in its sunset while the lamp dims, and that its targets glide towards the night', async () => {
    at('17:50');
    // The server's transition runs on for the hour after the switch; the glide is the ramp before it.
    wire.live = {
      active: 'day',
      transition: { until: '2026-09-19T19:00:00.000Z', from: 'day', to: 'night', gliding: true, targets: { temperature: 21.2 } },
    };
    await drawn([device({ type: 'fridge' })]);

    await waitFor(() =>
      expect(within(plan_()).getByText('Sunset · light off at 18:00, the targets gliding towards the night until then')).toBeInTheDocument(),
    );
    expect(holding()[0]).toHaveTextContent(/^Light on \(day\)/);
  });

  it('works a fridge’s glide out from its ramps where the server names none, and a tent controller’s targets do not glide', async () => {
    at('06:05');
    wire.live = { active: 'day' };
    await drawn([device({ type: 'fridge' })]);
    await waitFor(() => expect(within(plan_()).getByText('Sunrise · the targets glide towards the day until 06:15')).toBeInTheDocument());
  });

  it('says nothing of gliding for a tent controller, which switches its targets at once', async () => {
    at('06:05');
    wire.live = { active: 'day' };
    await drawn();
    await waitFor(() => expect(within(plan_()).getByText('Day now · light off at 18:00')).toBeInTheDocument());
  });

  it('says a device gone quiet is offline since when, and which half the schedule says rather than which it holds', async () => {
    at('12:00');
    wire.live = { active: 'night' };
    const quiet = DateTime.now().minus({ hours: 8 });
    await drawn([device({ state: { ...device().state, lastSeenAt: quiet.toISO()! } })]);

    expect(within(plan_()).getByText(`Offline since ${quiet.toFormat('HH:mm')} · by the schedule it would be day now`)).toBeInTheDocument();
    expect(holding()[0]).toHaveTextContent(/^Light on \(day\).*by the schedule$/);
    expect(screen.queryByText('holds now')).not.toBeInTheDocument();
    // The table stays to be read and set.
    expect(field('Night temperature')).toBeEnabled();
    expect(
      screen.getByText(new RegExp(`^Offline since .*${quiet.toFormat('HH:mm')} · what the device is really running may be older than this$`)),
    ).toBeInTheDocument();
  });

  /** A drying room has no schedule, so offline its column is the one it was last left in, not the schedule's. */
  it('says a quiet drying room holds what it was last left at, not what a schedule says', async () => {
    at('12:00');
    const quiet = DateTime.now().minus({ hours: 8 });
    draw([
      device({
        type: 'fridge',
        control: { running: true, drying: true, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES },
        state: { ...device().state, lastSeenAt: quiet.toISO()! },
      }),
    ]);
    await screen.findByRole('spinbutton', { name: 'Temperature while drying' });

    expect(screen.getAllByRole('columnheader').at(-1)).toHaveTextContent(/as last left$/);
    expect(screen.queryByText('by the schedule')).not.toBeInTheDocument();
  });

  it('says what germination gives back to the night when it ends', async () => {
    draw([
      device({
        type: 'fridge',
        configuration: { ...CONFIGURATION, night: { temperature: 24, humidity: 55 } },
        control: {
          running: true,
          drying: false,
          mode: 'germination',
          energySaving: false,
          germinationChoices: GERMINATION_CHOICES,
          afterGermination: { dayTemperature: null, dayHumidity: null, nightTemperature: 20, nightHumidity: null, co2: null, lightLimit: null },
        },
      }),
    ]);
    await screen.findByRole('spinbutton', { name: 'Temperature while germinating' });

    expect(
      screen.getByText('Where germination ends without a new climate, the night temperature from before holds again: 20 °C.'),
    ).toBeInTheDocument();
  });

  /** Germination's 75 % is stored whether or not a humidifier holds it, and the night's own comes back when it ends. */
  it('names the humidity germination gives back to the night where the humidifier rests too', async () => {
    draw([
      device({
        type: 'fridge',
        configuration: { ...CONFIGURATION, workmode: 'breed', night: { temperature: 21, humidity: 75 } },
        control: {
          running: true,
          drying: false,
          mode: 'germination',
          energySaving: false,
          germinationChoices: { warnTooHumid: false, humidifierHolds: false },
          afterGermination: { dayTemperature: null, dayHumidity: null, nightTemperature: 21, nightHumidity: 55, co2: null, lightLimit: null },
        },
      }),
    ]);
    await screen.findByRole('spinbutton', { name: 'Temperature while germinating' });

    expect(screen.getByText('Where germination ends without a new climate, the night from before holds again: 21 °C · 55 %.')).toBeInTheDocument();
  });

  /**
   * Germination is a climate among the chips and a mode of the device at once:
   * its chip moves the one figure germination holds and says the device goes
   * dark, and the save sends it as germination. Any other chip ends it.
   */
  it('puts a lit fridge into germination in the dark from its chip, and saves it as germination', async () => {
    const lit = { running: true, drying: false, mode: 'standard' as const, energySaving: false, germinationChoices: GERMINATION_CHOICES };
    await drawn([device({ type: 'fridge', configuration: { ...CONFIGURATION, workmode: 'small' }, control: lit })]);

    const chips = screen.getAllByRole('button', { name: / · (dark|with light)$/ }).map(chip => chip.textContent);
    expect(chips).toEqual(['Germination · dark', 'Seedling · with light']);
    expect(screen.getByRole('switch', { name: 'Energy saving' })).toBeInTheDocument();

    tap('Germination · dark');
    expect(screen.getByRole('button', { name: 'Germination · dark' })).toHaveAttribute('aria-pressed', 'true');
    expect(field('Temperature while germinating').value).toBe('24');
    expect(screen.queryByRole('spinbutton', { name: 'Day temperature' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /^Saving switches to Germination · dark: light off, no CO₂, one temperature and 75 % humidity for a humidifier round the clock\./,
      ),
    ).toBeInTheDocument();
    // Without a humidifier nothing holds the humidity, so the table does not show it.
    expect(screen.queryByRole('spinbutton', { name: 'Humidity while germinating' })).not.toBeInTheDocument();
    // What germination does about the humidity is asked under the table: the alarm alone, where no humidifier is paired.
    const choices = screen.getByRole('group', { name: 'During germination' });
    expect(within(choices).getByRole('switch', { name: 'Warn when it gets too humid' })).toHaveAttribute('aria-checked', 'false');
    expect(within(choices).getByText('“Too humid” rests until germination ends. Alarms you set up yourself stay awake.')).toBeInTheDocument();
    expect(within(choices).queryByRole('switch', { name: 'Hold the humidity with the humidifier' })).not.toBeInTheDocument();
    // Energy saving belongs to a day and a night, which germination does not have.
    expect(screen.queryByRole('switch', { name: 'Energy saving' })).not.toBeInTheDocument();

    tap('Save');
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    const body = sent('PUT')[0].body as { configuration: DeviceConfiguration; germination?: boolean; drying?: boolean };
    expect(body).toMatchObject({ germination: true, drying: false, germinationChoices: { warnTooHumid: false } });
    expect(body).not.toHaveProperty('germinationChoices.humidifierHolds');
    // Germination brings its 75 % all the same, for a humidifier paired later; the rest stays for the seedling after it.
    expect(body.configuration.night).toEqual({ temperature: 24, humidity: 75 });
    expect(body.configuration.day).toEqual({ temperature: 25, humidity: 60, heating: 'hard' });
  });

  it('prefills germination´s 75 % for a paired humidifier, and draws its chip chosen by what the table shows', async () => {
    wire.sockets = ['humidifier'];
    const lit = { running: true, drying: false, mode: 'standard' as const, energySaving: false, germinationChoices: GERMINATION_CHOICES };
    const { unmount } = draw([device({ type: 'fridge', configuration: { ...CONFIGURATION, workmode: 'small' }, control: lit })]);

    await screen.findByRole('spinbutton', { name: 'Day temperature' });
    await screen.findByRole('switch', { name: 'Energy saving' });
    tap('Germination · dark');
    expect(field('Temperature while germinating').value).toBe('24');
    expect(((await screen.findByRole('spinbutton', { name: 'Humidity while germinating' })) as HTMLInputElement).value).toBe('75');
    expect(screen.getByText('The humidifier holds 75 % – it never makes it wetter than that.')).toBeInTheDocument();
    unmount();

    // A device that went into germination before it brought a humidity, with nothing to hold one: the chip is still its own.
    wire.sockets = [];
    const dark = { running: true, drying: false, mode: 'germination' as const, energySaving: false, germinationChoices: GERMINATION_CHOICES };
    draw([
      device({ type: 'fridge', configuration: { ...CONFIGURATION, workmode: 'breed', night: { temperature: 24, humidity: 55 } }, control: dark }),
    ]);
    expect(await screen.findByRole('button', { name: 'Germination · dark' })).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * Owner's decision G2: in germination the grower chooses whether "Zu feucht"
   * warns and whether a humidifier socket goes on holding the humidity. Where
   * it holds, the humidity it holds is a target of germination like its
   * temperature, and is set in the same table.
   */
  it('holds the night humidity with a paired humidifier, and rests it or warns when the grower says so', async () => {
    wire.sockets = ['heater', 'humidifier'];
    const dark = { running: true, drying: false, mode: 'germination' as const, energySaving: false, germinationChoices: GERMINATION_CHOICES };
    draw([device({ type: 'fridge', configuration: { ...CONFIGURATION, night: { temperature: 24, humidity: 55 } }, control: dark })]);

    const humidifier = await screen.findByRole('switch', { name: 'Hold the humidity with the humidifier' });
    expect(humidifier).toHaveAttribute('aria-checked', 'true');
    expect(field('Humidity while germinating').value).toBe('55');
    expect(screen.getByText('The humidifier holds 55 % – it never makes it wetter than that.')).toBeInTheDocument();
    // Nothing moved yet: nothing to save.
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    type('Humidity while germinating', 80);
    tap('Save');
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    const held = sent('PUT')[0].body as { configuration: DeviceConfiguration; germination?: boolean; germinationChoices?: unknown };
    expect(held.configuration.night).toEqual({ temperature: 24, humidity: 80 });
    expect(held.germinationChoices).toEqual({ warnTooHumid: false, humidifierHolds: true });
    // Saved from inside germination, it stays there.
    expect(held.germination).toBeUndefined();
  });

  it('saves the humidifier resting and the alarm warning as a change of their own, and hides the humidity nothing holds', async () => {
    wire.sockets = ['humidifier'];
    const dark = { running: true, drying: false, mode: 'germination' as const, energySaving: false, germinationChoices: GERMINATION_CHOICES };
    draw([device({ type: 'fridge', configuration: { ...CONFIGURATION, night: { temperature: 24, humidity: 55 } }, control: dark })]);

    fireEvent.click(await screen.findByRole('switch', { name: 'Hold the humidity with the humidifier' }));
    expect(screen.getByText('The humidifier rests until germination ends.')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Humidity while germinating' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Warn when it gets too humid' }));
    expect(screen.getByText('“Too humid” warns during germination above 90 %.')).toBeInTheDocument();

    tap('Save');
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect((sent('PUT')[0].body as { germinationChoices?: unknown }).germinationChoices).toEqual({ warnTooHumid: true, humidifierHolds: false });
  });

  it('says where the humidity the humidifier holds is more than "Too humid" lets pass once it warns', async () => {
    wire.sockets = ['humidifier'];
    const dark = { running: true, drying: false, mode: 'germination' as const, energySaving: false, germinationChoices: GERMINATION_CHOICES };
    draw([device({ type: 'fridge', configuration: { ...CONFIGURATION, night: { temperature: 24, humidity: 92 } }, control: dark })]);

    await screen.findByRole('switch', { name: 'Hold the humidity with the humidifier' });
    const clash = 'The humidifier holds more than “Too humid” allows during germination (90 %): the alarm will go off often.';
    expect(screen.queryByText(clash)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Warn when it gets too humid' }));
    expect(screen.getByText(clash)).toBeInTheDocument();
    type('Humidity while germinating', 85);
    expect(screen.queryByText(clash)).not.toBeInTheDocument();
  });

  it('pauses a plan whose germination step chose otherwise with a reason that says what was changed', async () => {
    wire.sockets = ['humidifier'];
    wire.plan = {
      ...plan('running'),
      steps: [
        {
          ...STEP,
          stage: 'germination',
          settings: { night: { temperature: 24 } },
          lightHours: null,
          germinationChoices: { warnTooHumid: false, humidifierHolds: true },
        },
      ],
    };
    const dark = { running: true, drying: false, mode: 'germination' as const, energySaving: false, germinationChoices: GERMINATION_CHOICES };
    draw([
      device({ type: 'fridge', configuration: { ...CONFIGURATION, workmode: 'breed', night: { temperature: 24, humidity: 55 } }, control: dark }),
    ]);

    fireEvent.click(await screen.findByRole('switch', { name: 'Warn when it gets too humid' }));
    tap('Save');

    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect(wire.calls.filter(call => call.method === 'POST').map(call => call.body)).toEqual([
      { kind: 'pause', reason: 'Germination choice changed by hand' },
    ]);
  });

  it('brings a germinating fridge back into the light with the seedling´s climate', async () => {
    const dark = { running: true, drying: false, mode: 'germination' as const, energySaving: false, germinationChoices: GERMINATION_CHOICES };
    draw([device({ type: 'fridge', configuration: { ...CONFIGURATION, night: { temperature: 24, humidity: 55 } }, control: dark })]);
    await screen.findByRole('spinbutton', { name: 'Temperature while germinating' });
    expect(screen.getByRole('button', { name: 'Germination · dark' })).toHaveAttribute('aria-pressed', 'true');

    tap('Seedling · with light');
    expect(screen.getByText('Saving ends germination: the device holds day and night again, with light and CO₂.')).toBeInTheDocument();
    expect(field('Day temperature').value).toBe('24');
    expect(field('Night temperature').value).toBe('21');

    tap('Save');
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    const body = sent('PUT')[0].body as { configuration: DeviceConfiguration; germination?: boolean };
    expect(body.germination).toBe(false);
    expect(body.configuration.day).toMatchObject({ temperature: 24, humidity: 70 });
    expect(body.configuration.night).toMatchObject({ temperature: 21, humidity: 65 });
  });

  /** A lamp at 0 % keeps its day: the plan and the column call it the day, not "light on", where they are read first. */
  it('calls a day with the lamp at 0 % the day, and says so over the table', async () => {
    at('12:00');
    await drawn([device({ configuration: { ...CONFIGURATION, 'lights.limit': 0 } })]);

    expect(within(plan_()).getByText('Day 06:00–18:00 · 12 h · lamp at 0 %')).toBeInTheDocument();
    // Nothing switches the lamp at 18:00; the night begins.
    expect(within(plan_()).getByText('Day now · night from 18:00')).toBeInTheDocument();
    expect(
      within(plan_()).getByText('Light limit 0 %: the lamp stays dark, but the day still holds – with the day figures and with CO₂.'),
    ).toBeInTheDocument();
    const heads = within(screen.getByRole('table')).getAllByRole('columnheader');
    expect(heads[1]).toHaveTextContent(/^Day \(lamp at 0 %\)/);
    expect(heads[2]).toHaveTextContent(/^Night/);
    expect(screen.queryByText('Light on')).not.toBeInTheDocument();
  });

  /** The tent controller's firmware loses its morning ramp for a window past midnight UTC; the bar drew a hard start nothing explained. */
  it('says a tent controller switches on without ramping for a window past midnight UTC', async () => {
    await drawn([device({ configuration: { ...CONFIGURATION, daynight: { day: 22 * 3600, night: 16 * 3600 } } })]);

    expect(within(plan_()).getByText(/^With this window the controller switches the light on at 22:00 without ramping up/)).toBeInTheDocument();
  });

  /** The server keeps the stored night when 24 hours are saved, so the night that is kept is the stored one, not one typed first. */
  it('shows the night that is kept at 24 hours as stored, not as typed before', async () => {
    await drawn();

    type('Night temperature', 18);
    for (let i = 0; i < 12; i += 1) tap('Light on for: more');
    expect(screen.getByText('20 °C · 55 %')).toBeInTheDocument();
    expect(screen.queryByText('18 °C · 55 %')).not.toBeInTheDocument();
  });

  it('draws the table first and the presets under it', async () => {
    await drawn();

    const night = field('Night humidity');
    const chip = screen.getByRole('button', { name: 'Flower' });
    expect(night.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers the way back to a plan only where the tab opens on one', async () => {
    draw([device()], true, true);

    expect(await screen.findByRole('link', { name: '‹ back to the plan' })).toHaveAttribute('href', '/control?space=space-1');
  });

  it('writes the figures in the reader´s own language', async () => {
    await i18next.changeLanguage('de');
    draw();
    await screen.findByRole('spinbutton', { name: 'Temperatur am Tag' });

    expect(within(screen.getByRole('row', { name: /^Luftfeuchte/ })).getByText('VPD 0,91')).toBeInTheDocument();
    expect(screen.getByText('Licht an 06:00–18:00 · 12 Std')).toBeInTheDocument();
    tap('Temperatur am Tag: mehr');
    expect(field('Temperatur am Tag').value).toBe('25,5');
  });

  it('steps a figure with − and +, on the grid its step makes, and no further than its range', async () => {
    await drawn();

    tap('Day temperature: more');
    expect(field('Day temperature').value).toBe('25.5');
    tap('Day temperature: less');
    tap('Day temperature: less');
    expect(field('Day temperature').value).toBe('24.5');
    // A figure typed off the grid lands back on it with the next step.
    type('Day humidity', 61.4);
    tap('Day humidity: more');
    expect(field('Day humidity').value).toBe('62');
    // 80 % and four taps is the lamp's whole output, and + goes no further.
    for (let i = 0; i < 4; i += 1) tap('Light limit: more');
    expect(field('Light limit').value).toBe('100');
    expect(screen.getByRole('button', { name: 'Light limit: more' })).toBeDisabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('prefills the table from a preset and writes nothing, the light plan drawn as a draft beside what runs', async () => {
    at('12:00');
    await drawn();

    fireEvent.click(screen.getByRole('button', { name: 'Flower' }));

    expect(field('Day temperature').value).toBe('25');
    expect(field('Day humidity').value).toBe('50');
    expect(field('Night temperature').value).toBe('20');
    expect(field('Night humidity').value).toBe('50');
    expect(field('Light limit').value).toBe('100');
    expect(field('Light on for').value).toBe('12');
    expect(field('CO₂ target').value).toBe('1000');
    // A preset says how long the light is on, never when it comes on: that is the grower's.
    expect(lightsOn().value).toBe('06:00');
    expect(screen.getByRole('button', { name: 'Flower' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Veg' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(sent('PUT')).toEqual([]);

    // The autoflower rows are the same stages under a long day, and say so -
    // as a draft, with what runs beside it and now still the device's.
    fireEvent.click(screen.getByRole('button', { name: 'Auto · Veg' }));
    expect(field('Light on for').value).toBe('20');
    expect(within(plan_()).getByText('Light on 06:00–02:00 · 20 h')).toBeInTheDocument();
    expect(within(plan_()).getByText('Draft')).toBeInTheDocument();
    expect(within(plan_()).getByText('so far: Light on 06:00–18:00 · 12 h')).toBeInTheDocument();
    expect(within(plan_()).getByText('Day now · light off at 18:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auto · Veg' })).toHaveAttribute('aria-pressed', 'true');
  });

  /** A light-on time moved past now turns the day into night the moment it is saved, which is said before the save. */
  it('says when saving the schedule would turn the half over at once', async () => {
    at('12:00');
    await drawn();

    // On at 13:00 for twelve hours: at noon that is night.
    for (let i = 0; i < 14; i += 1) tap('Light on at: later');
    expect(lightsOn().value).toBe('13:00');
    expect(within(plan_()).getByText('Once saved it is night at once: the light goes off and the night figures hold.')).toBeInTheDocument();
    // The heads show the edited times, so the mark stands on the column those times put now in, and says it is the draft's.
    expect(holding()).toEqual([]);
    const marked = screen.getAllByRole('columnheader').filter(head => within(head).queryByText('holds once saved'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveTextContent(/^Light off \(night\)/);
    expect(within(plan_()).getByText('Day now · light off at 18:00')).toBeInTheDocument();

    // Back to a window that holds noon: nothing turns over.
    for (let i = 0; i < 14; i += 1) tap('Light on at: earlier');
    expect(screen.queryByText(/^Once saved it is/)).not.toBeInTheDocument();
  });

  it('sends the whole document with the targets written into their sections', async () => {
    await drawn();

    type('Day temperature', 26.5);
    for (let i = 0; i < 6; i += 1) tap('Light on for: more');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect(sent('PUT')[0]).toEqual({
      method: 'PUT',
      path: '/devices/device-1/configuration',
      body: {
        configuration: {
          workmode: 'breed',
          day: { temperature: 26.5, humidity: 60, heating: 'hard' },
          night: { temperature: 20, humidity: 55 },
          co2: { target: 800, sunsetOff: 1 },
          lights: { sunrise: 15, sunset: 15, limit: 80 },
          // Eighteen hours from six in the morning is midnight, which goes a
          // second early: the firmware works the evening ramp out without
          // wrapping round midnight, and an off at zero cut the lamp hard.
          daynight: { day: 21600, night: 86399, maxDehumidifySeconds: 120 },
        },
      },
    });
    expect(sent('POST')).toEqual([]);
    expect(await screen.findByText(/Sent to the device \d/)).toBeInTheDocument();
    expect(screen.getByText('The device acknowledges no setting, so what it is running is not reported back.')).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  /**
   * The document holds seconds past midnight UTC, the grower thinks in the
   * clock on their wall. Kolkata is half an hour off the hour and keeps no
   * summer time, so the test reads the same every day of the year.
   */
  it('sets when the light comes on, on the account´s clock, and keeps how long it stays on', async () => {
    wire.zone = 'Asia/Kolkata';
    await drawn();

    await waitFor(() => expect(lightsOn().value).toBe('11:30'));
    expect(screen.getByText('Light on 11:30–23:30 · 12 h')).toBeInTheDocument();

    fireEvent.change(lightsOn(), { target: { value: '22:00' } });

    expect(lightsOn().value).toBe('22:00');
    expect(screen.getByText('Light on 22:00–10:00 · 12 h')).toBeInTheDocument();
    expect(field('Light on for').value).toBe('12');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(sent('PUT')).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    // 22:00 in Kolkata is 16:30 UTC, and twelve hours on is 04:30.
    expect((sent('PUT')[0].body as { configuration: DeviceConfiguration }).configuration.daynight).toEqual({
      day: 16.5 * 3600,
      night: 4.5 * 3600,
      maxDehumidifySeconds: 120,
    });
  });

  it('moves the light on by half an hour along the wall clock, landing on the half hour', async () => {
    wire.zone = 'Asia/Kolkata';
    await drawn();
    await waitFor(() => expect(lightsOn().value).toBe('11:30'));

    tap('Light on at: later');
    expect(lightsOn().value).toBe('12:00');
    tap('Light on at: earlier');
    tap('Light on at: earlier');
    expect(lightsOn().value).toBe('11:00');
  });

  it('keeps a half-typed time out of the draft', async () => {
    await drawn();

    fireEvent.change(lightsOn(), { target: { value: '' } });

    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    fireEvent.blur(lightsOn());
    expect(lightsOn().value).toBe('06:00');
  });

  /**
   * 24 hours has no night: one column, held round the clock, without the
   * daily dimming dip a window a second short of a day made - it is written as
   * a day that never ends. The night's figures are kept, not overwritten -
   * they are back as soon as there is a night again - and said behind a line
   * that says so.
   */
  it('has one column at 24 hours, writes a day that never ends, and keeps the night’s figures for later', async () => {
    await drawn([device({ type: 'fridge' })]);

    for (let i = 0; i < 12; i += 1) tap('Light on for: more');
    expect(field('Light on for').value).toBe('24');
    expect(within(plan_()).getByText('Light on round the clock · 24 h')).toBeInTheDocument();
    const heads = within(screen.getByRole('table')).getAllByRole('columnheader');
    expect(heads.at(-1)).toHaveTextContent(/^Light round the clock24 h · day figures/);
    expect(screen.queryByRole('spinbutton', { name: 'Night temperature' })).not.toBeInTheDocument();
    expect(
      within(plan_()).getByText(
        'The lamp stays at its light limit round the clock – no dimming down and up once a day. The day figures hold throughout. Set a length between 0 and 24 h and the day starts at 06:00 again.',
      ),
    ).toBeInTheDocument();
    // A light that never goes off has no time it comes on to set.
    expect(screen.queryByRole('textbox', { name: 'Light on at' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Light on at: later' })).not.toBeInTheDocument();
    expect(screen.getByText('Night figures – hold again as soon as there is a night')).toBeInTheDocument();
    expect(screen.getByText('20 °C · 55 %')).toBeInTheDocument();

    tap('Day temperature: more');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    const written = (sent('PUT')[0].body as { configuration: DeviceConfiguration }).configuration;
    // Both times past any second of the clock, the night one before the day: day on every second, and the hour kept.
    expect(written.daynight).toMatchObject({ day: 2 * 86400 + 21600 + 1, night: 2 * 86400 + 21600 });
    expect(written.day).toMatchObject({ temperature: 25.5, humidity: 60 });
    expect(written.night).toEqual({ temperature: 20, humidity: 55 });
  });

  /** None at all is the firmware's "always night": the night's figures round the clock, no CO₂, no lamp. */
  it('has one dark column at no hours of light, and keeps the day’s figures for later', async () => {
    at('12:00');
    await drawn();

    for (let i = 0; i < 12; i += 1) tap('Light on for: less');
    expect(field('Light on for').value).toBe('0');
    expect(screen.getByRole('button', { name: 'Light on for: less' })).toBeDisabled();
    expect(within(plan_()).getByText('Light off round the clock · 0 h')).toBeInTheDocument();
    expect(
      within(plan_()).getByText(
        'With no light it is night round the clock: the night figures hold and no CO₂ is dosed. Set a length between 0 and 24 h and the day starts at 06:00 again.',
      ),
    ).toBeInTheDocument();
    expect(within(plan_()).getByText('Once saved it is night at once: the light goes off and the night figures hold.')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('columnheader').at(-1)).toHaveTextContent(/^Dark round the clock/);
    expect(field('Night temperature').value).toBe('20');
    expect(screen.queryByRole('spinbutton', { name: 'Day temperature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'CO₂ target' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Light limit' })).not.toBeInTheDocument();
    expect(screen.getByText('Day figures – hold again as soon as there is a day')).toBeInTheDocument();
    expect(screen.getByText('25 °C · 60 % · CO₂ 800 ppm · light limit 80 %')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    const written = (sent('PUT')[0].body as { configuration: DeviceConfiguration }).configuration;
    // On and off at the same second: the firmware never turns it day.
    expect(written.daynight).toMatchObject({ day: 21600, night: 21600 });
    expect(written.day).toMatchObject({ temperature: 25, humidity: 60 });
  });

  it('reads a document whose light goes off the second it comes on as dark, and saves it dark', async () => {
    draw([device({ configuration: { ...CONFIGURATION, daynight: { day: 21600, night: 21600 } } })]);
    await screen.findByRole('spinbutton', { name: 'Night temperature' });

    expect(within(plan_()).getByText('Light off round the clock · 0 h')).toBeInTheDocument();
    type('Night temperature', 19);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect((sent('PUT')[0].body as { configuration: DeviceConfiguration }).configuration.daynight).toMatchObject({ day: 21600, night: 21600 });
  });

  it('says what 0 % does: the lamp dark, the day and its CO₂ still held', async () => {
    await drawn();

    for (let i = 0; i < 16; i += 1) tap('Light limit: less');
    expect(field('Light limit').value).toBe('0');
    expect(
      screen.getByText('Light limit 0 %: the lamp stays dark, but the day still holds – with the day figures and with CO₂.'),
    ).toBeInTheDocument();
  });

  /**
   * Saving over a running plan used to pause it whatever had changed, and said
   * so under the table, below the fold of a phone. A plan puts back what its
   * step writes and nothing else, so the marks say which figures those are,
   * the line over the table says what the mark means, and what a save does to
   * the plan stands in the bar beside the button.
   */
  it('marks what a running plan writes, and says beside the save that saving one of those pauses it', async () => {
    wire.plan = plan('running');
    await drawn();

    expect(screen.getByText('set by the running plan “Autoflower, 12 weeks” – again every hour.')).toBeInTheDocument();
    // Its twelve hours from the device's six are what runs already: nothing to put back.
    expect(screen.queryByText(/sets it back within the hour/)).not.toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /^Temperature/ })).getByRole('img', { name: 'set by the running plan' })).toBeInTheDocument();
    expect(within(plan_()).getAllByRole('img', { name: 'set by the running plan' })).toHaveLength(1);
    expect(within(lightsOn().closest('div')!).queryByRole('img', { name: 'set by the running plan' })).not.toBeInTheDocument();

    type('Day humidity', 65);
    expect(bar()).toHaveTextContent('Saving pauses the plan “Autoflower, 12 weeks” – it sets one of the figures you changed.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect(wire.calls.filter(call => call.method !== 'GET').map(call => [call.method, call.path, call.body])).toEqual([
      ['POST', '/devices/device-1/plan/transitions', { kind: 'pause', reason: 'Targets set by hand' }],
      [
        'PUT',
        '/devices/device-1/configuration',
        expect.objectContaining({ configuration: expect.objectContaining({ day: { temperature: 25, humidity: 65, heating: 'hard' } }) }),
      ],
    ]);
    expect(await screen.findByText('The plan is paused while these targets hold.')).toBeInTheDocument();
  });

  it('leaves a running plan running when only the hour the light comes on moves, and says so beside the save', async () => {
    wire.plan = plan('running');
    await drawn();

    tap('Light on at: later');
    expect(bar()).toHaveTextContent('The plan “Autoflower, 12 weeks” keeps running – it sets none of them.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect(sent('POST')).toEqual([]);
    expect((sent('PUT')[0].body as { configuration: DeviceConfiguration }).configuration.daynight).toMatchObject({ day: 23400, night: 66600 });
  });

  /** A recipe migrated from the old app carries its two fixed times in its settings, and puts them back: then the hour is the plan's too. */
  it('counts the hour the light comes on as the plan´s where its step carries one', async () => {
    wire.plan = { ...plan('running'), steps: [{ ...STEP, lightHours: null, settings: { daynight: { day: 3600, night: 50400 } } }] };
    await drawn();

    expect(within(plan_()).getAllByRole('img', { name: 'set by the running plan' })).toHaveLength(2);
    // What the plan will put back, said before the hour is up rather than found out after it.
    expect(
      within(plan_()).getByText('The running plan “Autoflower, 12 weeks” sets it back within the hour: Light on 01:00–14:00 · 13 h.'),
    ).toBeInTheDocument();
    tap('Light on at: later');
    expect(bar()).toHaveTextContent(/^Saving pauses the plan/);
  });

  it('offers to resume a paused plan', async () => {
    wire.plan = plan('paused');
    await drawn();

    fireEvent.click(screen.getByRole('button', { name: 'Resume plan' }));

    await waitFor(() => expect(sent('POST')).toEqual([{ method: 'POST', path: '/devices/device-1/plan/transitions', body: { kind: 'resume' } }]));
  });

  it('has no CO2 row without a CO2 sensor', async () => {
    await drawn([device({}, { co2: 'off' })]);

    expect(screen.queryByRole('spinbutton', { name: 'CO₂ target' })).not.toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /^CO₂/ })).not.toBeInTheDocument();
    // The chip is judged on what the page can set, so a preset still reads as chosen without its CO2 figure.
    fireEvent.click(screen.getByRole('button', { name: 'Seedling · with light' }));
    expect(screen.getByRole('button', { name: 'Seedling · with light' })).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * A report that does not mention the sensor is a firmware too old to have
   * been asked, which is how the server reads the same absence - not a device
   * without one.
   */
  it('draws the CO2 target of a device whose report says nothing about the sensor', async () => {
    await drawn([device({}, {})]);

    expect(screen.getByRole('spinbutton', { name: 'CO₂ target' })).toBeInTheDocument();
    expect(screen.queryByText('needs a CO₂ sensor')).not.toBeInTheDocument();
  });

  it('shows what the server refused with, and keeps the draft', async () => {
    wire.refuseSave = { status: 403, code: 'forbidden', detail: 'The demo may only look.' };
    await drawn();

    type('Night temperature', 18);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The demo may only look.');
    expect(field('Night temperature').value).toBe('18');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('lets a session that may only look see everything and move nothing', async () => {
    wire.plan = plan('paused');
    await drawn(undefined, false);

    for (const one of screen.getAllByRole('spinbutton')) expect(one).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Day temperature: more' })).toBeDisabled();
    expect(lightsOn()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Flower' })).toBeDisabled();
    expect(screen.getByText('The plan is paused while these targets hold.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume plan' })).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('puts the draft back with Discard', async () => {
    await drawn();

    type('Day temperature', 30);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(field('Day temperature').value).toBe('25');
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('asks before a change nobody saved is left behind, and goes on only once it is saved or thrown away', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/control',
          element: (
            <>
              <Link to="/control/alarms?space=space-1">Alarms</Link>
              <Link to="/control?space=space-2">Other place</Link>
              <Targets spaceId="space-1" devices={[device()]} mayManage />
            </>
          ),
        },
        { path: '/control/alarms', element: <p>The alarm rules</p> },
      ],
      { initialEntries: ['/control?space=space-1'] },
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole('spinbutton', { name: 'Day temperature' });

    // Nothing changed: leaving is not asked about.
    fireEvent.click(screen.getByRole('link', { name: 'Alarms' }));
    expect(await screen.findByText('The alarm rules')).toBeInTheDocument();
    await act(() => router.navigate('/control?space=space-1'));
    await screen.findByRole('spinbutton', { name: 'Day temperature' });

    type('Day temperature', 30);
    fireEvent.click(screen.getByRole('link', { name: 'Other place' }));
    const question = await screen.findByRole('dialog', { name: 'Targets not saved' });
    expect(question).toHaveTextContent('Without saving, the device keeps running on the old ones.');

    // Staying keeps the draft and the address.
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field('Day temperature').value).toBe('30');
    expect(router.state.location.search).toBe('?space=space-1');

    // Saving sends the draft and then goes where the tap was going.
    fireEvent.click(screen.getByRole('link', { name: 'Alarms' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and go on' }));
    expect(await screen.findByText('The alarm rules')).toBeInTheDocument();
    const [save] = sent('PUT');
    expect((save?.body as { configuration: DeviceConfiguration }).configuration.day).toEqual({ temperature: 30, humidity: 60, heating: 'hard' });
  });

  it('throws an unsaved change away when asked to, and leaves', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/control',
          element: (
            <>
              <Link to="/">Start</Link>
              <Targets spaceId="space-1" devices={[device()]} mayManage />
            </>
          ),
        },
        { path: '/', element: <p>Start page</p> },
      ],
      { initialEntries: ['/control?space=space-1'] },
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole('spinbutton', { name: 'Day temperature' });

    type('Day temperature', 30);
    fireEvent.click(screen.getByRole('link', { name: 'Start' }));
    const question = await screen.findByRole('dialog', { name: 'Targets not saved' });
    fireEvent.click(within(question).getByRole('button', { name: 'Discard' }));

    expect(await screen.findByText('Start page')).toBeInTheDocument();
    expect(sent('PUT')).toHaveLength(0);
  });

  it('switches energy saving on a fridge on the tap, and leaves the table where it was put', async () => {
    await drawn([
      device({
        type: 'fridge',
        control: { running: true, drying: false, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES },
      }),
    ]);
    type('Day temperature', 27);

    const toggle = screen.getByRole('switch', { name: 'Energy saving' });
    expect(screen.getByText('The back-wall fan runs even while the compressor is off.')).toBeInTheDocument();
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(sent('PATCH')).toEqual([{ method: 'PATCH', path: '/devices/device-1/configuration', body: { set: { energySaving: true } } }]),
    );
    expect(field('Day temperature').value).toBe('27');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('holds no humidity in greenhouse mode, says so over the table rather than in a dead row, and offers no energy saving there', async () => {
    await drawn([
      device({
        type: 'fridge',
        control: { running: true, drying: false, mode: 'greenhouse', energySaving: false, germinationChoices: GERMINATION_CHOICES },
      }),
    ]);

    expect(screen.queryByRole('switch', { name: 'Energy saving' })).not.toBeInTheDocument();
    // What the mode leaves of the table is said over it, with the way to the mode itself.
    expect(screen.getByText(/^Operating mode greenhouse: the device holds the temperature only/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change operating mode ›' })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /^Humidity/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Day humidity' })).not.toBeInTheDocument();
    // Temperature by day and night, the light plan and CO₂ run as ever.
    expect(field('Night temperature').value).toBe('20');
    expect(field('CO₂ target').value).toBe('800');
    expect(lightsOn().value).toBe('06:00');
  });

  it('germinates in one column: the temperature, round the clock, in the dark - and keeps the day it does not hold', async () => {
    wire.live = { active: 'night' };
    draw([
      device({
        type: 'fridge',
        control: { running: true, drying: false, mode: 'germination', energySaving: false, germinationChoices: GERMINATION_CHOICES },
      }),
    ]);
    await screen.findByRole('spinbutton', { name: 'Temperature while germinating' });

    expect(within(screen.getByRole('table')).getAllByRole('columnheader').at(-1)).toHaveTextContent(/^Germination · darkround the clock/);
    expect(within(plan_()).getByText('Light off · germination')).toBeInTheDocument();
    expect(
      within(plan_()).getByText(/^Germination keeps the light off round the clock\. The light plan – Light on 06:00–18:00 · 12 h – holds again/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Day temperature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /^Humidity/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'CO₂ target' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Light on at', { selector: 'input' })).not.toBeInTheDocument();
    await waitFor(() => expect(holding()).toHaveLength(1));

    type('Temperature while germinating', 24);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    const written = (sent('PUT')[0].body as { configuration: DeviceConfiguration }).configuration;
    expect(written.night).toEqual({ temperature: 24, humidity: 55 });
    // The day is the standard mode's, for when germination ends: nothing keeps it but the document.
    expect(written.day).toEqual({ temperature: 25, humidity: 60, heating: 'hard' });
  });

  it('offers a controller no energy saving, because it has no back-wall fan', async () => {
    await drawn([
      device({ control: { running: true, drying: false, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES } }),
    ]);

    expect(screen.queryByRole('switch', { name: 'Energy saving' })).not.toBeInTheDocument();
  });

  it('says control is off in one line with no table under it, and switches it on from there', async () => {
    draw([
      device({
        type: 'fridge',
        control: { running: false, drying: false, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES },
      }),
    ]);

    expect(await screen.findByText('Control off.')).toBeInTheDocument();
    expect(
      screen.getByText(/The device only measures: heater, compressor, light and CO₂ stand still, and it holds no targets\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Light plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Flower' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Energy saving' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch control on' }));

    await waitFor(() =>
      expect(sent('PATCH')).toEqual([{ method: 'PATCH', path: '/devices/device-1/configuration', body: { set: { control: true } } }]),
    );
  });

  /**
   * "End drying" wrote at once and left the drying room's 18 °C and the lamp at
   * 0 % standing. It asks first now, and says which targets come back.
   */
  it('says a drying phase has the device drying, and ends it from there once asked, naming the targets that come back', async () => {
    const afterDrying = { dayTemperature: 26, dayHumidity: 62, nightTemperature: 22, nightHumidity: 58, co2: 900, lightLimit: 80 };
    draw([
      device({
        type: 'fridge',
        control: { running: true, drying: true, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES, afterDrying },
      }),
    ]);
    await screen.findByRole('spinbutton', { name: 'Temperature while drying' });

    expect(screen.getByText(/^Drying: no day and night, no light, no CO₂/)).toBeInTheDocument();
    expect(screen.queryByText('Control off.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End drying …' }));

    const asked = await screen.findByRole('dialog', { name: 'End drying?' });
    expect(
      within(asked).getByText('The targets from before drying apply again: day 26 °C · 62 %, night 22 °C · 58 %, light 80 %, CO₂ 900 ppm.'),
    ).toBeInTheDocument();
    expect(sent('PATCH')).toEqual([]);
    fireEvent.click(within(asked).getByRole('button', { name: 'End drying' }));

    await waitFor(() =>
      expect(sent('PATCH')).toEqual([{ method: 'PATCH', path: '/devices/device-1/configuration', body: { set: { drying: false } } }]),
    );
    // The card it was asked from goes with the spell; the answer stays to be read.
    expect(await within(asked).findByText(/^Drying has ended/)).toBeInTheDocument();
  });

  /**
   * In the drying work mode the firmware has no day at all and holds the
   * night's figures. The page used to offer the whole day - light, schedule
   * and CO₂ included - under the card saying there was none, and saved a day
   * temperature that changed nothing. One column is offered now, and what it
   * sets is written to the night it holds; the stored day is sent as it is,
   * since the server keeps it through the spell and brings back the one from
   * before it when the spell ends.
   */
  it('dries in one column, offers nothing the drying does not hold, and writes it to the night it holds', async () => {
    draw([
      device({
        type: 'fridge',
        control: { running: true, drying: true, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES },
      }),
    ]);
    await screen.findByRole('spinbutton', { name: 'Temperature while drying' });

    expect(within(screen.getByRole('table')).getAllByRole('columnheader').at(-1)).toHaveTextContent(/^Dryinground the clock/);
    expect(within(plan_()).getByText('Light off · drying')).toBeInTheDocument();
    expect(
      within(plan_()).getByText('The light stays off while drying runs. Afterwards the light plan holds again: Light on 06:00–18:00 · 12 h.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Day temperature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'CO₂ target' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Light limit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Energy saving' })).not.toBeInTheDocument();

    type('Temperature while drying', 17);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    const written = (sent('PUT')[0].body as { configuration: DeviceConfiguration }).configuration;
    expect(written.day).toEqual({ temperature: 25, humidity: 60, heating: 'hard' });
    expect(written.night).toEqual({ temperature: 17, humidity: 55 });
    // The schedule and the lamp stay as they were, for when the spell ends.
    expect(written.daynight).toEqual(CONFIGURATION.daynight);
  });

  it('says where the targets come from when the ones from before drying were never kept', async () => {
    draw([
      device({
        type: 'fridge',
        control: { running: true, drying: true, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES },
      }),
    ]);

    fireEvent.click(await screen.findByRole('button', { name: 'End drying …' }));
    const asked = await screen.findByRole('dialog', { name: 'End drying?' });
    expect(within(asked).getByText(/^The targets last saved before drying apply again/)).toBeInTheDocument();
  });

  it('starts drying with the drying preset, says so before it is saved, and shows the one column it will hold', async () => {
    await drawn([
      device({
        type: 'fridge',
        control: { running: true, drying: false, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES },
      }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Drying' }));
    expect(screen.getByText(/^Saving starts drying/)).toBeInTheDocument();
    // Tuned after the chip, the targets are still a drying room's.
    type('Temperature while drying', 17);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect(sent('PUT')[0].body).toMatchObject({ drying: true, configuration: { day: { temperature: 17 }, night: { temperature: 17 } } });
  });

  it('ends a drying spell with any other preset, and leaves it running where only a figure moved', async () => {
    draw([
      device({
        type: 'fridge',
        control: { running: true, drying: true, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES },
      }),
    ]);
    await screen.findByRole('spinbutton', { name: 'Temperature while drying' });

    type('Temperature while drying', 17);
    expect(screen.queryByText(/^Saving ends drying/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Veg' }));
    expect(screen.getByText(/^Saving ends drying/)).toBeInTheDocument();
    // What it ends in is the day and the night again, drawn before it is saved.
    expect(field('Day temperature')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect(sent('PUT')[0].body).toMatchObject({ drying: false });
  });

  /**
   * The bar stands over the foot of a phone's screen from the first change on,
   * which is where a row tapped near the bottom was: its own − and + went under
   * the bar its first tap brought up. The row is scrolled out from under it.
   */
  it('scrolls the row being changed out from under the save bar', async () => {
    await drawn();
    const scrolled = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this.textContent?.startsWith('Unsaved changes') ? 700 : 0;
      return {
        top,
        bottom: this.getAttribute('role') === 'row' ? 740 : top + 40,
        left: 0,
        right: 0,
        width: 0,
        height: 40,
        x: 0,
        y: top,
        toJSON: () => ({}),
      };
    });

    const more = screen.getByRole('button', { name: 'Night humidity: more' });
    fireEvent.pointerDown(more);
    fireEvent.click(more);

    await waitFor(() => expect(scrolled).toHaveBeenCalledWith({ top: 740 - 700 + 16 }));
    rect.mockRestore();
    scrolled.mockRestore();
  });

  it('heads each panel with the device name when more than one states a climate', async () => {
    draw([device(), device({ id: 'device-2', name: 'Second tent' })]);

    expect(await screen.findByRole('heading', { name: 'Blue Dream tent' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Second tent' })).toBeInTheDocument();
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
