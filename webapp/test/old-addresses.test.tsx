import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DevicePage } from '@fg2/shared-types/v1';
import { OldDevice } from '@/app/OldAddresses';
import { screens } from '@/app/routes';

/**
 * A bookmark of the old app's device pages, followed by somebody signed in:
 * each lands where the same thing is now, about the place the device stands in.
 */

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');
  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

const fridge = (over: Partial<Device> = {}): Device => ({
  id: 'sim-fridge-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  type: 'fridge',
  classId: 'class-fridge',
  serialNumber: 7,
  ownerId: 'user-1',
  spaceId: 'space-9',
  name: null,
  firmware: { channel: 'stable', targetId: null },
  configuration: null,
  settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
  control: null,
  isDemo: false,
  state: {
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    claimedAt: '2026-01-01T00:00:00.000Z',
    firmwareId: null,
    updateStartedAt: null,
    updateEndedAt: null,
    updateFailedAt: null,
    maintenanceUntil: null,
    hardware: {},
    socketStateChangedAt: {},
    socketsReportedAt: null,
  },
  ...over,
});

const devices = { items: [fridge()] };

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8')) as Record<string, unknown>;
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  devices.items = [fridge()];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items: devices.items, nextCursor: null } satisfies DevicePage), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
});

function Landed() {
  const location = useLocation();
  return <p>Landed on {`${location.pathname}${location.search}`}</p>;
}

const draw = (at: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/device/:deviceId/:page?" element={<OldDevice />} />
          <Route path="*" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('an old device page', () => {
  it.each([
    ['charts', '/charts?space=space-9'],
    ['diary', '/timeline?space=space-9'],
    ['settings', '/control?space=space-9'],
    ['testmode', '/devices?space=space-9'],
    ['', '/spaces/space-9'],
  ])('/%s lands on %s', async (page, landing) => {
    draw(`/device/sim-fridge-1/${page}`);
    expect(await screen.findByText(`Landed on ${landing}`)).toBeInTheDocument();
  });

  it('lands on the device list for a device the account cannot see', async () => {
    draw('/device/somebody-elses/charts');
    expect(await screen.findByText('Landed on /devices')).toBeInTheDocument();
  });
});

describe('the old app’s own pages inside the session', () => {
  it.each([
    ['list', '/'],
    ['account', '/me/account'],
    ['shares', '/me/share-links'],
  ])('/%s is sent on to %s', (path, to) => {
    const route = screens.find(one => one.path === path);
    expect(route?.element).toMatchObject({ props: { to, replace: true } });
  });
});
