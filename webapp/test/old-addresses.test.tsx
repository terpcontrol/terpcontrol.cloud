import { screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, DevicePage } from '@fg2/shared-types/v1';
import { OldDevice } from '@/app/OldAddresses';
import { screens } from '@/app/routes';
import { deviceWith } from './fixtures';
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

const fridge = (over: Partial<Device> = {}): Device =>
  deviceWith({ id: 'sim-fridge-1', type: 'fridge', classId: 'class-fridge', serialNumber: 7, spaceId: 'space-9', ...over });

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
    ['charts', '/timeline?space=space-9'],
    ['diary', '/timeline?space=space-9'],
    ['settings', '/control?space=space-9'],
    ['testmode', '/control?space=space-9'],
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

    // The curves it ticked - the outputs as the strips they are now, the log as the diary's lines - over its week,
    // at its step. The picture stands in the cursor's card and a window that ends now follows it, so neither is asked.
    expect(landed.pathname).toBe('/timeline');
    expect(Object.fromEntries(landed.searchParams)).toEqual({
      space: 'space-9',
      range: '7d',
      show: 'temperature,light,outputs,diary,machine',
      vpd: 'night',
      step: '900',
    });
  });

  it('opens a width the chips do not name as that width up to now', async () => {
    draw('/device/sim-fridge-1/charts?timespan=6h');
    expect(await screen.findByText('Landed on /timeline?space=space-9&last=21600')).toBeInTheDocument();
  });

  it('opens a stretch the old page was dated to: two dates as the window, one as where the timespan started', async () => {
    draw('/device/sim-fridge-1/charts?timespan=1d&date=2026-09-20T10:00:00.000Z&dateEnd=2026-09-21T16:00:00.000Z');
    const zoomed = new URL((await screen.findByText(/Landed on/)).textContent!.replace('Landed on ', ''), 'http://app');
    expect(Object.fromEntries(zoomed.searchParams)).toEqual({ space: 'space-9', from: '2026-09-20T10:00:00.000Z', to: '2026-09-21T16:00:00.000Z' });
  });

  it('ends a window the old page dated by its start where that timespan ran out', async () => {
    draw('/device/sim-fridge-1/charts?timespan=1d&date=2026-09-20T10:00:00.000Z');
    const dated = new URL((await screen.findByText(/Landed on/)).textContent!.replace('Landed on ', ''), 'http://app');
    expect(Object.fromEntries(dated.searchParams)).toEqual({ space: 'space-9', from: '2026-09-20T10:00:00.000Z', to: '2026-09-21T10:00:00.000Z' });
  });

  it('lands on Steuerung for a device the account cannot see', async () => {
    draw('/device/somebody-elses/charts');
    expect(await screen.findByText('Landed on /control')).toBeInTheDocument();
  });
});

describe('the old app’s own pages inside the session', () => {
  it.each([
    ['list', '/'],
    ['account', '/me/account'],
    ['shares', '/grows/share-links'],
  ])('/%s is sent on to %s', (path, to) => {
    const route = screens.find(one => one.path === path);
    expect(route?.element).toMatchObject({ props: { to, replace: true } });
  });
});
