import { DateTime } from 'luxon';
import { vi } from 'vitest';
import type { AccessNeed, Device, DeviceLive, Entry, HomeAnswer, HomeSpaceCard, Me, SpaceOverview, SpaceTimeline } from '@fg2/shared-types/v1';
import { json } from './harness';
import { spacePage, spaceWhere } from './session';

/**
 * A place as the server answers it, for the suites that draw Start: a fridge
 * module that is fine, its overview, what it reports live, a day of curves,
 * and the wire they are read through. Everything is dated against the real
 * clock, because the page ages its readings by it, and the account is kept in
 * UTC so the hours a test writes are the hours drawn.
 */

export const ago = (minutes: number) => DateTime.now().minus({ minutes }).toUTC().toISO()!;
export const hhmm = (iso: string) => DateTime.fromISO(iso).toUTC().toFormat('HH:mm');

export const fridge = (over: Partial<Device> = {}): Device =>
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

export const values = (minutesOld = 0.3): SpaceOverview['values'] => {
  const state = minutesOld < 2 ? 'live' : 'offline';
  return [
    { metric: 'temperature', value: 25.1, measuredAt: ago(minutesOld), state },
    { metric: 'humidity', value: 61, measuredAt: ago(minutesOld), state },
    { metric: 'co2', value: 880, measuredAt: ago(minutesOld), state },
    { metric: 'vpd', value: 1.03, measuredAt: ago(minutesOld), state },
  ];
};

export const setpoints: SpaceOverview['setpoints'] = [
  { metric: 'temperature', value: 25, band: 1 },
  { metric: 'humidity', value: 60, band: 5 },
  { metric: 'co2', value: 900, band: 200 },
];

export const entry = (id: string, over: Partial<Entry>): Entry => ({
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

export const reboot = (id: string, minutes: number) =>
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

export const overviewOf = (over: Partial<SpaceOverview> = {}): SpaceOverview => ({
  spaceId: 'space-1',
  name: 'Fridge 1',
  climates: [],
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
  events: [],
  readingNames: [],
  dueTasks: [],
  openAlerts: [],
  people: [{ id: 'user-1', handle: 'you' }],
  ...over,
});

/** A grow standing in the place, flowering on day 29. */
export const growOf = (over: Partial<SpaceOverview['grows'][number]> = {}): SpaceOverview['grows'][number] =>
  ({
    growId: 'grow-1',
    name: 'Spring run',
    type: 'photoperiod',
    dayNumber: 29,
    phaseDay: 15,
    stageWeek: 3,
    stage: 'flowering',
    stagesReached: ['vegetative', 'flowering'],
    preset: null,
    isAuto: false,
    plantCount: 3,
    strains: ['Blue Dream'],
    coverMediaId: null,
    stageGroups: [],
    weekNumber: 5,
    placedAt: ago(29 * 1440),
    placedOnDay: 1,
    ...over,
  }) as SpaceOverview['grows'][number];

export const deviceLive = (over: Partial<DeviceLive['outputs']> = {}): DeviceLive => ({
  deviceId: 'device-1',
  pending: null,
  metrics: {},
  outputs: {
    dehumidifier: { value: 1, measuredAt: ago(0.2), state: 'live' },
    heater: { value: 0, measuredAt: ago(0.2), state: 'live' },
    co2: { value: 0, measuredAt: ago(0.2), state: 'live' },
    light: { value: 65, measuredAt: ago(0.2), state: 'live' },
    ...over,
  },
  // `transition: null` is the device saying it is not between its halves. Left
  // out, the schedule's ramps decide that instead, and a fridge is gliding to
  // the night for the last quarter of an hour before 18:00 UTC.
  setpoints: { day: { temperature: 25, humidity: 60, co2: 900 }, night: { temperature: 21, humidity: 55 }, active: 'day', transition: null },
});

/** A day at an hour to the point; in one of them a door stood open, which its mean hardly shows and its lowest sample does. */
const curve = (from: number, step: number) =>
  Array.from({ length: 24 }, (_, index) => ({
    measuredAt: ago(24 * 60 - index * 60),
    value: from + (index % 3) * step,
    ...(index === 12 ? { min: from - 4, max: from + 2 * step } : {}),
  }));

export const timeline = (): SpaceTimeline =>
  ({
    spaceId: 'space-1',
    range: '24h',
    startsAt: ago(24 * 60),
    endsAt: ago(0),
    stepSeconds: 180,
    panels: [
      { metric: 'temperature', points: curve(24.6, 0.3), targets: [] },
      { metric: 'humidity', points: curve(58, 2), targets: [] },
    ],
    nights: [{ startsAt: ago(20 * 60), endsAt: ago(8 * 60) }],
    transitions: [],
    alarms: [],
    outputs: [],
    events: [],
    cameras: [],
    grows: [],
  }) as unknown as SpaceTimeline;

/** The account: whether it keeps a diary, what it said about one, and whether a mail address takes its alarms. */
export const meOf = (diary: boolean, over: { email?: string | null; preferences?: Record<string, unknown> } = {}): Me =>
  ({
    id: 'user-1',
    email: 'login@example.org',
    handle: 'you',
    preferences: { timezone: 'UTC', timezoneChosen: true, locale: 'en', diary: null, notifyLaterUntil: null, ...over.preferences },
    notifications: {
      channels: { email: over.email ?? null, telegram: null, webhook: null },
      routing: over.email ? { alerts: ['email'], tasks: ['email'], camera: ['email'] } : {},
      quietHours: null,
      mutedUntil: null,
    },
    pushSubscribed: false,
    layers: { diary },
  }) as unknown as Me;

/** A place's card on the home, as the several-places Start reads it. */
export const cardOf = (over: Partial<HomeSpaceCard> = {}): HomeSpaceCard => ({
  spaceId: 'space-1',
  name: 'Fridge 1',
  kind: 'fridge',
  roomId: null,
  deviceIds: ['device-1'],
  values: values(),
  setpoints,
  climates: [],
  trend: null,
  grow: null,
  entries: [],
  events: [],
  latestStill: null,
  dueTasks: [],
  openAlerts: [],
  ...over,
});

export const homeOf = (spaces: HomeSpaceCard[], diary = false): HomeAnswer => ({
  spaces,
  followedGrows: [],
  people: [{ id: 'user-1', handle: 'you' }],
  layers: { diary },
});

/** What the stubbed server answers; a test sets what it is about and `resetServer` puts the rest back. */
export const server = {
  me: meOf(false),
  youMay: 'own' as AccessNeed,
  /** The spaces the account lists; left empty, the one place and a second for the pickers. */
  spaces: null as ReturnType<typeof spaceWhere>[] | null,
  /** The account's own places that have ended, as `?archived=true` lists them. */
  ended: [] as ReturnType<typeof spaceWhere>[],
  devices: [fridge()],
  live: deviceLive(),
  home: null as HomeAnswer | null,
  /** Whether the home is answered at all: false is a connection that is gone, and the request fails without an answer. */
  reachable: true,
  /** A status the home answers with in place of its cards: a server that is there and at fault. */
  fault: null as number | null,
  overviews: new Map<string, SpaceOverview>(),
  /** The plan the device runs, as its route answers it; none answers that there is none. */
  plan: null as Record<string, unknown> | null,
  /** What is waiting on the task list: reminders due and plan steps to confirm. */
  tasks: [] as Record<string, unknown>[],
  /** The grows the pickers and the grow page read. */
  grows: [] as Record<string, unknown>[],
  /** One grow as its own route answers it, by id: where its feeding scheme is. */
  grow: new Map<string, Record<string, unknown>>(),
  /** Every request the page sent, as "METHOD /path". */
  calls: [] as string[],
  /** The bodies of what it wrote, by "METHOD /path". */
  bodies: new Map<string, unknown>(),
};

export const resetServer = () => {
  server.me = meOf(false);
  server.youMay = 'own';
  server.spaces = null;
  server.ended = [];
  server.devices = [fridge()];
  server.live = deviceLive();
  server.home = null;
  server.reachable = true;
  server.fault = null;
  server.overviews = new Map();
  server.plan = null;
  server.tasks = [];
  server.grows = [];
  server.grow = new Map();
  server.calls = [];
  server.bodies = new Map();
};

export const writes = () => server.calls.filter(call => !call.startsWith('GET '));

export const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const { pathname, searchParams } = new URL(String(input), 'http://localhost');
  const path = pathname.replace(/^\/v1/, '');
  const method = init?.method ?? 'GET';
  server.calls.push(`${method} ${path}`);

  if (method !== 'GET') {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    server.bodies.set(`${method} ${path}`, body);
    if (method === 'DELETE') return new Response(null, { status: 204 });
    if (path === '/me') return json({ ...server.me, preferences: { ...server.me.preferences, ...(body as { preferences?: object }).preferences } });
    if (path === '/grows') return json({ id: 'grow-new', ...(body as object) });
    return json({ id: 'made', ...(body as object) });
  }

  if (path === '/me') return json(server.me);
  if (path === '/spaces' && searchParams.get('archived') === 'true') return json(spacePage(...server.ended));
  if (path === '/spaces')
    return json(spacePage(...(server.spaces ?? [spaceWhere(server.youMay), spaceWhere(server.youMay, { id: 'space-2', name: 'Tent 2' })])));
  if (path === '/devices') return json({ items: server.devices, nextCursor: null });
  const one = /^\/devices\/([^/]+)$/.exec(path);
  if (one) return json(server.devices.find(device => device.id === one[1]));
  if (/^\/devices\/[^/]+\/live$/.test(path)) return json(server.live);
  if (/^\/devices\/[^/]+\/plan$/.test(path))
    return server.plan ? json(server.plan) : json({ status: 404, code: 'plan_not_found', title: 'No plan', detail: '', errors: [] }, 404);
  if (/^\/spaces\/[^/]+\/timeline$/.test(path)) return json(timeline());
  if (path === '/tasks') return json({ items: server.tasks, nextCursor: null });
  if (path === '/grows') return json({ items: server.grows, nextCursor: null });
  const grow = /^\/grows\/([^/]+)$/.exec(path);
  if (grow && server.grow.has(grow[1])) return json(server.grow.get(grow[1]));
  if (path === '/home') {
    if (!server.reachable) return Promise.reject(new TypeError('Failed to fetch'));
    if (server.fault) return json({ status: server.fault, code: 'unexpected', title: 'Internal Server Error', detail: '', errors: [] }, server.fault);
    return server.home ? json(server.home) : json({ status: 503, code: 'unavailable', title: 'Unavailable', detail: '', errors: [] }, 503);
  }
  const overview = /^\/spaces\/([^/]+)\/overview$/.exec(path);
  if (overview) {
    const found = server.overviews.get(overview[1]);
    return found ? json(found) : json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
  }
  const live = /^\/spaces\/([^/]+)\/live$/.exec(path);
  if (live && server.overviews.has(live[1])) return json({ ...server.overviews.get(live[1])!, devices: [], cameras: [] });

  return json({ items: [], nextCursor: null });
});
