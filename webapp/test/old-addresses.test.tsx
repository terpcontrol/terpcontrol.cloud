import { screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DevicePage } from '@fg2/shared-types/v1';
import { OldDevice } from '@/app/OldAddresses';
import { screens } from '@/app/routes';
import { drawAt, json } from './harness';
import { translate } from './translations';

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

beforeAll(() => translate());

beforeEach(() => {
  devices.items = [fridge()];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ items: devices.items, nextCursor: null } satisfies DevicePage)),
  );
});

function Landed() {
  const location = useLocation();
  return <p>Landed on {`${location.pathname}${location.search}`}</p>;
}

const draw = (at: string) =>
  drawAt(
    <Routes>
      <Route path="/device/:deviceId/:page?" element={<OldDevice />} />
      <Route path="*" element={<Landed />} />
    </Routes>,
    { at },
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

  /** A bookmark of the old charts page kept the whole view in its address, and opens on the same view rather than on the default day. */
  it('keeps what an old charts bookmark asked for', async () => {
    draw(
      '/device/sim-fridge-1/charts?measures=temperature,out_light,out_fan-internal,logs,image,day&timespan=1w&interval=15m&vpdMode=night&autoUpdate=true&logs=x',
    );
    const landed = new URL((await screen.findByText(/Landed on/)).textContent!.replace('Landed on ', ''), 'http://app');

    expect(landed.pathname).toBe('/charts');
    expect(Object.fromEntries(landed.searchParams)).toEqual({
      space: 'space-9',
      range: '7d',
      show: 'temperature,out.light,out.fanInternal',
      msgs: '1',
      cam: '1',
      vpd: 'night',
      live: '1',
      step: '900',
    });
  });

  it('opens a stretch the old page was dated to: two dates as the zoom, one as where the timespan started', async () => {
    draw('/device/sim-fridge-1/charts?timespan=1d&date=2026-09-20T10:00:00.000Z&dateEnd=2026-09-21T16:00:00.000Z');
    expect(await screen.findByText(/zoom=2026-09-20T10%3A00%3A00.000Z%7E2026-09-21T16%3A00%3A00.000Z/)).toBeInTheDocument();
  });

  it('ends a window the old page dated by its start where that timespan ran out', async () => {
    draw('/device/sim-fridge-1/charts?timespan=1d&date=2026-09-20T10:00:00.000Z');
    expect(await screen.findByText('Landed on /charts?space=space-9&range=24h&at=2026-09-21T10%3A00%3A00.000Z')).toBeInTheDocument();
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
