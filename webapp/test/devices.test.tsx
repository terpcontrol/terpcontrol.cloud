import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, DeviceCapabilities, Socket } from '@fg2/shared-types/v1';
import { SocketRow } from '@/screens/devices/SocketRow';
import { defaultHold, holdsFor, rowsOf } from '@/screens/devices/sockets';
import { cameraFreshness } from '@/screens/devices/cameras';
import type { OverrideRequest } from '@/api/devices';

/**
 * The Devices tab's one moving part: the switch on a socket row.
 *
 * A tap forces the row the other way, a tap while something is forcing it hands
 * it back, and a build that takes no override is drawn disabled rather than
 * pretending. What a command answered is said underneath and never mistaken for
 * the row having changed: a row changes when the device says it did.
 */

const sent: OverrideRequest[] = [];
const state = vi.hoisted(() => ({ answer: { deviceOnline: true } as { deviceOnline: boolean } | undefined }));

vi.mock('@/api/devices', async importOriginal => ({
  ...(await importOriginal<object>()),
  useSetOverride: () => ({
    mutate: (request: OverrideRequest) => sent.push(request),
    data: state.answer,
    error: null,
    isPending: false,
  }),
  useTestSocket: () => ({ mutate: () => {}, data: undefined, error: null, isPending: false }),
}));

const NOW = DateTime.fromISO('2026-09-19T12:00:00.000Z');

const CAPABILITIES: DeviceCapabilities = {
  socketOverride: true,
  socketTimer: true,
  lightOverride: true,
  roles: ['heater', 'light', 'pump'],
  pulseSeconds: { heater: 300, light: 1800 },
};

const socket = (over: Partial<Socket> = {}): Socket => ({
  slot: 0,
  role: 'heater',
  hardwareId: '5BAD22AB0B99',
  address: '10.0.0.63',
  state: 'off',
  override: null,
  timer: null,
  stateChangedAt: NOW.minus({ minutes: 4 }).toISO()!,
  ...over,
});

const draw = (one: Socket, capabilities = CAPABILITIES, refusal: string | null = null, mayManage = true, unheard: string | null = null) => {
  const [row] = rowsOf([one], { ...capabilities, lightOverride: false });

  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SocketRow
          row={row}
          deviceId="device-1"
          capabilities={capabilities}
          refusal={refusal}
          unheard={unheard}
          mayManage={mayManage}
          runs={null}
          now={NOW}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  sent.length = 0;
  state.answer = { deviceOnline: true };
});

describe('the switch on a socket row', () => {
  it('forces the row the other way, for a time the role allows', () => {
    draw(socket());

    fireEvent.click(screen.getByRole('switch', { name: 'Force Heater' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'on', forSeconds: 3600 }]);
  });

  it('hands the row back to its role while something is forcing it', () => {
    draw(socket({ state: 'on', override: { state: 'on', validUntil: NOW.plus({ minutes: 42 }).toISO()! } }));

    expect(screen.getByText(/forced on · 42 min/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Force Heater' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'auto', forSeconds: 0 }]);
  });

  it('says a command went out and never that the socket switched', () => {
    draw(socket());

    fireEvent.click(screen.getByRole('switch', { name: 'Force Heater' }));

    expect(screen.getByRole('status')).toHaveTextContent('Asked. The device reports back within half a minute.');
    expect(screen.getByRole('switch', { name: 'Force Heater' })).toHaveAttribute('aria-checked', 'false');
  });

  it('says so when nobody was listening', () => {
    state.answer = { deviceOnline: false };
    draw(socket());

    expect(screen.getByRole('status')).toHaveTextContent('Nobody was listening');
  });

  it('is drawn disabled when the build takes no override', () => {
    draw(socket(), { ...CAPABILITIES, socketOverride: false }, 'This build takes no override.');

    expect(screen.getByRole('switch', { name: 'Force Heater' })).toBeDisabled();
  });

  it('is not drawn at all for somebody who may only look', () => {
    draw(socket(), CAPABILITIES, null, false);

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('off')).toBeInTheDocument();
  });

  it('offers the three-way where the device does not say what the row is doing', () => {
    draw(socket({ state: 'unknown' }));

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'on' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'on', forSeconds: 3600 }]);
  });

  it('says a socket has stopped answering, and since when', () => {
    draw(socket({ state: 'unknown', stateChangedAt: NOW.minus({ minutes: 7 }).toISO()! }));

    expect(screen.getByText(/no answer · 7 min/)).toBeInTheDocument();
  });

  it('still offers to find a socket on a build that is too old to hold one', () => {
    draw(socket(), { ...CAPABILITIES, socketOverride: false }, 'This build takes no override.');

    fireEvent.click(screen.getByRole('button', { name: /What Heater is/ }));

    expect(screen.getByRole('button', { name: 'Find it' })).toBeEnabled();
  });

  it('refuses to find a socket only where nobody is listening', () => {
    draw(socket(), CAPABILITIES, 'Offline', true, 'Offline');

    fireEvent.click(screen.getByRole('button', { name: /What Heater is/ }));

    expect(screen.getByRole('button', { name: 'Find it' })).toBeDisabled();
  });

  it('opens the times, the address and the way back when the row is opened', () => {
    draw(socket({ state: 'on', override: { state: 'on', validUntil: NOW.plus({ hours: 1 }).toISO()! } }));

    fireEvent.click(screen.getByRole('button', { name: /What Heater is/ }));

    expect(screen.getByText('10.0.0.63')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to auto' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '15 min' }));

    expect(sent).toEqual([{ deviceId: 'device-1', target: { kind: 'socket', slot: 0 }, state: 'off', forSeconds: 900 }]);
  });
});

describe('what a row is made of', () => {
  it("puts the controller's own light output above the table, and only where the build takes one", () => {
    expect(rowsOf([socket()], CAPABILITIES).map(row => row.key)).toEqual(['output-light', 'socket-0-heater']);
    expect(rowsOf([socket()], { ...CAPABILITIES, lightOverride: false }).map(row => row.key)).toEqual(['socket-0-heater']);
  });

  it('leaves the output row out for somebody who may only look, because it carries nothing but a switch', () => {
    expect(rowsOf([socket()], CAPABILITIES, false).map(row => row.key)).toEqual(['socket-0-heater']);
  });

  it('offers every hold whatever the role, because the pulse is a failsafe and not a minimum', () => {
    // `pulseSeconds` is the time after the last command at which the socket
    // switches itself off, so a role that carries one is held no differently
    // from a role that does not.
    const holds = [900, 3600, 4 * 3600, 8 * 3600, 86400];

    expect(holdsFor(CAPABILITIES, 'light')).toEqual(holds);
    expect(holdsFor(CAPABILITIES, 'pump')).toEqual(holds);
    expect(defaultHold(CAPABILITIES, 'light')).toBe(3600);
  });
});

describe('how late a camera is', () => {
  const camera = (lastStillAt: string | null, stillIntervalSeconds = 30): Camera =>
    ({ stillIntervalSeconds, state: { lastStillAt, lastError: null, firmwareVersion: null } }) as Camera;

  it('is judged against the camera´s own interval and not against a reading´s two minutes', () => {
    expect(cameraFreshness(camera(NOW.minus({ seconds: 45 }).toISO()!), NOW)).toBe('live');
    expect(cameraFreshness(camera(NOW.minus({ seconds: 45 }).toISO()!, 10), NOW)).toBe('stale');
    expect(cameraFreshness(camera(NOW.minus({ minutes: 10 }).toISO()!), NOW)).toBe('offline');
    expect(cameraFreshness(camera(null), NOW)).toBe('offline');
  });
});
