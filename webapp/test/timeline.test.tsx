import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, CardValue, SpaceTimeline } from '@fg2/shared-types/v1';
import { LogContext, type Told } from '@/log/log-context';
import { SharedTimeline } from '@/screens/timeline/Timeline';
import { Timeline } from '@/screens/Timeline';
import { forgetKept } from '@/ui/kept';
import { drawAt, json, NOT_FOUND } from './harness';
import { cardOf, entry, fridge, homeOf } from './place-wire';
import { meWith, spacePage, spaceWhere } from './session';
import { translate } from './translations';

/**
 * Verlauf, the one page of curves. What the curves come to is arithmetic and
 * is held by `timeline-view.test.ts` and `timeline-model.test.ts`; here it is
 * the page: that its view is its address, that every number it owes is written,
 * what each kind of reader is offered, and what it says where it has nothing.
 */

const who = vi.hoisted(() => ({ is: 'you' as 'you' | 'demo' }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');
  return {
    ...(await importOriginal<object>()),
    mediaUrl: (id: string) => `/media/${id}`,
    useSession: () => (who.is === 'demo' ? ON_THE_DEMO : SIGNED_IN),
  };
});

// A chart is a canvas, which jsdom has not got. What it draws is held by the model's tests.
vi.mock('@/charts/Chart', () => ({ Chart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} /> }));

const NOW = Date.now();
const HOUR = 3600_000;
const iso = (time: number) => new Date(time).toISOString();
const ago = (hours: number) => iso(NOW - hours * HOUR);

const restart = entry('entry-restart', {
  kind: 'system',
  source: 'device',
  authorId: null,
  deviceId: 'device-1',
  text: null,
  occurredAt: ago(5),
  message: { key: 'message-device-booted', params: ['POWERON'] },
  values: { kind: 'system' },
});
const watered = entry('entry-water', { kind: 'water', occurredAt: ago(3), text: null, values: { kind: 'water', litres: 1.5, readings: [] } });

/** The window a request names, answered at a point an hour (or at every sample, where it is twenty minutes). */
const answerTo = (query: URLSearchParams, over: Partial<SpaceTimeline> = {}): SpaceTimeline => {
  const from = query.get('from') ? Date.parse(query.get('from')!) : NOW - 24 * HOUR;
  const to = query.get('to') ? Date.parse(query.get('to')!) : NOW;
  const count = 24;
  const step = (to - from) / count;
  const points = (value: number, spike?: { min: number; max: number }) =>
    Array.from({ length: count }, (_, index) => ({ measuredAt: iso(from + (index + 1) * step), value, ...(spike && index === 12 ? spike : {}) }));
  // An output's samples point by point: those heard, those it ran in, and its mean level where it has one.
  const counted = (said: (index: number) => [number, number, number | null]) =>
    Array.from({ length: count }, (_, index) => {
      const [heard, on, level] = said(index);
      return { measuredAt: iso(from + (index + 1) * step), heard, on, level };
    });

  return {
    spaceId: 'space-1',
    name: 'Tent 1',
    kind: 'tent',
    range: '24h',
    growId: 'grow-1',
    dayFrom: 28,
    dayTo: 29,
    startsAt: iso(from),
    endsAt: iso(to),
    stepSeconds: Math.round(step / 1000),
    deviceIds: ['device-1'],
    deviceId: 'device-1',
    reading: server.reading,
    lastReadingAt: null,
    panels: [
      { metric: 'temperature', points: points(25.2, { min: 19.4, max: 25.3 }), targets: [] },
      { metric: 'humidity', points: points(58, { min: 54.2, max: 71.5 }), targets: [] },
      { metric: 'vpd', points: points(1.4), targets: [] },
      { metric: 'co2', points: points(820), targets: [] },
    ],
    nights: [],
    transitions: [],
    alarms: [],
    outputs: [
      {
        output: 'light',
        deviceId: 'device-1',
        spans: [{ startsAt: iso(from), endsAt: iso(to) }],
        heardUntil: iso(to),
        points: counted(() => [12, 12, 65]),
      },
      { output: 'heater', deviceId: 'device-1', spans: [], heardUntil: iso(to), points: counted(() => [12, 0, 0]) },
      {
        output: 'dehumidifier',
        deviceId: 'device-1',
        spans: [{ startsAt: iso(from + 12 * step), endsAt: iso(from + 12.5 * step) }],
        heardUntil: iso(to),
        // On through half of the thirteenth point.
        points: counted(index => [12, index === 12 ? 6 : 0, null]),
      },
    ],
    events: [restart, watered],
    deviceChanges: [],
    machineEvents: { shown: 1, total: 1 },
    grows: [{ growId: 'grow-1', name: 'Amnesia', startedAt: ago(28 * 24), endedAt: null }],
    readingNames: [],
    cameras: [
      {
        cameraId: 'camera-1',
        name: 'Zeltkamera',
        frames: [
          { mediaId: 'still-old', capturedAt: iso(from + 2 * step) },
          { mediaId: 'still-new', capturedAt: iso(to - 60_000) },
        ],
      },
    ],
    people: [{ id: 'user-1', handle: 'you' }],
    ...over,
  };
};

const server = {
  youMay: 'own' as AccessNeed,
  over: {} as Partial<SpaceTimeline>,
  /** What Verlauf was answered instead, for a test about a read that fails. */
  fails: false,
  /** Whether Verlauf's answer is held back until `release`, for a test about the moment it is asked. */
  holds: false,
  release: () => {},
  asked: [] as URLSearchParams[],
  /** Every path read, in order. */
  askedFor: [] as string[],
  /** The drawn device's last reading, as the answer carries it for every reader; none where nothing is drawn of a device. */
  reading: null as SpaceTimeline['reading'],
  views: [] as { id: string; name: string; definition: unknown }[],
  wrote: [] as string[],
  /** Whether the account has a second place with a controller of its own standing in it. */
  elsewhere: false,
};

const wire = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = url.pathname.replace(/^.*\/v1/, '');
  const method = init?.method ?? 'GET';
  if (method !== 'GET') server.wrote.push(`${method} ${path}`);
  else server.askedFor.push(path);

  const second = server.elsewhere;
  if (path === '/home') {
    const cards = [
      cardOf({ name: 'Tent 1', kind: 'tent' }),
      ...(second ? [cardOf({ spaceId: 'space-2', name: 'Tent 2', kind: 'tent', deviceIds: ['device-2'] })] : []),
    ];
    return json(homeOf(cards, true));
  }
  if (path === '/spaces')
    return json(spacePage(spaceWhere(server.youMay), ...(second ? [spaceWhere('own', { id: 'space-2', name: 'Tent 2' })] : [])));
  if (path === '/devices') {
    return json({
      items: [fridge(), ...(second ? [fridge({ id: 'device-2', type: 'controller', name: 'Controller B', spaceId: 'space-2' })] : [])],
      nextCursor: null,
    });
  }
  if (path === '/me') return json(meWith({ preferences: { ...meWith().preferences, timezone: 'UTC' } }));
  if (path === '/spaces/space-1/timeline' || (second && path === '/spaces/space-2/timeline')) {
    server.asked.push(url.searchParams);
    if (server.holds) {
      server.holds = false;
      await new Promise<void>(resolve => (server.release = resolve));
    }
    return server.fails
      ? json({ status: 500, code: 'unexpected', title: 'Broken', detail: '', errors: [] }, 500)
      : json(answerTo(url.searchParams, server.over));
  }
  if (path === '/grows/grow-1') {
    const placements = [{ id: 'placement-1', spaceId: 'space-1', startedAt: ago(28 * 24), endedAt: null, plantIds: null }];
    return json({ id: 'grow-1', name: 'Amnesia', measurements: [], placements, endedAt: null, ownerId: 'user-1' });
  }
  // A grow of the account that stands in no place: nothing of a climate to draw, and its page Messwerte for the rest.
  if (path === '/grows/grow-loose')
    return json({ id: 'grow-loose', name: 'Windowsill', measurements: [], placements: [], endedAt: null, ownerId: 'user-1' });
  if (path === '/chart-views' && method === 'POST') {
    const view = { id: `view-${server.views.length + 1}`, ...(JSON.parse(String(init?.body)) as { name: string; definition: unknown }) };
    server.views.push(view);
    return json(view);
  }
  if (path === '/chart-views') return json({ items: server.views, nextCursor: null });
  return json(NOT_FOUND, 404);
};

const opened: unknown[][] = [];
const told: Told[] = [];

function Address() {
  const { pathname, search } = useLocation();
  return <output data-testid="address">{decodeURIComponent(`${pathname}${search}`)}</output>;
}

const draw = (at = '/timeline', page: ReactNode = <Timeline />) => {
  const log = { openDetails: (...args: unknown[]) => opened.push(args), tell: (one: Told) => told.push(one) } as unknown as ComponentProps<
    typeof LogContext
  >['value'];
  return drawAt(
    <LogContext value={log}>
      {page}
      <Address />
      {/* The bar's item: the page's own address with nothing in it. */}
      <Link to="/timeline" data-testid="bar">
        Verlauf
      </Link>
    </LogContext>,
    { at },
  );
};

const address = () => new URL(screen.getByTestId('address').textContent!, 'http://app');
const panel = (name: string) => screen.getByRole('region', { name });
const settled = () => screen.findByRole('region', { name: 'Temperature' });
/** A tap on a plot at a share of its width. */
const tap = (name: string, fraction: number) => {
  const plot = within(panel(name)).getByRole('slider');
  plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  for (const type of ['pointerdown', 'pointerup']) {
    const event = new MouseEvent(type, { bubbles: true, clientX: 200 * fraction, clientY: 10 });
    Object.assign(event, { pointerId: 1, pointerType: 'touch' });
    fireEvent(plot, event);
  }
};

beforeAll(() => translate());

beforeEach(() => {
  who.is = 'you';
  Object.assign(server, {
    youMay: 'own',
    over: {},
    fails: false,
    holds: false,
    asked: [],
    askedFor: [],
    reading: null,
    views: [],
    wrote: [],
    elsewhere: false,
  });
  opened.length = 0;
  told.length = 0;
  localStorage.clear();
  forgetKept();
  vi.stubGlobal('fetch', vi.fn(wire));
});

afterEach(() => vi.unstubAllGlobals());

describe('Verlauf as it opens', () => {
  it('draws a panel each for temperature, humidity and VPD, with the low, the high and the reading at the cursor', async () => {
    draw();
    await settled();

    // The lowest and highest sample of the window, not of its means: the door that stood open shows.
    expect(panel('Temperature')).toHaveTextContent('Low 19.4 · High 25.3');
    expect(within(panel('Temperature')).getByText('25.2 °C')).toBeInTheDocument();
    // A humidity is read to the tenth here: a highest sample of 71.5 is not "72".
    expect(panel('Humidity')).toHaveTextContent('Low 54.2 · High 71.5');
    expect(within(panel('Humidity')).getByText('58.0 %')).toBeInTheDocument();
    expect(panel('VPD')).toHaveTextContent('Low 1.40 · High 1.40');
    expect(panel('VPD')).toBeInTheDocument();
    // CO₂ is measured and waits for its tick.
    expect(screen.queryByRole('region', { name: 'CO₂' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Humidity between 54.2 and 71.5 %/ })).toBeInTheDocument();
  });

  it('asks for the last 24 hours by their name, with every panel a place can have', async () => {
    draw();
    await settled();

    expect(Object.fromEntries(server.asked[0])).toEqual({ range: '24h', metrics: 'ppfd' });
    expect(server.asked[0].getAll('metrics')).toEqual(['temperature', 'humidity', 'vpd', 'co2', 'leafTemperature', 'lux', 'ppfd']);
  });

  it('names the window between its arrows, with the grow`s days, and cannot step past now', async () => {
    draw();
    await settled();

    const move = screen.getByRole('group', { name: 'Move and zoom the window' });
    expect(move).toHaveTextContent(/Yesterday \d\d:\d\d to now/);
    expect(move).toHaveTextContent(/day 28–29/i);
    expect(within(move).getByRole('button', { name: '24 h later' })).toBeDisabled();
    expect(within(move).getByRole('button', { name: '24 h earlier' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '24 h', pressed: true })).toBeInTheDocument();
  });

  it('puts each output under the curve it acts on, and beside the rail the lamp under the last panel', async () => {
    draw();
    await settled();

    expect(within(panel('Temperature')).getByRole('img', { name: 'Heater: on 0 % of the time' })).toBeInTheDocument();
    expect(within(panel('Humidity')).getByRole('img', { name: 'Dehumidifier: on 2 % of the time' })).toBeInTheDocument();
    expect(within(panel('VPD')).getByRole('img', { name: 'Light: on 100 % of the time' })).toBeInTheDocument();
  });

  it('gives the lamp a card of its own on a phone, with when it burned and how bright', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    draw();
    await settled();

    const card = screen.getByRole('heading', { name: 'Light' }).closest('section')!;
    expect(within(card).getByRole('img', { name: 'Light: on 100 % of the time' })).toBeInTheDocument();
    expect(card).toHaveTextContent(/on since \d\d:\d\d · 65 %/);
    expect(within(panel('VPD')).queryByRole('img', { name: /Light/ })).not.toBeInTheDocument();
  });

  it('reads the cursor in a card that stays put: the newest picture, now, a figure per curve, each output', async () => {
    draw();
    await settled();

    const card = screen.getByRole('region', { name: 'Cursor' });
    expect(within(card).getByRole('img', { name: /at the cursor/ })).toHaveAttribute('src', '/media/still-new');
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/cameras/camera-1');
    expect(card).toHaveTextContent(/Cursor · now, \d\d:\d\d/);
    expect(card).toHaveTextContent('25.2 °C · 58.0 % · 1.40 kPa');
    // The zoom stands with the card, which stays in sight while the page scrolls.
    expect(within(card).getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    // One form per output: one driven at a level reads in per cent, also at 0; a switch reads on or off.
    expect(card).toHaveTextContent('Light 65 % · Heater 0 % · Dehumidifier off');
  });

  it('lists what was written in the window, oldest first, a device`s line marked as its own', async () => {
    draw();
    await settled();

    const lines = within(screen.getByRole('region', { name: 'Diary in this window' })).getAllByRole('listitem');
    expect(lines.map(line => line.textContent)).toEqual([expect.stringMatching(/Device rebooted.*by itself/), expect.stringMatching(/You watered/)]);
  });

  it('says in that list when another device took over the measuring, as a line nobody wrote', async () => {
    server.over = { deviceChanges: [{ kind: 'device', at: ago(4), name: 'Controller B', type: 'controller' }] };
    draw();
    await settled();

    const lines = within(screen.getByRole('region', { name: 'Diary in this window' })).getAllByRole('listitem');
    expect(lines.map(line => line.textContent)).toEqual([
      expect.stringMatching(/Device rebooted/),
      // The stamp says when, and the line does not say the hour again.
      expect.stringMatching(/^\d\d:\d\d, Set the cursor on this momentController B measures from here onby itself$/),
      expect.stringMatching(/You watered/),
    ]);
  });
});

describe('the view in the address', () => {
  it('sets the cursor down where a plot is tapped, and reads that moment`s picture and figures', async () => {
    draw();
    await settled();
    tap('Humidity', 0.1);

    await waitFor(() => expect(address().searchParams.get('at')).not.toBeNull());
    const placed = Date.parse(address().searchParams.get('at')!);
    expect(Math.abs(placed - (NOW - 0.9 * 24 * HOUR))).toBeLessThan(HOUR);
    const card = screen.getByRole('region', { name: 'Cursor' });
    expect(within(card).getByRole('img', { name: /at the cursor/ })).toHaveAttribute('src', '/media/still-old');
    expect(card).not.toHaveTextContent('now');
  });

  it('zooms in around the cursor one width at a time, asks for that window by its ends, and says how fine it is drawn', async () => {
    const cursor = NOW - 6 * HOUR;
    draw(`/timeline?at=${iso(cursor)}`);
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

    await waitFor(() => expect(address().searchParams.has('from')).toBe(true));
    const [from, to] = [Date.parse(address().searchParams.get('from')!), Date.parse(address().searchParams.get('to')!)];
    expect(to - from).toBe(6 * HOUR);
    // The cursor keeps its instant and its place: three quarters across.
    expect(address().searchParams.get('at')).toBe(iso(cursor));
    expect((cursor - from) / (to - from)).toBeCloseTo(0.75, 3);
    await waitFor(() => expect(server.asked.at(-1)!.get('from')).toBe(iso(from)));
    expect(await screen.findByText(/every 15 min/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
  });

  it('steps back a day and forward again to now', async () => {
    draw();
    await settled();
    fireEvent.click(screen.getByRole('button', { name: '24 h earlier' }));

    await waitFor(() => expect(address().searchParams.has('to')).toBe(true));
    expect(Date.parse(address().searchParams.get('to')!)).toBeLessThan(NOW - 23 * HOUR);
    // Still a day, so its chip stays lit.
    expect(screen.getByRole('button', { name: '24 h', pressed: true })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '24 h later' }));
    await waitFor(() => expect(address().search).toBe(''));
  });

  it('opens a link to a moment however old on that moment`s own day, with the cursor on it', async () => {
    const old = NOW - 131 * 24 * HOUR;
    draw(`/timeline?space=space-1&at=${iso(old)}&grow=grow-1&focus=humidity`);
    await settled();

    expect(Object.fromEntries(server.asked[0])).toMatchObject({
      range: '24h',
      growId: 'grow-1',
      from: iso(old - 12 * HOUR),
      to: iso(old + 12 * HOUR),
    });
    expect(panel('Humidity')).toHaveAttribute('data-focus');
    expect(screen.getByRole('region', { name: 'Cursor' })).not.toHaveTextContent('now');
  });

  it('offers the grow`s phase and its whole stretch where a grow stands, and asks for them with the grow', async () => {
    draw();
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Grow' }));

    await waitFor(() => expect(address().search).toBe('?range=grow&grow=grow-1'));
    await waitFor(() => expect(Object.fromEntries(server.asked.at(-1)!)).toMatchObject({ range: 'grow', growId: 'grow-1' }));
  });

  it('offers no stretch of a grow where nothing grows', async () => {
    server.over = { growId: null, grows: [], dayFrom: null, dayTo: null };
    draw();
    await settled();

    expect(screen.getAllByRole('button', { pressed: false }).map(chip => chip.textContent)).toEqual(expect.arrayContaining(['7 d', '30 d']));
    expect(screen.queryByRole('button', { name: 'Phase' })).not.toBeInTheDocument();
  });
});

describe('what the place reads now', () => {
  const value = (metric: CardValue['metric'], figure: number, minutesAgo: number): CardValue =>
    ({ metric, value: figure, measuredAt: iso(NOW - minutesAgo * 60_000), state: minutesAgo > 10 ? 'offline' : 'live' }) as CardValue;
  const read = (minutesAgo: number, values: CardValue[], outputs: NonNullable<SpaceTimeline['reading']>['outputs'] = []) => ({
    measuredAt: iso(NOW - minutesAgo * 60_000),
    values,
    outputs,
  });

  it('is the device`s last reading as the answer carries it, in the head of each panel and in the card - not the mean of the last window', async () => {
    server.reading = read(
      0.1,
      [value('temperature', 26.7, 0.1), value('humidity', 61.4, 0.1), value('vpd', 1.52, 0.1)],
      [
        { output: 'light', on: true, level: 40 },
        { output: 'dehumidifier', on: true, level: null },
      ],
    );
    draw('/timeline?range=30d');
    await settled();

    await waitFor(() => expect(within(panel('Temperature')).getByText('26.7 °C')).toBeInTheDocument());
    const card = screen.getByRole('region', { name: 'Cursor' });
    expect(card).toHaveTextContent(/Cursor · now, \d\d:\d\d/);
    expect(card).toHaveTextContent('26.7 °C · 61.4 % · 1.52 kPa');
    // The outputs are that reading's too: the lamp at 40 %, not the 65 % the window's mean came to.
    expect(card).toHaveTextContent('Light 40 % · Heater 0 % · Dehumidifier on');
  });

  it('is the same for somebody reading through a link: one instant, one set of figures', async () => {
    server.reading = read(0.1, [value('temperature', 26.7, 0.1)], [{ output: 'light', on: true, level: 40 }]);
    server.over = { deviceIds: null, events: [], machineEvents: { shown: 0, total: 0 }, grows: [], growId: null };
    draw(
      '/shared/token-1',
      <SharedTimeline spaceId="space-1" shared={{ token: 'token-1', picture: id => `/shared-media/${id}` }} title={<h2>Timeline</h2>} />,
    );
    await settled();

    const card = screen.getByRole('region', { name: 'Cursor' });
    expect(card).toHaveTextContent('26.7 °C');
    expect(card).toHaveTextContent('Light 40 %');
    // Nothing of a device is asked beside the answer.
    expect(server.askedFor.filter(path => path.endsWith('/live'))).toEqual([]);
  });

  it('is "last reading" with its own time once the device has stopped reporting by the offline rule, on a month as on a day', async () => {
    server.reading = read(95, [value('temperature', 24.1, 95), value('humidity', 55, 95)]);
    // The curve's last mean closes two hours ago; nothing was measured after the device went quiet.
    const points = [4, 3, 2].map(hours => ({ measuredAt: ago(hours), value: 25.2 }));
    server.over = { panels: [{ metric: 'temperature', points, targets: [] }], outputs: [], cameras: [] };
    draw('/timeline?range=30d');
    await settled();

    const card = screen.getByRole('region', { name: 'Cursor' });
    await waitFor(() => expect(card).toHaveTextContent(/Cursor · last reading · /));
    expect(card).not.toHaveTextContent('now');
    expect(within(panel('Temperature')).getByText('24.1 °C')).toBeInTheDocument();
  });
});

describe('the cursor', () => {
  it('is what the address says and nothing else: with no `at` the card rests on now, whatever was set down before', async () => {
    draw();
    await settled();
    tap('Temperature', 0.25);
    await waitFor(() => expect(address().searchParams.has('at')).toBe(true));
    expect(screen.getByRole('region', { name: 'Cursor' })).not.toHaveTextContent('now');

    // "Verlauf" in the bar: the same page with no cursor in its address.
    fireEvent.click(screen.getByTestId('bar'));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Cursor' })).toHaveTextContent(/Cursor · now, \d\d:\d\d/));
    expect(screen.getByRole('region', { name: 'Cursor' })).toHaveTextContent('25.2 °C');
  });

  it('names the arrows as a person says it: by the chip`s own words, and a stretch of a grow as the stretch before', async () => {
    draw('/timeline?range=7d');
    await settled();
    expect(screen.getByRole('button', { name: '7 d earlier' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 d later' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Grow' }));
    expect(await screen.findByRole('button', { name: 'The stretch before' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'The stretch after' })).toBeInTheDocument();
  });
});

describe('a window that is not what the address asked for', () => {
  it('keeps the last picture where a window`s read fails, says whether the server answered, and shows that a retry is trying', async () => {
    draw();
    await settled();
    server.fails = true;
    fireEvent.click(screen.getByRole('button', { name: '7 d' }));

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('This window could not be loaded; what you see is the one before.');
    // The picture, the chips, the arrows and the sheet are all still there.
    expect(panel('Temperature')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 d' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Adjust' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /earlier/ })).toBeEnabled();
    // The label names the window that is drawn - the day - and the figures of that picture stay where they were.
    expect(screen.getByText(/^Yesterday \d\d:\d\d to now$/)).toBeInTheDocument();
    expect(within(panel('Temperature')).getByText('25.2 °C')).toBeInTheDocument();

    // Asked again, it says on the button that it tries, and nothing else on the page moves while it does.
    server.holds = true;
    fireEvent.click(within(notice).getByRole('button', { name: /Try again/i }));
    const trying = await screen.findByRole('button', { name: 'Trying…' });
    expect(trying).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('This window could not be loaded');
    expect(within(panel('Temperature')).getByText('25.2 °C')).toBeInTheDocument();

    // The notice goes when a read succeeds again.
    server.fails = false;
    server.release();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '7 d', pressed: true })).toBeInTheDocument();
  });

  it('draws the place`s own device where the address names one that does not stand here, says so and drops it - without asking the server what it can only refuse', async () => {
    draw('/timeline?device=device-nobody-has');
    expect(await screen.findByText(/The device in the address does not stand in this place/)).toBeInTheDocument();
    await settled();
    expect(address().searchParams.has('device')).toBe(false);
    expect(server.asked.every(query => !query.has('deviceId'))).toBe(true);
    expect(server.askedFor.some(path => path.includes('device-nobody-has'))).toBe(false);
  });

  it('reads a device the address names in the place it stands in, whichever place was chosen, and the choice follows', async () => {
    server.elsewhere = true;
    localStorage.setItem('terp.place', 'space-1');
    draw('/timeline?device=device-2&range=7d');

    await settled();
    // The address names the device's place, which is what chooses it; the rest of the view stays.
    expect(Object.fromEntries(address().searchParams)).toEqual({ device: 'device-2', range: '7d', space: 'space-2' });
    expect(server.asked.map(query => query.get('deviceId'))).toEqual(['device-2']);
    expect(server.askedFor.filter(path => path.endsWith('/timeline'))).toEqual(['/spaces/space-2/timeline']);
    await waitFor(() => expect(localStorage.getItem('terp.place')).toBe('space-2'));
  });

  it('sends a grow that stands in no place to its page of measurements, without asking for its curves here', async () => {
    draw('/timeline?grow=grow-loose');

    expect(await screen.findByText(/“Windowsill” has no place and so no climate curves/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Measurements/ })).toHaveAttribute('href', '/grows/grow-loose/measurements');
    await settled();
    expect(server.asked.every(query => !query.has('growId'))).toBe(true);
    expect(address().searchParams.has('grow')).toBe(false);
  });

  it('lights no chip for a stretch of a grow the address names no grow for: it is the last day that is drawn', async () => {
    draw('/timeline?range=grow');
    await settled();

    expect(screen.getByRole('button', { name: '24 h', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grow', pressed: false })).toBeInTheDocument();
  });

  it('offers the way back to now whenever the window does not end now, and not while it does', async () => {
    draw();
    await settled();
    expect(screen.queryByRole('button', { name: 'Now' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '24 h earlier' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Now' }));
    await waitFor(() => expect(address().search).toBe(''));
    expect(screen.queryByRole('button', { name: 'Now' })).not.toBeInTheDocument();
  });

  it('writes the curves last ticked in this browser into a bare address, so a copied one draws the same anywhere', async () => {
    localStorage.setItem('terp.curves', JSON.stringify(['temperature', 'co2', 'diary']));
    draw();
    await settled();

    await waitFor(() => expect(address().searchParams.get('show')).toBe('temperature,co2,diary'));
    expect(screen.getByRole('region', { name: 'CO₂' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Humidity' })).not.toBeInTheDocument();
  });
});

describe('the sheet "Adjust"', () => {
  const adjust = async () => {
    draw();
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }));
    return screen.findByRole('dialog', { name: 'Adjust' });
  };

  it('ticks a curve the place has into the picture and the address, and remembers it for the next visit', async () => {
    const sheet = await adjust();
    expect(within(sheet).getByRole('checkbox', { name: 'CO₂' })).not.toBeChecked();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'CO₂' }));

    expect(within(sheet).getByRole('checkbox', { name: 'CO₂' })).toBeChecked();
    expect(await screen.findByRole('region', { name: 'CO₂' })).toBeInTheDocument();
    expect(address().searchParams.get('show')).toBe('temperature,humidity,vpd,light,outputs,diary,machine,co2');
    expect(JSON.parse(localStorage.getItem('terp.curves')!)).toContain('co2');
    // What the place does not measure is not offered at all.
    expect(within(sheet).queryByRole('checkbox', { name: 'PPFD' })).not.toBeInTheDocument();
  });

  it('draws all curves in one picture, each named with its figure', async () => {
    const sheet = await adjust();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'All curves in one picture' }));

    const one = await screen.findByRole('region', { name: 'Temperature, Humidity, VPD' });
    expect(one).toHaveTextContent('Temperature 25.2 °C');
    expect(one).toHaveTextContent('VPD 1.40 kPa');
    expect(address().searchParams.get('one')).toBe('1');
  });

  it('takes the device`s lines out of the diary and leaves what people wrote', async () => {
    server.over = { deviceChanges: [{ kind: 'device', at: ago(4), name: null, type: 'controller' }] };
    const sheet = await adjust();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Device messages' }));

    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Diary in this window' })).getAllByRole('listitem')).toHaveLength(1));
  });

  it('offers no step under five minutes for a window wider than three days', async () => {
    draw(`/timeline?from=${ago(8 * 24)}&to=${ago(24)}`);
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }));
    const sheet = await screen.findByRole('dialog', { name: 'Adjust' });
    const steps = within(within(sheet).getByRole('combobox', { name: /Point spacing/ }))
      .getAllByRole('option')
      .map(option => option.textContent);

    expect(steps).toEqual(['Automatic', '10 min', '1 h']);
  });

  it('asks the server for a step somebody chose', async () => {
    const sheet = await adjust();
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Point spacing' }), { target: { value: '60' } });

    await waitFor(() => expect(server.asked.at(-1)!.get('stepSeconds')).toBe('60'));
    expect(address().searchParams.get('step')).toBe('60');
  });

  it('jumps to a day of the calendar, which the arrows and the zoom lead on from', async () => {
    const sheet = await adjust();
    fireEvent.change(within(sheet).getByLabelText('Jump to a day'), { target: { value: '2026-03-14' } });

    await waitFor(() => expect(address().searchParams.get('from')).toBe('2026-03-14T00:00:00.000Z'));
    expect(address().searchParams.get('to')).toBe('2026-03-15T00:00:00.000Z');
  });

  it('keeps the view in the account under a name, and opens it again', async () => {
    const sheet = await adjust();
    fireEvent.click(within(sheet).getByRole('button', { name: /Views/ }));
    fireEvent.change(await screen.findByPlaceholderText('Name, e.g. flowering weeks'), { target: { value: 'Nights' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(server.wrote).toEqual(['POST /chart-views']));
    // The write answers: what was kept, and the way to take it back.
    await waitFor(() => expect(told.map(one => one.label)).toEqual(['View “Nights” saved']));
    expect(told[0].undo).not.toBeNull();
    expect(server.views[0]).toMatchObject({
      name: 'Nights',
      definition: { metrics: ['temperature', 'humidity', 'vpd'], span: { kind: 'last', forSeconds: 86400 }, layout: 'stacked' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Nights' }));
    await waitFor(() => expect(address().searchParams.get('show')).toBe('temperature,humidity,vpd,light,outputs,diary,machine'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers a link and saved views to whoever keeps the place', async () => {
    const own = await adjust();

    expect(within(own).getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(within(own).getByRole('button', { name: /Views/ })).toBeInTheDocument();
    expect(within(own).getByRole('button', { name: 'Download as CSV' })).toBeInTheDocument();
  });

  it('offers neither to the demo, which keeps nothing and shares nothing', async () => {
    who.is = 'demo';
    const tour = await adjust();

    expect(within(tour).queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    expect(within(tour).queryByRole('button', { name: /Views/ })).not.toBeInTheDocument();
    expect(within(tour).getByRole('button', { name: 'Download as CSV' })).toBeInTheDocument();
  });
});

describe('the diary of the window', () => {
  it('sets the cursor on a line`s moment when its stamp is tapped', async () => {
    draw();
    await settled();
    const line = within(screen.getByRole('region', { name: 'Diary in this window' })).getAllByRole('listitem')[1];
    fireEvent.click(within(line).getByRole('button', { name: /Set the cursor on this moment/ }));

    await waitFor(() => expect(address().searchParams.get('at')).toBe(watered.occurredAt));
  });

  it('offers a note at the cursor once it was set down, to whoever may write here', async () => {
    const cursor = NOW - 6 * HOUR;
    draw(`/timeline?at=${iso(cursor)}`);
    await settled();
    fireEvent.click(await screen.findByRole('button', { name: /^Write a note at \d\d:\d\d/ }));

    expect(opened).toHaveLength(1);
    expect(opened[0][0]).toBe('note');
    expect((opened[0][3] as Date).getTime()).toBe(cursor);
  });

  it('offers no note to somebody who may only read, nor to the demo', async () => {
    server.youMay = 'view';
    draw(`/timeline?at=${ago(6)}`);
    await settled();

    expect(screen.queryByRole('button', { name: /Write a note/ })).not.toBeInTheDocument();
  });
});

describe('Verlauf with nothing to draw', () => {
  it('says that a device waits for its first values', async () => {
    server.over = { panels: [], outputs: [], cameras: [], events: [], machineEvents: { shown: 0, total: 0 } };
    draw();

    expect(await screen.findByText('Waiting for first values: the curves appear here once the device measures.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Cursor' })).not.toBeInTheDocument();
    expect(screen.getByText('No entry.')).toBeInTheDocument();
  });

  it('dates a window nothing was measured in, with the way to the last reading', async () => {
    const last = NOW - 50 * HOUR;
    server.over = { panels: [], outputs: [], cameras: [], lastReadingAt: iso(last) };
    draw();
    fireEvent.click(await screen.findByRole('button', { name: /Go to the last reading/ }));

    expect(screen.getByText(/Nothing was measured in this window · last reading 2 d ago/)).toBeInTheDocument();
    // The moment alone: the page gives it its own day around it, and never a window past now.
    await waitFor(() => expect(address().search).toBe(`?at=${iso(last)}`));
    await waitFor(() => expect(Object.fromEntries(server.asked.at(-1)!)).toMatchObject({ from: iso(last - 12 * HOUR), to: iso(last + 12 * HOUR) }));
  });

  it('says so where no device measures at all', async () => {
    server.over = { panels: [], outputs: [], cameras: [], deviceIds: [] };
    draw();

    expect(await screen.findByText('No device measures here, so there are no curves.')).toBeInTheDocument();
  });

  it('rests the cursor on the last reading of a place gone quiet, and says that it is the last', async () => {
    const points = [
      { measuredAt: ago(9), value: 24 },
      { measuredAt: ago(8), value: 24.5 },
      { measuredAt: iso(NOW - 8 * HOUR + 1), value: null },
    ];
    server.over = { panels: [{ metric: 'temperature', points, targets: [] }], outputs: [], cameras: [] };
    draw();
    await settled();

    expect(screen.getByRole('region', { name: 'Cursor' })).toHaveTextContent(/Cursor · last reading · \d\d:\d\d/);
    expect(within(panel('Temperature')).getByText('24.5 °C')).toBeInTheDocument();
  });

  it('offers the read again where it failed, under a head that still steps elsewhere', async () => {
    server.fails = true;
    draw();

    expect(await screen.findByRole('button', { name: /Try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 d' })).toBeInTheDocument();
    // One sentence, and no zoom on a plot that is not there.
    expect(
      within(screen.getByRole('alert'))
        .getAllByText(/./)
        .filter(node => node.tagName === 'P'),
    ).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
    server.fails = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(await settled()).toBeInTheDocument();
  });
});

describe('a place read through a link', () => {
  const shared = () =>
    draw(
      '/shared/token-1',
      <SharedTimeline spaceId="space-1" shared={{ token: 'token-1', picture: id => `/shared-media/${id}` }} title={<h2>Timeline</h2>} />,
    );

  it('reads with the link`s token, draws the curves and the strips, and keeps nothing of the account', async () => {
    // What the server answers a link: no device id, no alarm, no machine line, no grow.
    server.over = {
      deviceIds: null,
      alarms: [],
      events: [watered],
      machineEvents: { shown: 0, total: 0 },
      grows: [],
      growId: null,
      dayFrom: null,
      dayTo: null,
    };
    shared();
    await settled();

    expect(server.asked[0].get('share')).toBe('token-1');
    expect(within(panel('Humidity')).getByRole('img', { name: /Dehumidifier/ })).toBeInTheDocument();
    // The picture comes through the link and leads nowhere: the reader has no camera page to open.
    const card = screen.getByRole('region', { name: 'Cursor' });
    expect(within(card).getByRole('img', { name: /at the cursor/ })).toHaveAttribute('src', '/shared-media/still-new');
    expect(within(card).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Phase' })).not.toBeInTheDocument();
    expect(localStorage.getItem('terp.curves')).toBeNull();
  });

  it('is offered the curves to tick and the table, and nothing that needs an account', async () => {
    server.over = { deviceIds: null, events: [watered], machineEvents: { shown: 0, total: 0 }, grows: [], growId: null };
    shared();
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }));

    const sheet = await screen.findByRole('dialog', { name: 'Adjust' });
    expect(within(sheet).getByRole('checkbox', { name: 'CO₂' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Download as CSV' })).toBeInTheDocument();
    for (const name of ['Share', /Views/, /Compare/]) expect(within(sheet).queryByRole('button', { name })).not.toBeInTheDocument();
    // Saved views belong to an account, so a reader through a link does not even ask for them.
    expect(server.askedFor).not.toContain('/chart-views');
    // No line of a device was answered, so there is none to tick away either.
    expect(within(sheet).queryByRole('checkbox', { name: 'Device messages' })).not.toBeInTheDocument();
    expect(server.wrote).toEqual([]);
  });

  it('writes no note and corrects no line', async () => {
    server.over = { deviceIds: null, events: [watered], machineEvents: { shown: 0, total: 0 }, grows: [], growId: null };
    draw(
      `/shared/token-1?at=${ago(3)}`,
      <SharedTimeline spaceId="space-1" shared={{ token: 'token-1', picture: id => `/shared-media/${id}` }} title={<h2>Timeline</h2>} />,
    );
    await settled();

    expect(screen.queryByRole('button', { name: /Write a note/ })).not.toBeInTheDocument();
    const line = within(screen.getByRole('region', { name: 'Diary in this window' })).getByRole('listitem');
    expect(within(line).getAllByRole('button')).toHaveLength(1);
  });
});

describe('the bar`s item with no place to show', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => (new URL(String(input)).pathname.endsWith('/home') ? json(homeOf([], true)) : wire(input))),
    );
  });

  it('sends an account with no place yet to Start, where a device is added and a grow is started', async () => {
    draw();

    expect(await screen.findByText(/Add a device or start a grow/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  });

  it('tells the demo that nothing was left in it, rather than asking it to add a device', async () => {
    who.is = 'demo';
    draw();

    expect(await screen.findByText('The demo has nothing to draw; nothing has been left in this one to look at.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
  });
});
