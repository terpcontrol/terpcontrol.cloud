import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GERMINATION_CHOICES } from '@fg2/shared-types/v1-schemas/climate-presets.js';
import type {
  AccessNeed,
  AlarmRule,
  Device,
  DeviceLive,
  Entry,
  HomeAnswer,
  HomeSpaceCard,
  Me,
  MyGrowCard,
  SpaceOverview,
  SpaceTimeline,
} from '@fg2/shared-types/v1';
import { LogProvider } from '@/log/LogProvider';
import { Home } from '@/screens/Home';
import { PlaceCockpit } from '@/screens/cockpit/PlaceCockpit';
import { holdVerdictOf, judgedPanel, outputsFor, statusOf } from '@/screens/cockpit/place';
import { drawAt, json } from './harness';
import { spacePage, spaceWhere } from './session';
import { translate } from './translations';

/** Who reads the cockpit: the grower, or support reading a customer's place. */
const who = vi.hoisted(() => ({ admin: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return {
    ...(await importOriginal<object>()),
    mediaUrl: (id: string) => `/media/${id}`,
    useSession: () => (who.admin ? { ...SIGNED_IN, user: { ...SIGNED_IN.user!, isAdmin: true } } : SIGNED_IN),
  };
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
  // `transition: null` is the device saying it is not between its halves. Left
  // out, the schedule's ramps decide that instead, and a fridge is gliding to
  // the night for the last quarter of an hour before 18:00 UTC - which made the
  // day's figures fail to read as the day's whenever the suite ran then.
  setpoints: { day: { temperature: 25, humidity: 60, co2: 900 }, night: { temperature: 21, humidity: 55 }, active: 'day', transition: null },
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
  /** The plan the device runs, as its route answers it; none answers that there is none. */
  plan: null as Record<string, unknown> | null,
  /** Devices that are not the account's own: a customer's, which support reads one by one. */
  customers: [] as Device[],
  /** Every grow of the account, as "My grows" reads it. */
  mine: [] as MyGrowCard[],
  /** The rows of the device's socket table, by role; none paired is what most devices answer. */
  sockets: [] as { role: string; state?: string; stateChangedAt?: string | null }[],
};

const fetchStub = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const { pathname } = new URL(String(input), 'http://localhost');
  const path = pathname.replace(/^\/v1/, '');

  if (path === '/me') return json(server.me);
  if (path === '/spaces') return json(spacePage(spaceWhere(server.youMay), spaceWhere(server.youMay, { id: 'space-2', name: 'Tent 2' })));
  if (path === '/devices') return json({ items: server.devices, nextCursor: null });
  // One device read on its own, which is how support reads a customer's: none of them is in its own list.
  const one = /^\/devices\/([^/]+)$/.exec(path);
  if (one) return json(server.customers.find(device => device.id === one[1]) ?? server.devices.find(device => device.id === one[1]));
  if (/^\/devices\/[^/]+\/live$/.test(path)) return json(server.live);
  if (/^\/devices\/[^/]+\/alarm-rules$/.test(path)) return json({ items: server.rules, nextCursor: null });
  if (/^\/devices\/[^/]+\/sockets$/.test(path)) return json({ items: server.sockets, nextCursor: null });
  if (/^\/devices\/[^/]+\/plan$/.test(path) && server.plan) return json(server.plan);
  if (/^\/devices\/[^/]+\/plan\/transitions$/.test(path)) return json(server.plan);
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
  if (path === '/home/grows') return json({ items: server.mine, nextCursor: null });
  const overview = /^\/spaces\/([^/]+)\/overview$/.exec(path);
  if (overview && server.overviews.has(overview[1])) return json(server.overviews.get(overview[1]));
  const live = /^\/spaces\/([^/]+)\/live$/.exec(path);
  if (live && server.overviews.has(live[1])) return json({ ...server.overviews.get(live[1])!, devices: [], cameras: [] });

  return json({ items: [], nextCursor: null });
});

const draw = (node: React.ReactNode) => drawAt(<LogProvider>{node}</LogProvider>);

/** The tile of one reading, found by the link its name is. */
const tile = async (name: string) => (await screen.findByRole('link', { name })).closest('article')!;

beforeAll(() => translate());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  server.me = me(false);
  server.youMay = 'own';
  server.devices = [fridge()];
  server.live = deviceLive();
  server.rules = rules();
  server.home = null;
  server.mine = [];
  server.overviews = new Map();
  server.plan = null;
  server.customers = [];
  server.sockets = [];
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

  /** A "too humid" alarm that rests while the fridge germinates is said to rest, rather than promised (owner's decision G2). */
  it('says a "too humid" alarm rests while the fridge germinates', async () => {
    server.rules = [
      rule({
        id: 'humid',
        name: 'Too humid',
        origin: 'preset',
        watch: { kind: 'reading', metric: 'humidity', upper: 90, lower: null, forSeconds: 1200 } as never,
      }),
    ];
    server.devices = [
      fridge({
        configuration: { ...fridge().configuration, workmode: 'breed' },
        control: { running: true, drying: false, mode: 'germination', energySaving: false, germinationChoices: GERMINATION_CHOICES },
      }),
    ];
    draw(<PlaceCockpit overview={overviewOf()} />);

    const alarms = await screen.findByRole('region', { name: 'Alarms' });
    expect(await within(alarms).findByText('Too humid above 90 % (rests during germination)')).toBeInTheDocument();
  });

  /** Asked to warn, the stage's "too humid" warns at germination's line, whatever stage wrote its band. */
  it('says the line a "too humid" warns at while the fridge germinates', async () => {
    server.rules = [
      rule({
        id: 'humid',
        name: 'Too humid',
        origin: 'preset',
        watch: { kind: 'reading', metric: 'humidity', upper: 72, lower: null, forSeconds: 1200 } as never,
      }),
    ];
    server.devices = [
      fridge({
        configuration: { ...fridge().configuration, workmode: 'breed' },
        control: {
          running: true,
          drying: false,
          mode: 'germination',
          energySaving: false,
          germinationChoices: { warnTooHumid: true, humidifierHolds: true },
        },
      }),
    ];
    draw(<PlaceCockpit overview={overviewOf()} />);

    const alarms = await screen.findByRole('region', { name: 'Alarms' });
    expect(await within(alarms).findByText('Too humid above 90 %')).toBeInTheDocument();
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

describe('a place whose control is switched off', () => {
  const off = () =>
    fridge({ control: { running: false, drying: false, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES } });

  it('opens on it, and offers to switch it back on with one tap', async () => {
    server.devices = [off()];
    draw(<PlaceCockpit overview={overviewOf()} />);

    expect(await screen.findByText('Control off: the device holds no targets')).toBeInTheDocument();
    const on = await screen.findByRole('button', { name: /^Switch control on/ });
    fireEvent.click(on);

    await waitFor(() =>
      expect(fetchStub).toHaveBeenCalledWith(
        expect.stringContaining('/devices/device-1/configuration'),
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ set: { control: true } }) }),
      ),
    );
  });

  it('resumes the plan the switch paused when it is switched back on, and says so on the button', async () => {
    server.devices = [off()];
    server.plan = {
      id: 'plan-1',
      deviceId: 'device-1',
      name: 'Photoperiod',
      steps: [
        {
          id: 's1',
          name: 'Veg',
          stage: 'vegetative',
          preset: null,
          duration: { days: 14 },
          settings: {},
          lightHours: 18,
          waitForConfirmation: false,
          confirmationMessage: null,
        },
      ],
      state: { status: 'paused', activeStepIndex: 0, stepStartedAt: ago(600), pausedElapsedMs: 0, pauseReason: 'Control was switched off.' },
    };
    draw(<PlaceCockpit overview={overviewOf()} />);

    fireEvent.click(await screen.findByRole('button', { name: /^Switch control on.*the plan goes on/ }));

    await waitFor(() =>
      expect(fetchStub).toHaveBeenCalledWith(
        expect.stringContaining('/devices/device-1/plan/transitions'),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ kind: 'resume' }) }),
      ),
    );
  });

  it('offers to switch a running one off, beside the maintenance window', async () => {
    server.devices = [
      fridge({ control: { running: true, drying: false, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES } }),
    ];
    draw(<PlaceCockpit overview={overviewOf()} />);

    expect(await screen.findByRole('button', { name: /^Switch control off/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^MaintenancePause/ })).toBeInTheDocument();
  });
});

describe('a customer´s place read by support', () => {
  it('says it is support reading it, and offers no invitation and none of the account´s own offers', async () => {
    who.admin = true;
    server.youMay = 'view';
    draw(<PlaceCockpit overview={overviewOf({ spaceId: 'space-customer' })} headed />);

    expect(await screen.findByText(/^Support view of a customer's place: read only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^More about/ }));
    expect(screen.queryByRole('link', { name: 'Invite members' })).not.toBeInTheDocument();
    who.admin = false;
  });

  /**
   * Support's cockpit drew the customer's place from the administrator's own
   * device list, which holds none of the customer's devices: no lamp tile, no
   * compressor under the readings, no alarms - the very things a case about a
   * lamp that does not switch is about.
   */
  it('shows support the lamp, the outputs and the alarms the customer sees, and nothing that writes', async () => {
    who.admin = true;
    server.youMay = 'view';
    server.customers = server.devices;
    server.devices = [];
    draw(<PlaceCockpit overview={overviewOf({ spaceId: 'space-customer' })} headed />);

    expect(await within(await tile('Light')).findByText('On')).toBeInTheDocument();
    const temperature = await tile('Temperature');
    await waitFor(() => expect(temperature).toHaveTextContent('Compressor running for 12 min'));
    const alarms = await screen.findByRole('region', { name: 'Alarms' });
    expect(await within(alarms).findByText('Device offline · Too warm above 30 °C')).toBeInTheDocument();
    expect(within(alarms).queryByRole('link', { name: 'Change' })).not.toBeInTheDocument();
    // Whose phone an alarm reaches is a fact of the reader's account, and support's is not the customer's.
    expect(within(alarms).queryByRole('link', { name: /don't reach you/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Switch control off/ })).not.toBeInTheDocument();
    who.admin = false;
  });
});

describe('a place in another work mode', () => {
  it('says a germinating fridge is dark and holds one temperature, that its light is off for that reason, and where it ends', async () => {
    server.devices = [
      fridge({ control: { running: true, drying: false, mode: 'germination', energySaving: false, germinationChoices: GERMINATION_CHOICES } }),
    ];
    draw(<PlaceCockpit overview={overviewOf()} />);

    expect(await screen.findByText(/^Germination · dark: no light and no CO₂, one temperature round the clock/)).toBeInTheDocument();
    expect(screen.getAllByText('off · germination').length).toBeGreaterThan(0);
    // Ended by the seedling climate under Steuerung, like drying.
    expect(screen.getByRole('link', { name: 'Change ›' })).toHaveAttribute('href', expect.stringContaining('/control'));
  });

  it('says a drying fridge is drying, with the way to end it in Steuerung', async () => {
    server.devices = [
      fridge({ control: { running: true, drying: true, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES } }),
    ];
    draw(<PlaceCockpit overview={overviewOf()} />);

    expect(await screen.findByText(/^Drying: no light and no CO₂/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change ›' })).toHaveAttribute('href', expect.stringContaining('/control'));
  });

  it('says a drying fridge holds no CO₂ because it is drying, not because it is night', async () => {
    server.devices = [
      fridge({ control: { running: true, drying: true, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES } }),
    ];
    const drying = setpoints.map(one => (one.metric === 'co2' ? { ...one, value: null } : one));
    draw(<PlaceCockpit overview={overviewOf({ setpoints: drying })} />);

    expect(await screen.findByText('no target · drying')).toBeInTheDocument();
    expect(screen.queryByText('No target at night')).not.toBeInTheDocument();
  });

  /** A drying room has no day and no night, and the tiles said "Night target 18.0 °C" under a line saying so. */
  it('calls a drying fridge´s targets the drying targets, not the night´s', async () => {
    server.devices = [
      fridge({ control: { running: true, drying: true, mode: 'standard', energySaving: false, germinationChoices: GERMINATION_CHOICES } }),
    ];
    server.live = {
      ...deviceLive(),
      setpoints: { day: { temperature: 18, humidity: 58 }, night: { temperature: 18, humidity: 58 }, active: 'night' },
    };
    const drying = setpoints.map(one => (one.metric === 'co2' ? { ...one, value: null } : { ...one, value: one.metric === 'temperature' ? 18 : 58 }));
    draw(<PlaceCockpit overview={overviewOf({ setpoints: drying })} />);

    const temperature = await tile('Temperature');
    await waitFor(() => expect(temperature).toHaveTextContent('Drying target 18 °C'));
    expect(await tile('Humidity')).toHaveTextContent('Drying target 58 %');
    expect(document.body).not.toHaveTextContent(/Night target/);
  });

  it('says nothing of a mode where the fridge runs its standard one', async () => {
    server.devices = [
      fridge({ control: { running: true, drying: false, mode: 'standard', energySaving: true, germinationChoices: GERMINATION_CHOICES } }),
    ];
    draw(<PlaceCockpit overview={overviewOf()} />);

    expect(await screen.findByRole('button', { name: /^Switch control off/ })).toBeInTheDocument();
    expect(screen.queryByText(/^Operating mode/)).not.toBeInTheDocument();
  });
});

/**
 * Day and night are the device's clock and its mode, never its lamp, and a
 * mode without them has no day or night target to name. The tiles, the
 * targets card and the light tile say it the way Steuerung shades it.
 */
describe('day and night on the cockpit', () => {
  const lamp = (value: number) => ({ light: { value, measuredAt: ago(0.2), state: 'live' as const } });
  const targetsCard = () => screen.getByRole('region', { name: 'Targets' });

  /** A lamp held off at noon, dimmed to 0 % or cut by the heat leaves the device in its day, heating to its day target. */
  it('names the half the device says it holds, whatever the lamp is doing, and marks it in the targets card', async () => {
    server.live = { ...deviceLive(lamp(0)), setpoints: { ...deviceLive().setpoints!, active: 'day' } };
    draw(<PlaceCockpit overview={overviewOf()} />);

    const temperature = await tile('Temperature');
    await waitFor(() => expect(temperature).toHaveTextContent('Day target 25 °C'));
    const light = await tile('Light');
    await waitFor(() => expect(light).toHaveTextContent('day until 18:00'));
    expect(light).not.toHaveTextContent('on at 06:00');
    await waitFor(() => expect(within(targetsCard()).getByText('now').closest('dt')).toHaveTextContent(/^Daynow$/));
  });

  it('names the night where the device says it is in one, the lamp held on through it', async () => {
    server.live = { ...deviceLive(lamp(100)), setpoints: { ...deviceLive().setpoints!, active: 'night' } };
    draw(<PlaceCockpit overview={overviewOf({ setpoints: [{ metric: 'temperature', value: 21, band: 1 }] })} />);

    await waitFor(async () => expect(await tile('Temperature')).toHaveTextContent('Night target 21 °C'));
    await waitFor(async () => expect(await tile('Light')).toHaveTextContent('night until 06:00'));
    await waitFor(() => expect(within(targetsCard()).getByText('now').closest('dt')).toHaveTextContent(/^Nightnow$/));
  });

  it('calls a germinating fridge´s target the germination´s, with no night beside it and the light off', async () => {
    server.devices = [
      fridge({ control: { running: true, drying: false, mode: 'germination', energySaving: false, germinationChoices: GERMINATION_CHOICES } }),
    ];
    server.live = { ...deviceLive(lamp(0)), setpoints: { day: {}, night: { temperature: 24 }, active: 'night' } };
    const germinating = [
      { metric: 'temperature' as const, value: 24, band: 1 },
      { metric: 'humidity' as const, value: null, band: null },
      { metric: 'co2' as const, value: null, band: null },
    ];
    draw(
      <PlaceCockpit
        overview={overviewOf({ setpoints: germinating, targets: { day: germinating, night: [{ metric: 'temperature', value: 24, band: 1 }] } })}
      />,
    );

    await waitFor(async () => expect(await tile('Temperature')).toHaveTextContent('Germination target 24 °C'));
    expect(await tile('Humidity')).toHaveTextContent('no target · germination');
    await waitFor(() => expect(targetsCard()).toHaveTextContent('Germination24 °C'));
    expect(targetsCard()).toHaveTextContent('Lightoff · germination');
    expect(targetsCard()).not.toHaveTextContent(/Day|Night/);
  });

  /** A humidifier socket the grower lets hold the humidity in the dark is what looks after it, and the tile says so. */
  it('names the humidity a humidifier holds while the fridge germinates', async () => {
    server.sockets = [{ role: 'humidifier' }];
    server.devices = [
      fridge({
        configuration: { ...fridge().configuration, workmode: 'breed', night: { temperature: 24, humidity: 75 } },
        control: { running: true, drying: false, mode: 'germination', energySaving: false, germinationChoices: GERMINATION_CHOICES },
      }),
    ];
    server.live = { ...deviceLive(lamp(0)), setpoints: { day: {}, night: { temperature: 24 }, active: 'night' } };
    const germinating = [
      { metric: 'temperature' as const, value: 24, band: 1 },
      { metric: 'humidity' as const, value: null, band: null },
      { metric: 'co2' as const, value: null, band: null },
    ];
    draw(
      <PlaceCockpit
        overview={overviewOf({ setpoints: germinating, targets: { day: germinating, night: [{ metric: 'temperature', value: 24, band: 1 }] } })}
      />,
    );

    await waitFor(async () => expect(await tile('Humidity')).toHaveTextContent('Humidifier target 75 %'));
  });

  /**
   * A humidifier that is to hold 80 % over a box reading 58 % - an empty tank -
   * was "All on target" under "humidifier holds 80 %", with only the
   * compressor named. The tile, the status line and the summaries now say what
   * it is to hold, how far under it the box reads, and that the socket runs.
   */
  it('judges the humidity a humidifier holds from below, and names the humidifier and its figure', async () => {
    server.sockets = [{ role: 'humidifier', state: 'on', stateChangedAt: ago(240) }];
    server.devices = [
      fridge({
        configuration: { ...fridge().configuration, workmode: 'breed', night: { temperature: 24, humidity: 80 } },
        control: { running: true, drying: false, mode: 'germination', energySaving: false, germinationChoices: GERMINATION_CHOICES },
      }),
    ];
    server.live = { ...deviceLive(lamp(0)), setpoints: { day: {}, night: { temperature: 24 }, active: 'night' } };
    const germinating = [
      { metric: 'temperature' as const, value: 24, band: 1 },
      { metric: 'humidity' as const, value: null, band: null },
      { metric: 'co2' as const, value: null, band: null },
    ];
    const dry = values().map(value =>
      value.metric === 'temperature' ? { ...value, value: 24.2 } : value.metric === 'humidity' ? { ...value, value: 58 } : value,
    );
    draw(
      <PlaceCockpit
        overview={overviewOf({
          values: dry,
          setpoints: germinating,
          targets: { day: germinating, night: [{ metric: 'temperature', value: 24, band: 1 }] },
        })}
      />,
    );

    const humidity = await tile('Humidity');
    await waitFor(() => expect(humidity).toHaveTextContent('Humidifier target 80 %'));
    expect(humidity).toHaveTextContent('22 % too low');
    await waitFor(() => expect(humidity).toHaveTextContent('Humidifier running for 4 h'));
    expect(screen.getByText('Humidity 22 % too low')).toBeInTheDocument();
    expect(screen.queryByText('All on target')).not.toBeInTheDocument();
    expect(screen.getByText(/one temperature round the clock, and the humidifier holds 80 % humidity\./)).toBeInTheDocument();
    expect(targetsCard()).toHaveTextContent('Germination24 °C · 80 %');
  });

  it('keeps saying germination holds no humidity where the humidifier rests', async () => {
    server.sockets = [{ role: 'humidifier' }];
    server.devices = [
      fridge({
        configuration: { ...fridge().configuration, workmode: 'breed', night: { temperature: 24, humidity: 75 } },
        control: {
          running: true,
          drying: false,
          mode: 'germination',
          energySaving: false,
          germinationChoices: { warnTooHumid: false, humidifierHolds: false },
        },
      }),
    ];
    server.live = { ...deviceLive(lamp(0)), setpoints: { day: {}, night: { temperature: 24 }, active: 'night' } };
    const germinating = [
      { metric: 'temperature' as const, value: 24, band: 1 },
      { metric: 'humidity' as const, value: null, band: null },
      { metric: 'co2' as const, value: null, band: null },
    ];
    draw(
      <PlaceCockpit
        overview={overviewOf({ setpoints: germinating, targets: { day: germinating, night: [{ metric: 'temperature', value: 24, band: 1 }] } })}
      />,
    );

    await waitFor(async () => expect(await tile('Temperature')).toHaveTextContent('Germination target 24 °C'));
    expect(await tile('Humidity')).toHaveTextContent('no target · germination');
    await waitFor(() => expect(targetsCard()).toHaveTextContent('Germination24 °C'));
    expect(targetsCard()).toHaveTextContent('Lightoff · germination');
    expect(targetsCard()).not.toHaveTextContent(/Day|Night/);
  });

  /** "06:00–05:59" read as a lamp that goes off a minute before it comes on. */
  it('says a day-long light is on round the clock, and sums the one climate it holds', async () => {
    server.devices = [fridge({ configuration: { ...fridge().configuration, daynight: { day: 6 * 3600, night: 6 * 3600 - 1 } } })];
    draw(<PlaceCockpit overview={overviewOf()} />);

    const light = await tile('Light');
    await waitFor(() => expect(light).toHaveTextContent('on round the clock · 24 h'));
    expect(light).not.toHaveTextContent(/off at|05:59/);
    expect(within(light).getByRole('img', { name: 'on round the clock · 24 h' })).toBeInTheDocument();
    await waitFor(() => expect(targetsCard()).toHaveTextContent('Round the clock25 °C · 60 % · CO₂ 900 ppm'));
    expect(targetsCard()).toHaveTextContent('Lighton round the clock · 24 h');
    expect(targetsCard()).not.toHaveTextContent('Night');
    // One climate round the clock has no other half to name it against.
    await waitFor(async () => expect(await tile('Temperature')).toHaveTextContent('Target 25 °C'));
    expect(await tile('Temperature')).not.toHaveTextContent('Day target');
  });

  it('says a light that never comes on is off round the clock, and that its CO₂ has no target without light', async () => {
    server.devices = [fridge({ configuration: { ...fridge().configuration, daynight: { day: 6 * 3600, night: 6 * 3600 } } })];
    server.live = { ...deviceLive(lamp(0)), setpoints: { ...deviceLive().setpoints!, active: 'night' } };
    const dark = [
      { metric: 'temperature' as const, value: 21, band: 1 },
      { metric: 'humidity' as const, value: 55, band: 5 },
      { metric: 'co2' as const, value: null, band: null },
    ];
    draw(<PlaceCockpit overview={overviewOf({ setpoints: dark })} />);

    await waitFor(async () => expect(await tile('Light')).toHaveTextContent('off round the clock · 0 h'));
    await waitFor(async () => expect(await tile('CO₂')).toHaveTextContent('no target without light'));
    await waitFor(() => expect(targetsCard()).toHaveTextContent('Round the clock21 °C · 55 %'));
    expect(targetsCard()).toHaveTextContent('Lightoff round the clock · 0 h');
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

    const status = await screen.findByRole('link', { name: new RegExp(`^Temperature 2\\.4 °C too high · since (\\d+ \\w+ )?${hhmm(startedAt)}$`) });
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

describe('the edge of the band', () => {
  it('counts a reading that is written as on the edge as in target, so the status line does not flip on rounding', () => {
    const now = DateTime.now();
    const edge = values().map(value => (value.metric === 'temperature' ? { ...value, value: 26.04 } : value));
    expect(statusOf({ values: edge, setpoints, deviceIds: ['device-1'], openAlerts: [], quiet: null }, now).kind).toBe('good');

    const past = values().map(value => (value.metric === 'temperature' ? { ...value, value: 26.06 } : value));
    expect(statusOf({ values: past, setpoints, deviceIds: ['device-1'], openAlerts: [], quiet: null }, now)).toMatchObject({
      kind: 'off',
      delta: 1.1,
    });
  });
});

/**
 * For the hour after a switch between day and night - and while a fridge glides
 * along its ramp before it - the server judges a reading by both halves' bands
 * together, and the card says so: a fridge cooling into its night is on its
 * way, not "too warm", and not "in band" beside a target it has not reached.
 */
describe('a device changing between day and night', () => {
  const until = DateTime.now().plus({ minutes: 40 });
  const changing: SpaceOverview['setpoints'] = [
    { metric: 'temperature', value: 21, band: 1, transition: { from: 'day', to: 'night', until: until.toISO()!, low: 20, high: 26 } },
    { metric: 'humidity', value: 60, band: 5 },
    { metric: 'co2', value: null, band: null, transition: { from: 'day', to: 'night', until: until.toISO()!, low: null, high: null } },
  ];
  const warm = (value: number) => values().map(one => (one.metric === 'temperature' ? { ...one, value } : one));

  it('is on target anywhere between the two bands, and off it outside both', () => {
    const now = DateTime.now();
    expect(statusOf({ values: warm(24.6), setpoints: changing, deviceIds: ['device-1'], openAlerts: [], quiet: null }, now).kind).toBe('good');
    expect(statusOf({ values: warm(27.5), setpoints: changing, deviceIds: ['device-1'], openAlerts: [], quiet: null }, now)).toMatchObject({
      kind: 'off',
      metric: 'temperature',
      high: true,
    });
  });

  /** The figure a fridge glides through is neither half's: "Day target 23.3 °C" read as the day being set to 23.3. */
  it('calls the figure a fridge is gliding through the target of now, and says where it is gliding', async () => {
    server.live = {
      ...deviceLive(),
      setpoints: {
        ...deviceLive().setpoints!,
        active: 'day',
        period: 'day',
        transition: { from: 'day', to: 'night', until: until.toISO()!, gliding: true, targets: { temperature: 23.3 } },
      },
    };
    const gliding = changing.map(one => (one.metric === 'temperature' ? { ...one, value: 23.3 } : one));
    draw(<PlaceCockpit overview={overviewOf({ values: warm(24), setpoints: gliding })} />);

    await waitFor(async () => expect(await tile('Temperature')).toHaveTextContent('Target now 23.3 °C · gliding to the night'));
    expect(await tile('Temperature')).not.toHaveTextContent('Day target');
  });

  it('says on the tile that it is changing over, and until when, and judges CO₂ not at all meanwhile', async () => {
    draw(<PlaceCockpit overview={overviewOf({ values: warm(24.6), setpoints: changing })} />);

    const temperature = await tile('Temperature');
    expect(temperature).toHaveTextContent(`changing over until ${until.toFormat('HH:mm')}`);
    expect(temperature).not.toHaveTextContent('in band');
    expect(temperature).not.toHaveAttribute('data-verdict');
    expect(await tile('CO₂')).not.toHaveTextContent('too');
  });
});

describe('a place that has gone quiet', () => {
  it('says since when and what to try, calls every figure its last value, and claims nothing about the hardware', async () => {
    const overview = overviewOf({ values: values(180) });
    server.live = deviceLive();
    draw(<PlaceCockpit overview={overview} />);

    // Read after midnight, three hours back is yesterday and says its date too.
    expect(await screen.findByText(new RegExp(`^Offline since (\\d+ \\w+ )?${hhmm(ago(180))}$`))).toBeInTheDocument();
    expect(screen.getByText('Unplug the device, wait 10 seconds, plug it back in.')).toBeInTheDocument();

    const temperature = await tile('Temperature');
    expect(temperature).toHaveTextContent('last value');
    // Nothing is heard from it, so the half named is the one its schedule would put it in, and says so.
    expect(temperature).toHaveTextContent(/(Day|Night) target by the schedule/);
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
      cameras: [{ cameraId: 'cam-1', name: 'Cam 1', lastStillAt: ago(1), stills: [{ mediaId: 'media-1', capturedAt: ago(1) }], litStill: null }],
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

  /** The same plants look the same on Start and on "Meine Grows": the block takes the picture the grow´s card has. */
  it('shows a grow by the picture its card on "My grows" has, before the newest photo among the lines here', async () => {
    server.me = me(true);
    server.mine = [{ growId: 'grow-1', endedAt: null, coverMediaId: 'diary-photo-older' }] as MyGrowCard[];
    draw(<PlaceCockpit overview={growing} />);

    const grow = await screen.findByRole('region', { name: 'Grow' });
    await waitFor(() =>
      expect(
        within(grow)
          .getByRole('link', { name: /Spring run/ })
          .querySelector('img'),
      ).toHaveAttribute('src', '/media/diary-photo-older'),
    );
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

  /**
   * A diary kept without any hardware: the grow is the page. Nothing said
   * "Kein Sensor · Gerät hinzufügen" over it any more, and a sensor is offered
   * in one quiet line at the end, leading to the Gerät tab rather than into
   * the claim.
   */
  it('makes the grow the page of a diary kept by hand, and offers a sensor in a quiet line under it', async () => {
    server.me = me(true);
    draw(<PlaceCockpit overview={{ ...growing, deviceIds: [], values: [], setpoints: [], targets: null }} />);

    expect(await screen.findByRole('region', { name: 'Grow' })).toBeInTheDocument();
    expect(screen.queryByText('No sensor')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add a device/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /measures itself/ })).toHaveAttribute('href', '/devices');
    expect(screen.getByRole('button', { name: 'No thanks' })).toBeInTheDocument();
  });

  /** With a camera, its picture heads the grow block, with the day and the stage on it, and is not drawn a second time. */
  it('heads the grow block with the camera´s picture where a camera watches the place', async () => {
    server.me = me(true);
    const camera = {
      cameraId: 'cam-1',
      name: 'Terp Cam · B07171',
      lastStillAt: ago(1),
      stills: [{ mediaId: 'media-1', capturedAt: ago(1) }],
      litStill: null,
    };
    draw(<PlaceCockpit overview={{ ...growing, cameras: [camera] }} />);

    const grow = await screen.findByRole('region', { name: 'Grow' });
    expect(within(grow).getByRole('link', { name: 'Open the camera' })).toHaveTextContent('Day 34 · Flower wk 2');
    expect(screen.getAllByRole('link', { name: 'Open the camera' })).toHaveLength(1);
  });

  it('says a camera alone is delivering, or since when it is not, where nothing measures the place', async () => {
    server.me = me(false);
    const quiet = { cameraId: 'cam-1', name: 'Growbox-Cam', lastStillAt: ago(180), stills: [], litStill: null };
    draw(<PlaceCockpit overview={{ ...overviewOf({ deviceIds: [], values: [], setpoints: [], targets: null }), cameras: [quiet] }} />);

    expect(await screen.findByRole('link', { name: /Growbox-Cam not delivering · since/ })).toHaveAttribute('href', '/cameras/cam-1');
    expect(screen.queryByText('No sensor')).not.toBeInTheDocument();
  });

  it('leaves the grow out for an account without the diary, and offers it once in a quiet line', async () => {
    server.me = me(false);
    draw(<PlaceCockpit overview={growing} />);

    expect(await screen.findByRole('button', { name: /Turn on the grow diary/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Grow' })).not.toBeInTheDocument();
  });
});

describe('the place menu', () => {
  it('offers the owner the name, who else is here, a climate preset and a grow, each saying what it changes', async () => {
    draw(<PlaceCockpit overview={overviewOf()} headed />);

    fireEvent.click(await screen.findByRole('button', { name: 'More about Fridge 1' }));
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Invite members' })).toHaveAttribute('href', '/spaces/space-1/members');
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
    // Showing the diary to somebody is the grow's, and a tap from here rather than the seventh chip of the grow page.
    expect(screen.getByRole('link', { name: 'Share the grow' })).toHaveAttribute('href', '/grows/grow-1?share=1');
    expect(screen.queryByRole('link', { name: /Start a grow/ })).not.toBeInTheDocument();
  });

  it('offers somebody who may only log nothing that would change the place', async () => {
    server.youMay = 'log';
    draw(<PlaceCockpit overview={overviewOf()} headed />);

    fireEvent.click(screen.getByRole('button', { name: 'More about Fridge 1' }));
    expect(await screen.findByRole('link', { name: 'Invite members' })).toBeInTheDocument();
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

  /**
   * With one place the way to every grow is the cockpit's grow block, beside
   * its tasks: a line under the cockpit stood below "Zuletzt" and the folded
   * "Erweitert", two screens down on a phone, and read as part of the latter.
   */
  it('leads to every grow from the cockpit´s grow block, for an account that keeps a diary and only once there is a grow', async () => {
    const grows = [{ endedAt: null }, { endedAt: '2026-06-01T10:00:00.000Z' }, { endedAt: '2026-01-10T10:00:00.000Z' }] as MyGrowCard[];
    server.home = { ...answer(card('space-1', 'Fridge 1')), layers: { diary: true } };
    server.overviews.set('space-1', overviewOf());
    server.me = me(true);
    server.mine = grows;
    const kept = draw(<Home />);

    const block = await screen.findByRole('region', { name: 'Grow' });
    expect(await within(block).findByRole('link', { name: /^My grows/ })).toHaveAttribute('href', '/grows');
    expect(within(block).getByRole('link', { name: /^All tasks/ })).toHaveAttribute('href', '/tasks');
    // Once, in the block, and not a second time at the foot of the page.
    expect(screen.getAllByRole('link', { name: /^My grows/ })).toHaveLength(1);
    kept.unmount();

    // A diary with no grow yet has nothing behind the way, and is not offered it.
    server.mine = [];
    const none = draw(<Home />);
    const empty = await screen.findByRole('region', { name: 'Grow' });
    await waitFor(() => expect(fetchStub).toHaveBeenCalledWith(expect.stringContaining('/home/grows'), expect.anything()));
    expect(within(empty).queryByRole('link', { name: /^My grows/ })).not.toBeInTheDocument();
    none.unmount();

    // Without the diary the cockpit is the whole of Start.
    server.mine = grows;
    server.home = answer(card('space-1', 'Fridge 1'));
    server.me = me(false);
    draw(<Home />);
    expect(await screen.findByRole('heading', { name: 'Fridge 1' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^My grows/ })).not.toBeInTheDocument();
  });

  it('leads to every grow from under the cards where there are several places', async () => {
    server.home = { ...answer(card('space-1', 'Fridge 1'), card('space-2', 'Tent 2')), layers: { diary: true } };
    server.me = me(true);
    server.mine = [{ endedAt: null }, { endedAt: '2026-06-01T10:00:00.000Z' }] as MyGrowCard[];
    draw(<Home />);

    const line = await screen.findByRole('link', { name: /^My grows/ });
    expect(line).toHaveAttribute('href', '/grows');
    expect(line).toHaveTextContent('1 running · 1 finished');
  });

  /** An account whose grows have all ended owns no place and lands on the empty Start, which must not say that nothing is here. */
  it('tells an account whose grows have all ended that none is running, with the way to them first', async () => {
    server.home = { ...answer(), layers: { diary: true } };
    server.me = me(true);
    server.mine = [{ endedAt: '2026-08-15T10:00:00.000Z' }] as MyGrowCard[];
    const kept = draw(<Home />);

    expect(await screen.findByRole('heading', { level: 1, name: 'No grow is running right now.' })).toBeInTheDocument();
    const line = screen.getByRole('link', { name: /^My grows/ });
    expect(line).toHaveTextContent('1 finished');
    // Before the doors to the next grow, not under them.
    const start = screen.getByRole('heading', { name: 'Start a grow' });
    expect(line.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    kept.unmount();

    server.mine = [];
    draw(<Home />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nothing here yet.' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^My grows/ })).not.toBeInTheDocument();
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

  it('says on a place´s card that a day-long light is on round the clock rather than until a time', async () => {
    const day = { day: 6 * 3600, night: 6 * 3600 - 1 };
    server.devices = [fridge({ configuration: { ...fridge().configuration, daynight: day } })];
    server.home = answer(card('space-1', 'Fridge 1'), card('space-2', 'Tent 2'));
    draw(<Home />);

    const fridgeCard = (await screen.findByRole('link', { name: 'Fridge 1' })).closest('article')!;
    await waitFor(() => expect(fridgeCard).toHaveTextContent('Light on round the clock · Compressor running'));
    expect(fridgeCard).not.toHaveTextContent('until');
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
    // A camera that stopped is the one thing a place without a sensor has to report.
    expect(
      statusOf({ ...place, deviceIds: [], openAlerts: [{ ...alert, kind: 'camera_stale' as never, severity: 'warning' as const }] }, now).kind,
    ).toBe('alert');
    expect(statusOf({ ...place, values: [] }, now).kind).toBe('waiting');
  });

  /** Nothing in the dark dries the box, so a humidity over what a humidifier holds is no verdict at all. */
  it('judges a humidity a humidifier holds from below alone, and says nothing of how long it has been under', () => {
    const hold = { target: 75, band: 5 };
    const reading = (value: number) => ({ metric: 'humidity' as const, value, measuredAt: ago(0.3), state: 'live' as const });
    expect(holdVerdictOf(reading(58), hold, now)).toEqual({ kind: 'low', delta: 17 });
    expect(holdVerdictOf(reading(71), hold, now)).toEqual({ kind: 'in' });
    expect(holdVerdictOf(reading(80), hold, now)).toEqual({ kind: 'in' });
    expect(holdVerdictOf(reading(88), hold, now)).toBeNull();

    const germinating = [{ metric: 'temperature' as const, value: 25, band: 1 }];
    const dry = values().map(value => (value.metric === 'humidity' ? { ...value, value: 58 } : value));
    const judged = { ...place, values: dry, setpoints: germinating, verdict: { metrics: [] } as never };
    expect(statusOf(judged, now).kind).toBe('good');
    expect(statusOf({ ...judged, humidifierHold: hold }, now)).toEqual({ kind: 'off', metric: 'humidity', high: false, delta: 17 });
  });

  it('says control is switched off before any alarm or reading it explains, and after a silence or a maintenance window', () => {
    const alert = {
      alertId: 'a',
      kind: 'threshold' as const,
      severity: 'critical' as const,
      startedAt: ago(5),
      value: 31,
      metric: 'temperature' as const,
      name: 'Too warm',
    };
    const hot = values().map(value => (value.metric === 'temperature' ? { ...value, value: 28 } : value));
    const quiet = { until: ago(-10), alarmsUntil: ago(-20), parked: true };

    expect(statusOf({ ...place, values: hot, openAlerts: [alert], controlOff: true }, now).kind).toBe('controlOff');
    expect(statusOf({ ...place, quiet, controlOff: true }, now).kind).toBe('maintenance');
    expect(statusOf({ ...place, values: values(30), controlOff: true }, now).kind).toBe('offline');
  });

  /**
   * The Timeline's bands are what the controller aimed at, change by change and
   * in the mode it ran - the record the status line is judged by too - so a
   * tile's curve draws them as they came. Only a curve with no band at all
   * borrows what the controller holds now, as one climate where it holds one.
   */
  it('bands a tile´s curve by the record the status line is judged by, and borrows today´s targets only where it has none', () => {
    const recorded = {
      metric: 'humidity' as const,
      points: [],
      targets: [
        {
          startsAt: ago(3000),
          endsAt: ago(0),
          phaseId: 'phase-1',
          stage: 'vegetative' as const,
          day: { setpoint: 62, band: { low: 57, high: 67 } },
          night: { setpoint: 58, band: { low: 53, high: 63 } },
          held: 'schedule' as const,
        },
      ],
    };
    const now = {
      day: [{ metric: 'humidity' as const, value: 62, band: 5 }],
      night: [{ metric: 'humidity' as const, value: 58, band: 5 }],
    };

    const [from, to] = [ago(1440), ago(0)];
    expect(judgedPanel(recorded, now, from, to)).toBe(recorded);
    const bare = { ...recorded, targets: [] };
    expect(judgedPanel(bare, now, from, to)?.targets).toEqual([
      {
        startsAt: from,
        endsAt: to,
        phaseId: null,
        stage: null,
        day: { setpoint: 62, band: { low: 57, high: 67 } },
        night: { setpoint: 58, band: { low: 53, high: 63 } },
      },
    ]);
    // A drying room's one climate is drawn through the whole day.
    const drying = { day: [], night: [{ metric: 'humidity' as const, value: 58, band: 5 }] };
    expect(judgedPanel(bare, drying, from, to, 'drying')?.targets[0]).toMatchObject({ day: null, held: 'drying' });
    // A place that holds no targets keeps whatever the Timeline drew.
    expect(judgedPanel(bare, null, from, to)).toBe(bare);
    expect(judgedPanel(bare, { day: [], night: [] }, from, to)).toBe(bare);
  });

  it('leaves out an output the device never reported, and a CO₂ valve the firmware never opens', () => {
    const live = deviceLive({ heater: undefined });

    expect(outputsFor(fridge(), live, [], 'temperature').map(state => state.word)).toEqual(['compressor']);
    expect(outputsFor(fridge({ state: { hardware: { co2: 'off' } } as never }), live, [], 'co2')).toEqual([]);
  });
});
