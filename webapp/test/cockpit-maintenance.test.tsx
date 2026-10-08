import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, SpaceOverview } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { LogProvider } from '@/log/LogProvider';
import { PlaceCockpit } from '@/screens/cockpit/PlaceCockpit';
import { drawAt } from './harness';
import { spaceWhere } from './session';
import { translate } from './translations';

/**
 * The cockpit's maintenance: what used to read "Alarms off 25 min" and in fact
 * parked the heater, the dehumidifier and the CO2 valve. It says what it is
 * now, asks before it sends, sends the device command rather than writing a
 * diary line, and is not offered where nothing would hear it or nothing would
 * stop. While a window stands, the page's own first sentence says so.
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
    targets: null,
    verdict: { metrics: [], actuators: [] },
    grows: [],
    cameras: [],
    entries: [],
    readingNames: [],
    dueTasks: [],
    openAlerts: [],
    people: [],
  }) as unknown as SpaceOverview;

const answer = { devices: [fridge()] };

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

const draw = (minutesOld = 0.3) =>
  drawAt(
    <LogProvider>
      <PlaceCockpit overview={place(minutesOld)} />
    </LogProvider>,
  );

beforeAll(() => translate());

beforeEach(() => {
  answer.devices = [fridge()];
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/devices') return Promise.resolve({ items: answer.devices, nextCursor: null }) as never;
    if (path === '/spaces') return Promise.resolve({ items: [spaceWhere('own')], nextCursor: null }) as never;
    if (path === '/me') return Promise.resolve(me) as never;
    if (path === '/devices/device-1/live') return Promise.resolve({ deviceId: 'device-1', metrics: {}, outputs: {}, setpoints: null }) as never;
    if (path === '/spaces/space-1/timeline')
      return Promise.resolve({ panels: [], nights: [], outputs: [], startsAt: ago(1440), endsAt: ago(0) }) as never;

    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue({ publishedAt: DateTime.now().toISO(), deviceOnline: true } as never);
});

describe('maintenance on the cockpit', () => {
  it('says what it is and what it does, asks first, and sends the device command rather than a diary line', async () => {
    draw();

    const button = await screen.findByRole('button', { name: /^Maintenance/ });
    expect(button).toHaveTextContent('Pause control and alarms');
    expect(screen.queryByText(/Alarms off/)).not.toBeInTheDocument();

    fireEvent.click(button);
    const asked = await screen.findByRole('dialog', { name: 'Maintenance' });
    // A quarter of an hour unless somebody picks longer.
    expect(within(asked).getByRole('button', { name: '15 min' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(asked).getByText(/For 15 minutes the device stops the heater, the compressor and the CO₂ valve/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(within(asked).getByRole('button', { name: 'Start maintenance' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 900 }));
    expect(api.post).not.toHaveBeenCalledWith('/entries', expect.anything());
  });

  it('runs as long as somebody picks - half an hour or an hour - and says so throughout', async () => {
    draw();

    fireEvent.click(await screen.findByRole('button', { name: /^Maintenance/ }));
    const asked = await screen.findByRole('dialog', { name: 'Maintenance' });
    fireEvent.click(within(asked).getByRole('button', { name: '60 min' }));

    expect(within(asked).getByText(/For 60 minutes the device stops/)).toBeInTheDocument();
    expect(within(asked).getByText(/Alarms stay off for 70 minutes – the 60 minutes and 10 more/)).toBeInTheDocument();
    fireEvent.click(within(asked).getByRole('button', { name: 'Start maintenance' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 3600 }));
    expect(await within(asked).findByText(/After 60 minutes everything carries on by itself; alarms come back after 70 minutes/)).toBeInTheDocument();
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

  it('says until when a standing window holds, and offers its end', async () => {
    answer.devices = [fridge({ maintenanceUntil: DateTime.now().plus({ minutes: 9 }).toISO()! })];
    draw();

    const button = await screen.findByRole('button', { name: /^Maintenance until \d\d:\d\d/ });
    expect(button).toHaveTextContent('Control and alarms paused');
    expect(screen.getByRole('status')).toHaveTextContent(/^Maintenance until \d\d:\d\d · regulation and alarms paused$/);

    fireEvent.click(button);
    const asked = await screen.findByRole('dialog', { name: 'Maintenance' });
    fireEvent.click(within(asked).getByRole('button', { name: 'End now' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 0 }));
  });
});
