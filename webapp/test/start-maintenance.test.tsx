import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, SpaceOverview } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { LogProvider } from '@/log/LogProvider';
import { PlaceStart } from '@/screens/start/PlaceStart';
import { drawAt } from './harness';
import { spaceWhere } from './session';
import { translate } from './translations';

/**
 * Maintenance on Start, one of the two places it is started from: one line,
 * "Maintenance · 15 min", that starts a quarter of an hour with the tap -
 * no sheet, nothing to read first - sends the device command rather than
 * writing a diary line, and is not offered where nothing would hear it or
 * nothing would stop. While a window stands, the same spot says until when
 * and carries its end and another quarter of an hour, and the place's own
 * sentence leads there. The sheet with its lengths is the device's card's
 * (`devices.test.tsx`).
 *
 * Liveness is read against the wall clock, so the place and its devices are
 * dated by it.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

const ago = (minutes: number) => DateTime.now().minus({ minutes }).toISO()!;

const fridge = (over: Partial<Device['state']> = {}, type = 'fridge'): Device =>
  ({
    id: 'device-1',
    type,
    name: null,
    ownerId: 'user-1',
    spaceId: 'space-1',
    firmware: { channel: 'manual', targetId: null },
    configuration: null,
    state: { lastSeenAt: ago(0.3), hardware: {}, maintenanceUntil: null, ...over },
  }) as unknown as Device;

const place = (minutesOld: number): SpaceOverview =>
  ({
    spaceId: 'space-1',
    name: 'Fridge 1',
    kind: 'fridge',
    roomId: null,
    deviceIds: ['device-1'],
    values: [{ metric: 'temperature', value: 25.1, measuredAt: ago(minutesOld), state: minutesOld < 2 ? 'live' : 'offline' }],
    setpoints: [],
    climates: [],
    targets: null,
    verdict: { metrics: [], actuators: [] },
    grows: [],
    cameras: [],
    entries: [],
    events: [],
    readingNames: [],
    dueTasks: [],
    openAlerts: [],
    people: [],
  }) as unknown as SpaceOverview;

/** An account that is reached by mail and keeps no diary, so nothing else on the page asks for attention. */
const me = {
  id: 'user-1',
  email: 'login@example.org',
  preferences: { timezone: null, diary: 'off', notifyLaterUntil: null },
  notifications: {
    channels: { email: 'login@example.org', telegram: null, webhook: null },
    routing: { alerts: ['email'] },
    quietHours: null,
    mutedUntil: null,
  },
  pushSubscribed: false,
  layers: { diary: false },
};

const answer = { devices: [fridge()], minutesOld: 0.3 };

const draw = (minutesOld = 0.3) => {
  answer.minutesOld = minutesOld;
  return drawAt(
    <LogProvider>
      <PlaceStart spaceId="space-1" />
    </LogProvider>,
  );
};

beforeAll(() => translate());

beforeEach(() => {
  answer.devices = [fridge()];
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/devices') return Promise.resolve({ items: answer.devices, nextCursor: null }) as never;
    if (path === '/spaces') return Promise.resolve({ items: [spaceWhere('own')], nextCursor: null }) as never;
    if (path === '/me') return Promise.resolve(me) as never;
    if (path === '/devices/device-1/live') return Promise.resolve({ deviceId: 'device-1', metrics: {}, outputs: {}, setpoints: null }) as never;
    if (path === '/spaces/space-1/overview') return Promise.resolve(place(answer.minutesOld)) as never;
    if (path === '/spaces/space-1/live') return Promise.resolve({ ...place(answer.minutesOld), devices: [], cameras: [] }) as never;
    if (path === '/spaces/space-1/timeline')
      return Promise.resolve({ panels: [], nights: [], outputs: [], startsAt: ago(1440), endsAt: ago(0) }) as never;

    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue({ publishedAt: DateTime.now().toISO(), deviceOnline: true } as never);
});

describe('maintenance on Start', () => {
  it('starts a quarter of an hour with one tap, as the device command rather than a diary line', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Maintenance · 15 min' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 900 }));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalledWith('/entries', expect.anything());
    // Nothing asks first and nothing explains: the hand that tapped is on the zip.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says so where a device was not there to hear it', async () => {
    vi.mocked(api.post).mockResolvedValue({ publishedAt: DateTime.now().toISO(), deviceOnline: false } as never);
    draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Maintenance · 15 min' }));

    expect(await screen.findByText('A device could not be reached just now and may not have got the command.')).toBeInTheDocument();
  });

  it('is not offered while the place is offline', async () => {
    answer.devices = [fridge({ lastSeenAt: ago(30) })];
    draw(30);

    // The page has drawn the rest of what it offers by then.
    expect(await screen.findByRole('link', { name: 'Temperature' })).toBeInTheDocument();
    await expect(screen.findByRole('button', { name: /^Maintenance/ }, { timeout: 400 })).rejects.toThrow();
  });

  /** A plug parks nothing, so a place with only a plug has no regulation for maintenance to pause. */
  it('is not offered where nothing standing there parks anything', async () => {
    answer.devices = [fridge({}, 'plug')];
    draw();

    expect(await screen.findByRole('link', { name: 'Temperature' })).toBeInTheDocument();
    await expect(screen.findByRole('button', { name: /^Maintenance/ }, { timeout: 400 })).rejects.toThrow();
  });

  it('says until when a standing window holds at the same spot, and ends it there', async () => {
    answer.devices = [fridge({ maintenanceUntil: DateTime.now().plus({ minutes: 9 }).toISO()! })];
    draw();

    const control = await screen.findByRole('group', { name: 'Maintenance' });
    expect(control).toHaveTextContent(/^Maintenance until \d\d:\d\dControl and alarms pausedEndExtend$/);
    expect(screen.queryByRole('button', { name: /^Maintenance · 15/ })).not.toBeInTheDocument();
    // The sentence near the top says so too, and leads to where the window is ended.
    const sentence = within(screen.getByRole('status')).getByRole('link');
    expect(sentence).toHaveTextContent(/^Maintenance until \d\d:\d\d · regulation and alarms paused$/);
    expect(sentence).toHaveAttribute('href', '#start-maintenance');
    expect(control.parentElement).toHaveAttribute('id', 'start-maintenance');

    fireEvent.click(within(control).getByRole('button', { name: 'End' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 0 }));
  });

  it('extends a standing window by another quarter of an hour', async () => {
    answer.devices = [fridge({ maintenanceUntil: DateTime.now().plus({ minutes: 9 }).toISO()! })];
    draw();

    fireEvent.click(within(await screen.findByRole('group', { name: 'Maintenance' })).getByRole('button', { name: 'Extend' }));

    // What is left of the window and fifteen minutes more, counted from now as the device counts it.
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const [, command] = vi.mocked(api.post).mock.calls[0] as [string, { kind: string; forSeconds: number }];
    expect(command.kind).toBe('maintenance');
    expect(command.forSeconds).toBeGreaterThan(24 * 60 - 5);
    expect(command.forSeconds).toBeLessThanOrEqual(24 * 60);
  });
});
