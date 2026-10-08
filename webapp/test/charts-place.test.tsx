import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, SpaceSeries, TimelineTargets } from '@fg2/shared-types/v1';
import { Charts } from '@/screens/charts/Charts';
import { defaultPick, halfOf } from '@/screens/charts/cards';
import { categoryOf, columnsOf, nearestColumn } from '@/screens/charts/message-columns';
import { rangeOfSpan, stepped, windowOf, WIDTHS, zoomedIn } from '@/screens/charts/span';
import { drawAt } from './harness';
import { translate } from './translations';

/**
 * The charts page of a place, which is how every old chart comes back: a place
 * with no grow, any width from twenty minutes to three years, stepped back by
 * its own width or picked by date, zoomed, at the step somebody chose, the VPD
 * of one half of the day, what was written over the window, the picture at the
 * cursor, and a link to share it all.
 */

const NOW = DateTime.fromISO('2026-09-22T12:00:00.000Z');
const HOUR = 3600 * 1000;

const state = vi.hoisted(() => ({
  asked: [] as { path: string; query: Record<string, unknown> | undefined }[],
  posted: [] as { path: string; body: unknown }[],
  series: null as unknown,
  entries: [] as unknown[],
  home: null as unknown,
}));

vi.mock('@/api/client', () => ({
  api: {
    get: (path: string, query?: Record<string, unknown>) => {
      state.asked.push({ path, query });
      if (path.startsWith('/spaces/space-2/series')) {
        return Promise.resolve({
          ...(state.series as object),
          startsAt: query?.from,
          endsAt: query?.to,
          stepSeconds: Number(query?.stepSeconds) || 300,
        });
      }
      if (path === '/grows') return Promise.resolve({ items: [], nextCursor: null });
      if (path === '/spaces')
        return Promise.resolve({ items: [{ id: 'space-2', name: 'Fridge 1', ownerId: 'user-1', youMay: 'own' }], nextCursor: null });
      if (path === '/devices')
        return Promise.resolve({ items: [{ id: 'device-1', settings: { vpdLeafOffsetDay: -2, vpdLeafOffsetNight: 0 } }], nextCursor: null });
      if (path === '/entries') return Promise.resolve({ items: state.entries, nextCursor: null });
      if (path === '/home') return Promise.resolve(state.home);
      if (path === '/me') return Promise.resolve({ id: 'user-1', handle: 'you', preferences: { timezone: 'UTC' } });
      return Promise.resolve({ items: [], nextCursor: null });
    },
    post: (path: string, body: unknown) => {
      state.posted.push({ path, body });
      return Promise.resolve({ id: 'link-1', token: 'tok-9', subject: { type: 'space', id: 'space-2' }, kind: 'view' });
    },
    patch: () => Promise.resolve({}),
    delete: () => Promise.resolve(undefined),
  },
}));

vi.mock('@/charts/Chart', () => ({ Chart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} /> }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');
  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN, mediaUrl: (id: string) => `/media/${id}` };
});

vi.mock('@/api/clock', async importOriginal => ({ ...(await importOriginal<object>()), serverNow: () => NOW }));

const at = (hours: number) => NOW.minus({ hours: 24 - hours }).toISO()!;

const targets: TimelineTargets = {
  startsAt: at(0),
  endsAt: at(24),
  phaseId: null,
  stage: null,
  day: { setpoint: 25, band: { low: 24, high: 26 } },
  night: { setpoint: 21, band: { low: 20, high: 22 } },
};

const placeSeries: Omit<SpaceSeries, 'startsAt' | 'endsAt' | 'stepSeconds'> = {
  spaceId: 'space-2',
  deviceIds: ['device-1'],
  lastReadingAt: null,
  climate: [
    { metric: 'temperature', points: [0, 6, 12, 18, 24].map(hour => ({ measuredAt: at(hour), value: 24 })), targets: [targets] },
    { metric: 'humidity', points: [0, 6, 12, 18, 24].map(hour => ({ measuredAt: at(hour), value: 60 })), targets: [] },
    { metric: 'vpd', points: [0, 6, 12, 18, 24].map(hour => ({ measuredAt: at(hour), value: 1 })), targets: [] },
    { metric: 'leafTemperature', points: [0, 6, 12, 18, 24].map(hour => ({ measuredAt: at(hour), value: 22 })), targets: [] },
  ],
  outputs: [{ output: 'light', deviceId: 'device-1', spans: [{ startsAt: at(6), endsAt: at(18) }], heardUntil: at(24) }],
  nights: [{ startsAt: at(0), endsAt: at(6) }],
  cameras: [{ cameraId: 'cam-1', name: 'Fridge cam', frames: [{ mediaId: 'still-1', capturedAt: at(23.97) }] }],
};

const entry = (id: string, hours: number, over: Partial<Entry>): Entry =>
  ({
    id,
    createdAt: at(hours),
    kind: 'system',
    occurredAt: at(hours),
    source: 'device',
    authorId: null,
    growId: null,
    spaceId: 'space-2',
    deviceId: 'device-1',
    plantIds: [],
    cameraId: null,
    taskId: null,
    alertId: null,
    severity: 'info',
    text: null,
    message: { key: 'message-device-booted', params: [] },
    values: { kind: 'system' },
    mediaIds: [],
    undoUntil: null,
    ...over,
  }) as Entry;

function Address() {
  const location = useLocation();
  return <output data-testid="address">{`${location.pathname}${location.search}`}</output>;
}

const draw = (at = '/charts?space=space-2') =>
  drawAt(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <Charts />
            <Address />
          </>
        }
      />
    </Routes>,
    { at },
  );

interface SeriesRead {
  from: string;
  to: string;
  stepSeconds?: number;
  metrics: string[];
}

const lastRead = () => state.asked.filter(read => read.path.includes('/series')).at(-1)!.query as unknown as SeriesRead;
const widthOf = (read: SeriesRead) => Date.parse(read.to) - Date.parse(read.from);

beforeAll(() => translate());

beforeEach(() => {
  state.asked = [];
  state.posted = [];
  state.series = placeSeries;
  state.entries = [];
  state.home = { spaces: [] };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a place charted without a grow', () => {
  it('reads the place over the last day, offers every line it has and no stretch of a grow', async () => {
    draw();

    expect(await screen.findByText('Temp + RH')).toBeInTheDocument();
    expect(widthOf(lastRead())).toBe(WIDTHS['24h']);
    expect(lastRead().metrics).toEqual(expect.arrayContaining(['leafTemperature', 'lux', 'ppfd']));
    expect(state.asked.some(read => read.path.startsWith('/grows/'))).toBe(false);

    for (const label of ['Leaf', 'Messages', 'Camera picture']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    for (const label of ['Phase', 'Grow', 'Day-of-grow']) expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    // The leaf is offered, and drawn only once it is asked for.
    expect(screen.queryByText('Leaf', { selector: 'span' })).not.toBeInTheDocument();
  });

  it('opens the bare address on the place the tabs show, keeping what else the address asked', async () => {
    state.home = { spaces: [{ spaceId: 'space-2', name: 'Fridge 1', values: [], deviceIds: ['device-1'] }] };
    draw('/charts?range=7d');

    await waitFor(() => expect(screen.getByTestId('address')).toHaveTextContent('/charts?range=7d&space=space-2'));
    expect(await screen.findByText('Temp + RH')).toBeInTheDocument();
    expect(widthOf(lastRead())).toBe(WIDTHS['7d']);
  });

  it('offers every width from twenty minutes to three years, the rare ones one tap further', async () => {
    draw();
    await screen.findByText('Temp + RH');

    expect(screen.queryByRole('button', { name: '3 years' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More …' }));
    fireEvent.click(screen.getByRole('button', { name: '3 years' }));

    await waitFor(() => expect(widthOf(lastRead())).toBe(WIDTHS['3y']));
    fireEvent.click(screen.getByRole('button', { name: '20 min' }));
    await waitFor(() => expect(widthOf(lastRead())).toBe(WIDTHS['20m']));
  });

  it('steps the window back by its own width, and back to now', async () => {
    draw('/charts?space=space-2&range=7d');
    await screen.findByText('Temp + RH');
    const end = Date.parse(lastRead().to);

    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }));
    await waitFor(() => expect(Date.parse(lastRead().to)).toBe(end - WIDTHS['7d']));
    expect(screen.getByTestId('address')).toHaveTextContent('at=');

    fireEvent.click(screen.getByRole('button', { name: 'Up to now' }));
    await waitFor(() => expect(Date.parse(lastRead().to)).toBe(end));
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
  });

  it('draws at the step chosen under Advanced, and says where the window was too wide for it', async () => {
    draw();
    await screen.findByText('Temp + RH');

    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Interval' }), { target: { value: '60' } });

    await waitFor(() => expect(lastRead().stepSeconds).toBe(60));
    expect(screen.getByTestId('address')).toHaveTextContent('step=60');

    state.series = { ...placeSeries };
    fireEvent.change(screen.getByRole('combobox', { name: 'Interval' }), { target: { value: '5' } });
    await waitFor(() => expect(lastRead().stepSeconds).toBe(5));
  });

  it('zooms into a third of the window around the cursor, and back out', async () => {
    draw();
    await screen.findByText('Temp + RH');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(widthOf(lastRead())).toBe(WIDTHS['24h'] / 3));
    expect(await screen.findByText(/^Zoom:/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    await waitFor(() => expect(widthOf(lastRead())).toBe(WIDTHS['24h']));
  });

  it('lists what was written over the window, filtered by kind, and the lines of one column alone', async () => {
    state.entries = [
      entry('boot', 23, {}),
      entry('alarm', 2, { kind: 'alarm', source: 'alarm', severity: 'critical', message: { key: 'message-alarm-triggered', params: [] } }),
      entry('note', 22, { kind: 'note', source: 'human', text: 'Topped the tent', severity: null, message: null, values: { kind: 'note' } }),
    ];
    draw();
    await screen.findByText('Temp + RH');

    fireEvent.click(screen.getByRole('button', { name: 'Messages' }));
    expect(await screen.findByText('Topped the tent')).toBeInTheDocument();
    const read = state.asked.find(one => one.path === '/entries');
    expect(read?.query).toMatchObject({ spaceId: 'space-2', startsAt: expect.any(String), endsAt: expect.any(String) });
    expect(screen.getByText('· 3 in the window')).toBeInTheDocument();

    // A column of its own: the one the alarm was raised in, which is red.
    const lane = screen.getByRole('group', { name: 'Messages over the window' });
    const loud = within(lane)
      .getAllByRole('button')
      .find(column => column.getAttribute('data-severity') === 'critical')!;
    fireEvent.click(loud);
    expect(screen.queryByText('Topped the tent')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText('Topped the tent')).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('group', { name: 'Which messages' })).getByRole('button', { name: 'Diary' }));
    expect(screen.queryByText('Topped the tent')).not.toBeInTheDocument();
    expect(screen.getByText('· 2 in the window')).toBeInTheDocument();
  });

  it('shows the camera’s picture at the cursor', async () => {
    draw();
    await screen.findByText('Temp + RH');

    fireEvent.click(screen.getByRole('button', { name: 'Camera picture' }));
    expect(await screen.findByRole('img', { name: /at the cursor/ })).toHaveAttribute('src', expect.stringContaining('still-1'));
  });

  it('shares the place and hands the link over to copy', async () => {
    draw();
    await screen.findByText('Temp + RH');

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(await screen.findByRole('button', { name: /Create/ }));

    await waitFor(() => expect(state.posted[0]).toMatchObject({ path: '/share-links', body: { subject: { type: 'space', id: 'space-2' } } }));
    expect(state.posted[0].body).not.toHaveProperty('range');
    expect(await screen.findByText(/shared\/tok-9/)).toBeInTheDocument();
  });

  it('moves a zoom along the window by its own width, and never past now', async () => {
    draw();
    await screen.findByText('Temp + RH');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(widthOf(lastRead())).toBe(WIDTHS['24h'] / 3));
    const zoomedTo = Date.parse(lastRead().to);

    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }));
    await waitFor(() => expect(Date.parse(lastRead().to)).toBe(zoomedTo - WIDTHS['24h'] / 3));
    expect(widthOf(lastRead())).toBe(WIDTHS['24h'] / 3);
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(Date.parse(lastRead().to)).toBe(zoomedTo));
  });

  it('keeps the curves, the messages and the picture in the address, so a reload opens on the same chart', async () => {
    draw();
    await screen.findByText('Temp + RH');

    fireEvent.click(screen.getByRole('button', { name: 'Leaf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Messages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Camera picture' }));
    const address = screen.getByTestId('address').textContent!;
    const asked = new URLSearchParams(address.split('?')[1]);
    expect(asked.get('show')!.split(',')).toEqual(expect.arrayContaining(['temperature', 'humidity', 'leafTemperature']));
    expect(asked.get('msgs')).toBe('1');
    expect(asked.get('cam')).toBe('1');

    cleanup();
    draw(address);
    expect(await screen.findByText('Leaf', { selector: '[class*=cardTitle]' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Messages' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Camera picture' })).toHaveAttribute('aria-pressed', 'true');
  });

  /** A reload after zooming landed on the whole window again, and the layout and the message filter were forgotten too. */
  it('keeps the zoom, the layout and the kinds of message left out in the address as well', async () => {
    state.entries = [
      entry('boot', 23, {}),
      entry('note', 22, { kind: 'note', source: 'human', text: 'Topped the tent', severity: null, message: null, values: { kind: 'note' } }),
    ];
    draw('/charts?space=space-2&msgs=1');
    await screen.findByText('Temp + RH');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(widthOf(lastRead())).toBe(WIDTHS['24h'] / 3));
    const zoomed = { from: lastRead().from, to: lastRead().to };
    fireEvent.click(screen.getByRole('button', { name: 'Overlay' }));
    fireEvent.click(within(await screen.findByRole('group', { name: 'Which messages' })).getByRole('button', { name: 'Diary' }));
    const address = screen.getByTestId('address').textContent!;
    const asked = new URLSearchParams(address.split('?')[1]);
    expect(asked.get('zoom')).toBe(`${zoomed.from}~${zoomed.to}`);
    expect(asked.get('layout')).toBe('overlay');
    expect(asked.get('hide')).toBe('diary');

    cleanup();
    state.asked = [];
    draw(address);
    expect(await screen.findByText(/^Zoom:/)).toBeInTheDocument();
    await waitFor(() => expect({ from: lastRead().from, to: lastRead().to }).toEqual(zoomed));
    expect(screen.getByRole('button', { name: 'Overlay' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('· 1 in the window')).toBeInTheDocument();
    expect(screen.queryByText('Topped the tent')).not.toBeInTheDocument();

    // Back to the whole window, which the address says by no longer naming a zoom.
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    await waitFor(() => expect(widthOf(lastRead())).toBe(WIDTHS['24h']));
    expect(new URLSearchParams(screen.getByTestId('address').textContent!.split('?')[1]).has('zoom')).toBe(false);
  });

  it('draws nothing where the address turned every curve off, and ignores a name it does not know', async () => {
    draw('/charts?space=space-2&show=');
    expect(await screen.findByText('Nothing picked yet — tap a series above.')).toBeInTheDocument();

    cleanup();
    draw('/charts?space=space-2&show=humidity,nonsense');
    expect(await screen.findByText('RH', { selector: '[class*=cardTitle]' })).toBeInTheDocument();
    expect(screen.queryByText('Temp', { selector: '[class*=cardTitle]' })).not.toBeInTheDocument();
    expect(screen.queryByText(/nonsense/, { selector: 'p, span' })).not.toBeInTheDocument();
  });

  it('starts a range of one´s own on the days the chart was showing, so the curves stay', async () => {
    draw();
    await screen.findByText('Temp + RH');

    fireEvent.click(screen.getByRole('button', { name: 'Custom …' }));
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.queryByText('Pick both ends and the chart is drawn between them.')).not.toBeInTheDocument();
  });

  it('shares the window somebody picked, unless they take the place as a whole', async () => {
    draw('/charts?space=space-2&range=custom&from=2026-09-10&to=2026-09-12');
    await screen.findByText('Temp + RH');

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('button', { name: 'No limit' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));

    await waitFor(() =>
      expect(state.posted[0]?.body).toMatchObject({
        range: { startsAt: expect.stringMatching(/^2026-09-(09|10)T/), endsAt: expect.stringMatching(/^2026-09-1[23]T/) },
      }),
    );
  });
});

describe('the arithmetic under it', () => {
  const span = { range: '24h' as const, from: '', to: '', at: null, zoom: null, now: NOW.toMillis(), endedAt: null, zone: 'UTC' };

  it('ends a rolling window now, where a grow that has ended stopped, or where it was stepped back to', () => {
    expect(windowOf(span)).toEqual({ kind: 'span', from: NOW.toMillis() - WIDTHS['24h'], to: NOW.toMillis() });
    expect(windowOf({ ...span, endedAt: NOW.toMillis() - 5 * HOUR })).toMatchObject({ to: NOW.toMillis() - 5 * HOUR });
    expect(windowOf({ ...span, at: NOW.toMillis() - 48 * HOUR })).toMatchObject({ to: NOW.toMillis() - 48 * HOUR });
    expect(windowOf({ ...span, range: 'phase' })).toEqual({ kind: 'grow', range: 'phase' });
    expect(windowOf({ ...span, range: 'custom', from: '2026-09-01', to: '2026-09-03' })).toEqual({
      kind: 'span',
      from: Date.parse('2026-09-01T00:00:00Z'),
      to: Date.parse('2026-09-03T23:59:59.999Z'),
    });
  });

  it('steps on no further than now, and zooms inside the window', () => {
    const end = NOW.toMillis();
    expect(stepped('24h', null, end, -1)).toBe(end - WIDTHS['24h']);
    expect(stepped('24h', end - WIDTHS['24h'], end, 1)).toBeNull();
    expect(zoomedIn(0, 3000, 2900)).toEqual({ from: 2000, to: 3000 });
    expect(zoomedIn(0, 3000, 1500)).toEqual({ from: 1000, to: 2000 });
  });

  it('reads a saved width back as the nearest chip', () => {
    expect(rangeOfSpan({ kind: 'last', forSeconds: 86_400 }, null)).toEqual({ range: '24h' });
    expect(rangeOfSpan({ kind: 'last', forSeconds: 40 * 86_400 }, null)).toEqual({ range: '30d' });
  });

  it('keeps the VPD of one half of the day, by the light', () => {
    const panel = placeSeries.climate[2];
    const night = halfOf(panel, placeSeries.nights, 'night').points.map(point => point.value);
    const day = halfOf(panel, placeSeries.nights, 'day').points.map(point => point.value);

    expect(night).toEqual([1, 1, null, null, null]);
    expect(day).toEqual([null, null, 1, 1, 1]);
  });

  it('opens a diary kept without hardware on what was measured by hand, and a place on its climate', () => {
    const height = { key: 'height', name: 'Height', unit: 'cm', perPlant: false, targetMin: null, targetMax: null, chart: true };

    expect(defaultPick({ metrics: [], outputs: [], measurements: [height] })).toEqual({ metrics: [], outputs: [], measurements: ['height'] });
    expect(defaultPick({ metrics: ['temperature', 'co2', 'lux'], outputs: ['light'], measurements: [height] })).toEqual({
      metrics: ['temperature'],
      outputs: [],
      measurements: [],
    });
  });

  it('cuts the window into columns and tells the kinds of line apart', () => {
    const columns = columnsOf(
      [entry('a', 0.1, {}), entry('b', 0.2, { severity: 'warning' }), entry('c', 23.9, {})],
      Date.parse(at(0)),
      Date.parse(at(24)),
      4,
    );

    expect(columns.map(column => column.entries.length)).toEqual([2, 0, 0, 1]);
    expect(columns[0].severity).toBe('warning');
    // A finger on an empty column takes the nearest one with lines, within reach, and nothing further off.
    const lane = columnsOf([entry('a', 6.5, {})], Date.parse(at(0)), Date.parse(at(24)), 48);
    expect(nearestColumn(lane, 70, 200)).toBe(13);
    expect(nearestColumn(lane, 54, 200)).toBe(13);
    expect(nearestColumn(lane, 150, 200)).toBeNull();
    expect(categoryOf({ kind: 'plan', source: 'plan' })).toBe('plan');
    expect(categoryOf({ kind: 'water', source: 'human' })).toBe('diary');
    expect(categoryOf({ kind: 'system', source: 'device' })).toBe('device');
  });
});
