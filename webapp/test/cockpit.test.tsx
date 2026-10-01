import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccessNeed,
  AlarmRule,
  Device,
  DeviceLive,
  Entry,
  HomeAnswer,
  HomeSpaceCard,
  Me,
  SpaceOverview,
  SpaceTimeline,
} from '@fg2/shared-types/v1';
import { LogProvider } from '@/log/LogProvider';
import { Home } from '@/screens/Home';
import { PlaceCockpit } from '@/screens/cockpit/PlaceCockpit';
import { judgedPanel, outputsFor, statusOf } from '@/screens/cockpit/place';
import { spacePage, spaceWhere } from './session';

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

/**
 * The cockpit is the one place page there is: a status sentence, the readings
 * as tiles with a day of each and the outputs that move them, the targets and
 * the alarms in a few lines each, the grow for whoever keeps a diary, and the
 * last three things that happened. These tests draw it from what the server
 * answers, through the wire, in the states a grower actually meets: a fridge
 * that is fine, one that is off target, one that has gone quiet, a tent with
 * leaf sensors and no CO2, a camera, and a diary on and off. Start is then one
 * cockpit or a card per place.
 *
 * Everything is dated against the real clock, because the page ages its
 * readings by it, and the account is kept in UTC so the hours below are the
 * hours written.
 */

const ago = (minutes: number) => DateTime.now().minus({ minutes }).toUTC().toISO()!;
const hhmm = (iso: string) => DateTime.fromISO(iso).toUTC().toFormat('HH:mm');

const fridge = (over: Partial<Device> = {}): Device =>
  ({
    id: 'device-1',
    type: 'fridge',
    name: 'fridge',
    ownerId: 'user-1',
    spaceId: 'space-1',
    firmware: { channel: 'manual', targetId: null },
    configuration: {
      daynight: { day: 6 * 3600, night: 18 * 3600 },
      day: { temperature: 25, humidity: 60 },
      night: { temperature: 21, humidity: 55 },
      co2: { target: 900 },
      lights: { limit: 100 },
    },
    settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
    state: { lastSeenAt: ago(0.2), hardware: {}, maintenanceUntil: null },
    ...over,
  }) as unknown as Device;

const values = (minutesOld = 0.3): SpaceOverview['values'] => {
  const state = minutesOld < 2 ? 'live' : 'offline';
  return [
    { metric: 'temperature', value: 25.1, measuredAt: ago(minutesOld), state },
    { metric: 'humidity', value: 61, measuredAt: ago(minutesOld), state },
    { metric: 'co2', value: 880, measuredAt: ago(minutesOld), state },
    { metric: 'vpd', value: 1.03, measuredAt: ago(minutesOld), state },
  ];
};

const setpoints: SpaceOverview['setpoints'] = [
  { metric: 'temperature', value: 25, band: 1 },
  { metric: 'humidity', value: 60, band: 5 },
  { metric: 'co2', value: 900, band: 200 },
];

const entry = (id: string, over: Partial<Entry>): Entry => ({
  id,
  createdAt: ago(60),
  kind: 'note',
  occurredAt: ago(60),
  source: 'human',
  authorId: 'user-1',
  growId: null,
  spaceId: 'space-1',
  deviceId: null,
  plantIds: [],
  cameraId: null,
  taskId: null,
  alertId: null,
  severity: null,
  text: 'Checked the drip',
  message: null,
  values: { kind: 'note' },
  mediaIds: [],
  undoUntil: null,
  ...over,
});

const reboot = (id: string, minutes: number) =>
  entry(id, {
    kind: 'system',
    source: 'device',
    authorId: null,
    deviceId: 'device-1',
    text: null,
    occurredAt: ago(minutes),
    message: { key: 'message-device-booted', params: ['POWERON'] },
    values: { kind: 'system' },
  });

const overviewOf = (over: Partial<SpaceOverview> = {}): SpaceOverview => ({
  spaceId: 'space-1',
  name: 'Fridge 1',
  kind: 'fridge',
  roomId: null,
  deviceIds: ['device-1'],
  values: values(),
  setpoints,
  targets: {
    day: setpoints,
    night: [
      { metric: 'temperature', value: 21, band: 1 },
      { metric: 'humidity', value: 55, band: 5 },
    ],
  },
  verdict: {
    deviceId: 'device-1',
    startsAt: ago(24 * 60),
    endsAt: ago(0),
    forSeconds: 86_400,
    stepSeconds: 120,
    rating: 'good',
    inBandFraction: 0.97,
    metrics: [],
    actuators: [],
    trend: null,
  },
  grows: [],
  cameras: [],
  entries: [],
  readingNames: [],
  dueTasks: [],
  openAlerts: [],
  people: [{ id: 'user-1', handle: 'you' }],
  ...over,
});

const deviceLive = (over: Partial<DeviceLive['outputs']> = {}): DeviceLive => ({
  deviceId: 'device-1',
  metrics: {},
  outputs: {
    dehumidifier: { value: 1, measuredAt: ago(0.2), state: 'live' },
    heater: { value: 0, measuredAt: ago(0.2), state: 'live' },
    co2: { value: 0, measuredAt: ago(0.2), state: 'live' },
    light: { value: 100, measuredAt: ago(0.2), state: 'live' },
    ...over,
  },
  setpoints: { day: { temperature: 25, humidity: 60, co2: 900 }, night: { temperature: 21, humidity: 55 }, active: 'day' },
});

const curve = (from: number, step: number) =>
  Array.from({ length: 24 }, (_, index) => ({ measuredAt: ago(24 * 60 - index * 60), value: from + (index % 3) * step }));

const timeline = (): SpaceTimeline => {
  const end = ago(0);
  return {
    spaceId: 'space-1',
    range: '24h',
    startsAt: ago(24 * 60),
    endsAt: ago(0),
    stepSeconds: 180,
    panels: [
      { metric: 'temperature', points: curve(24.6, 0.3), targets: [] },
      { metric: 'humidity', points: curve(58, 2), targets: [] },
      { metric: 'co2', points: curve(870, 20), targets: [] },
    ],
    nights: [{ startsAt: ago(20 * 60), endsAt: ago(8 * 60) }],
    alarms: [],
    // The compressor came on twelve and a half minutes ago and is still running where the record ends.
    outputs: [{ output: 'dehumidifier', deviceId: 'device-1', spans: [{ startsAt: ago(12.5), endsAt: end }], heardUntil: end }],
    events: [],
    cameras: [],
    grows: [],
  } as unknown as SpaceTimeline;
};

const rule = (over: Partial<AlarmRule>): AlarmRule =>
  ({
    id: 'rule-1',
    deviceId: 'device-1',
    name: 'Device offline',
    origin: 'always',
    enabled: true,
    watch: { kind: 'reading', metric: 'offline', upper: null, lower: null, forSeconds: 0 },
    ...over,
  }) as unknown as AlarmRule;

const me = (diary: boolean, email: string | null = null): Me =>
  ({
    id: 'user-1',
    email: 'login@example.org',
    handle: 'you',
    preferences: { timezone: 'UTC', diary: null, notifyLaterUntil: null },
    notifications: {
      channels: { email, telegram: null, webhook: null },
      routing: email ? { alerts: ['email'] } : {},
      quietHours: null,
      mutedUntil: null,
    },
    pushSubscribed: false,
    layers: { diary },
  }) as unknown as Me;

const rules = (): AlarmRule[] => [
  rule({}),
  rule({
    id: 'rule-2',
    name: 'Too warm',
    origin: 'human',
    watch: { kind: 'reading', metric: 'temperature', upper: 30, lower: null, forSeconds: 600 } as never,
  }),
];

const server = {
  me: me(false),
  youMay: 'own' as AccessNeed,
  devices: [fridge()],
  live: deviceLive(),
  rules: rules(),
  home: null as HomeAnswer | null,
  overviews: new Map<string, SpaceOverview>(),
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const { pathname } = new URL(String(input), 'http://localhost');
  const path = pathname.replace(/^\/v1/, '');

  if (path === '/me') return json(server.me);
  if (path === '/spaces') return json(spacePage(spaceWhere(server.youMay), spaceWhere(server.youMay, { id: 'space-2', name: 'Tent 2' })));
  if (path === '/devices') return json({ items: server.devices, nextCursor: null });
  if (/^\/devices\/[^/]+\/live$/.test(path)) return json(server.live);
  if (/^\/devices\/[^/]+\/alarm-rules$/.test(path)) return json({ items: server.rules, nextCursor: null });
  if (/^\/devices\/[^/]+\/series$/.test(path)) {
    return json({
      deviceId: 'device-1',
      startsAt: ago(1440),
      endsAt: ago(0),
      stepSeconds: 600,
      metrics: [{ metric: 'leafTemperature', points: curve(23, 0.2) }],
      outputs: [],
    });
  }
  if (/^\/spaces\/[^/]+\/timeline$/.test(path)) return json(timeline());
  if (path === '/home' && server.home) return json(server.home);
  const overview = /^\/spaces\/([^/]+)\/overview$/.exec(path);
  if (overview && server.overviews.has(overview[1])) return json(server.overviews.get(overview[1]));
  const live = /^\/spaces\/([^/]+)\/live$/.exec(path);
  if (live && server.overviews.has(live[1])) return json({ ...server.overviews.get(live[1])!, devices: [], cameras: [] });

  return json({ items: [], nextCursor: null });
});

const draw = (node: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LogProvider>{node}</LogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The tile of one reading, found by the link its name is. */
const tile = async (name: string) => (await screen.findByRole('link', { name })).closest('article')!;

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  server.me = me(false);
  server.youMay = 'own';
  server.devices = [fridge()];
  server.live = deviceLive();
  server.rules = rules();
  server.home = null;
  server.overviews = new Map();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the cockpit of a place that is fine', () => {
  it('opens on one sentence, then a tile per reading with its day target, its verdict and what moves it', async () => {
    draw(<PlaceCockpit overview={overviewOf()} />);

    expect(screen.getByRole('status')).toHaveTextContent('All on target');

    const temperature = await tile('Temperature');
    // One compressor cools and dries, and is called by one name under both readings.
    expect(await within(temperature).findByText(/running for 12 min/)).toBeInTheDocument();
    expect(temperature).toHaveTextContent('Compressor running for 12 min');
    expect(temperature).toHaveTextContent('25.1');
    expect(temperature).toHaveTextContent('Day target 25 °C');
    expect(temperature).toHaveTextContent('in band');
    expect(temperature).toHaveTextContent('Heater off');

    const humidity = await tile('Humidity');
    expect(humidity).toHaveTextContent('VPD 1.03');
    expect(humidity).toHaveTextContent('Compressor running for 12 min');
    expect(humidity).not.toHaveTextContent('Dehumidifier');

    expect(await tile('CO₂')).toHaveTextContent('CO₂ valve closed');
  });

  it('says whether the lamp is on, how bright, and today´s window on the account´s clock', async () => {
    draw(<PlaceCockpit overview={overviewOf()} />);

    const light = await tile('Light');
    expect(await within(light).findByText('On')).toBeInTheDocument();
    expect(light).toHaveTextContent('100 %');
    expect(light).toHaveTextContent('06:00–18:00 · 12 h');
    expect(within(light).getByRole('img', { name: 'Light on from 06:00 to 18:00' })).toBeInTheDocument();
  });

  it('opens the Timeline on the reading a tile is about', async () => {
    draw(<PlaceCockpit overview={overviewOf()} />);

    expect(await screen.findByRole('link', { name: /^Temperature/ })).toHaveAttribute('href', '/timeline?space=space-1&focus=temperature');
    expect(screen.getByRole('link', { name: /^Humidity/ })).toHaveAttribute('href', '/timeline?space=space-1&focus=humidity');
    expect(await screen.findByRole('link', { name: /^Light/ })).toHaveAttribute('href', '/timeline?space=space-1&focus=light');
  });

  it('sums up the targets and the alarms, each with the way to change it', async () => {
    draw(<PlaceCockpit overview={overviewOf()} />);

    const targets = screen.getByRole('region', { name: 'Targets' });
    expect(targets).toHaveTextContent('Day25 °C · 60 % · CO₂ 900 ppm');
    expect(targets).toHaveTextContent('Night21 °C · 55 %');
    expect(await within(targets).findByText('06:00–18:00 · 12 h')).toBeInTheDocument();
    expect(within(targets).getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/control?space=space-1');

    const alarms = screen.getByRole('region', { name: 'Alarms' });
    // The bound in words: a "›" in a run of prose reads as the chevron of the link under it.
    expect(await within(alarms).findByText('Device offline · Too warm above 30 °C')).toBeInTheDocument();
    expect(within(alarms).getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/control/alarms?space=space-1');
    // Nothing reaches this account, so the summary says so and links to the fix.
    expect(await within(alarms).findByRole('link', { name: /don't reach you/ })).toHaveAttribute('href', '/me/notifications');
  });

  it('writes a rule with a floor as "below", and one with both bounds as the band it keeps', async () => {
    server.rules = [
      rule({
        id: 'cold',
        name: 'Too cold',
        origin: 'human',
        watch: { kind: 'reading', metric: 'temperature', upper: null, lower: 16, forSeconds: 600 } as never,
      }),
      rule({
        id: 'band',
        name: 'Humidity',
        origin: 'human',
        watch: { kind: 'reading', metric: 'humidity', upper: 70, lower: 40, forSeconds: 600 } as never,
      }),
    ];
    draw(<PlaceCockpit overview={overviewOf()} />);

    const alarms = await screen.findByRole('region', { name: 'Alarms' });
    expect(await within(alarms).findByText('Too cold below 16 °C · Humidity below 40 % or above 70 %')).toBeInTheDocument();
  });

  it('says where alarms go once something reaches the grower', async () => {
    server.me = me(false, 'login@example.org');
    draw(<PlaceCockpit overview={overviewOf()} />);

    expect(await screen.findByText(/Critical alarms by e-mail/i)).toBeInTheDocument();
  });

  it('names the last three things that happened in a line each, without the machine´s explanation', () => {
    const entries = [
      reboot('e1', 10),
      entry('e2', { occurredAt: ago(20) }),
      reboot('e3', 300),
      entry('e4', { text: 'Older note', occurredAt: ago(600) }),
    ];
    draw(<PlaceCockpit overview={overviewOf({ entries })} />);

    const latest = screen.getByRole('region', { name: 'Latest' });
    expect(within(latest).getAllByRole('listitem')).toHaveLength(3);
    expect(latest).not.toHaveTextContent('Older note');
    expect(latest).not.toHaveTextContent('POWERON');
    expect(within(latest).getByRole('link', { name: 'Timeline' })).toHaveAttribute('href', '/timeline?space=space-1');
  });

  it('opens a person´s line in the sheet it was written in, and leaves a device´s line inert', async () => {
    draw(<PlaceCockpit overview={overviewOf({ entries: [entry('e1', {}), reboot('e2', 30)] })} />);

    expect(screen.queryByRole('button', { name: /Device restarted/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Checked the drip/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('a reading off its target', () => {
  it('says how far and since when, once the day´s verdict holds an open run outside the band', async () => {
    const startedAt = ago(40);
    const overview = overviewOf({
      values: values().map(value => (value.metric === 'temperature' ? { ...value, value: 27.4 } : value)),
      verdict: {
        ...overviewOf().verdict,
        metrics: [
          {
            metric: 'temperature',
            rating: 'watch',
            minValue: 24,
            maxValue: 27.5,
            averageValue: 25.5,
            dayBand: { low: 24, high: 26 },
            nightBand: { low: 20, high: 22 },
            inBandSeconds: 80_000,
            outOfBandSeconds: 2400,
            excursions: [{ startedAt, endedAt: null, above: true, extremeValue: 27.5 }],
          },
        ],
      },
    });
    draw(<PlaceCockpit overview={overview} />);

    const status = await screen.findByRole('link', { name: `Temperature 2.4 °C too high · since ${hhmm(startedAt)}` });
    expect(status).toHaveAttribute('href', '/timeline?space=space-1&focus=temperature');
    expect(await tile('Temperature')).toHaveTextContent('2.4 °C too high');
    expect(await tile('Temperature')).toHaveAttribute('data-verdict', 'off');
  });

  it('says "just now" while the run is too short to be an excursion, which a door opened for a minute is not', () => {
    const overview = overviewOf({ values: values().map(value => (value.metric === 'humidity' ? { ...value, value: 68 } : value)) });
    draw(<PlaceCockpit overview={overview} />);

    expect(screen.getByRole('link', { name: 'Humidity 8 % too high just now' })).toBeInTheDocument();
  });
});

describe('a place that has gone quiet', () => {
  it('says since when and what to try, calls every figure its last value, and claims nothing about the hardware', async () => {
    const overview = overviewOf({ values: values(180) });
    server.live = deviceLive();
    draw(<PlaceCockpit overview={overview} />);

    expect(await screen.findByText(`Offline since ${hhmm(ago(180))}`)).toBeInTheDocument();
    expect(screen.getByText('Unplug the device, wait 10 seconds, plug it back in.')).toBeInTheDocument();

    const temperature = await tile('Temperature');
    expect(temperature).toHaveTextContent('last value');
    expect(temperature).not.toHaveTextContent('in band');
    expect(temperature).not.toHaveTextContent('Compressor');
    // Maintenance would not be heard by a device that is not listening.
    expect(screen.queryByRole('button', { name: /Maintenance/ })).not.toBeInTheDocument();
  });
});

describe('what a place reports decides its tiles', () => {
  it('draws no CO₂ tile without a sensor, and a leaf-and-light tile where the canopy is measured', async () => {
    server.devices = [fridge({ type: 'controller' })];
    server.live = deviceLive({ co2: undefined });
    const overview = overviewOf({
      kind: 'tent',
      values: [
        ...values().filter(value => value.metric !== 'co2'),
        { metric: 'leafTemperature', value: 23.1, measuredAt: ago(0.3), state: 'live' },
        { metric: 'lux', value: 40_000, measuredAt: ago(0.3), state: 'live' },
      ],
    });
    draw(<PlaceCockpit overview={overview} />);

    const leaf = await tile('Leaf & light');
    expect(leaf).toHaveTextContent('23.1');
    expect(leaf).toHaveTextContent('2.0 °C cooler than the air');
    // The thousands are set apart by a narrow space, which reads as a space.
    expect(leaf).toHaveTextContent('40 000 lx');
    expect(screen.getByRole('link', { name: /^Leaf & light/ })).toHaveAttribute('href', '/timeline?space=space-1&focus=leafTemperature');
    expect(screen.queryByRole('link', { name: /^CO₂/ })).not.toBeInTheDocument();
    // A tent controller cannot cool, so its temperature lists the heater and nothing that would promise otherwise.
    const temperature = await tile('Temperature');
    expect(await within(temperature).findByText(/Heater/)).toBeInTheDocument();
    expect(temperature).not.toHaveTextContent('Compressor');
  });

  it('opens the Timeline on the light where the canopy sensor measures no leaf', async () => {
    server.devices = [fridge({ type: 'controller' })];
    const overview = overviewOf({ kind: 'tent', values: [...values(), { metric: 'lux', value: 12_500, measuredAt: ago(0.3), state: 'live' }] });
    draw(<PlaceCockpit overview={overview} />);

    expect(await tile('Leaf & light')).toHaveTextContent('12 500lx');
    expect(screen.getByRole('link', { name: /^Leaf & light/ })).toHaveAttribute('href', '/timeline?space=space-1&focus=lux');
  });

  it('shows the newest still a tap from the camera´s page, and no camera where there is none', async () => {
    const withCamera = overviewOf({
      cameras: [{ cameraId: 'cam-1', name: 'Cam 1', lastStillAt: ago(1), stills: [{ mediaId: 'media-1', capturedAt: ago(1) }] }],
    });
    const { unmount } = draw(<PlaceCockpit overview={withCamera} />);

    const camera = screen.getByRole('link', { name: 'Open the camera' });
    expect(camera).toHaveAttribute('href', '/cameras/cam-1');
    expect(within(camera).getByRole('img')).toHaveAttribute('src', '/media/media-1');
    unmount();

    draw(<PlaceCockpit overview={overviewOf()} />);
    expect(screen.queryByRole('link', { name: 'Open the camera' })).not.toBeInTheDocument();
  });
});

describe('the diary on a place', () => {
  const growing = overviewOf({
    grows: [
      {
        growId: 'grow-1',
        name: 'Spring run',
        type: 'photoperiod',
        dayNumber: 34,
        phaseDay: 12,
        stageWeek: 2,
        weekNumber: 5,
        stage: 'flowering',
        stagesReached: ['vegetative', 'flowering'],
        preset: null,
        isAuto: false,
        plantCount: 3,
        strains: ['Amnesia'],
        coverMediaId: null,
        stageGroups: [],
        placedAt: ago(10 * 1440),
        placedOnDay: 22,
      },
    ],
    entries: [entry('e1', { growId: 'grow-1', text: 'Defoliated' })],
    dueTasks: [
      { id: 'task-1', kind: 'water', label: 'Water', dueAt: ago(0), subject: { type: 'grow', id: 'grow-1' }, assigneeId: null, defaults: null },
    ],
  });

  it('draws the grow with its day and phase, the last line and what is due, for whoever keeps one', async () => {
    server.me = me(true);
    draw(<PlaceCockpit overview={growing} />);

    const grow = await screen.findByRole('region', { name: 'Grow' });
    const link = within(grow).getByRole('link', { name: /Spring run/ });
    expect(link).toHaveAttribute('href', '/grows/grow-1');
    expect(link).toHaveTextContent('Day 34');
    expect(link).toHaveTextContent('Flower · wk 2 · Amnesia');
    expect(link).toHaveTextContent('Defoliated');
    expect(within(grow).getByText('Water')).toBeInTheDocument();
    expect(within(grow).getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('leaves the grow out for an account without the diary, and offers it once in a quiet line', async () => {
    server.me = me(false);
    draw(<PlaceCockpit overview={growing} />);

    expect(await screen.findByRole('button', { name: /Keep a grow diary/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Grow' })).not.toBeInTheDocument();
  });
});

describe('the place menu', () => {
  it('offers the owner the name, who else is here, a climate preset and a grow, each saying what it changes', async () => {
    draw(<PlaceCockpit overview={overviewOf()} headed />);

    fireEvent.click(await screen.findByRole('button', { name: 'More about Fridge 1' }));
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Members & sharing' })).toHaveAttribute('href', '/spaces/space-1/members');
    // The climate preset is the one list of chips under the targets, which the item opens rather than a second list of its own.
    expect(screen.getByRole('link', { name: 'Choose a climate preset under Control · applies once saved' })).toHaveAttribute(
      'href',
      '/control?space=space-1#presets',
    );
    // Somebody who keeps no diary is told that a grow brings one, and what it does to the targets.
    expect(await screen.findByRole('link', { name: 'Start a grow turns the grow diary on · puts the targets on the stage' })).toHaveAttribute(
      'href',
      '/grows/new?space=space-1',
    );
    expect(screen.queryByRole('button', { name: 'Move a grow here' })).not.toBeInTheDocument();
  });

  it('offers no grow to somebody who said no to the diary', async () => {
    server.me = { ...me(false), preferences: { ...me(false).preferences, diary: 'off' } } as Me;
    draw(<PlaceCockpit overview={overviewOf()} headed />);

    fireEvent.click(await screen.findByRole('button', { name: 'More about Fridge 1' }));
    await waitFor(() => expect(fetchStub).toHaveBeenCalledWith(expect.stringContaining('/me'), expect.anything()));
    expect(screen.queryByRole('link', { name: /Start a grow/ })).not.toBeInTheDocument();
  });

  it('opens the grow standing here for whoever keeps a diary', async () => {
    server.me = me(true);
    const grow = {
      growId: 'grow-1',
      name: 'Spring run',
      type: 'photoperiod',
      dayNumber: 34,
      phaseDay: 12,
      stageWeek: 2,
      weekNumber: 5,
      stage: 'flowering',
      stagesReached: ['vegetative', 'flowering'],
      preset: null,
      isAuto: false,
      plantCount: 3,
      strains: ['Amnesia'],
      coverMediaId: null,
      stageGroups: [],
      placedAt: ago(12 * 24 * 60),
      placedOnDay: 22,
    } as SpaceOverview['grows'][number];
    draw(<PlaceCockpit overview={overviewOf({ grows: [grow] })} headed />);

    fireEvent.click(await screen.findByRole('button', { name: 'More about Fridge 1' }));
    expect(await screen.findByRole('link', { name: 'Open the grow Spring run · day 34' })).toHaveAttribute('href', '/grows/grow-1');
    expect(screen.queryByRole('link', { name: /Start a grow/ })).not.toBeInTheDocument();
  });

  it('offers somebody who may only log nothing that would change the place', async () => {
    server.youMay = 'log';
    draw(<PlaceCockpit overview={overviewOf()} headed />);

    fireEvent.click(screen.getByRole('button', { name: 'More about Fridge 1' }));
    expect(await screen.findByRole('link', { name: 'Members & sharing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Choose a climate preset/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link', { name: 'Change' })).toHaveLength(0);
  });
});

describe('Start', () => {
  const card = (spaceId: string, name: string): HomeSpaceCard => ({
    spaceId,
    name,
    kind: 'fridge',
    roomId: null,
    deviceIds: spaceId === 'space-1' ? ['device-1'] : [],
    values: spaceId === 'space-1' ? values() : [],
    setpoints: spaceId === 'space-1' ? setpoints : [],
    trend: null,
    grow: null,
    entries: [],
    latestStill: null,
    dueTasks: [],
    openAlerts: [],
  });

  const answer = (...cards: HomeSpaceCard[]): HomeAnswer => ({ spaces: cards, followedGrows: [], people: [], layers: { diary: false } });

  it('is the cockpit of the one place an account has', async () => {
    server.home = answer(card('space-1', 'Fridge 1'));
    server.overviews.set('space-1', overviewOf());
    draw(<Home />);

    expect(await screen.findByRole('heading', { name: 'Fridge 1' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /^Temperature/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('All on target');
  });

  it('is a card per place once there are several, each opening that place´s cockpit', async () => {
    server.home = answer(card('space-1', 'Fridge 1'), card('space-2', 'Tent 2'));
    draw(<Home />);

    const fridgeCard = (await screen.findByRole('link', { name: 'Fridge 1' })).closest('article')!;
    expect(screen.getByRole('link', { name: 'Fridge 1' })).toHaveAttribute('href', '/spaces/space-1');
    expect(screen.getByRole('link', { name: 'Tent 2' })).toHaveAttribute('href', '/spaces/space-2');
    expect(fridgeCard).toHaveTextContent('All on target');
    expect(fridgeCard).toHaveTextContent('25.1');
    // The device line is the cockpit's, in its names.
    await waitFor(() => expect(fridgeCard).toHaveTextContent('Light on until 18:00 · Compressor running · Heater off'));
    // Start says what it is with its cards, as on a phone; the old "2 places · by urgency" head is gone, and the page keeps its name for a screen reader.
    expect(screen.queryByText(/^2 places/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    // Neither card is a cockpit of its own.
    expect(screen.queryByRole('link', { name: /^Temperature/ })).not.toBeInTheDocument();
  });
});

describe('what the cockpit decides', () => {
  const now = DateTime.now();
  const place = { values: values(), setpoints, deviceIds: ['device-1'], openAlerts: [], quiet: null };

  it('puts a silence before a maintenance window, that before an alarm, and an alarm before a reading off target', () => {
    const alert = {
      alertId: 'a',
      kind: 'threshold' as const,
      severity: 'critical' as const,
      startedAt: ago(5),
      value: 31,
      metric: 'temperature' as const,
      name: 'Too warm',
    };
    const quiet = { until: ago(-10), alarmsUntil: ago(-20), parked: true };
    const hot = values().map(value => (value.metric === 'temperature' ? { ...value, value: 28 } : value));

    expect(statusOf({ ...place, values: values(30), openAlerts: [alert], quiet }, now).kind).toBe('offline');
    expect(statusOf({ ...place, openAlerts: [alert], quiet }, now).kind).toBe('maintenance');
    expect(statusOf({ ...place, values: hot, openAlerts: [alert] }, now).kind).toBe('alert');
    // With no verdict at hand - a card of Start - it cannot say since when, nor that it has only just begun.
    expect(statusOf({ ...place, values: hot }, now)).toEqual({ kind: 'off', metric: 'temperature', high: true, delta: 3 });
    // With the day's verdict and no open run in it, the reading has only just left the band.
    expect(statusOf({ ...place, values: hot, verdict: { metrics: [] } as never }, now)).toMatchObject({ kind: 'off', since: null });
    expect(statusOf(place, now).kind).toBe('good');
    expect(statusOf({ ...place, setpoints: [] }, now).kind).toBe('noTargets');
    expect(statusOf({ ...place, deviceIds: [] }, now).kind).toBe('none');
    expect(statusOf({ ...place, values: [] }, now).kind).toBe('waiting');
  });

  /**
   * The Timeline draws a grow's phase against the targets it recorded when it
   * began. A tile judges against what the controller holds now, so its curve
   * is banded the same way, or "62 % · in band" stood over a line drawn under
   * a band of 65-75 after the targets were changed mid-phase.
   */
  it('bands a tile´s curve by the targets the tile judges against, not by the ones the phase began with', () => {
    const phase = {
      metric: 'humidity' as const,
      points: [],
      targets: [
        {
          startsAt: ago(3000),
          endsAt: ago(0),
          phaseId: 'phase-1',
          stage: 'vegetative' as const,
          day: { setpoint: 70, band: { low: 65, high: 75 } },
          night: { setpoint: 65, band: { low: 60, high: 70 } },
        },
      ],
    };
    const now = {
      day: [{ metric: 'humidity' as const, value: 62, band: 5 }],
      night: [{ metric: 'humidity' as const, value: 58, band: 5 }],
    };

    const [from, to] = [ago(1440), ago(0)];
    expect(judgedPanel(phase, now, from, to)?.targets).toEqual([
      {
        startsAt: from,
        endsAt: to,
        phaseId: null,
        stage: null,
        day: { setpoint: 62, band: { low: 57, high: 67 } },
        night: { setpoint: 58, band: { low: 53, high: 63 } },
      },
    ]);
    // A place that holds no targets keeps whatever the Timeline drew.
    expect(judgedPanel(phase, null, from, to)).toBe(phase);
    expect(judgedPanel(phase, { day: [], night: [] }, from, to)).toBe(phase);
  });

  it('leaves out an output the device never reported, and a CO₂ valve the firmware never opens', () => {
    const live = deviceLive({ heater: undefined });

    expect(outputsFor(fridge(), live, [], 'temperature').map(state => state.word)).toEqual(['compressor']);
    expect(outputsFor(fridge({ state: { hardware: { co2: 'off' } } as never }), live, [], 'co2')).toEqual([]);
  });
});
