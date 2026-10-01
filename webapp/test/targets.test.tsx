import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime, Settings } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DeviceConfiguration, Me, Plan } from '@fg2/shared-types/v1';
import { Targets } from '@/screens/control/targets/Targets';
import { vapourPressureDeficit } from '@fg2/shared-types/v1-schemas/vpd.js';
import { draftOf, lightWindowLabel, secondsOf, vpdOf, wallClock, withDraft } from '@/screens/control/targets/targets-draft';
import { CLIMATE_CHOICES, presetsOf, STAGES_WITH_CLIMATE } from '@/ui/presets';

/**
 * What the targets page promises: that a chip only moves the sliders,
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

const plan = (status: Plan['state']['status']): Plan => ({
  id: 'plan-1',
  createdAt: NOW.minus({ days: 30 }).toISO()!,
  deviceId: 'device-1',
  templateId: null,
  name: 'Autoflower, 12 weeks',
  steps: [],
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
  /** The account's zone; none leaves the page on the browser's, which the test keeps on UTC. */
  zone: null as string | null,
  /** What PUT /configuration answers with instead of the document, when a refusal is wanted. */
  refuseSave: null as { status: number; code: string; detail: string } | null,
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
    if (method === 'GET' && path === '/devices/device-1/plan') {
      return wire.plan ? json(wire.plan) : problem(404, 'plan_not_found', 'This device is not being run by a plan.');
    }
    if (method === 'POST' && path === '/devices/device-1/plan/transitions') {
      wire.plan = plan(body.kind === 'pause' ? 'paused' : 'running');
      return json(wire.plan);
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

/** The page once the plan has been read, which is when the sliders are drawn. */
const drawn = async (devices?: Device[], mayManage?: boolean) => {
  draw(devices, mayManage);
  return screen.findByRole('slider', { name: 'Day temperature' });
};

const slider = (name: string) => screen.getByRole('slider', { name }) as HTMLInputElement;

const slide = (name: string, to: number) => fireEvent.change(slider(name), { target: { value: String(to) } });

const lightsOn = () => screen.getByLabelText('Light on at', { selector: 'input' }) as HTMLInputElement;

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
});

afterAll(() => {
  Settings.defaultZone = 'system';
});

beforeEach(() => {
  wire.plan = null;
  wire.zone = null;
  wire.refuseSave = null;
  wire.calls = [];
});

describe('the targets page', () => {
  it('says so when nothing standing here states a climate, and offers the one thing that helps', () => {
    draw([device({ id: 'plug-1', type: 'plug', configuration: { workmode: 'heater', 'heater.day.on': 24 } })]);

    expect(screen.getByText(/Nothing standing here states a climate/)).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a device' })).toHaveAttribute('href', '/claim');
    expect(screen.queryByRole('link', { name: '‹ back to the plan' })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('keeps asking for a device where the only thing standing here is a plug that has sent nothing', () => {
    draw([device({ id: 'plug-1', type: 'plug', configuration: null })]);

    expect(screen.getByText(/Nothing standing here states a climate/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a device' })).toBeInTheDocument();
  });

  it('draws the targets the controller is running, with the VPD and when the light comes on and goes off', async () => {
    await drawn();

    expect(screen.getByText('Targets')).toBeInTheDocument();
    expect(screen.getByText('Day')).toBeInTheDocument();
    expect(screen.getByText('Night')).toBeInTheDocument();
    expect(slider('Day temperature').value).toBe('25');
    expect(slider('Day humidity').value).toBe('60');
    expect(slider('Night temperature').value).toBe('20');
    expect(slider('Night humidity').value).toBe('55');
    expect(slider('Light limit').value).toBe('80');
    expect(slider('Light on for').value).toBe('12');
    expect(slider('CO₂ target').value).toBe('800');
    expect(lightsOn().value).toBe('06:00');
    expect(screen.getByText('off at 18:00')).toBeInTheDocument();
    // Said once, beside the time it is set with, rather than a second time beside the brightness.
    expect(screen.queryByText('06–18 h')).not.toBeInTheDocument();
    // 25 °C at 60 % with the leaf two degrees cooler, worked out as the server
    // works a reading's, and written to the two decimals a deficit is written
    // to wherever else the app prints one.
    // With its unit: every other figure in these four rows carries one, and
    // every other VPD in the app is a kPa.
    expect(screen.getByText('VPD 0.91 kPa')).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    // The page is what the tab opens on, so there is no way back to anywhere.
    expect(screen.queryByRole('link', { name: '‹ back to the plan' })).not.toBeInTheDocument();
  });

  /**
   * The chips used to stand over the sliders, so the first thing on the tab a
   * grower opens to change a temperature was seven stages to choose from. The
   * figures come first now and the stages are one way of setting them, under.
   */
  it('says a device gone quiet is offline since when, in the words the rest of the app uses', async () => {
    const quiet = DateTime.now().minus({ hours: 8 });
    await drawn([device({ state: { ...device().state, lastSeenAt: quiet.toISO()! } })]);

    // A clock time, with the day in front where the silence began before today.
    expect(
      screen.getByText(new RegExp(`^Offline since .*${quiet.toFormat('HH:mm')} · what the device is really running may be older than this$`)),
    ).toBeInTheDocument();
  });

  it('draws the sliders first and the presets under them', async () => {
    await drawn();

    const night = slider('Night humidity');
    const chip = screen.getByRole('button', { name: 'Flower' });
    expect(night.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers the way back to a plan only where the tab opens on one', async () => {
    draw([device()], true, true);

    expect(await screen.findByRole('link', { name: '‹ back to the plan' })).toHaveAttribute('href', '/control?space=space-1');
  });

  /**
   * The one reading on this page that is written rather than typed into a
   * field, and it was the last one in the app written in English whatever
   * language the page was in: a German grower moved "Luftfeuchte" and was
   * answered "VPD 1.0" beside it, on an account whose home card writes
   * "0,98 kPa" for the very same quantity.
   */
  it('writes the deficit in the reader´s own language', async () => {
    await i18next.changeLanguage('de');
    draw();

    expect(await screen.findByText('VPD 0,91 kPa')).toBeInTheDocument();
    expect(screen.queryByText('VPD 0.91 kPa')).not.toBeInTheDocument();
  });

  it('prefills the sliders from a preset and writes nothing', async () => {
    await drawn();

    fireEvent.click(screen.getByRole('button', { name: 'Flower' }));

    expect(slider('Day temperature').value).toBe('25');
    expect(slider('Day humidity').value).toBe('50');
    expect(slider('Night temperature').value).toBe('20');
    expect(slider('Night humidity').value).toBe('50');
    expect(slider('Light limit').value).toBe('100');
    expect(slider('Light on for').value).toBe('12');
    expect(slider('CO₂ target').value).toBe('1000');
    // A preset says how long the light is on, never when it comes on: that is the grower's.
    expect(lightsOn().value).toBe('06:00');
    expect(screen.getByText('off at 18:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Flower' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Veg' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(sent('PUT')).toEqual([]);

    // The autoflower rows are the same stages under a long day, and say so.
    fireEvent.click(screen.getByRole('button', { name: 'Auto · Veg' }));
    expect(slider('Light on for').value).toBe('20');
    expect(screen.getByRole('button', { name: 'Auto · Veg' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends the whole document with the targets written into their sections', async () => {
    await drawn();

    slide('Day temperature', 26.5);
    slide('Light on for', 18);
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
          // Eighteen hours from six in the morning is midnight, which the firmware spells as zero.
          daynight: { day: 21600, night: 0, maxDehumidifySeconds: 120 },
        },
      },
    });
    expect(sent('POST')).toEqual([]);
    expect(await screen.findByText(/Sent to the controller \d/)).toBeInTheDocument();
    expect(screen.getByText('The controller acknowledges no setting, so what it is running is not reported back.')).toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  /**
   * The document holds seconds past midnight UTC, the grower thinks in the
   * clock on their wall, and the page used to offer only how long the light
   * stays on - "when it comes on stays as it is". Kolkata is half an hour off
   * the hour and keeps no summer time, so the test reads the same every day of
   * the year.
   */
  it('sets when the light comes on, on the account´s clock, and keeps how long it stays on', async () => {
    wire.zone = 'Asia/Kolkata';
    await drawn();

    await waitFor(() => expect(lightsOn().value).toBe('11:30'));
    expect(screen.getByText('off at 23:30')).toBeInTheDocument();

    fireEvent.change(lightsOn(), { target: { value: '22:00' } });

    expect(lightsOn().value).toBe('22:00');
    expect(screen.getByText('off at 10:00')).toBeInTheDocument();
    expect(slider('Light on for').value).toBe('12');
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

  it('keeps a half-typed time out of the draft', async () => {
    await drawn();

    fireEvent.change(lightsOn(), { target: { value: '' } });

    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    fireEvent.blur(lightsOn());
    expect(lightsOn().value).toBe('06:00');
  });

  it('pauses a running plan before it writes, and says so beforehand', async () => {
    wire.plan = plan('running');
    await drawn();

    expect(screen.getByText('Saving pauses the running plan, which would otherwise put its own targets back within the hour.')).toBeInTheDocument();
    slide('Day humidity', 65);
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

  it('offers to resume a paused plan', async () => {
    wire.plan = plan('paused');
    await drawn();

    fireEvent.click(screen.getByRole('button', { name: 'Resume plan' }));

    await waitFor(() => expect(sent('POST')).toEqual([{ method: 'POST', path: '/devices/device-1/plan/transitions', body: { kind: 'resume' } }]));
  });

  it('has no CO2 slider without a CO2 sensor, and says why', async () => {
    await drawn([device({}, { co2: 'off' })]);

    expect(screen.queryByRole('slider', { name: 'CO₂ target' })).not.toBeInTheDocument();
    expect(screen.getByText('needs a CO₂ sensor')).toBeInTheDocument();
    // The chip is judged on what the page can set, so a preset still reads as chosen without its CO2 figure.
    fireEvent.click(screen.getByRole('button', { name: 'Seedling' }));
    expect(screen.getByRole('button', { name: 'Seedling' })).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * A report that does not mention the sensor is a firmware too old to have
   * been asked, which is how the server reads the same absence - not a device
   * without one. Read as a no, it hid the row on a fridge that was streaming
   * 300 ppm and holding a 400 ppm target, on a page whose own Overview printed
   * both.
   */
  it('draws the CO2 target of a device whose report says nothing about the sensor', async () => {
    await drawn([device({}, {})]);

    expect(screen.getByRole('slider', { name: 'CO₂ target' })).toBeInTheDocument();
    expect(screen.queryByText('needs a CO₂ sensor')).not.toBeInTheDocument();
  });

  it('shows what the server refused with, and keeps the draft', async () => {
    wire.refuseSave = { status: 403, code: 'forbidden', detail: 'The demo may only look.' };
    await drawn();

    slide('Night temperature', 18);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The demo may only look.');
    expect(slider('Night temperature').value).toBe('18');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('lets a session that may only look see everything and move nothing', async () => {
    wire.plan = plan('paused');
    await drawn(undefined, false);

    for (const one of screen.getAllByRole('slider')) expect(one).toBeDisabled();
    expect(lightsOn()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Flower' })).toBeDisabled();
    expect(screen.getByText('The plan is paused while these targets hold.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume plan' })).not.toBeInTheDocument();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('puts the draft back with Discard', async () => {
    await drawn();

    slide('Day temperature', 30);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(slider('Day temperature').value).toBe('25');
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('heads each panel with the device name when more than one states a climate', async () => {
    await drawn([device(), device({ id: 'device-2', name: 'Second tent' })]);

    expect(screen.getByRole('heading', { name: 'Blue Dream tent' })).toBeInTheDocument();
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
  it("reads the light window in the reader's time from seconds past midnight UTC", () => {
    expect(lightWindowLabel(draftOf(CONFIGURATION), NOW)).toBe('06–18 h');
    expect(lightWindowLabel(draftOf({ daynight: { day: 6.5 * 3600, night: 18 * 3600 } }), NOW)).toBe('06:30–18:00 h');
  });

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
  });

  it('keeps the hour the light comes on and moves when it goes off, past midnight if it must', () => {
    const draft = { ...draftOf(CONFIGURATION), lightHours: 20 };

    expect(withDraft(CONFIGURATION, draft).daynight).toEqual({ day: 21600, night: (21600 + 20 * 3600) % 86400, maxDehumidifySeconds: 120 });
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
