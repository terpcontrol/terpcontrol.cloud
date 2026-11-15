import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, CardValue, SpaceTimeline } from '@fg2/shared-types/v1';
import { LogContext, type Told } from '@/log/log-context';
import { SharedTimeline } from '@/screens/timeline/Timeline';
import { Timeline } from '@/screens/Timeline';
import { forgetKept } from '@/ui/kept';
import { LoadFailed } from '@/ui/PageState';
import { zonedAt } from '@/ui/zone';
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
    silences: [],
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
    stretches: [],
    deviceChanges: [],
    arrivals: [],
    devices: [],
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

/** The device as it reads a few seconds ago: what the page says at rest, where a test names no other reading. */
const reads = (): NonNullable<SpaceTimeline['reading']> => ({
  measuredAt: iso(NOW - 6000),
  values: (
    [
      ['temperature', 25.2],
      ['humidity', 58],
      ['vpd', 1.4],
      ['co2', 820],
    ] as const
  ).map(([metric, value]) => ({ metric, value, measuredAt: iso(NOW - 6000), state: 'live' as const })),
  outputs: [
    { output: 'light', on: true, level: 65 },
    { output: 'heater', on: false, level: 0 },
    { output: 'dehumidifier', on: false, level: null },
  ],
});

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
  /** Whether a lamp module stands in the place beside its fridge module. */
  lamp: false,
  /** The account's grows as the list of them answers, where a test reads it. */
  grows: null as unknown[] | null,
  /** The plants of the grow standing here, where a test reads them. */
  plants: null as unknown[] | null,
  /** Whether the account has a place that has ended, "Old tent", where an ended grow stood last. */
  gone: false,
  /** Whether every read of the account's grows fails, as a server error does. */
  growsFail: false,
};

const wire = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = url.pathname.replace(/^.*\/v1/, '');
  const method = init?.method ?? 'GET';
  if (method !== 'GET') server.wrote.push(`${method} ${path}`);
  else server.askedFor.push(path);

  const second = server.elsewhere;
  if (server.growsFail && path.startsWith('/grows')) return json({ status: 500, code: 'unexpected', title: 'Broken', detail: '', errors: [] }, 500);
  if (path === '/home') {
    const cards = [
      cardOf({ name: 'Tent 1', kind: 'tent' }),
      ...(second ? [cardOf({ spaceId: 'space-2', name: 'Tent 2', kind: 'tent', deviceIds: ['device-2'] })] : []),
    ];
    return json(homeOf(cards, true));
  }
  if (path === '/spaces' && url.searchParams.get('archived') === 'true')
    return json(spacePage(...(server.gone ? [spaceWhere('own', { id: 'space-gone', name: 'Old tent', archivedAt: ago(48) })] : [])));
  if (path === '/spaces')
    return json(spacePage(spaceWhere(server.youMay), ...(second ? [spaceWhere('own', { id: 'space-2', name: 'Tent 2' })] : [])));
  if (server.gone && path === '/spaces/space-gone/timeline') {
    server.asked.push(url.searchParams);
    return json(
      answerTo(url.searchParams, { spaceId: 'space-gone', name: 'Old tent', panels: [], outputs: [], cameras: [], deviceIds: [], ...server.over }),
    );
  }
  if (server.gone && path === '/grows/grow-gone') {
    const placements = [{ id: 'placement-gone', spaceId: 'space-gone', startedAt: ago(40 * 24), endedAt: ago(48), plantIds: null }];
    return json({ id: 'grow-gone', name: 'Old haze', measurements: [], placements, endedAt: ago(48), ownerId: 'user-1' });
  }
  if (path === '/devices') {
    return json({
      items: [
        fridge(),
        ...(second ? [fridge({ id: 'device-2', type: 'controller', name: 'Controller B', spaceId: 'space-2' })] : []),
        ...(server.lamp ? [fridge({ id: 'lamp-1', type: 'light', name: 'Grow light', configuration: null })] : []),
      ],
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
  if (path === '/grows' && server.grows) return json({ items: server.grows, nextCursor: null });
  if (path === '/grows/grow-1/plants' && server.plants) return json({ items: server.plants, nextCursor: null });
  return json(NOT_FOUND, 404);
};

const opened: unknown[][] = [];
const told: Told[] = [];

function Address() {
  const { pathname, search } = useLocation();
  return <output data-testid="address">{decodeURIComponent(`${pathname}${search}`)}</output>;
}

/** One output's lane: its label and its strip. */
const lane = (output: string, within: Element = document.body) => within.querySelector(`li[data-output="${output}"]`);

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
    reading: reads(),
    views: [],
    wrote: [],
    elsewhere: false,
    lamp: false,
    grows: null,
    plants: null,
    gone: false,
    growsFail: false,
  });
  opened.length = 0;
  told.length = 0;
  localStorage.clear();
  forgetKept();
  vi.stubGlobal('fetch', vi.fn(wire));
});

afterEach(() => vi.unstubAllGlobals());

describe('Verlauf as it opens', () => {
  it('names itself while it waits for the account´s places, as it does once they are read', async () => {
    draw();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Timeline');
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    await settled();
  });

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
    // A panel's heading is its name alone: the (i) beside it is a button of its own, not read as part of the heading.
    expect(within(panel('VPD')).getByRole('heading', { level: 2 })).toHaveAccessibleName('VPD');
  });

  /**
   * One row of name, range and figure wrapped where the row ran out: at 320 px a short name ("CO₂") kept its figure
   * on the name's row and every longer one put it under the name. The figure stands beside the name and its range,
   * which wrap among themselves, so it ends the name's row in every panel.
   */
  it('sets every panel´s figure beside its name and range, never among them', async () => {
    draw();
    await settled();

    for (const name of ['Temperature', 'Humidity', 'VPD']) {
      const head = panel(name).querySelector('header')!;
      expect([...head.children].map(child => child.tagName)).toEqual(['SPAN', 'STRONG']);
      expect(head.firstElementChild).toContainElement(within(panel(name)).getByRole('heading', { level: 2 }));
    }
  });

  /** At 320 CO₂'s short name kept its low and high beside it, where every other panel's stood under its name. */
  it('puts every panel´s low and high under its name on a phone, CO₂´s too', async () => {
    draw('/timeline?show=temperature,humidity,vpd,co2');
    await settled();

    for (const name of ['Temperature', 'Humidity', 'VPD', 'CO₂']) {
      const label = panel(name).querySelector('header')!.firstElementChild!;
      expect([...label.children].map(child => child.textContent)).toEqual([name, expect.stringMatching(/^Low .* · High /)]);
    }
    const sheet = readFileSync(resolve(__dirname, '../src/screens/timeline/Timeline.module.css'), 'utf8');
    expect(sheet).toMatch(/@media \(max-width: 599px\) \{\s*\.panelRange \{\s*flex-basis: 100%;/);
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
    // The line under the window's name opens with a capital, as every line does: "Day 28–29 · every 3 min".
    expect(move.querySelector('small')).toHaveTextContent(/^Day 28–29 · every \d+ (s|min|h)$/);
    expect(within(move).getByRole('button', { name: '24 h later' })).toBeDisabled();
    expect(within(move).getByRole('button', { name: '24 h earlier' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '24 h', pressed: true })).toBeInTheDocument();
  });

  it('puts each output under the curve it acts on, and beside the rail the lamp under the last panel', async () => {
    draw();
    await settled();

    // The share of the time it ran stands beside each output's name, on the screen - and the lamp's stretches by
    // the clock beside the rail as on a phone.
    expect(lane('heater', panel('Temperature'))).toHaveTextContent('Heater · on 0 % of the time');
    expect(lane('dehumidifier', panel('Humidity'))).toHaveTextContent('Dehumidifier · on 2 % of the time');
    // Lit through the whole window: "on since" would name the window's first minute as a switch.
    expect(lane('light', panel('VPD'))).toHaveTextContent('Light · on throughout · 65 %');
  });

  it('gives the lamp a card of its own on a phone, with when it burned and how bright', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    draw();
    await settled();

    const card = screen.getByRole('heading', { name: 'Light' }).closest('section')!;
    expect(lane('light', card)).toHaveTextContent('Light · on throughout · 65 %');
    expect(lane('light', panel('VPD'))).toBeNull();
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
    // One form per output: one driven at a level reads in per cent and "off" at none, as on Start; a switch on or off.
    expect(card).toHaveTextContent('Light 65 % · Heater off · Dehumidifier off');
  });

  it('names every figure on the card once one of them needs its name, never some of them', async () => {
    const { panels } = answerTo(new URLSearchParams());
    server.over = { panels: [...panels, { ...panels[0], metric: 'leafTemperature' }] };
    draw('/timeline?show=temperature,leafTemperature,humidity');
    await settled();

    // Two figures in degrees are told apart by name, and then the humidity beside them is named too.
    expect(screen.getByRole('region', { name: 'Cursor' })).toHaveTextContent(/Temperature 25\.2 °C · Humidity 58\.0 % · Leaf temperature/);
  });

  it('is reached by the keyboard in the order it stands: in one column the card before the plots and "Adjust" by the title, in two the ranges before "Adjust"', async () => {
    const before = (one: Element, other: Element) => Boolean(one.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING);
    const view = draw();
    await settled();
    const card = screen.getByRole('region', { name: 'Cursor' });
    expect(before(card, within(panel('Temperature')).getByRole('slider'))).toBe(true);
    expect(before(screen.getByRole('button', { name: 'Adjust' }), screen.getByRole('group', { name: /range/i }))).toBe(true);
    view.unmount();

    // Two columns from 1200 px: the head is one row with "Adjust" at its end, and the card heads the column beside the plots.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1200px)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    draw();
    await settled();
    expect(before(screen.getByRole('group', { name: /range/i }), screen.getByRole('button', { name: 'Adjust' }))).toBe(true);
    expect(before(within(panel('Temperature')).getByRole('slider'), screen.getByRole('region', { name: 'Cursor' }))).toBe(true);
  });

  it('names a lamp`s stretch that ended in a silence by its last reading, and one that was switched off by when', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const hour = (index: number) => iso(NOW - (24 - index) * HOUR);
    const lamp = (heard: number[], lit: (index: number) => boolean) => ({
      output: 'light' as const,
      deviceId: 'device-1',
      spans: [{ startsAt: hour(2), endsAt: hour(10) }],
      heardUntil: hour(Math.max(...heard)),
      points: heard.map(index => ({ measuredAt: hour(index), heard: 12, on: lit(index) ? 12 : 0, level: lit(index) ? 65 : 0 })),
    });
    const hours = Array.from({ length: 24 }, (_, index) => index + 1);

    // Heard for ten hours and then no more: the lamp was lit when the device fell silent.
    server.over = { outputs: [lamp(hours.slice(0, 10), index => index > 2)] };
    const first = draw();
    await settled();
    expect(lane('light')).toHaveTextContent(/Light · \d\d:\d\d to last reading \d\d:\d\d · on \d+ % of the time · 65 %/);
    first.unmount();

    // Heard all day: it was switched off, and the stretch has two ends.
    server.over = { outputs: [lamp(hours, index => index > 2 && index <= 10)] };
    draw();
    await settled();
    const card = screen.getByRole('heading', { name: 'Light' }).closest('section')!;
    expect(card).toHaveTextContent(/Light · \d\d:\d\d to \d\d:\d\d · on \d+ % of the time · 65 %/);
    expect(card).not.toHaveTextContent('last reading');
  });

  // Rest stands on the last reading. A picture taken after that reading was the only one "after the cursor", and
  // play stopped on it at once - six loads of eight on a tent that reports every thirty seconds.
  it('plays the window from its first picture where no cursor was set, also with a picture newer than the reading', async () => {
    server.reading = { ...reads(), measuredAt: iso(NOW - 90_000) };
    draw();
    await settled();

    fireEvent.click(within(screen.getByRole('region', { name: 'Cursor' })).getByRole('button', { name: 'Play the window' }));
    // The first picture of the window, two hours into it - not the newest, which lies after the reading.
    await waitFor(() => expect(Math.abs(Date.parse(address().searchParams.get('at') ?? '') - (NOW - 22 * HOUR))).toBeLessThan(60_000));
    expect(within(screen.getByRole('region', { name: 'Cursor' })).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Cursor' })).getByRole('img', { name: /at the cursor/ })).toHaveAttribute(
      'src',
      '/media/still-old',
    );
  });

  it('plays on from a cursor the address carries', async () => {
    draw(`/timeline?at=${iso(NOW - 10 * HOUR)}`);
    await settled();

    fireEvent.click(within(screen.getByRole('region', { name: 'Cursor' })).getByRole('button', { name: 'Play the window' }));
    // The next picture after it is the newest one, a minute before now.
    await waitFor(() => expect(Date.parse(address().searchParams.get('at') ?? '')).toBeGreaterThan(NOW - HOUR));
  });

  it('lists what was written in the window, oldest first, a device`s line marked as its own', async () => {
    draw();
    await settled();

    const lines = within(screen.getByRole('region', { name: 'Diary in this window' })).getAllByRole('listitem');
    expect(lines.map(line => line.textContent)).toEqual([expect.stringMatching(/Device rebooted.*automatic/), expect.stringMatching(/You watered/)]);
  });

  it('says in that list when another device took over the measuring, as a line nobody wrote', async () => {
    server.over = { deviceChanges: [{ kind: 'device', at: ago(4), name: 'Controller B', type: 'controller' }] };
    draw();
    await settled();

    const lines = within(screen.getByRole('region', { name: 'Diary in this window' })).getAllByRole('listitem');
    expect(lines.map(line => line.textContent)).toEqual([
      expect.stringMatching(/Device rebooted/),
      // The stamp says when, and the line does not say the hour again.
      expect.stringMatching(/^\d\d:\d\d, Set the cursor on this momentController B measures from here onautomatic$/),
      expect.stringMatching(/You watered/),
    ]);
  });

  /** Start and the grow's diary say a maintenance as one line; the list read "started" and "ended" as two lines of each. */
  it('says a maintenance and regulation switched off as one line each, as the grow´s diary does', async () => {
    server.over = {
      stretches: [
        { kind: 'maintenance', at: ago(4), endedAt: iso(NOW - 4 * HOUR + 2 * 60_000) },
        { kind: 'controlOff', at: ago(2), endedAt: null },
      ],
    };
    draw();
    await settled();

    const lines = within(screen.getByRole('region', { name: 'Diary in this window' })).getAllByRole('listitem');
    expect(lines.map(line => line.textContent)).toEqual([
      expect.stringMatching(/Device rebooted/),
      expect.stringMatching(/Maintenance · 2 min/),
      expect.stringMatching(/You watered/),
      expect.stringMatching(/Control is off/),
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
    // With no grow's days the step opens the line under the window's name, and with a capital.
    expect(screen.getByRole('group', { name: 'Move and zoom the window' }).querySelector('small')).toHaveTextContent(/^Every \d+ (s|min|h)$/);
  });
});

describe('what the place reads now', () => {
  const value = (metric: CardValue['metric'], figure: number, minutesAgo: number): CardValue =>
    ({
      metric,
      value: figure,
      measuredAt: iso(NOW - minutesAgo * 60_000),
      // The server's own mark: stale from two minutes, offline from ten.
      state: minutesAgo >= 10 ? 'offline' : minutesAgo >= 2 ? 'stale' : 'live',
    }) as CardValue;
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
    // An output the reading did not hear is a dash - not a window's mean under the reading's stamp.
    expect(card).toHaveTextContent('Light 40 % · Heater — · Dehumidifier on');
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

  // A reading five to ten minutes old stood past the reach of a cursor left at the end of a day's window: the card
  // was blank under "now", the heads were blank, and the outputs were the lanes', which contradicted the reading.
  it.each(['/timeline', '/timeline?range=7d'])(
    'is "last reading" from the moment the server calls it stale, with its figures and its outputs: %s',
    async path => {
      server.reading = read(
        6,
        [value('temperature', 20.5, 6), value('humidity', 55.9, 6), value('vpd', 1.03, 6)],
        [
          { output: 'light', on: false, level: 0 },
          { output: 'heater', on: true, level: 46 },
          { output: 'dehumidifier', on: false, level: null },
        ],
      );
      draw(path);
      await settled();

      const card = screen.getByRole('region', { name: 'Cursor' });
      await waitFor(() => expect(card).toHaveTextContent(/Cursor · last reading · /));
      expect(card).not.toHaveTextContent('now');
      expect(card).toHaveTextContent('20.5 °C · 55.9 % · 1.03 kPa');
      expect(card).toHaveTextContent('Light off · Heater 46 % · Dehumidifier off');
      expect(within(panel('Temperature')).getByText('20.5 °C')).toBeInTheDocument();
      expect(within(panel('Humidity')).getByText('55.9 %')).toBeInTheDocument();
    },
  );

  it('is the reading at rest whatever is ticked: with no curve drawn the card still says "now" and the reading`s outputs', async () => {
    draw('/timeline?show=light,outputs');

    const card = await screen.findByRole('region', { name: 'Cursor' });
    await waitFor(() => expect(card).toHaveTextContent(/Cursor · now, \d\d:\d\d/));
    expect(card).toHaveTextContent('Light 65 % · Heater off · Dehumidifier off');
  });

  // A window given relative to now reaches now, and its end stands up to a beat behind the clock: clamped to that
  // end, rest stood on a mean beside the reading, and half the loads of a zoom read "last reading" over a live tent.
  it.each(['/timeline?last=300', '/timeline?last=1200', '/timeline?last=3600'])(
    'rests a zoom on a reading newer than the window`s end: %s',
    async path => {
      server.reading = { ...reads(), measuredAt: iso(NOW + 25_000) };
      draw(path);
      await settled();

      const card = screen.getByRole('region', { name: 'Cursor' });
      await waitFor(() => expect(card).toHaveTextContent(/Cursor · now, \d\d:\d\d/));
      expect(card).toHaveTextContent('25.2 °C · 58.0 % · 1.40 kPa');
      expect(card).toHaveTextContent('Light 65 % · Heater off · Dehumidifier off');
    },
  );

  it('shows at rest every value the reading carries, an older one with its own time, and no dash without its name', async () => {
    server.reading = {
      ...reads(),
      values: [
        ...reads().values.filter(one => one.metric !== 'co2' && one.metric !== 'vpd'),
        // The CO2 sensor reports every few minutes: its newest figure is five minutes older than the reading.
        { metric: 'co2', value: 801, measuredAt: iso(NOW - 306_000), state: 'stale' },
      ],
    };
    draw('/timeline?show=temperature,vpd,co2');
    await settled();

    const card = screen.getByRole('region', { name: 'Cursor' });
    await waitFor(() => expect(card).toHaveTextContent(/25\.2 °C · VPD — · CO₂ 801 ppm · \d\d:\d\d/));
    // The panel's head marks the older value as the card does.
    expect(within(panel('CO₂')).getByText(/^801 ppm · \d\d:\d\d$/)).toBeInTheDocument();
  });

  it('names a lamp`s stretch by the switch that began it, a silence that ended since as a gap, and a level alike in every stretch once', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const hour = (index: number) => iso(NOW - (24 - index) * HOUR);
    const hours = Array.from({ length: 24 }, (_, index) => index + 1);
    // A point after hours nothing was heard in says so, as the server's lanes do.
    const points = (heard: number[], lit: (index: number) => boolean) =>
      heard.map(index => ({
        measuredAt: hour(index),
        heard: 12,
        on: lit(index) ? 12 : 0,
        level: lit(index) ? 65 : 0,
        resumed: !heard.includes(index - 1) && index > 1,
      }));
    const lamp = (spans: [number, number][], heard: number[], lit: (index: number) => boolean) => ({
      output: 'light' as const,
      deviceId: 'device-1',
      spans: spans.map(([from, to]) => ({ startsAt: hour(from), endsAt: hour(to) })),
      heardUntil: hour(24),
      points: points(heard, lit),
    });

    // Came on four hours into the window and is still lit: the switch lies in the window, and is named.
    server.over = { outputs: [lamp([[4, 24]], hours, index => index > 4)] };
    const first = draw();
    await settled();
    expect(lane('light')).toHaveTextContent(/^Light · on since \d\d:\d\d · on 83 % of the time · 65 %$/);
    first.unmount();

    // Lit, silent from the tenth hour to the sixteenth, lit again to the twentieth: the first stretch ends in a gap,
    // and the second begins where the gap ends - with no switch, so it is "on", not a time it came on at.
    const heard = hours.filter(index => index <= 10 || index > 16);
    server.over = {
      outputs: [
        lamp(
          [
            [2, 10],
            [16, 20],
          ],
          heard,
          index => index > 2 && index <= 20,
        ),
      ],
    };
    draw();
    await settled();
    expect(lane('light')).toHaveTextContent(
      /^Light · \d\d:\d\d to \d\d:\d\d · gap until \d\d:\d\d · on until \d\d:\d\d · on \d+ % of the time · 65 %$/,
    );
    expect(lane('light')).not.toHaveTextContent('last reading');
  });

  it('says a switch only where one is: a stretch that begins where a silence ends is a gap and "on"', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const hour = (index: number) => iso(NOW - (24 - index) * HOUR);
    const lamp = (spans: [number, number][], heard: number[], level = 65) => ({
      output: 'light' as const,
      deviceId: 'device-1',
      spans: spans.map(([from, to]) => ({ startsAt: hour(from), endsAt: hour(to) })),
      heardUntil: hour(24),
      points: heard.map(index => ({ measuredAt: hour(index), heard: 12, on: 12, level, resumed: !heard.includes(index - 1) && index > 1 })),
    });
    const later = Array.from({ length: 24 }, (_, index) => index + 1).filter(index => index > 18);

    // Silent until the eighteenth hour, lit ever since: no switch lies in the window, and none is named.
    server.over = { outputs: [lamp([[18, 24]], later)] };
    const first = draw();
    await settled();
    expect(lane('light')).toHaveTextContent(/^Light · gap until \d\d:\d\d · on · 65 %$/);
    first.unmount();

    // The same, switched off at the twenty-second hour: "on until", not a stretch from the end of a silence.
    server.over = {
      outputs: [
        {
          ...lamp([[18, 22]], later),
          points: later.map(index => ({
            measuredAt: hour(index),
            heard: 12,
            on: index <= 22 ? 12 : 0,
            level: index <= 22 ? 65 : 0,
            resumed: index === 19,
          })),
        },
      ],
    };
    const second = draw();
    await settled();
    expect(lane('light')).toHaveTextContent(/^Light · gap until \d\d:\d\d · on until \d\d:\d\d · on 67 % of the time · 65 %$/);
    second.unmount();

    // Lit through the whole window at full level: one fact, said once.
    server.over = {
      outputs: [
        lamp(
          [[0, 24]],
          Array.from({ length: 24 }, (_, index) => index + 1),
          100,
        ),
      ],
    };
    draw();
    await settled();
    expect(lane('light')).toHaveTextContent(/^Light · on throughout$/);
  });

  it('adds to the share of an output driven at a level how hard it ran on average', async () => {
    const points = Array.from({ length: 24 }, (_, index) => ({
      measuredAt: iso(NOW - (23 - index) * HOUR),
      heard: 12,
      on: index < 6 ? 12 : 0,
      level: index < 6 ? 48 : 0,
    }));
    server.over = {
      outputs: [
        { output: 'heater', deviceId: 'device-1', spans: [], heardUntil: iso(NOW), points },
        { output: 'dehumidifier', deviceId: 'device-1', spans: [], heardUntil: iso(NOW), points: points.map(point => ({ ...point, level: null })) },
      ],
    };
    draw();
    await settled();

    expect(lane('heater')).toHaveTextContent(/^Heater · on 25 % of the time · 12 % on average$/);
    // A switch has no level to average.
    expect(lane('dehumidifier')).toHaveTextContent(/^Dehumidifier · on 25 % of the time$/);
  });

  it('says "on since" only of a lamp heard now: under a stale reading its stretch ends at that reading', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const fresh = draw();
    await settled();
    expect(lane('light')).toHaveTextContent('Light · on throughout');
    fresh.unmount();

    server.reading = read(6, [value('temperature', 20.5, 6)], [{ output: 'light', on: true, level: 65 }]);
    draw();
    await settled();
    // On in all that was heard: the stretch says so, and the share would say it again.
    await waitFor(() => expect(lane('light')).toHaveTextContent(/^Light · until last reading \d\d:\d\d · 65 %$/));
    expect(lane('light')).not.toHaveTextContent(/on since|throughout/);
  });

  it('rests a window that ended in the past on its last drawn point: never a blank card over a curve', async () => {
    const [from, to] = [iso(NOW - 30 * HOUR), iso(NOW - 6 * HOUR)];
    draw(`/timeline?from=${from}&to=${to}`);
    await settled();

    const card = screen.getByRole('region', { name: 'Cursor' });
    // The last point is the mean of what the window's end left of its hour, and says so: it never runs past that end.
    await waitFor(() => expect(card).toHaveTextContent(/Cursor · mean \d\d:\d\d(:\d\d)?–\d\d:\d\d(:\d\d)?/));
    expect(card).toHaveTextContent('25.2 °C · 58.0 % · 1.40 kPa');
    // What the outputs did over that point, counted from its samples.
    expect(card).toHaveTextContent('Light 65 % · Heater off · Dehumidifier off');
    expect(within(panel('Temperature')).getByText('25.2 °C')).toBeInTheDocument();
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
  /**
   * A place with a fridge module and a lamp module drew one "Light" strip of both, its words running two lamps' days
   * into one and the card saying "Light 100 %" of neither. Each lamp is its own strip, named as Steuerung names it,
   * and the card reads each lamp off its own.
   */
  it('draws each lamp of the place apart, named, and reads each one on the card', async () => {
    server.lamp = true;
    server.reading = read(0.1, [value('temperature', 26.7, 0.1)], [{ output: 'light', on: true, level: 40 }]);
    const lamp = {
      output: 'light' as const,
      deviceId: 'lamp-1',
      spans: [{ startsAt: ago(24), endsAt: ago(0) }],
      heardUntil: ago(0),
      points: Array.from({ length: 24 }, (_, index) => ({ measuredAt: ago(23 - index), heard: 12, on: 12, level: 100 })),
    };
    server.over = { outputs: [...answerTo(new URLSearchParams({ range: '24h' }), {}).outputs, lamp] };
    draw();
    await settled();

    const card = screen.getByRole('region', { name: 'Cursor' });
    await waitFor(() => expect(card).toHaveTextContent(/Light · [^·]+ 40 %/));
    expect(card).toHaveTextContent(/(Light · )?Grow light 100 %/);
    const strips = screen.getAllByRole('listitem').filter(item => item.hasAttribute('data-output') && item.getAttribute('data-output') === 'light');
    expect(strips.map(strip => strip.textContent)).toEqual([expect.stringMatching(/^Light · /), expect.stringMatching(/Grow light/)]);
  });

  /** "no reading · since 09:46" under a cursor where the lamp module's strip right below was lit at 100 %. */
  it('reads a lamp module heard through the controller`s silence on the card, beside the silence', async () => {
    server.lamp = true;
    server.reading = read(8 * 60, [value('temperature', 26.7, 8 * 60)], [{ output: 'light', on: true, level: 40 }]);
    const whole = answerTo(new URLSearchParams({ range: '24h' }), {});
    const heard = (point: { measuredAt: string }) => Date.parse(point.measuredAt) <= NOW - 8 * HOUR;
    const lamp = {
      output: 'light' as const,
      deviceId: 'lamp-1',
      spans: [{ startsAt: ago(24), endsAt: ago(0) }],
      heardUntil: ago(0),
      points: Array.from({ length: 24 }, (_, index) => ({ measuredAt: ago(23 - index), heard: 12, on: 12, level: 100 })),
    };
    server.over = {
      panels: whole.panels.map(one => ({ ...one, points: one.points.filter(heard) })),
      outputs: [...whole.outputs.map(one => ({ ...one, heardUntil: ago(8), points: one.points!.filter(heard) })), lamp],
      silences: [{ startsAt: ago(8), endsAt: ago(0) }],
    };
    draw(`/timeline?at=${ago(3)}`);
    await settled();

    const card = screen.getByRole('region', { name: 'Cursor' });
    await waitFor(() => expect(within(card).getByText('no reading')).toBeInTheDocument());
    expect(card).toHaveTextContent(/(Light · )?Grow light 100 %/);
    expect(card).not.toHaveTextContent(/Light · [^·]+ 40 %/);
  });

  /** A lamp module given up since was "Light 2" on its strip, the card and the CSV: the account holds it no longer. */
  it('names a lamp that has left the account by what the answer says it was called', async () => {
    const lamp = {
      output: 'light' as const,
      deviceId: 'lamp-gone',
      spans: [{ startsAt: ago(24), endsAt: ago(6) }],
      heardUntil: ago(6),
      points: Array.from({ length: 18 }, (_, index) => ({ measuredAt: ago(23 - index), heard: 12, on: 12, level: 100 })),
    };
    server.over = {
      outputs: [...answerTo(new URLSearchParams({ range: '24h' }), {}).outputs, lamp],
      devices: [
        { deviceId: 'device-1', name: null, type: 'fridge' },
        { deviceId: 'lamp-gone', name: 'Old lamp', type: 'light' },
      ],
    };
    draw();
    await settled();

    const strips = screen.getAllByRole('listitem').filter(item => item.getAttribute('data-output') === 'light');
    expect(strips.map(strip => strip.textContent)).toEqual([expect.stringMatching(/^Light · /), expect.stringMatching(/Old lamp/)]);
  });
});

describe('the cursor', () => {
  /**
   * The row at rest lies unseen under the row on view and held its column as wide as its longest fact: "Blatttemperatur
   * 24,4 °C" at 360 px widened it past the card's text, and the figure ran under the zoom's "+". jsdom lays nothing
   * out, so the rule is read from the sheet: the column is never wider than the row, and a fact longer than it breaks.
   */
  it('keeps a row at rest inside the card`s text, so no figure runs under the zoom buttons', () => {
    const sheet = readFileSync(resolve(__dirname, '../src/screens/timeline/Timeline.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector: string) => sheet.match(new RegExp(`${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule('.screen [data-rest]')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule('.screen [data-rest]')).toMatch(/max-width:\s*100%/);
    expect(rule('.screen [data-rest]::before')).toMatch(/overflow-wrap:\s*anywhere/);
  });

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

  it('names the arrows of a stretch no chip names by its whole days, and of any other width as the stretch before', async () => {
    draw('/timeline?last=259200');
    await settled();
    expect(screen.getByRole('button', { name: '3 days earlier' })).toBeInTheDocument();

    // Seventy-two hours and a minute are nobody's unit: never "4321 min earlier".
    draw(`/timeline?from=${iso(NOW - 80 * HOUR)}&to=${iso(NOW - 8 * HOUR + 60_000)}`);
    await settled();
    expect(await screen.findByRole('button', { name: 'The stretch before' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /min earlier/ })).not.toBeInTheDocument();
  });

  it('says a silence once, with its ends, in rows that stay as high as they are at rest', async () => {
    // Nothing measured and nothing heard between the tenth hour and the sixteenth.
    const quiet = (index: number) => index >= 10 && index < 16;
    const whole = answerTo(new URLSearchParams());
    server.over = {
      panels: whole.panels.map(one => ({
        ...one,
        points: one.points.flatMap((point, index) => (quiet(index) ? (index === 10 ? [{ ...point, value: null }] : []) : [point])),
      })),
      outputs: whole.outputs.map(one => ({
        ...one,
        points: one.points!.filter((_, index) => !quiet(index)).map((point, index) => ({ ...point, resumed: index === 10 })),
      })),
      // The answer names the silence by its samples: the last before it, the first after it.
      silences: [{ startsAt: iso(NOW - 14 * HOUR - 5000), endsAt: iso(NOW - 8 * HOUR + 20_000) }],
    };
    draw(`/timeline?at=${iso(NOW - 11.5 * HOUR)}`);
    await settled();

    const card = screen.getByRole('region', { name: 'Cursor' });
    // One row says it, the other between which two readings: the card's two rows, and no third.
    await waitFor(() => expect(within(card).getByText('no reading')).toBeInTheDocument());
    const clock = (time: number) => new Date(time).toISOString().slice(11, 16);
    expect(within(card).getByText(`${clock(NOW - 14 * HOUR - 5000)} to ${clock(NOW - 8 * HOUR + 20_000)}`)).toBeInTheDocument();
    // No wall of named dashes, and no output said as unknown five times.
    expect(card).not.toHaveTextContent('—');
    // What the rows say at rest lies unseen under them and holds their height.
    const rows = [...card.querySelectorAll('[data-rest]')].map(row => row.getAttribute('data-rest')!.replace(/\u00a0/g, ' '));
    expect(rows).toEqual(['25.2 °C · 58.0 % · 1.40 kPa', 'Light 65 % · Heater off · Dehumidifier off']);
    // So does a head's figure: a dash is narrower than a reading, and the head must not wrap another way for it.
    expect(within(panel('Temperature')).getByText('—').parentElement).toHaveAttribute('data-rest', '25.2\u00a0°C');
  });

  it('does not call a point of one sample a mean: it says the stretch the sample lies in', async () => {
    const whole = answerTo(new URLSearchParams());
    // A device that reports once an hour, drawn at an hour a point.
    server.over = {
      outputs: whole.outputs.map(one => ({ ...one, points: one.points!.map(point => ({ ...point, heard: 1, on: Math.min(point.on, 1) })) })),
    };
    draw(`/timeline?at=${iso(NOW - 10.5 * HOUR)}`);
    await settled();

    const card = screen.getByRole('region', { name: 'Cursor' });
    await waitFor(() => expect(card).toHaveTextContent(/Cursor · \d\d:\d\d(:\d\d)?–\d\d:\d\d(:\d\d)?25\.2/));
    expect(card).not.toHaveTextContent('mean');
  });

  it('drops a cursor the address sets outside the window it names: the card would read another instant', async () => {
    draw(`/timeline?from=${iso(NOW - 30 * HOUR)}&to=${iso(NOW - 6 * HOUR)}&at=${iso(NOW - 2 * HOUR)}`);
    await settled();

    await waitFor(() => expect(address().searchParams.has('at')).toBe(false));
    expect(address().searchParams.has('from')).toBe(true);
  });

  it.each(['show=', 'show=diary,machine', 'show=nonsense'])(
    'draws the curves a place starts with for an address that names none: %s',
    async asked => {
      draw(`/timeline?${asked}`);
      await settled();

      // One answer to "no curve": the first ones, and never a page that says none is chosen under a bare card.
      expect(screen.getByRole('region', { name: 'Humidity' })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'Cursor' })).toHaveTextContent('25.2 °C · 58.0 % · 1.40 kPa');
      expect(screen.queryByText(/No curve/)).not.toBeInTheDocument();
    },
  );

  it('reads no neighbour`s mean inside a silence the answer names, however near its edge the cursor stands', async () => {
    const whole = answerTo(new URLSearchParams());
    server.over = {
      panels: whole.panels.map(one => ({
        ...one,
        points: one.points.flatMap((point, index) => (index >= 10 && index < 16 ? (index === 10 ? [{ ...point, value: null }] : []) : [point])),
      })),
      silences: [{ startsAt: iso(NOW - 14 * HOUR), endsAt: iso(NOW - 8 * HOUR) }],
    };
    // Twenty minutes into six silent hours: the point before is nearer than a step and a half.
    draw(`/timeline?at=${iso(NOW - 14 * HOUR + 20 * 60_000)}`);
    await settled();

    const card = screen.getByRole('region', { name: 'Cursor' });
    await waitFor(() => expect(within(card).getByText('no reading')).toBeInTheDocument());
    expect(card).not.toHaveTextContent('mean');
    expect(within(panel('Temperature')).getByText('—')).toBeInTheDocument();
  });

  it('writes the figure of a scale so narrow that both its ends read alike once', async () => {
    const whole = answerTo(new URLSearchParams());
    server.over = {
      // One sample of a device heard once, and no reading to close its curve.
      reading: null,
      panels: whole.panels.map(one =>
        one.metric === 'humidity' ? { ...one, points: one.points.slice(-1).map(point => ({ measuredAt: point.measuredAt, value: 50 })) } : one,
      ),
    };
    draw();
    await settled();

    const ends = [...panel('Humidity').querySelectorAll('span[aria-hidden] > span')].map(end => end.textContent);
    expect(ends.filter(Boolean)).toEqual(['50']);
  });

  it('drops a cursor the address sets in the future, and rests where it would without one', async () => {
    draw(`/timeline?at=${iso(NOW + HOUR)}`);
    await settled();

    await waitFor(() => expect(address().searchParams.has('at')).toBe(false));
    expect(screen.getByRole('region', { name: 'Cursor' })).toHaveTextContent(/Cursor · now, \d\d:\d\d/);
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
    expect(await screen.findByText(/The device in the address is not in this place/)).toBeInTheDocument();
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

  /**
   * Under "has no place" stood the chosen place's curves, its day numbers and its diary, and on a phone nothing named
   * that place: they read as the grow's. The sentence stands alone, with the way on to the place's own Verlauf.
   */
  it('sends a grow that stands in no place to its page of measurements, and draws no other place´s curves under it', async () => {
    draw('/timeline?grow=grow-loose');

    expect(await screen.findByText(/“Windowsill” has no place and so no climate curves/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Measurements/ })).toHaveAttribute('href', '/grows/grow-loose/measurements');
    await waitFor(() => expect(address().searchParams.has('grow')).toBe(false));
    expect(server.asked.every(query => !query.has('growId'))).toBe(true);
    expect(screen.queryByRole('region', { name: 'Temperature' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Diary in this window' })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /Timeline of Tent 1/ }));
    await settled();
    expect(screen.queryByText(/has no place/)).not.toBeInTheDocument();
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

  it('keeps the last curve ticked: its box cannot be unticked, and the sheet says so', async () => {
    draw('/timeline?show=temperature,diary');
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust' }));
    const sheet = await screen.findByRole('dialog', { name: 'Adjust' });

    expect(within(sheet).getByRole('checkbox', { name: 'Temperature' })).toBeDisabled();
    expect(within(sheet).getByText('One curve always stays ticked.')).toBeInTheDocument();
    // With a second one ticked either may go again.
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Humidity' }));
    expect(within(sheet).getByRole('checkbox', { name: 'Temperature' })).toBeEnabled();
    expect(within(sheet).queryByText('One curve always stays ticked.')).not.toBeInTheDocument();
  });

  it('ticks a curve the place has into the picture and the address, and remembers it for the next visit', async () => {
    const sheet = await adjust();
    expect(within(sheet).getByRole('checkbox', { name: 'CO₂' })).not.toBeChecked();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'CO₂' }));

    expect(within(sheet).getByRole('checkbox', { name: 'CO₂' })).toBeChecked();
    // The page behind the open sheet is out of the tree, and drawn all the same.
    expect(await screen.findByRole('region', { name: 'CO₂', hidden: true })).toBeInTheDocument();
    expect(address().searchParams.get('show')).toBe('temperature,humidity,vpd,light,outputs,diary,machine,co2');
    expect(JSON.parse(localStorage.getItem('terp.curves')!)).toContain('co2');
    // What the place does not measure is not offered at all.
    expect(within(sheet).queryByRole('checkbox', { name: 'PPFD' })).not.toBeInTheDocument();
  });

  it('draws all curves in one picture, each named with its figure', async () => {
    const sheet = await adjust();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'All curves in one picture' }));

    const one = await screen.findByRole('region', { name: 'Temperature, Humidity, VPD', hidden: true });
    expect(one).toHaveTextContent('Temperature 25.2 °C');
    expect(one).toHaveTextContent('VPD 1.40 kPa');
    expect(address().searchParams.get('one')).toBe('1');
  });

  it('takes the device`s lines out of the diary and leaves what people wrote', async () => {
    server.over = { deviceChanges: [{ kind: 'device', at: ago(4), name: null, type: 'controller' }] };
    const sheet = await adjust();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Device messages' }));

    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Diary in this window', hidden: true })).getAllByRole('listitem', { hidden: true }),
      ).toHaveLength(1),
    );
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
  it('says a folded run´s end in the form its stamps are in: one form of a date in a row', async () => {
    const again = (hours: number) => ({ ...restart, id: `restart-${hours}`, occurredAt: ago(hours) });
    server.over = { events: [again(52), again(51), again(50)] };
    draw(`/timeline?from=${ago(7 * 24)}&to=${iso(NOW - HOUR)}`);
    await settled();

    const [line] = within(screen.getByRole('region', { name: 'Diary in this window' })).getAllByRole('listitem');
    // A stamp is one piece: its weekday and its clock are not broken apart.
    expect(line.textContent).toMatch(/^[A-Z][a-z]{2}\u00a0\d\d:\d\d, Set the cursor on this moment.*3× until [A-Z][a-z]{2}\u00a0\d\d:\d\d/);
  });

  /**
   * The window's lines come oldest first, and the list read "resolved" from a run's first firing - so it never said
   * an alarm was over, and two devices' lines of one name both read open.
   */
  it('says an alarm that is over as over, and one that stands as standing, two devices´ of one name apart', async () => {
    const offline = (id: string, hours: number, deviceId: string, fired: boolean) =>
      entry(id, {
        kind: 'alarm',
        source: 'alarm',
        authorId: null,
        deviceId,
        severity: fired ? 'warning' : 'info',
        text: null,
        occurredAt: ago(hours),
        message: {
          key: fired ? 'message-alarm-triggered' : 'message-alarm-resolved',
          params: [fired ? 'Device offline, last heard 11 min ago' : 'Device offline, back after 1 h'],
        },
        values: { kind: 'alarm' },
      });
    server.over = {
      events: [
        offline('ctrl', 9, 'device-2', true),
        offline('plug-1', 8, 'device-1', true),
        offline('plug-2', 6, 'device-1', true),
        offline('plug-back', 5, 'device-1', false),
      ],
    };
    server.elsewhere = true;
    draw();
    await settled();

    const list = within(screen.getByRole('region', { name: 'Diary in this window' }));
    await waitFor(() => expect(list.getAllByRole('listitem')[1].textContent).toMatch(/Device offline · /));
    const [ctrl, first, second] = list.getAllByRole('listitem').map(line => line.textContent);
    expect(ctrl).toMatch(/Device offline · Controller B/);
    expect(ctrl).not.toMatch(/ over/);
    // Each silence is a line of its own: the one another followed is over, the next one until its clearing.
    expect(first).toMatch(/Device offline · [^·]+ · over/);
    expect(second).toMatch(/Device offline · [^·]+ · until \d\d:\d\d · over/);
  });

  /**
   * An open alarm's run read "5× bis 09:29" - "until" its newest firing, which read as its end - while Meldungen said
   * it stood open since then. It stands at its newest firing, as Meldungen's start, and says since when it fired.
   */
  it('says an alarm that still stands since its first firing, at its newest, and never until', async () => {
    const fired = (id: string, hours: number) =>
      entry(id, {
        kind: 'alarm',
        source: 'alarm',
        authorId: null,
        deviceId: 'device-2',
        severity: 'warning',
        text: null,
        occurredAt: ago(hours),
        message: { key: 'message-alarm-triggered', params: ['Too humid (humidity), value=72, upper threshold=60, lower threshold=n/a'] },
        values: { kind: 'alarm' },
      });
    server.over = { events: [fired('first', 9), fired('newest', 7)] };
    server.elsewhere = true;
    draw();
    await settled();

    const list = within(screen.getByRole('region', { name: 'Diary in this window' }));
    await waitFor(() => expect(list.getByText(/Too humid/)).toBeInTheDocument());
    const [line] = list.getAllByRole('listitem').filter(one => /Too humid/.test(one.textContent ?? ''));
    // The reader's zone is UTC here; a stamp may lead with its day.
    const stamp = (hours: number) => `(\\w{3}\\s)?${ago(hours).slice(11, 16)}`;
    // The line is of this place, which holds another device: it names its own (`calledIn`).
    expect(line.textContent).toMatch(new RegExp(`^${stamp(7)}, .*Too humid · Controller B · 2× since ${stamp(9)}`));
    expect(line.textContent).not.toMatch(/until/);
  });

  /**
   * "09:46 Gerät offline · 4× seit 18:35": a silence since 09:46 folded with the one before the device restarted, two
   * days back, and said that day's 18:35 as if it were the window's. Each silence is its own line, the one that is
   * over from its start - with its day, outside the window's - until its end, the one still going from its own start.
   */
  it('tells each silence apart, the one before a restart from its start with its day until its end', async () => {
    const offline = (id: string, hours: number, alertId: string, fired: boolean, silent = 0) =>
      entry(id, {
        kind: 'alarm',
        source: 'alarm',
        authorId: null,
        deviceId: 'device-2',
        alertId,
        severity: fired ? 'critical' : 'info',
        text: null,
        occurredAt: ago(hours),
        message: {
          key: fired ? 'message-alarm-triggered' : 'message-alarm-resolved',
          params: [fired ? `Device offline, last heard ${Math.floor(silent / 3600)} h ago, silent=${silent}` : 'Device offline, back after 19 h'],
        },
        values: { kind: 'alarm' },
      });
    // Quiet since 40 hours ago, raised again three times inside the window, back four hours ago; quiet again since three.
    server.over = {
      events: [
        offline('again-1', 20, 'alert-1', true, 20 * 3600),
        offline('again-2', 19, 'alert-2', true, 21 * 3600),
        offline('again-3', 18, 'alert-3', true, 22 * 3600),
        offline('back', 4, 'alert-3', false),
        offline('now', 3 - 10 / 60, 'alert-4', true, 600),
      ],
    };
    server.elsewhere = true;
    draw();
    await settled();

    const list = within(screen.getByRole('region', { name: 'Diary in this window' }));
    await waitFor(() => expect(list.getAllByText(/Device offline/)).toHaveLength(2));
    const lines = list.getAllByRole('listitem').flatMap(one => (/Device offline/.test(one.textContent ?? '') ? [one.textContent ?? ''] : []));
    const day = (hours: number) => zonedAt(NOW - hours * HOUR, 'UTC').toFormat('ccc');
    expect(lines).toEqual([
      expect.stringMatching(
        new RegExp(`^${day(40)}\\u00a0${ago(40).slice(11, 16)}, .*Device offline · Controller B · until ${day(4)}\\u00a0${ago(4).slice(11, 16)}`),
      ),
      expect.stringMatching(new RegExp(`^${day(3)}\\u00a0${ago(3).slice(11, 16)}, .*Device offline · Controller B(?! ·)`)),
    ]);
  });

  /**
   * Meldungen said "seit 22:54" and Verlauf's line 22:55 of one silence: the line, written before its seconds were,
   * rounded its span down. Where the window's alarms hold its alert, the line is dated by the alert to the second.
   */
  it('dates a silence by its alert, to the second, where the line rounded it', async () => {
    const raised = NOW - 3 * HOUR;
    server.over = {
      alarms: [
        {
          alertId: 'alert-1',
          kind: 'offline',
          severity: 'critical',
          metric: null,
          startedAt: iso(raised),
          endedAt: null,
          value: 640,
          extremeValue: 640,
        },
      ],
      events: [
        entry('quiet', {
          kind: 'alarm',
          source: 'alarm',
          authorId: null,
          deviceId: 'device-1',
          alertId: 'alert-1',
          severity: 'critical',
          text: null,
          occurredAt: iso(raised),
          message: { key: 'message-alarm-triggered', params: ['Device offline, last heard 10 min ago'] },
          values: { kind: 'alarm' },
        }),
      ],
    };
    draw();
    await settled();

    const list = within(screen.getByRole('region', { name: 'Diary in this window' }));
    await waitFor(() => expect(list.getByText(/Device offline/)).toBeInTheDocument());
    const [line] = list.getAllByRole('listitem').filter(one => /Device offline/.test(one.textContent ?? ''));
    expect(line.textContent).toMatch(new RegExp(`^${iso(raised - 640_000).slice(11, 16)}, `));
  });

  /**
   * Friday's window, as Grow's "Kurven zu diesem Tag" opens it, drew "18:35 Gerät offline" open and red: the line that
   * says the silence ended lies after the window. The window's alarms know its end, and the line says it.
   */
  it('reads the end of a silence the window ends inside from its alert, and draws it over', async () => {
    const [from, to] = [NOW - 72 * HOUR, NOW - 48 * HOUR];
    const raised = from + 6 * HOUR;
    server.over = {
      alarms: [
        {
          alertId: 'alert-1',
          kind: 'offline',
          severity: 'critical',
          metric: null,
          startedAt: iso(raised),
          endedAt: iso(NOW - 30 * HOUR),
          value: 600,
          extremeValue: 600,
        },
      ],
      events: [
        entry('quiet', {
          kind: 'alarm',
          source: 'alarm',
          authorId: null,
          deviceId: 'device-1',
          alertId: 'alert-1',
          severity: 'critical',
          text: null,
          occurredAt: iso(raised),
          message: { key: 'message-alarm-triggered', params: ['Device offline, last heard 10 min ago, silent=600'] },
          values: { kind: 'alarm' },
        }),
      ],
    };
    draw(`/timeline?from=${iso(from)}&to=${iso(to)}`);
    await settled();

    const list = within(screen.getByRole('region', { name: 'Diary in this window' }));
    await waitFor(() => expect(list.getByText(/Device offline/)).toBeInTheDocument());
    const [line] = list.getAllByRole('listitem').filter(one => /Device offline/.test(one.textContent ?? ''));
    const end = zonedAt(NOW - 30 * HOUR, 'UTC');
    expect(line.textContent).toMatch(new RegExp(`Device offline · until ${end.toFormat('ccc')}\u00a0${end.toFormat('HH:mm')} · over`));
    expect(line).not.toHaveAttribute('data-severity');
  });

  /** The 24 h view said "09:44 Gerät offline · behoben" of a silence begun the evening before: neither start nor span. */
  it('stands a silence begun before the window at its start, with its day, until its end', async () => {
    const [quiet, back] = [NOW - 40 * HOUR, NOW - 2 * HOUR];
    server.over = {
      alarms: [
        {
          alertId: 'alert-1',
          kind: 'offline',
          severity: 'critical',
          metric: null,
          startedAt: iso(quiet + 600_000),
          endedAt: iso(back),
          value: 600,
          extremeValue: 600,
        },
      ],
      events: [
        entry('back', {
          kind: 'alarm',
          source: 'alarm',
          authorId: null,
          deviceId: 'device-1',
          alertId: 'alert-1',
          severity: 'info',
          text: null,
          occurredAt: iso(back),
          message: { key: 'message-alarm-resolved', params: ['Device offline, back after 38 h'] },
          values: { kind: 'alarm' },
        }),
      ],
    };
    draw();
    await settled();

    const list = within(screen.getByRole('region', { name: 'Diary in this window' }));
    await waitFor(() => expect(list.getByText(/Device offline/)).toBeInTheDocument());
    const [line] = list.getAllByRole('listitem').filter(one => /Device offline/.test(one.textContent ?? ''));
    const [start, end] = [zonedAt(quiet, 'UTC'), zonedAt(back, 'UTC')];
    expect(line.textContent).toMatch(
      new RegExp(
        `^${start.toFormat('ccc')}\u00a0${start.toFormat('HH:mm')}, .*Device offline.* · until ${end.toFormat('ccc')}\u00a0${end.toFormat('HH:mm')}`,
      ),
    );
  });

  /**
   * Two grows in one tent: Start's lines say whose a line is since the sixth walk; Verlauf's list said nothing. An
   * alarm is the place's, both grows': a line written before named the grow begun last, and is not called its own.
   */
  it('names the grow of each line where the window´s lines are of two grows, and no grow of an alarm', async () => {
    const humid = entry('humid', {
      kind: 'alarm',
      source: 'alarm',
      authorId: null,
      growId: 'grow-2',
      severity: 'warning',
      text: null,
      occurredAt: ago(2),
      message: { key: 'message-alarm-triggered', params: ['Too humid (humidity), value=62, upper threshold=60, lower threshold=n/a'] },
      values: { kind: 'alarm' },
    });
    server.over = {
      events: [entry('mine', { growId: 'grow-1', occurredAt: ago(4) }), entry('theirs', { growId: 'grow-2', occurredAt: ago(3) }), humid],
      grows: [
        { growId: 'grow-1', name: 'Amnesia', startedAt: ago(28 * 24), endedAt: null },
        { growId: 'grow-2', name: 'Gelato', startedAt: ago(10 * 24), endedAt: null },
      ],
    };
    draw();
    await settled();

    const list = within(screen.getByRole('region', { name: 'Diary in this window' }));
    await waitFor(() => expect(list.getAllByRole('listitem')).toHaveLength(3));
    expect(list.getAllByRole('listitem').map(one => one.textContent)).toEqual([
      expect.stringMatching(/Amnesia/),
      expect.stringMatching(/Gelato/),
      expect.not.stringMatching(/Gelato|Amnesia/),
    ]);
  });

  /** A round of readings across two plants read "pH 6,1 pH · pH 6,4 pH" here: no plant named, the unit its name. */
  it('names the plant of each reading, and says no unit that repeats the reading´s name', async () => {
    const round = entry('entry-round', {
      kind: 'measurement',
      growId: 'grow-1',
      occurredAt: ago(3),
      text: null,
      values: {
        kind: 'measurement',
        readings: [
          { key: 'ph', value: 6.1, plantId: 'plant-1' },
          { key: 'ph', value: 6.4, plantId: 'plant-2' },
        ],
      },
    });
    server.plants = [
      { id: 'plant-1', growId: 'grow-1', strain: 'Haze', label: 'Haze 1', status: 'active', harvest: null, createdAt: ago(28 * 24) },
      { id: 'plant-2', growId: 'grow-1', strain: 'Haze', label: 'Haze 2', status: 'active', harvest: null, createdAt: ago(28 * 24) },
    ];
    server.over = { events: [round], readingNames: [{ growId: 'grow-1', readings: [{ key: 'ph', name: 'pH', unit: 'pH' }] }] };
    draw();
    await settled();

    const list = within(screen.getByRole('region', { name: 'Diary in this window' }));
    const line = () => list.getAllByRole('listitem').find(one => /pH/.test(one.textContent ?? ''));
    await waitFor(() => expect(line()).toHaveTextContent(/pH 6\.1 · Haze 1 · pH 6\.4 · Haze 2/));
    expect(line()).not.toHaveTextContent(/6\.1 pH/);
  });

  /** A note corrected from Verlauf was headed "Note · Tent 1", the place; from the grow's diary "Note · Amnesia · Day 10". */
  it('heads a line´s correction with its grow and the grow´s day, wherever it is opened', async () => {
    const note = entry('entry-grow-note', { growId: 'grow-1', occurredAt: ago(3) });
    // The grow began at midnight nine days before the note's date: the note stands on its tenth day.
    const began = new Date(`${note.occurredAt.slice(0, 10)}T00:00:00.000Z`).getTime() - 9 * 24 * HOUR;
    server.grows = [{ id: 'grow-1', name: 'Amnesia', startedAt: new Date(began).toISOString(), phases: [], summary: { zone: 'UTC' } }];
    server.over = { events: [note] };
    draw();
    await settled();

    const list = within(screen.getByRole('region', { name: 'Diary in this window' }));
    await waitFor(() => expect(server.askedFor).toContain('/grows'));
    await waitFor(() => {
      opened.length = 0;
      fireEvent.click(list.getByRole('button', { name: /Correct this line/ }));
      expect(opened[0]?.[1]).toMatchObject({ label: 'Amnesia', growId: 'grow-1', dayNumber: 10 });
    });
  });

  /** A maintenance that began before the window was lost from its list, or read "is on" where it ended after it. */
  it('tells a stretch the window cuts with its true start and length, in one form of a stamp, and sets the cursor where the window begins', async () => {
    server.over = { stretches: [{ kind: 'maintenance', at: ago(30), endedAt: ago(23) }] };
    draw();
    await settled();

    const lines = within(screen.getByRole('region', { name: 'Diary in this window' })).getAllByRole('listitem');
    expect(lines.map(line => line.textContent)).toEqual([
      expect.stringMatching(/^[A-Z][a-z]{2}\s\d\d:\d\d, Set the cursor on this momentMaintenance · 7 h/),
      expect.stringMatching(/^[A-Z][a-z]{2}\s\d\d:\d\d, .*Device rebooted/),
      expect.stringMatching(/^[A-Z][a-z]{2}\s\d\d:\d\d, .*You watered/),
    ]);
    fireEvent.click(within(lines[0]).getByRole('button', { name: /Set the cursor on this moment/ }));

    await waitFor(() => expect(address().searchParams.get('at')).toBe(iso(NOW - 24 * HOUR)));
  });

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

  it('offers no note for a moment before the place existed', async () => {
    draw(`/timeline?at=${iso(Date.parse('2025-12-31T12:00:00.000Z'))}`);
    await settled();
    await waitFor(() => expect(server.asked.at(-1)?.get('to')).toBe('2026-01-01T00:00:00.000Z'));

    expect(screen.queryByRole('button', { name: /Write a note/ })).not.toBeInTheDocument();
  });

  it('offers no note to somebody who may only read, nor to the demo', async () => {
    server.youMay = 'view';
    draw(`/timeline?at=${ago(6)}`);
    await settled();

    expect(screen.queryByRole('button', { name: /Write a note/ })).not.toBeInTheDocument();
  });
});

describe('Verlauf with nothing to draw', () => {
  it('says when a device came here and where its earlier readings are, and points to no last reading of there', async () => {
    // Never today: a day ago and more.
    const came = NOW - 30 * HOUR;
    server.over = {
      panels: [],
      outputs: [],
      cameras: [],
      lastReadingAt: null,
      deviceIds: ['device-1'],
      arrivals: [{ deviceId: 'device-1', name: null, type: 'fridge', at: iso(came), from: { spaceId: 'space-old', name: 'Zelt' } }],
    };
    draw();

    const earlier = await screen.findByRole('link', { name: /^Timeline of Zelt/ });
    expect(earlier.closest('p')).toHaveTextContent(
      new RegExp(`came here on ${zonedAt(came, 'UTC').toFormat('d LLL HH:mm')} · earlier readings under`),
    );
    expect(earlier.getAttribute('href')).toContain('space=space-old');
    expect(screen.queryByRole('button', { name: /Go to the last reading/ })).not.toBeInTheDocument();
    // It has reported where it stood before: it waits for its first value here, not for its first value at all.
    expect(screen.getByText(/^No reading has come here since the move/)).toBeInTheDocument();
    expect(screen.queryByText(/^Waiting for first values/)).not.toBeInTheDocument();
    // The link is a target of its own and leaves the note one line high (jsdom lays nothing out: the rule is read).
    expect(earlier.className).toMatch(/inSentence/);
  });

  /** "15. Nov 15:17" on the day itself, where every other line of today gives the time alone. */
  it('says a device that came today by the time alone', async () => {
    server.over = { arrivals: [{ deviceId: 'device-1', name: 'Box', type: 'fridge', at: iso(NOW), from: null }] };
    draw();

    expect(
      await screen.findByText(
        `Fridge module came here at ${zonedAt(NOW, 'UTC').toFormat('HH:mm')} · earlier readings are with the place it stood in before.`,
      ),
    ).toBeInTheDocument();
  });

  it('says where a device came from without a way there, for a reader who may not read that place', async () => {
    server.over = { arrivals: [{ deviceId: 'device-1', name: 'Box', type: 'fridge', at: ago(20), from: null }] };
    draw();

    expect(await screen.findByText(/came here on .* · earlier readings are with the place it stood in before\./)).toBeInTheDocument();
  });

  it('says of an ended place without curves that it has ended, and promises none', async () => {
    server.gone = true;
    draw('/timeline?space=space-gone');

    expect(await screen.findByText('The place Old tent no longer exists. Nothing can be changed here any more.')).toBeInTheDocument();
    expect(screen.getByText('No device stood here in this window.')).toBeInTheDocument();
    expect(screen.queryByText(/curves can still be read/)).not.toBeInTheDocument();
  });

  it('draws an ended grow named alone where it stood last, a place that has ended, and no other place´s curves', async () => {
    server.gone = true;
    draw('/timeline?grow=grow-gone');

    await waitFor(() => expect(address().searchParams.get('space')).toBe('space-gone'));
    expect(await screen.findByText(/The place Old tent no longer exists/)).toBeInTheDocument();
    expect(server.askedFor).not.toContain('/spaces/space-1/timeline');
  });

  /** A deleted grow by address read "was never in this place", after a read of it answered 404. */
  it('says a grow the account no longer holds is gone, and asks for nothing that answers 404', async () => {
    server.grows = [{ id: 'grow-1', name: 'Amnesia', placements: [], phases: [], summary: { zone: 'UTC' } }];
    draw('/timeline?grow=grow-deleted');

    expect(await screen.findByText('The grow in the address no longer exists. This is the place without it.')).toBeInTheDocument();
    expect(server.askedFor.filter(path => path.includes('grow-deleted'))).toEqual([]);
    expect(server.asked.every(query => !query.has('growId'))).toBe(true);
  });

  /** With `/v1/grows` failing, an existing grow was called deleted and `grow=` left the address for good. */
  it('says a grow it could not read could not be read, and keeps it in the address', async () => {
    server.growsFail = true;
    draw('/timeline?grow=grow-1');

    expect(await screen.findByText('The grow in the address could not be loaded just now.')).toBeInTheDocument();
    expect(screen.queryByText(/no longer exists/)).not.toBeInTheDocument();
    expect(address().searchParams.get('grow')).toBe('grow-1');
    await waitFor(() => expect(server.asked.some(query => query.get('growId') === 'grow-1')).toBe(true));
  });

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
    expect(await screen.findByText(/Nothing was measured in this window · last reading 2 d ago/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Go to the last reading/ }));

    // The moment alone: the page gives it its own day around it, and never a window past now.
    await waitFor(() => expect(address().search).toBe(`?at=${iso(last)}`));
    await waitFor(() => expect(Object.fromEntries(server.asked.at(-1)!)).toMatchObject({ from: iso(last - 12 * HOUR), to: iso(last + 12 * HOUR) }));
  });

  /** Saturday's window, wholly inside a silence, said "letzter Wert vor 1 Std" of a value 1 h 46 min before now. */
  it('dates the last reading of a past window by its time, not its age from now', async () => {
    const [from, to, last] = [NOW - 72 * HOUR, NOW - 48 * HOUR, NOW - 75 * HOUR];
    server.over = { panels: [], outputs: [], cameras: [], lastReadingAt: iso(last) };
    draw(`/timeline?from=${iso(from)}&to=${iso(to)}`);

    const then = zonedAt(last, 'UTC');
    expect(await screen.findByText(`Nothing was measured in this window · last reading ${then.toFormat('ccc HH:mm')}`)).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
  });

  /** A day wholly inside the controller's silence kept the lamp module's strip and lost its climate panels without a word. */
  it('says why the climate is missing from a window that keeps a lamp´s strip, with the way to the last reading', async () => {
    const last = NOW - 50 * HOUR;
    server.over = { panels: [], cameras: [], lastReadingAt: iso(last) };
    draw();

    expect(await screen.findByText(/No climate readings came in this window · last reading 2 d ago/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go to the last reading/ })).toBeInTheDocument();
    expect(lane('light')).not.toBeNull();
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
    // An answer that carries no reading at all - the device has been gone for longer than a reading is kept.
    server.reading = null;
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
    expect(lane('dehumidifier', panel('Humidity'))).toHaveTextContent(/^Dehumidifier · /);
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

/** "Die App zeigt erst wieder Werte" stood on Konto, Benachrichtigungen and Freigabelinks, which show no values. */
describe('a page that could not be read', () => {
  it('says the readings come back with the connection only where the page shows readings', () => {
    const read = { error: new TypeError('Failed to fetch'), isFetching: false, refetch: () => undefined };
    drawAt(
      <>
        <LoadFailed title="Account" read={read} />
        <LoadFailed title="Timeline" read={read} values />
      </>,
    );

    const [account, timeline] = screen.getAllByRole('alert');
    expect(account).toHaveTextContent('Your devices keep controlling the climate. The app shows anything again once the connection is back.');
    expect(timeline).toHaveTextContent('Your devices keep controlling the climate. The app shows readings again once the connection is back.');
  });
});
