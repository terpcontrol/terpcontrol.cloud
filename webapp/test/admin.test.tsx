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
import type { Camera, Device, DeviceClass, Firmware, Fleet as FleetAnswer, User } from '@fg2/shared-types/v1';
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

const CAMERAS: Camera[] = [];

const server = {
  wrote: [] as { method: string; path: string; body: unknown }[],
  asked: [] as string[],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const NOT_FOUND = { status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] };

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = String(input).replace(/^.*\/v1/, '');
  const method = init?.method ?? 'GET';
  const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;

  if (method !== 'GET') {
    server.wrote.push({ method, path, body });
    return json({});
  }

  server.asked.push(path);
  if (path.startsWith('/admin/fleet')) return json(FLEET);
  if (path.startsWith('/admin/devices')) return json({ items: DEVICES, nextCursor: null });
  if (path.startsWith('/admin/users')) return json({ items: PEOPLE, nextCursor: null });
  if (path.startsWith('/admin/device-classes')) return json({ items: [CLASS], nextCursor: null });
  if (path.startsWith('/admin/firmwares')) return json({ items: [BUILD], nextCursor: null });
  if (path.startsWith('/cameras')) return json({ items: CAMERAS, nextCursor: null });
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
    expect(screen.getByText(/showing 3 of 3 loaded · 4 on this install/)).toBeInTheDocument();
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

  it('draws no figure the server does not answer, and says which those are', async () => {
    await drawFleet();

    expect(screen.queryByText(/InfluxDB|MQTT 1|renders queued/)).not.toBeInTheDocument();
    expect(screen.getByText(/Not here because this install answers no figure for them yet/)).toBeInTheDocument();
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

describe('the arithmetic behind the table', () => {
  const rows = () =>
    fleetRows({ devices: DEVICES, cameras: CAMERAS, classes: [CLASS], firmwares: [BUILD], people: new Map(PEOPLE.map(one => [one.id, one])) });

  it('puts the hardware heard from most recently first, and the one that never spoke last', () => {
    expect(rows().map(row => row.id)).toEqual(['tc-7f3a', 'fg-1102', 'tc-00d4']);
  });

  it('reads the socket count off what the device itself reported, and leaves it out where no build reported one', () => {
    expect(rows().map(row => row.sockets)).toEqual([6, null, 6]);
  });

  it('counts a device with no class as neither behind nor on stable, so a filter never claims it is either', () => {
    const noClass = filteredRows(
      fleetRows({ devices: [device({ id: 'sim-1', classId: null })], cameras: [], classes: [CLASS], firmwares: [BUILD], people: new Map() }),
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
