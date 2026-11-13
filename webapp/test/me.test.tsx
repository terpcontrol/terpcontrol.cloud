import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, GrowListItem, Me, MeUpdate, MyGrowCard, Scheme, ShareLink } from '@fg2/shared-types/v1';
import { useDiaryLayer } from '@/api/layers';
import type { Told } from '@/log/log-context';
import { About } from '@/screens/me/about/About';
import { DiarySetting } from '@/screens/me/diary/DiarySetting';
import { diaryLine, notificationsLine, profileLine, shareLinksLine } from '@/screens/me/doors';
import { Grows } from '@/screens/grow/Grows';
import { Me as MeScreen } from '@/screens/Me';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { drawAt, json, NOT_FOUND } from './harness';
import { meWith } from './session';
import { Toast } from './toast';
import { translate } from './translations';

/**
 * Me: the handle and one row per subject of the account, each with a line
 * under it that says what the page behind it holds today - and the three
 * doors that stand with the grows instead, under "All grows": the feeding
 * schemes, the share links and the grows somebody follows.
 *
 * Every one of those lines is read off a resource the server answered, so the
 * thing to check is that each is read off the right one and says the empty
 * thing when there is nothing to count - "no links yet", never "0 active".
 * Who is looking decides which rows there are: an administrator has one more,
 * and the demo only the two that work without an account, with a note saying
 * why the others are missing.
 */

const session = vi.hoisted(() => ({ who: 'grower' as 'grower' | 'admin' | 'demo' }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');
  const seats = { grower: SIGNED_IN, admin: { ...SIGNED_IN, user: { ...SIGNED_IN.user!, isAdmin: true } }, demo: ON_THE_DEMO };

  return { ...(await importOriginal<object>()), useSession: () => seats[session.who] };
});

const me = (over: Partial<Me> = {}): Me =>
  meWith({
    email: 'christian@example.org',
    handle: 'chrisgrows',
    publicProfile: true,
    privacy: { hideWeights: true, hideCounts: false },
    retention: { climateDays: 365 },
    notifications: {
      channels: { email: 'mail@example.org', telegram: { chatId: '1', linkedAt: '2026-02-01T00:00:00.000Z' }, webhook: null },
      routing: {},
      quietHours: { fromMinute: 23 * 60, toMinute: 7 * 60 },
      mutedUntil: null,
    },
    premium: { enforced: true, extendUrl: null, priceLabel: null, free: { stillWidth: null, stillDays: null, timelapseDays: null } },
    telegramAvailable: true,
    ...over,
  });

const grow = (id: string, over: Partial<GrowListItem>): GrowListItem =>
  ({
    id,
    ownerId: 'user-1',
    name: id,
    visibility: 'private',
    scheme: null,
    endedAt: null,
    isDemo: false,
    ...over,
  }) as unknown as GrowListItem;

const GROWS: GrowListItem[] = [
  grow('spring', {
    visibility: 'public',
    scheme: {
      origin: { type: 'asset', assetId: 'biobizz-light-mix', version: '2025-05' },
      strength: 1,
      waterEc: null,
      plantType: 'light_mix',
      flipWeek: 4,
      edited: true,
      grid: [],
    },
  }),
  grow('autumn', {
    scheme: {
      origin: { type: 'asset', assetId: 'biobizz-light-mix', version: '2025-05' },
      strength: 1,
      waterEc: null,
      plantType: 'light_mix',
      flipWeek: 4,
      edited: false,
      grid: [],
    },
  }),
  // Over and done with: its scheme is not "in use" any more.
  grow('last-year', {
    endedAt: '2025-12-01T00:00:00.000Z',
    scheme: { origin: { type: 'own', schemeId: 'own-1' }, strength: 1, waterEc: null, plantType: '', flipWeek: null, edited: false, grid: [] },
  }),
];

const link = (id: string, over: Partial<ShareLink>): ShareLink => ({
  id,
  createdAt: '2026-03-01T00:00:00.000Z',
  token: `token-${id}`,
  kind: 'view',
  subject: { type: 'grow', id: 'spring' },
  range: { startsAt: null, endsAt: null },
  includeCameras: false,
  createdBy: 'user-1',
  expiresAt: null,
  revokedAt: null,
  state: { openCount: 0, lastOpenedAt: null },
  ...over,
});

const LINKS = [link('a', {}), link('b', { expiresAt: '2026-01-01T00:00:00.000Z' }), link('c', { revokedAt: '2026-02-01T00:00:00.000Z' })];

const camera = (over: Partial<Camera>): Camera =>
  ({
    id: 'cam-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ownerId: 'user-1',
    kind: 'terpcam_controller',
    name: 'Terp Cam 1',
    entitlement: { validUntil: '2027-10-14T12:00:00.000Z', grant: 'included', tier: 'premium', renewalVisible: false },
    isDemo: false,
    removedAt: null,
    state: { lastStillAt: null, lastError: null, firmwareVersion: null },
    ...over,
  }) as unknown as Camera;

const OWN: Scheme = {
  id: 'own-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  ownerId: 'user-1',
  name: 'Biobizz, my way',
  origin: { assetId: 'biobizz-light-mix', version: '2025-05' },
  grid: [],
};

const INDEX = {
  schemes: [
    {
      id: 'biobizz-light-mix',
      name: 'Biobizz · Light·Mix',
      manufacturer: 'Biobizz',
      version: '2025-05',
      plantTypes: [{ key: 'light_mix', name: 'Light·Mix' }],
      defaultPlantType: 'light_mix',
      weeks: 12,
      flipWeek: 4,
      source: { title: 'Biobizz Nutrient Schedule', url: 'https://biobizz.example/chart.pdf', readAt: '2026-09-22' },
    },
  ],
};

const server = {
  me: me(),
  grows: GROWS,
  links: LINKS,
  cameras: [camera({})],
  own: [OWN],
  follows: 2,
  mine: [] as MyGrowCard[],
  patched: [] as MeUpdate[],
  asked: [] as string[],
  failing: [] as string[],
  held: {} as Record<string, Promise<Response> | undefined>,
};

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const { pathname } = new URL(String(input), 'http://localhost');
  if (pathname === '/v1/me' && init?.method === 'PATCH') {
    const body = JSON.parse(String(init.body)) as MeUpdate;
    server.patched.push(body);
    // The layer follows the answer; left to the account's use it is on, as this account has grows.
    server.me = {
      ...server.me,
      preferences: { ...server.me.preferences, ...body.preferences },
      layers: { diary: body.preferences?.diary !== 'off' },
    } as Me;
    return json(server.me);
  }
  server.asked.push(pathname);
  if (server.failing.includes(pathname)) return json({ status: 500, code: 'server_error', title: 'Server error', detail: '', errors: [] }, 500);
  // A read the test holds open, which is how one answer arriving before another is staged.
  if (server.held[pathname]) return server.held[pathname];

  if (pathname === '/v1/me') return json(server.me);
  if (pathname === '/v1/home') return json({ layers: server.me.layers });
  if (pathname === '/v1/grows') return json({ items: server.grows, nextCursor: null });
  if (pathname === '/v1/home/grows') return json({ items: server.mine, nextCursor: null });
  if (pathname === '/v1/follows')
    return json({ items: Array.from({ length: server.follows }, (_, index) => ({ id: `f${index}`, growId: `g${index}` })), nextCursor: null });
  if (pathname === '/v1/share-links') return json({ items: server.links, nextCursor: null });
  if (pathname === '/v1/cameras') return json({ items: server.cameras, nextCursor: null });
  if (pathname === '/v1/schemes') return json({ items: server.own, nextCursor: null });
  if (pathname === '/assets/schemes/index.json') return json(INDEX);
  return json(NOT_FOUND, 404);
});

const draw = () =>
  drawAt(
    <ThemeProvider>
      <MeScreen />
    </ThemeProvider>,
    { at: '/me' },
  );

/** The page of every grow, whose foot holds the doors that belong to growing; the grows themselves are not what is looked at here. */
const drawGrows = () => {
  server.mine = [];
  return drawAt(<Grows />, { at: '/grows' });
};

/** Where the rows of the page lead, in the order they stand in. */
const rows = () => within(screen.getByRole('list')).getAllByRole('link');
const doors = () => rows().map(row => row.getAttribute('href'));

/** The line under a door, once it says something other than that it is loading. */
const lineUnder = async (title: string): Promise<string> => {
  const door = await screen.findByRole('link', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
  await waitFor(() => expect(door).not.toHaveTextContent('loading'));

  // A figure is bound to what follows it, so no line of a door ends on one: said here as the words it is.
  return door.textContent!.slice(title.length).replace(/\u00a0/g, ' ');
};

beforeAll(() => translate());

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.who = 'grower';
  server.me = me();
  server.grows = GROWS;
  server.links = LINKS;
  server.cameras = [camera({})];
  server.own = [OWN];
  server.follows = 2;
  server.mine = [{ endedAt: null }, { endedAt: null }, { endedAt: '2025-12-01T00:00:00.000Z' }] as MyGrowCard[];
  server.patched = [];
  server.asked = [];
  server.failing = [];
  server.held = {};
});

afterEach(() => vi.unstubAllGlobals());

describe('who is signed in', () => {
  it('draws the handle under the title, and the way back to Start', async () => {
    draw();

    expect(screen.getByRole('heading', { name: 'Me' })).toBeInTheDocument();
    // The session's own handle, which the shell already knows.
    expect(screen.getByText('@you')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');
    expect(await lineUnder('Account')).toBe('E-mail, password, time zone');
  });

  it('says every line is loading until its answer is there, rather than guessing a figure', () => {
    draw();

    for (const name of ['Notifications', 'Grow diary', 'Privacy and profile']) {
      expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveTextContent(`${name}loading`);
    }
    expect(screen.queryByText(/0 /)).not.toBeInTheDocument();
  });
});

describe('the rows', () => {
  it('are one per subject of the account, in one card, over the way out', async () => {
    draw();

    await screen.findByRole('link', { name: 'Premium' });
    expect(doors()).toEqual(['/me/notifications', '/me/account', '/me/appearance', '/me/diary', '/me/privacy', '/me/premium', '/me/about']);
    // Premium and About say what they are and nothing under it.
    expect(screen.getByRole('link', { name: 'About' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    expect(screen.queryByText(/The demo has no account/)).not.toBeInTheDocument();
  });

  it('end, for an administrator, on the one row to the install, marked as theirs alone', async () => {
    session.who = 'admin';
    draw();

    const admin = await screen.findByRole('link', { name: /^Admin/ });
    expect(admin).toHaveAttribute('href', '/admin/fleet');
    expect(admin).toHaveTextContent('AdminFleet, firmware, users, demo deviceadmin only');
    expect(rows().at(-1)).toBe(admin);
    expect(doors().filter(to => to?.startsWith('/admin'))).toEqual(['/admin/fleet']);
  });
});

describe('what each door says', () => {
  it('says whether a stranger finds the profile, and how many of the grows one can open', async () => {
    draw();

    expect(await lineUnder('Privacy and profile')).toBe('profile public · 1 public grow');
  });

  it('says the profile is private where it is', async () => {
    server.me = me({ publicProfile: false });
    server.grows = [...GROWS, grow('summer', { visibility: 'public' })];
    draw();

    expect(await lineUnder('Privacy and profile')).toBe('profile private · 2 public grows');
  });

  it('counts the grows followed, beside the grows', async () => {
    drawGrows();

    expect(await lineUnder('Following')).toBe('2 grows');
  });

  it('counts the links that still open, the ones that ran out and the ones pulled, beside the grows', async () => {
    drawGrows();

    expect(await lineUnder('Share links')).toBe('1 active · 1 expired · 1 revoked');
  });

  it('lists the channels that are on and the quiet hours', async () => {
    draw();

    expect(await lineUnder('Notifications')).toBe('Telegram and E-mail · quiet 23:00–07:00');
  });

  it('states the language and the theme, and not the units the views do not show yet', async () => {
    server.me = me({ preferences: { ...me().preferences, units: { temperature: 'fahrenheit', weight: 'grams', volume: 'gallons' } } });
    draw();

    expect(await lineUnder('Appearance')).toBe('English · same as the system');
  });

  it('says whether the diary is kept, and that the account left that to its use', async () => {
    const left = draw();
    expect(await lineUnder('Grow diary')).toBe('Automatic · on');
    left.unmount();

    server.me = me({ preferences: { ...me().preferences, diary: 'off' }, layers: { diary: false } });
    draw();
    expect(await lineUnder('Grow diary')).toBe('off');
  });

  it('names the one scheme the running grows are on, marks it edited, and counts the shelf, beside the grows', async () => {
    drawGrows();

    expect(await lineUnder('Feeding schemes')).toBe('Biobizz · Light·Mix (edited) · 1 of your own');
  });
});

/**
 * Several reads fan out from this page and they answer in whatever order the
 * connection gives them, so each is failed in turn here and the page is asked
 * for all of its doors. Me is the only way to privacy, to the account and
 * to signing out, and a read that never answers has to cost its own line and
 * nothing else; the mixed state - one read in and another not - is the one
 * that took the whole screen down, so the door built from two of them is
 * checked with each half failing on its own.
 */
describe('one read that fails', () => {
  // Premium is a door only once the cameras have said there is one, so it is
  // not among the doors that stand from the first paint.
  const DOORS = ['Notifications', 'Account', 'Appearance', 'Grow diary', 'Privacy and profile', 'About'];

  it.each([
    ['/v1/me', ['Notifications', 'Grow diary', 'Privacy and profile']],
    ['/v1/grows', ['Privacy and profile']],
    ['/v1/home/grows', []],
    ['/v1/cameras', []],
  ])('keeps every door when %s fails, and says so under the ones that needed it', async (path, affected) => {
    server.failing = [path];
    draw();

    for (const name of DOORS) expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    for (const name of affected) expect(await lineUnder(name)).toBe('Could not load.');
  });

  it('draws a line read off two answers as loading while one of them is still out, whatever the other has said', async () => {
    let answerGrows = (_: Response) => {};
    server.held = {
      '/v1/grows': new Promise<Response>(resolve => {
        answerGrows = resolve;
      }),
    };
    draw();

    // The account is in, which is half of what the line is worked out from.
    expect(await lineUnder('Notifications')).toBe('Telegram and E-mail · quiet 23:00–07:00');
    expect(screen.getByRole('link', { name: /^Privacy and profile/ })).toHaveTextContent('loading');

    answerGrows(json({ items: server.grows, nextCursor: null }));
    expect(await lineUnder('Privacy and profile')).toBe('profile public · 1 public grow');
  });
});

describe('what is empty', () => {
  it('says the empty thing rather than a nought', async () => {
    server.grows = [];
    server.links = [];
    server.cameras = [];
    server.own = [];
    server.follows = 0;
    server.me = me({
      notifications: { ...me().notifications, channels: { email: null, telegram: null, webhook: null }, quietHours: null },
    });
    draw();

    expect(await lineUnder('Privacy and profile')).toBe('profile public · no public grow');
    expect(await lineUnder('Notifications')).toBe('no channel on');
  });

  it('says it under the doors beside the grows too', async () => {
    server.grows = [];
    server.links = [];
    server.own = [];
    server.follows = 0;
    drawGrows();

    expect(await lineUnder('Following')).toBe('nobody yet');
    expect(await lineUnder('Share links')).toBe('no links yet');
    expect(await lineUnder('Feeding schemes')).toBe('none in use · none of your own yet');
  });

  /**
   * A feeding scheme is what a grow's feed lines are dosed from. An account
   * that keeps no diary was shown a door to a shelf of nutrient charts it has
   * no use for; one that wrote a scheme of its own keeps the door to it.
   */
  it('has a door to the feeding schemes only for a diary, or for whoever wrote one of their own', async () => {
    server.me = me({ layers: { diary: false } });
    server.own = [];
    const none = drawGrows();
    expect(await lineUnder('Share links')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('link', { name: /^Feeding schemes/ })).not.toBeInTheDocument());
    none.unmount();

    server.own = [OWN];
    drawGrows();
    expect(await lineUnder('Feeding schemes')).toContain('1 of your own');
  });

  /**
   * Every grow is reached through Grow in the bar, which an account that keeps
   * no diary does not have: one that has grows all the same finds its way to
   * them here, and one that never had any is not shown a page that could only
   * say it is empty.
   */
  it('has a door to every grow only for whoever has grows and no diary in the bar', async () => {
    const kept = draw();
    expect(await lineUnder('Grow diary')).toBe('Automatic · on');
    await waitFor(() => expect(server.asked).toContain('/v1/home/grows'));
    expect(screen.queryByRole('link', { name: /^All grows/ })).not.toBeInTheDocument();
    kept.unmount();

    server.me = me({ layers: { diary: false } });
    const off = draw();
    expect(await lineUnder('All grows')).toBe('2 running · 1 finished');
    expect(screen.getByRole('link', { name: /^All grows/ })).toHaveAttribute('href', '/grows');
    expect(doors().slice(3, 6)).toEqual(['/me/diary', '/grows', '/me/privacy']);
    off.unmount();

    server.mine = [];
    server.asked = [];
    draw();
    expect(await lineUnder('Grow diary')).toBe('Automatic · off');
    await waitFor(() => expect(server.asked).toContain('/v1/home/grows'));
    expect(screen.queryByRole('link', { name: /^All grows/ })).not.toBeInTheDocument();
  });

  /**
   * Premium is what a camera can do beyond its free tier. An account with no
   * camera was handed a door to a table about hardware it does not own, fourth
   * of eight, above its notifications.
   */
  it('has no Premium door without a camera, nor one while it cannot tell', async () => {
    // Waited out rather than read once, so a door that would arrive with the cameras is not missed for being late.
    const neverPremium = () => expect(screen.findByRole('link', { name: /^Premium/ }, { timeout: 400 })).rejects.toThrow();

    server.cameras = [];
    const empty = draw();
    await neverPremium();
    empty.unmount();

    server.cameras = [camera({ removedAt: '2026-01-01T00:00:00.000Z' })];
    const removed = draw();
    await neverPremium();
    removed.unmount();

    // A camera in a place the account was let into is its host's.
    server.cameras = [camera({ ownerId: 'user-9' })];
    const guest = draw();
    await neverPremium();
    guest.unmount();

    server.cameras = [camera({})];
    server.failing = ['/v1/cameras'];
    draw();
    await neverPremium();
    expect(server.asked).toContain('/v1/cameras');
  });
});

describe('the lines on their own', () => {
  const t = i18next.t.bind(i18next);
  const now = DateTime.fromISO('2026-09-22T12:00:00.000Z');

  it('counts as public only the grows of the account itself, and never the demo´s', () => {
    const grows = [
      grow('own', { visibility: 'public' }),
      grow('theirs', { ownerId: 'user-2', visibility: 'public' }),
      grow('demo', { visibility: 'public', isDemo: true }),
    ];

    expect(profileLine(t, grows, me())).toBe('profile public · 1 public grow');
    expect(profileLine(t, grows.slice(1), me({ publicProfile: false }))).toBe('profile private · no public grow');
  });

  it('says the diary´s state for an account that answered, and that it was left to its use for one that did not', () => {
    expect(diaryLine(t, me({ preferences: { ...me().preferences, diary: 'on' } }))).toBe('on');
    expect(diaryLine(t, me({ layers: { diary: false } }))).toBe('Automatic · off');
  });

  it('says a mute before the channels, and push only where a browser is subscribed', () => {
    const muted = me({
      pushSubscribed: true,
      notifications: { ...me().notifications, quietHours: null, mutedUntil: now.plus({ hours: 1 }).toISO() },
    });

    expect(notificationsLine(t, muted, now, 'en')).toBe('muted · Push, Telegram, and E-mail');
    expect(notificationsLine(t, me({ notifications: { ...muted.notifications, mutedUntil: now.minus({ hours: 1 }).toISO() } }), now, 'en')).toBe(
      'Telegram and E-mail',
    );
  });

  it('does not count a revoked link as expired, whatever its date says', () => {
    expect(shareLinksLine(t, [link('x', { expiresAt: '2020-01-01T00:00:00.000Z', revokedAt: '2019-06-01T00:00:00.000Z' })], now)).toBe('1 revoked');
  });
});

describe('the demo', () => {
  it('is shown the two rows that work without an account, told why the others are missing, and asks the server for nothing', async () => {
    session.who = 'demo';
    draw();

    expect(screen.getByText('@demo')).toBeInTheDocument();
    expect(doors()).toEqual(['/me/appearance', '/me/about']);
    expect(await lineUnder('Appearance')).toBe('English · same as the system');
    expect(
      screen.getByText('The demo has no account of its own: there are no notifications, no account and no privacy settings here.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    // Nothing of what it draws is the server's, so the server is asked for nothing.
    expect(server.asked).toEqual([]);
  });
});

/**
 * Whether the diary is kept is the account's, so every device agrees, and the
 * answer given on Start can be taken back here. "Automatic" is no answer at
 * all: the account's use decides. A tap is the write, and the bar follows it.
 */
describe('the grow diary', () => {
  const told: Told[] = [];

  /** What the bar asks, so that the home it reads is seen to be read again. */
  function Bar() {
    return useDiaryLayer() ? <p>Grow is in the bar</p> : null;
  }

  const drawDiary = () =>
    drawAt(
      <Toast told={told}>
        <Bar />
        <DiarySetting />
      </Toast>,
      { at: '/me/diary' },
    );

  const choice = (name: string) =>
    within(screen.getByRole('radiogroup', { name: 'Keep the diary' })).getByRole('radio', { name: new RegExp(`^${name}`) });
  const chosen = () =>
    within(screen.getByRole('radiogroup', { name: 'Keep the diary' }))
      .getAllByRole('radio')
      .map(radio => radio.getAttribute('aria-checked'));

  beforeEach(() => {
    told.length = 0;
  });

  it('reads "Automatic" where nobody has answered, writes the answer on the tap and reads the home again', async () => {
    drawDiary();

    await screen.findByRole('radiogroup', { name: 'Keep the diary' });
    expect(screen.getByRole('heading', { name: 'Grow diary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Me' })).toHaveAttribute('href', '/me');
    expect(chosen()).toEqual(['true', 'false', 'false']);
    expect(await screen.findByText('Grow is in the bar')).toBeInTheDocument();

    fireEvent.click(choice('Off'));

    await waitFor(() => expect(told.map(one => one.label)).toEqual(['The grow diary is off']));
    expect(server.patched).toEqual([{ preferences: { diary: 'off' } }]);
    expect(chosen()).toEqual(['false', 'false', 'true']);
    await waitFor(() => expect(screen.queryByText('Grow is in the bar')).not.toBeInTheDocument());
    expect(server.asked.filter(path => path === '/v1/home')).toHaveLength(2);
  });

  it('says under "Automatic" what is true of the diary: on since it was used, or on once it is', async () => {
    const used = drawDiary();
    expect(await screen.findByText('on since you started a grow or logged something')).toBeInTheDocument();
    used.unmount();

    server.me = me({ layers: { diary: false } });
    drawDiary();
    expect(await screen.findByText('on once you start a grow or log something')).toBeInTheDocument();
  });

  it('takes the answer back from the toast, to what the account held before', async () => {
    server.me = me({ preferences: { ...me().preferences, diary: 'on' } });
    drawDiary();

    await screen.findByRole('radiogroup', { name: 'Keep the diary' });
    expect(chosen()).toEqual(['false', 'true', 'false']);
    // The answer that holds is no button to press again.
    fireEvent.click(choice('On'));
    fireEvent.click(choice('Off'));
    await waitFor(() => expect(told).toHaveLength(1));

    await told[0].undo!();

    expect(server.patched).toEqual([{ preferences: { diary: 'off' } }, { preferences: { diary: 'on' } }]);
    await waitFor(() => expect(chosen()).toEqual(['false', 'true', 'false']));
    expect(await screen.findByText('Grow is in the bar')).toBeInTheDocument();
  });

  it('hands the question back to the account´s use when "Automatic" is chosen again', async () => {
    server.me = me({ preferences: { ...me().preferences, diary: 'off' }, layers: { diary: false } });
    drawDiary();

    await screen.findByRole('radiogroup', { name: 'Keep the diary' });
    fireEvent.click(choice('Automatic'));

    await waitFor(() => expect(told.map(one => one.label)).toEqual(['Grow diary: automatic']));
    expect(server.patched).toEqual([{ preferences: { diary: null } }]);
  });

  it('is not the demo´s to answer, which is told why', () => {
    session.who = 'demo';
    drawDiary();

    expect(screen.getByText(/^The demo has no account of its own/)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(server.asked).not.toContain('/v1/me');
  });
});

describe('what this install is', () => {
  it('states the build, the server it talks to, and no links card where the install wrote none', () => {
    render(
      <MemoryRouter initialEntries={['/me/about']}>
        <About />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument();
    expect(screen.getByText('This app')).toBeInTheDocument();
    expect(screen.getByText(/^v\d+\.\d+\.\d+ · test$/)).toBeInTheDocument();
    expect(screen.getByText('Server')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:5081')).toBeInTheDocument();
    expect(screen.queryByText('Links')).not.toBeInTheDocument();
  });
});
