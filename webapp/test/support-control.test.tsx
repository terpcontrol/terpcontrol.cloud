import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '@fg2/shared-types/v1';
import { Control } from '@/screens/control/Control';
import { ControlTab } from '@/screens/place/ControlTab';
import { SIGNED_IN, spacePage, spaceWhere } from './session';

/**
 * Steuerung of a customer's place, read by support. The administrator's own
 * device list holds none of the customer's devices, and the tab used to say
 * there was nothing here to steer and offer to add a device; it shows the
 * customer's targets now, read only.
 */

vi.mock('@/api/session', async importOriginal => ({
  ...(await importOriginal<object>()),
  useSession: () => ({ ...SIGNED_IN, user: { ...SIGNED_IN.user!, isAdmin: true } }),
}));

const CUSTOMER: Device = {
  id: 'device-9',
  type: 'fridge',
  name: 'fridge',
  ownerId: 'user-9',
  spaceId: 'space-customer',
  firmware: { channel: 'manual', targetId: null },
  configuration: {
    daynight: { day: 6 * 3600, night: 18 * 3600 },
    day: { temperature: 25, humidity: 60 },
    night: { temperature: 21, humidity: 55 },
    co2: { target: 900 },
    lights: { limit: 80 },
    workmode: 'small',
  },
  control: { running: true, drying: false, mode: 'standard', energySaving: false },
  settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0, ppfdLuxFactor: 0.015 },
  state: { lastSeenAt: new Date().toISOString(), hardware: {}, maintenanceUntil: null },
} as unknown as Device;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
  // The administrator's own account: one place of its own and no device at all.
  if (path === '/spaces') return json(spacePage(spaceWhere('own')));
  if (path === '/devices') return json({ items: [], nextCursor: null });
  if (path === '/spaces/space-customer/overview') return json({ spaceId: 'space-customer', name: 'Kundenzelt', deviceIds: ['device-9'] });
  if (path === '/home') return json({ spaces: [], grows: [], tasks: [], layers: { diary: false } });
  if (path === '/devices/device-9') return json(CUSTOMER);
  if (path === '/devices/device-9/plan') return json({ status: 404, code: 'plan_not_found', title: 'Not found', detail: '', errors: [] }, 404);
  return json({ items: [], nextCursor: null });
});

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => vi.stubGlobal('fetch', fetchStub));
afterEach(() => vi.unstubAllGlobals());

describe('Steuerung of a customer´s place, read by support', () => {
  it('shows the customer´s targets read only rather than offering to add a device', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <Control spaceId="space-customer" sub={null} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Targets')).toBeInTheDocument();
    const day = await screen.findByRole('spinbutton', { name: 'Day temperature' });
    expect(day).toHaveValue('25');
    expect(day).toBeDisabled();
    expect(screen.getByText('This session may look and not set.')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing stands here yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a device' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  /** The tab picked the place from the administrator's own home, found none, and said there was nothing to steer. */
  it('opens the tab on the customer´s place the address names, said to be somebody else´s', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/control?space=space-customer']}>
          <Routes>
            <Route path="/control/:page?" element={<ControlTab />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: /Control · Kundenzelt/ })).toHaveTextContent("support view of a customer's place");
    expect(await screen.findByRole('spinbutton', { name: 'Day temperature' })).toHaveValue('25');
    expect(screen.queryByText(/Nothing to control yet/)).not.toBeInTheDocument();
  });
});
