import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '@fg2/shared-types/v1';
import { Control } from '@/screens/control/Control';
import { ControlTab } from '@/screens/place/ControlTab';
import { drawDevicePages } from './device-pages';
import { drawAt, json } from './harness';
import { SIGNED_IN, spacePage, spaceWhere } from './session';
import { Toast } from './toast';
import { translate } from './translations';

/**
 * Steuerung of a customer's place, read by support. The administrator's own
 * device list holds none of the customer's devices, and the tab used to say
 * there was nothing here to steer and offer to add a device; it shows the
 * customer's targets now, read only: figures, and nothing that writes.
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

const fetchStub = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/v1/, '');
  // The administrator's own account: one place of its own and no device at all.
  if (path === '/spaces') return json(spacePage(spaceWhere('own')));
  if (path === '/devices') return json({ items: [], nextCursor: null });
  if (path === '/spaces/space-customer/overview') return json({ spaceId: 'space-customer', name: 'Kundenzelt', deviceIds: ['device-9'] });
  if (path === '/home') return json({ spaces: [], grows: [], tasks: [], layers: { diary: false } });
  if (path === '/devices/device-9') return json(CUSTOMER);
  if (path === '/devices/device-9/plan') return json({ status: 404, code: 'plan_not_found', title: 'Not found', detail: '', errors: [] }, 404);
  if (path === '/devices/device-9/sockets') {
    return json({
      items: [],
      nextCursor: null,
      capabilities: { socketOverride: true, socketTimer: true, lightOverride: true, roles: [], pulseSeconds: {} },
    });
  }
  return json({ items: [], nextCursor: null });
});

beforeAll(() => translate());

beforeEach(() => vi.stubGlobal('fetch', fetchStub));
afterEach(() => vi.unstubAllGlobals());

describe('Steuerung of a customer´s place, read by support', () => {
  it('shows the customer´s targets read only rather than offering to add a device', async () => {
    drawAt(
      <Toast>
        <Control spaceId="space-customer" sub={null} />
      </Toast>,
    );

    expect(await screen.findByRole('table', { name: 'Targets' })).toHaveTextContent('25.0 °C');
    expect(screen.getByText('This session can look but not change anything.')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing stands here yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a device' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Change|^Preset|the light limit$|Add a device/ })).not.toBeInTheDocument();
  });

  /** The tab picked the place from the administrator's own home, found none, and said there was nothing to steer. */
  it('opens the tab on the customer´s place the address names, said to be somebody else´s', async () => {
    drawAt(
      <Toast>
        <Routes>
          <Route path="/control/:page?" element={<ControlTab />} />
        </Routes>
      </Toast>,
      { at: '/control?space=space-customer' },
    );

    expect(await screen.findByRole('heading', { name: /Control · Kundenzelt/ })).toHaveTextContent("support view of a customer's place");
    expect(await screen.findByRole('table', { name: 'Targets' })).toHaveTextContent('25.0 °C');
    expect(screen.queryByText(/Nothing to control yet/)).not.toBeInTheDocument();
  });
});

/**
 * A page under Steuerung that could not be read stood under Steuerung's title, without its own name or the way
 * back; and Steuerung waited for its places without a title at all.
 */
describe('Steuerung while its places are read, and when they cannot be', () => {
  const page = (at: string) =>
    drawAt(
      <Toast>
        <Routes>
          <Route path="/control" element={<ControlTab />} />
          <Route path="/control/:page" element={<ControlTab />} />
        </Routes>
      </Toast>,
      { at },
    );

  it('keeps a page´s own name and its way back where the server is not reached, and Steuerung its title', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    page('/control/alarms?space=space-1');
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/^No connection to the server/);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Alarms');
    expect(screen.getByRole('link', { name: 'Back to Control' })).toHaveAttribute('href', '/control?space=space-1');
  });

  it('keeps the name of a page under a device, and the way back to the device, where the device cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    drawDevicePages('/devices/device-9/advanced');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Advanced');
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(/^No connection to the server/);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Advanced');
    expect(screen.getByRole('link', { name: 'Back: Device' })).toHaveAttribute('href', '/devices/device-9');
  });

  it('says its title while it waits', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    const { unmount } = page('/control');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Control');
    unmount();
    page('/control/plan?space=space-1');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Grow plan');
  });
});
