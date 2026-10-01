import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, HomeSpaceCard } from '@fg2/shared-types/v1';
import { api } from '@/api/client';
import { LogProvider } from '@/log/LogProvider';
import { SpaceCard } from '@/screens/home/SpaceCard';
import { spaceWhere } from './session';

/**
 * The Home card's maintenance: what used to read "Alarms off 25 min" and in
 * fact parked the heater, the dehumidifier and the CO2 valve. It says what it
 * is now, asks before it sends, sends the device command rather than writing a
 * diary line, and is not offered where nothing would hear it or nothing would
 * stop.
 *
 * Liveness is read against the wall clock, so the card and its devices are
 * dated by it.
 */

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn(), upload: vi.fn() },
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
    state: { lastSeenAt: ago(0.3), hardware: {}, maintenanceUntil: null, ...over },
  }) as unknown as Device;

const card = (minutesOld: number): HomeSpaceCard => ({
  spaceId: 'space-1',
  name: 'Fridge 1',
  kind: 'fridge',
  roomId: null,
  deviceIds: ['device-1'],
  values: [{ metric: 'temperature', value: 25.1, measuredAt: ago(minutesOld), state: minutesOld < 2 ? 'live' : 'offline' }],
  setpoints: [],
  trend: null,
  grow: null,
  entries: [],
  latestStill: null,
  dueTasks: [],
  openAlerts: [],
});

const answer = { devices: [fridge()] };

const draw = (minutesOld = 0.3) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LogProvider>
          <SpaceCard card={card(minutesOld)} people={[]} now={DateTime.now()} compact={false} />
        </LogProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  answer.devices = [fridge()];
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/devices') return Promise.resolve({ items: answer.devices, nextCursor: null }) as never;
    if (path === '/spaces') return Promise.resolve({ items: [spaceWhere('own')], nextCursor: null }) as never;
    if (path === '/home') return Promise.resolve({ spaces: [], followedGrows: [], people: [] }) as never;

    return Promise.resolve({ items: [], nextCursor: null }) as never;
  });
  vi.mocked(api.post).mockReset();
  vi.mocked(api.post).mockResolvedValue({ publishedAt: DateTime.now().toISO(), deviceOnline: true } as never);
});

describe('maintenance on the Home card', () => {
  it('says what it is and what it does, asks first, and sends the device command rather than a diary line', async () => {
    draw();

    const button = await screen.findByRole('button', { name: /^Maintenance · 15 min/ });
    expect(button).toHaveTextContent('Pause control and alarms');
    expect(screen.queryByText(/Alarms off/)).not.toBeInTheDocument();

    fireEvent.click(button);
    const asked = await screen.findByRole('dialog', { name: 'Maintenance · 15 minutes' });
    expect(within(asked).getByText(/stops the heater, the compressor and the CO₂ valve/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.click(within(asked).getByRole('button', { name: 'Start maintenance' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 900 }));
    expect(api.post).not.toHaveBeenCalledWith('/entries', expect.anything());
  });

  it('is not offered while the place is offline', async () => {
    answer.devices = [fridge({ lastSeenAt: ago(30) })];
    draw(30);

    // The card has drawn the rest of what it offers by then.
    expect(await screen.findByRole('button', { name: /Photo/ })).toBeInTheDocument();
    await expect(screen.findByRole('button', { name: /^Maintenance/ }, { timeout: 400 })).rejects.toThrow();
  });

  /** A plug parks nothing, so a place with only a plug has no regulation for maintenance to pause. */
  it('is not offered where nothing standing there parks anything', async () => {
    answer.devices = [fridge({}, 'plug')];
    draw();

    expect(await screen.findByRole('button', { name: /Photo/ })).toBeInTheDocument();
    await expect(screen.findByRole('button', { name: /^Maintenance/ }, { timeout: 400 })).rejects.toThrow();
  });

  it('says until when a standing window holds, and offers its end', async () => {
    answer.devices = [fridge({ maintenanceUntil: DateTime.now().plus({ minutes: 9 }).toISO()! })];
    draw();

    const button = await screen.findByRole('button', { name: /^Maintenance until \d\d:\d\d/ });
    expect(button).toHaveTextContent('Control and alarms paused');

    fireEvent.click(button);
    const asked = await screen.findByRole('dialog', { name: 'Maintenance · 15 minutes' });
    fireEvent.click(within(asked).getByRole('button', { name: 'End now' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/devices/device-1/commands', { kind: 'maintenance', forSeconds: 0 }));
  });
});
