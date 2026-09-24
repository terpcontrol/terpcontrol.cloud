import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminStats, Camera, Device, DeviceClass, Firmware, Fleet as FleetAnswer, User } from '@fg2/shared-types/v1';
import { Rail } from '@/app/shell/Rail';
import { LogProvider } from '@/log/LogProvider';
import { AdminOnly } from '@/screens/admin/AdminOnly';
import { FirmwareScreen } from '@/screens/admin/Firmware';
import { Fleet } from '@/screens/admin/Fleet';
import { filteredRows, fleetRows, NO_FILTER } from '@/screens/admin/fleet-rows';
import { staged } from '@/screens/admin/rollout';
import { Users } from '@/screens/admin/Users';
import { ThemeProvider } from '@/theme/ThemeProvider';

/**
 * The fleet screens, which are the one part of the app that is not for growers.
 *
 * Three things matter more than the rest and are checked hardest. The first is
 * that an account which is not an administrator is shown no way in and, if it
 * follows a link anyway, is told so rather than shown a page that fails to
 * load. The second is the table's arithmetic: the chips are what an operator
 * narrows a fleet with, and a filter that quietly kept the wrong rows would be
 * read as the fleet itself. The third is the rollout, where the body that goes
 * on the wire is asserted field by field - it reaches hardware standing in
 * somebody's tent, and the contract is the only thing that says what it may
 * contain.
 *
 * The health card is the fourth: it is where whoever runs the install learns
 * that something has quietly stopped, so what it draws when the install's own
 * figures arrive, when the retention pass is null, and when that read fails
 * while the fleet answered are each checked - a figure nobody computed must
 * not appear, and a pass that has not happened must not read as a zero.
 *
 * The fetch is stubbed by route rather than the hooks being mocked, so what is
 * asserted about a write is the body that went on the wire.
 */

const session = vi.hoisted(() => ({ who: 'admin' as 'admin' | 'grower' }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');
  const original = await importOriginal<object>();
  const ADMIN = { ...SIGNED_IN, user: { ...SIGNED_IN.user!, id: 'user-1', handle: 'chris', isAdmin: true } };
  const seats = { admin: ADMIN, grower: SIGNED_IN };

  return { ...original, useSession: () => seats[session.who] };
});

const NOW = DateTime.now();

const CLASS: DeviceClass = {
  id: 'class-controller',
  createdAt: NOW.minus({ years: 1 }).toISO()!,
  name: 'controller',
  description: 'FG Controller 2.0',
  concurrentUpdates: 5,
  maxFailures: 10,
  firmwareIds: { stable: 'build-1', beta: null, alpha: null },
  rollout: { paused: false, percent: 100 },
};

const BUILD: Firmware = {
  id: 'build-1',
  createdAt: NOW.minus({ months: 1 }).toISO()!,
  classId: 'class-controller',
  name: 'Spring build',
  version: '0b1d8a2e-6a1f-4a0a-9f5a-2a0d9c1b7e31',
  wasStable: true,
};

const device = (over: Partial<Device> & { id: string }): Device => ({
  createdAt: NOW.minus({ months: 6 }).toISO()!,
  type: 'controller',
  classId: 'class-controller',
  serialNumber: 7,
  ownerId: 'user-2',
  spaceId: 'space-1',
  name: null,
  firmware: { channel: 'stable', targetId: null },
  configuration: null,
  settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
  isDemo: false,
  state: {
    lastSeenAt: NOW.minus({ seconds: 20 }).toISO()!,
    claimedAt: NOW.minus({ months: 6 }).toISO()!,
    firmwareId: 'build-1',
    updateStartedAt: null,
    updateEndedAt: null,
    updateFailedAt: null,
    maintenanceUntil: null,
    hardware: { sockets_n: '6' },
    socketStateChangedAt: {},
    socketsReportedAt: null,
  },
  ...over,
});

const DEVICES: Device[] = [
  device({ id: 'tc-7f3a', name: 'Tent 1' }),
  device({
    id: 'fg-1102',
    type: 'fridge',
    name: 'Fridge 1',
    ownerId: 'user-3',
    state: { ...device({ id: 'x' }).state, lastSeenAt: NOW.minus({ days: 3 }).toISO()!, firmwareId: 'build-old', hardware: {} },
  }),
  device({ id: 'tc-00d4', ownerId: null, spaceId: null, state: { ...device({ id: 'x' }).state, lastSeenAt: null, firmwareId: null } }),
];

const PEOPLE: User[] = [
  {
    id: 'user-2',
    createdAt: NOW.minus({ years: 1 }).toISO()!,
    email: 'mo@example.invalid',
    isAdmin: false,
    isActive: true,
    activationCode: null,
    handle: 'mo',
    bio: null,
    avatarMediaId: null,
    publicProfile: false,
    privacy: { hideWeights: false, hideCounts: false },
    preferences: { units: { temperature: 'celsius', weight: 'grams', volume: 'liters' }, locale: 'en', timezone: 'UTC' },
    retention: { climateDays: null },
    notifications: {
      channels: { email: null, telegram: null, webhook: null },
      routing: { alerts: [], warnings: [], tasks: [], plan: [], weekly_timelapse: [] },
      quietHours: null,
      mutedUntil: null,
    },
    deletionStartedAt: null,
  },
];

const FLEET: FleetAnswer = {
  classes: [
    {
      classId: 'class-controller',
      name: 'controller',
      total: 3,
      online: 1,
      rollout: { paused: false, percent: 100 },
      firmwares: [
        {
          firmwareId: 'build-1',
          version: BUILD.version,
          name: BUILD.name,
          total: 2,
          online: 1,
          updating: 0,
          failed: 0,
          averageUpdateMs: null,
          maxUpdateMs: null,
        },
      ],
    },
  ],
  unclassifiedDevices: 1,
};

const camera = (over: Partial<Camera> & { id: string }): Camera => ({
  createdAt: NOW.minus({ months: 2 }).toISO()!,
  ownerId: 'user-2',
  kind: 'terpcam_controller',
  deviceId: 'tc-7f3a',
  spaceId: 'space-1',
  name: 'Cam',
  looksAt: null,
  plantIds: [],
  did: null,
  uid: null,
  ip: null,
  url: null,
  transport: null,
  tunnel: false,
  model: null,
  stillIntervalSeconds: 30,
  nightOff: false,
  maintenanceOff: false,
  logErrors: false,
  staleWarning: true,
  entitlement: { validUntil: null, grant: null, tier: 'premium', renewalVisible: false },
  isDemo: false,
  removedAt: null,
  state: { lastStillAt: NOW.minus({ seconds: 40 }).toISO()!, lastError: null, firmwareVersion: '1.2.0' },
  ...over,
});

/** A pass from last night, so that its hour is what the card draws and its age is at least a day short of two. */
const LAST_NIGHT = NOW.minus({ days: 1 }).startOf('day').set({ hour: 3 });

const STATS: AdminStats = {
  collectedAt: NOW.minus({ seconds: 20 }).toISO()!,
  users: { total: 2, active: 2, admins: 1 },
  devices: { total: 4, claimed: 3, online: 1, updating: 0 },
  cameras: { total: 11, entitled: 11, stale: 4 },
  content: { spaces: 3, grows: 5, publicGrows: 1, plants: 12, entries: 400, media: 9000, mediaBytes: 2_254_857_830 },
  renders: { queued: 3, rendering: 1, failed: 0 },
  retention: { ranAt: LAST_NIGHT.toISO()!, reached: 143, devices: 96, days: 12, errors: 0 },
  alarmWatch: { ranAt: NOW.minus({ seconds: 30 }).toISO()!, devices: 223, unjudged: 0, failures: 0, failedAt: null },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The reader's own controller: the one row whose cams the account-scoped camera list can count. */
const MINE: Device = device({ id: 'tc-mine', name: 'My tent', ownerId: 'user-1' });

const server = {
  wrote: [] as { method: string; path: string; body: unknown }[],
  asked: [] as string[],
  devices: DEVICES,
  // What the accounts, fleet, stats and camera routes answer; a test that
  // needs a different install swaps these before drawing. The cameras are
  // pages, because the screen is expected to follow them.
  people: PEOPLE,
  fleet: FLEET,
  stats: (() => json(STATS)) as () => Response,
  cameras: [[]] as Camera[][],
};

const NOT_FOUND = { status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] };
const BROKEN = { status: 500, code: 'internal', title: 'Something went wrong', detail: '', errors: [] };

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = String(input).replace(/^.*\/v1/, '');
  const method = init?.method ?? 'GET';
  const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;

  if (method !== 'GET') {
    server.wrote.push({ method, path, body });
    return json({});
  }

  server.asked.push(path);
  if (path.startsWith('/admin/fleet')) return json(server.fleet);
  if (path.startsWith('/admin/stats')) return server.stats();
  if (path.startsWith('/admin/devices')) return json({ items: server.devices, nextCursor: null });
  if (path.startsWith('/admin/users')) return json({ items: server.people, nextCursor: null });
  if (path.startsWith('/admin/device-classes')) return json({ items: [CLASS], nextCursor: null });
  if (path.startsWith('/admin/firmwares')) return json({ items: [BUILD], nextCursor: null });
  if (path.startsWith('/cameras')) {
    const cursor = new URL(String(input), 'http://stub.invalid').searchParams.get('cursor');
    const at = cursor ? Number(cursor.replace('page-', '')) : 0;
    return json({ items: server.cameras[at] ?? [], nextCursor: at + 1 < server.cameras.length ? `page-${at + 1}` : null });
  }
  if (path.startsWith('/alerts')) return json({ items: [], nextCursor: null });

  return json(NOT_FOUND, 404);
}) as unknown as typeof fetch;

const wrapped = (node: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter>
        <ThemeProvider>{node}</ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8')) as Record<string, unknown>;
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.who = 'admin';
  server.wrote = [];
  server.asked = [];
  server.people = PEOPLE;
  server.fleet = FLEET;
  server.stats = () => json(STATS);
  server.devices = DEVICES;
  server.cameras = [[]];
});

afterEach(() => vi.unstubAllGlobals());

describe('the way in', () => {
  it('gives an administrator the four fleet screens on the rail, and nobody a tab for them', () => {
    wrapped(
      <LogProvider>
        <Rail />
      </LogProvider>,
    );

    const links = screen.getAllByRole('link').map(link => link.getAttribute('href'));
    expect(links).toContain('/admin/fleet');
    expect(links).toContain('/admin/firmware');
    expect(links).toContain('/admin/users');
    expect(links).toContain('/admin/demo');
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('shows an ordinary account no admin section at all', () => {
    session.who = 'grower';
    wrapped(
      <LogProvider>
        <Rail />
      </LogProvider>,
    );

    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).not.toContain('/admin/fleet');
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('answers an account that follows the link anyway with the reason, and asks the server for nothing', () => {
    session.who = 'grower';
    wrapped(
      <AdminOnly>
        <Fleet />
      </AdminOnly>,
    );

    expect(screen.getByText('Not for this account')).toBeInTheDocument();
    expect(server.asked).toHaveLength(0);
  });
});

describe('a window too narrow for a table a dozen columns wide', () => {
  it('says so to an administrator on a phone rather than folding the screen into a column', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    wrapped(
      <AdminOnly>
        <Fleet />
      </AdminOnly>,
    );

    expect(screen.getByText('Made for a wide window')).toBeInTheDocument();
    expect(server.asked).toHaveLength(0);
  });
});

describe('the fleet table', () => {
  const drawFleet = async () => {
    wrapped(
      <AdminOnly>
        <Fleet />
      </AdminOnly>,
    );
    await screen.findByText('tc-7f3a');
  };

  it('counts the whole install in the heading, and the loaded rows under the table', async () => {
    await drawFleet();

    // Three devices in the one class plus the one in no class, and what the
    // server said is online - never a count of the rows that happen to be here.
    expect(screen.getByText('4 devices · 1 online')).toBeInTheDocument();
    expect(screen.getByText(/showing 3 of 3 loaded · 4 devices on this install/)).toBeInTheDocument();
  });

  it("follows the camera list past its first page, so a standalone cam on the second page is a row and the reader's own cams are counted whole", async () => {
    server.devices = [...DEVICES, MINE];
    server.cameras = [
      [camera({ id: 'cam-1', deviceId: 'tc-mine', ownerId: 'user-1' })],
      [camera({ id: 'cam-a41c', kind: 'terpcam_standalone', deviceId: null, name: 'standalone' })],
    ];
    await drawFleet();

    expect(await screen.findByText('cam-a41c')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(within(rows.find(row => within(row).queryByText('tc-mine'))!).getByText('6 · 1')).toBeInTheDocument();
    // Somebody else's controller: the account's camera list cannot count its cams, so the cell says nothing rather than zero.
    expect(within(rows.find(row => within(row).queryByText('tc-7f3a'))!).getByText('6 · —')).toBeInTheDocument();
    expect(screen.getByText(/cams and the camera rows are the ones this account can see/)).toBeInTheDocument();
    // Every camera read asks for the biggest page there is, and the second hands the cursor back.
    const cameraReads = server.asked.filter(path => path.startsWith('/cameras'));
    expect(cameraReads.length).toBeGreaterThanOrEqual(2);
    expect(cameraReads.every(path => path.includes('limit=200'))).toBe(true);
    expect(cameraReads.some(path => path.includes('cursor=page-1'))).toBe(true);
    expect(screen.queryByText(/on no row/)).not.toBeInTheDocument();
  });

  it('names the owner by handle, says unclaimed where there is none, and never ranks a build', async () => {
    await drawFleet();

    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('@mo')).toBeInTheDocument();
    expect(screen.getByText('unclaimed')).toBeInTheDocument();
    // The build is drawn under the name it was registered with, and the row for
    // a build this install has no record of keeps the opaque id.
    expect(screen.getAllByText('Spring build').length).toBeGreaterThan(0);
    expect(screen.getByText('build-old')).toBeInTheDocument();
  });

  it('narrows to one type, to what has been quiet for a day, and to what is not on stable', async () => {
    await drawFleet();

    fireEvent.click(screen.getByRole('button', { name: 'Quiet over a day' }));
    expect(screen.queryByText('tc-7f3a')).not.toBeInTheDocument();
    expect(screen.getByText('fg-1102')).toBeInTheDocument();
    expect(screen.getByText('tc-00d4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Quiet over a day' }));
    fireEvent.change(screen.getByLabelText('Device type'), { target: { value: 'fridge' } });
    expect(screen.getByText('fg-1102')).toBeInTheDocument();
    expect(screen.queryByText('tc-7f3a')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Device type'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Not on stable' }));
    expect(screen.queryByText('tc-7f3a')).not.toBeInTheDocument();
    expect(screen.getByText('fg-1102')).toBeInTheDocument();
  });

  it('searches what is on the row - the id, the name and the owner - and nothing that is not', async () => {
    await drawFleet();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '@mo' } });
    expect(screen.getByText('tc-7f3a')).toBeInTheDocument();
    expect(screen.queryByText('fg-1102')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Fridge 1' } });
    expect(screen.getByText('fg-1102')).toBeInTheDocument();
    expect(screen.queryByText('tc-7f3a')).not.toBeInTheDocument();
  });

  it('says what a search that matches nothing was looking for, and what the search reads, where the rows were', async () => {
    await drawFleet();

    // The tent a device stands in is exactly what the search does not read,
    // and what an operator with twenty tents types first.
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Blue Dream' } });
    expect(screen.queryByText('tc-7f3a')).not.toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText(/No device matches "Blue Dream"/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/not the place it stands in/)).toBeInTheDocument();

    // One press shows everything again, the search included.
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Show everything' }));
    expect(screen.getByText('tc-7f3a')).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toHaveValue('');
  });

  it('pauses a class with exactly the body the contract names, and nothing else', async () => {
    await drawFleet();

    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0].method).toBe('PATCH');
    expect(server.wrote[0].path).toBe('/admin/device-classes/class-controller');
    // `DeviceClassUpdate` carries the rollout whole - there is one rollout per
    // class and it is never anything but this pair - and no other field is sent.
    expect(server.wrote[0].body).toEqual({ rollout: { paused: true, percent: 100 } });
  });

  it('says what pausing would do before it is pressed', async () => {
    await drawFleet();

    expect(screen.getByText(/No further device of this class is told to update/)).toBeInTheDocument();
    expect(screen.getByText(/Staged at 100 %, which is about 3 of 3 devices/)).toBeInTheDocument();
  });

  /**
   * The table is paged and the class is not: a stage counted off the devices
   * this browser happens to hold would have told an administrator it reached
   * sixteen while the heading beside it said twenty-four, which is the sort of
   * arithmetic somebody acts on and then finds they had not.
   */
  it('counts the stage against the whole class, not the page of devices loaded', async () => {
    server.fleet = { ...FLEET, classes: [{ ...FLEET.classes[0], total: 24, online: 11 }] };
    await drawFleet();

    expect(screen.getByText(/24 devices · 11 online/)).toBeInTheDocument();
    expect(screen.getByText(/Staged at 100 %, which is about 24 of 24 devices/)).toBeInTheDocument();
  });
});

describe('the health card', () => {
  const drawFleet = async () => {
    wrapped(
      <AdminOnly>
        <Fleet />
      </AdminOnly>,
    );
    await screen.findByText('tc-7f3a');
  };

  it("draws the board's figures from the install's own answer, in its order, and calls the liveness what it is", async () => {
    await drawFleet();

    // Devices heard from, the picture bucket, the composer's queue - and never
    // a broker connection count, which is not this server's to give.
    expect(await screen.findByText(/^1 online · pictures 2\.1 GB · 3 renders queued ·$/)).toBeInTheDocument();
    expect(screen.getByText('0 failed')).toBeInTheDocument();
    expect(screen.queryByText(/MQTT \d|\d connected/)).not.toBeInTheDocument();

    // The pass from last night: its hour, its age, how far it got, and its errors as their own figure.
    expect(screen.getByText(/^Retention ran 03:00 · \d+ (h|d) ago · 143 devices reached ·$/)).toBeInTheDocument();
    expect(screen.getByText('0 errors')).toBeInTheDocument();

    // And the watchdog's own pass beside it, which is the line that says whether an offline alarm would be raised at all.
    expect(screen.getByText(/^Offline watch ran \d\d:\d\d · \d+ s ago · 223 devices watched ·$/)).toBeInTheDocument();
    expect(screen.getByText('0 not judged · 0 failed passes')).toBeInTheDocument();

    // The camera count is the install's total, not the length of the loaded list, which is empty here.
    expect(screen.getByText('11 cameras · 4 delivering nothing')).toBeInTheDocument();
    expect(screen.getByText(/figures as of \d+ s ago/)).toBeInTheDocument();

    // What is still not answered is named, and what now is has left the sentence.
    const closing = screen.getByText(/Not here because this install answers no figure for them yet/);
    expect(closing).toHaveTextContent(/time-series database/);
    expect(closing).toHaveTextContent(/MQTT connections/);
    expect(closing).not.toHaveTextContent(/retention/);
    expect(closing).not.toHaveTextContent(/picture bucket/);
  });

  it('says nobody has swept since this server started when the pass is null, and never draws that as a zero', async () => {
    server.stats = () => json({ ...STATS, retention: null });
    await drawFleet();

    expect(await screen.findByText('No retention pass since this server started')).toBeInTheDocument();
    expect(screen.queryByText(/0 errors/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Retention ran/)).not.toBeInTheDocument();
  });

  /**
   * The state pass 7 found the restored install in: the watchdog had failed
   * every one of a hundred and seventy-five passes and nothing on any screen
   * said so, while the alerts inbox reported that nothing had gone wrong. The
   * card is what has to say it, so it draws the failures with no pass to date
   * rather than falling silent along with the loop.
   */
  it('says the offline watch has completed no pass, and counts the ones that failed', async () => {
    server.stats = () => json({ ...STATS, alarmWatch: { ranAt: null, devices: 0, unjudged: 0, failures: 175, failedAt: NOW.toISO()! } });
    await drawFleet();

    expect(await screen.findByText('No offline-alarm pass has completed since this server started ·')).toBeInTheDocument();
    expect(screen.getByText('0 not judged · 175 failed passes')).toBeInTheDocument();
    expect(screen.queryByText(/Offline watch ran/)).not.toBeInTheDocument();
  });

  /** A pass that completed over a store that would not answer for part of the fleet: those devices are named, not counted as calm. */
  it('counts the devices a completed pass could not vouch for', async () => {
    server.stats = () => json({ ...STATS, alarmWatch: { ...STATS.alarmWatch, devices: 223, unjudged: 218 } });
    await drawFleet();

    expect(await screen.findByText('218 not judged · 0 failed passes')).toBeInTheDocument();
  });

  it("keeps the table and the lines counted from the fleet when the install's figures cannot be read, and names what is missing with them", async () => {
    server.stats = () => json(BROKEN, 500);
    await drawFleet();

    expect(await screen.findByText("Could not read the install's own figures.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // Nothing that only the stats route answers is drawn from anything else.
    expect(screen.queryByText(/pictures \d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/renders queued/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Retention ran|No retention pass/)).not.toBeInTheDocument();
    // The fleet answer's own lines stay, and the closing line says what went with the failed read.
    expect(screen.getByText('0 installing · 0 gave up')).toBeInTheDocument();
    expect(screen.getByText('1 device in no class, which no rollout reaches')).toBeInTheDocument();
    expect(screen.getByText(/Nor, until they are read: devices online/)).toBeInTheDocument();
    expect(screen.getByText('4 devices · 1 online')).toBeInTheDocument();
  });

  it('tells an administrator of an older server that the route is not there, rather than that the read failed', async () => {
    server.stats = () => json(NOT_FOUND, 404);
    await drawFleet();

    expect(await screen.findByText(/This server does not answer its own figures yet/)).toBeInTheDocument();
    // The account's own camera list never stands in for the install's count.
    expect(screen.queryByText(/delivering nothing/)).not.toBeInTheDocument();
    expect(screen.getByText(/Nor, until they are read:.*the camera count/)).toBeInTheDocument();
  });
});

describe('the staged rollout, on the screen that has the builds in front of it', () => {
  it('writes nothing until it is applied, and then only the field that changed', async () => {
    wrapped(
      <AdminOnly>
        <FirmwareScreen />
      </AdminOnly>,
    );
    await screen.findByText('Device classes');

    // stable, beta, alpha, and the class the register form is pointed at.
    const [, beta] = screen.getAllByRole('combobox');
    fireEvent.change(beta, { target: { value: 'build-1' } });
    expect(server.wrote).toHaveLength(0);

    // What it would reach, before it is pressed and again in the sheet.
    expect(screen.getAllByText(/beta will point at Spring build/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply the change' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0].method).toBe('PATCH');
    expect(server.wrote[0].path).toBe('/admin/device-classes/class-controller');
    // `DeviceClassUpdate` is partial, and a class is one document: the rollout,
    // the pace and the failure limit were not touched, so they are not sent.
    expect(server.wrote[0].body).toEqual({ firmwareIds: { stable: 'build-1', beta: 'build-1', alpha: null } });
  });

  it('refuses to delete a build a channel still points at, with the reason the server would give', async () => {
    wrapped(
      <AdminOnly>
        <FirmwareScreen />
      </AdminOnly>,
    );
    await screen.findByText('Spring build');

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByText('A channel still points at this build. Point it elsewhere first.')).toBeInTheDocument();
  });
});

describe('the accounts', () => {
  it('resets a password without sending anything else, and says whose account it is', async () => {
    wrapped(
      <AdminOnly>
        <Users />
      </AdminOnly>,
    );
    await screen.findByText('@mo');

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(await screen.findByText(/This is somebody else's account: @mo/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a new one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0].method).toBe('PATCH');
    expect(server.wrote[0].path).toBe('/admin/users/user-2');
    expect(server.wrote[0].body).toEqual({ password: 'a new one' });
  });

  it('keeps an address out of every request it makes, the search included', async () => {
    wrapped(
      <AdminOnly>
        <Users />
      </AdminOnly>,
    );
    await screen.findByText('@mo');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'mo@example.invalid' } });

    expect(screen.getByText('mo@example.invalid')).toBeInTheDocument();
    expect(server.asked.some(path => path.includes('@') || path.includes('example'))).toBe(false);
  });
});

describe('the counts', () => {
  it('puts one device and one admin in the singular, and the rest in the plural', async () => {
    server.fleet = { classes: [{ ...FLEET.classes[0], total: 1, online: 1 }], unclassifiedDevices: 0 };
    server.people = [{ ...PEOPLE[0], id: 'user-1', handle: 'chris', email: 'chris@example.invalid', isAdmin: true }, PEOPLE[0]];

    wrapped(
      <AdminOnly>
        <Fleet />
      </AdminOnly>,
    );
    await screen.findByText('tc-7f3a');
    // Once in the heading, once in the rollout card's block for the class.
    expect(screen.getAllByText('1 device · 1 online')).toHaveLength(2);

    wrapped(
      <AdminOnly>
        <Users />
      </AdminOnly>,
    );
    await screen.findByText('@chris');
    expect(screen.getByText('2 accounts · 1 admin · 0 not activated')).toBeInTheDocument();
  });
});

describe("the administrator's own row", () => {
  const ME: User = { ...PEOPLE[0], id: 'user-1', handle: 'chris', email: 'chris@example.invalid', isAdmin: true };
  const OTHER_ADMIN: User = { ...PEOPLE[0], id: 'user-9', handle: 'mandy', email: 'mandy@example.invalid', isAdmin: true };

  const drawUsers = async () => {
    wrapped(
      <AdminOnly>
        <Users />
      </AdminOnly>,
    );
    await screen.findByText('@chris');
    return screen.getAllByRole('row');
  };

  it('never offers the flip that would leave the install with no administrator at all', async () => {
    server.people = [ME, PEOPLE[0]];
    const rows = await drawUsers();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Change' }));
    expect(await screen.findByText('This is your own account.')).toBeInTheDocument();
    expect(screen.getByLabelText('May run this install')).toBeDisabled();
    expect(screen.getByLabelText('Active')).toBeDisabled();
    expect(screen.getByText(/the only administrator this install has/)).toBeInTheDocument();
  });

  it('asks before taking its own rights away, names what is lost, and writes nothing until the question is answered', async () => {
    server.people = [ME, OTHER_ADMIN];
    const rows = await drawUsers();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Change' }));
    const box = await screen.findByLabelText('May run this install');
    expect(box).toBeEnabled();
    fireEvent.click(box);
    expect(screen.getByText(/the Admin section is gone for you the moment this is saved/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(server.wrote).toHaveLength(0);
    expect(await screen.findByText('Change your own account?')).toBeInTheDocument();

    // Back keeps the draft; the second press is the one that writes.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByLabelText('May run this install')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save anyway' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0].method).toBe('PATCH');
    expect(server.wrote[0].path).toBe('/admin/users/user-1');
    expect(server.wrote[0].body).toEqual({ isAdmin: false });
  });

  it("changes somebody else's rights without a question, as before", async () => {
    server.people = [ME, OTHER_ADMIN];
    const rows = await drawUsers();

    fireEvent.click(within(rows[2]).getByRole('button', { name: 'Change' }));
    fireEvent.click(await screen.findByLabelText('May run this install'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(server.wrote).toHaveLength(1));
    expect(server.wrote[0].body).toEqual({ isAdmin: false });
  });

  it('tells the truth about what deletion leaves behind, and that the configured account is kept', async () => {
    server.people = [ME, PEOPLE[0]];
    const rows = await drawUsers();

    fireEvent.click(within(rows[2]).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/What they wrote in other people's spaces stays there and loses their name/)).toBeInTheDocument();
    expect(screen.queryByText(/the server keeps it/)).not.toBeInTheDocument();
    // The prompt is set in small caps and a phone capitalises the first
    // letter, so the handle counts however it is cased.
    fireEvent.change(screen.getByLabelText('Type mo to confirm'), { target: { value: 'Mo' } });
    expect(screen.getByRole('button', { name: 'Delete the account' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/the server keeps it/)).toBeInTheDocument();
  });
});

describe('the arithmetic behind the table', () => {
  const rows = () =>
    fleetRows({
      devices: DEVICES,
      cameras: [],
      classes: [CLASS],
      firmwares: [BUILD],
      people: new Map(PEOPLE.map(one => [one.id, one])),
      readerId: 'user-1',
    });

  it('puts the hardware heard from most recently first, and the one that never spoke last', () => {
    expect(rows().map(row => row.id)).toEqual(['tc-7f3a', 'fg-1102', 'tc-00d4']);
  });

  it('reads the socket count off what the device itself reported, and leaves it out where no build reported one', () => {
    expect(rows().map(row => row.sockets)).toEqual([6, null, 6]);
  });

  it('counts a device with no class as neither behind nor on stable, so a filter never claims it is either', () => {
    const noClass = filteredRows(
      fleetRows({
        devices: [device({ id: 'sim-1', classId: null })],
        cameras: [],
        classes: [CLASS],
        firmwares: [BUILD],
        people: new Map(),
        readerId: null,
      }),
      { ...NO_FILTER, behind: true },
      NOW,
    );

    expect(noClass).toHaveLength(0);
  });

  it('works a stage out as the share of a count, which is what an operator is weighing', () => {
    expect(staged(10, 118)).toBe(12);
    expect(staged(0, 118)).toBe(0);
    expect(staged(100, 118)).toBe(118);
  });
});
