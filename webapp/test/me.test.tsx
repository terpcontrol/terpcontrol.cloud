import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, GrowListItem, Me, Scheme, ShareLink } from '@fg2/shared-types/v1';
import { About } from '@/screens/me/about/About';
import { premiumLine, shareLinksLine } from '@/screens/me/doors';
import { Me as MeScreen } from '@/screens/Me';
import { ThemeProvider } from '@/theme/ThemeProvider';

/**
 * Me: the identity line and the ten doors, each with a line under it that
 * says what the page behind it currently holds.
 *
 * Every one of those lines is a figure read off a resource the server
 * answered, so the thing to check is that each is read off the right one and
 * says the empty thing when there is nothing to count - "no links yet", never
 * "0 active". The demo is checked for the opposite: that the doors which need
 * an account are closed with a sentence rather than opened onto a refusal,
 * while the two that need none stay open.
 */

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
});

const me = (over: Partial<Me> = {}): Me => ({
  id: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  email: 'christian@example.org',
  isAdmin: false,
  isActive: true,
  handle: 'chrisgrows',
  bio: null,
  avatarMediaId: null,
  publicProfile: true,
  privacy: { hideWeights: true, hideCounts: false },
  preferences: { units: { temperature: 'celsius', weight: 'grams', volume: 'liters' }, locale: 'en', timezone: 'Europe/Berlin' },
  retention: { climateDays: 365 },
  climateRetention: { installDays: null, appliesDays: null },
  notifications: {
    channels: { email: 'mail@example.org', telegram: { chatId: '1', linkedAt: '2026-02-01T00:00:00.000Z' }, webhook: null },
    routing: {},
    quietHours: { fromMinute: 23 * 60, toMinute: 7 * 60 },
    mutedUntil: null,
  },
  deletionStartedAt: null,
  premium: { enforced: true, extendUrl: null, priceLabel: null, free: { stillWidth: null, stillDays: null, timelapseDays: null } },
  pushPublicKey: null,
  telegramAvailable: true,
  pushSubscribed: false,
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
  asked: [] as string[],
  failing: [] as string[],
  held: {} as Record<string, Promise<Response> | undefined>,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const { pathname } = new URL(String(input), 'http://localhost');
  server.asked.push(pathname);
  if (server.failing.includes(pathname)) return json({ status: 500, code: 'server_error', title: 'Server error', detail: '', errors: [] }, 500);
  // A read the test holds open, which is how one answer arriving before another is staged.
  if (server.held[pathname]) return server.held[pathname];

  if (pathname === '/v1/me') return json(server.me);
  if (pathname === '/v1/grows') return json({ items: server.grows, nextCursor: null });
  if (pathname === '/v1/follows')
    return json({ items: Array.from({ length: server.follows }, (_, index) => ({ id: `f${index}`, growId: `g${index}` })), nextCursor: null });
  if (pathname === '/v1/share-links') return json({ items: server.links, nextCursor: null });
  if (pathname === '/v1/cameras') return json({ items: server.cameras, nextCursor: null });
  if (pathname === '/v1/schemes') return json({ items: server.own, nextCursor: null });
  if (pathname === '/assets/schemes/index.json') return json(INDEX);
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
});

const draw = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/me']}>
        <ThemeProvider>
          <MeScreen />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The line under a door, once it says something other than that it is loading. */
const lineUnder = async (title: string): Promise<string> => {
  const door = screen.getByRole('link', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
  await waitFor(() => expect(door).not.toHaveTextContent('loading'));

  return door.textContent!.slice(title.length);
};

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8')) as Record<string, unknown>;
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  session.demo = false;
  server.me = me();
  server.grows = GROWS;
  server.links = LINKS;
  server.cameras = [camera({})];
  server.own = [OWN];
  server.follows = 2;
  server.asked = [];
  server.failing = [];
  server.held = {};
});

afterEach(() => vi.unstubAllGlobals());

describe('who is signed in', () => {
  it('draws the initials, the handle, the address and whether the profile is public', async () => {
    draw();

    // The session's own handle, which the shell already knows; the address waits for the account.
    expect(screen.getByText('YO')).toBeInTheDocument();
    expect(screen.getByText('@you')).toBeInTheDocument();
    expect(await screen.findByText('christian@example.org · public profile on')).toBeInTheDocument();
  });

  it('says every line is loading until its answer is there, rather than guessing a figure', () => {
    draw();

    expect(screen.getAllByText('loading').length).toBeGreaterThan(5);
    expect(screen.queryByText(/0 /)).not.toBeInTheDocument();
  });
});

describe('what each door says', () => {
  it('counts the public and private grows and names the profile address', async () => {
    draw();

    expect(await lineUnder('Public grows and profile')).toBe('1 public · 2 private · localhost:3000/@chrisgrows');
  });

  it('says the profile is off instead of naming an address nothing answers at', async () => {
    server.me = me({ publicProfile: false });
    draw();

    expect(await lineUnder('Public grows and profile')).toBe('1 public · 2 private · profile off');
    expect(await screen.findByText('christian@example.org · public profile off')).toBeInTheDocument();
  });

  it('counts the grows followed', async () => {
    draw();

    expect(await lineUnder('Following')).toBe('2 grows');
  });

  it('counts the links that still open, the ones that ran out and the ones pulled', async () => {
    draw();

    expect(await lineUnder('Share links')).toBe('1 active · 1 expired · 1 revoked');
  });

  it('names the one camera with its year and sets the state word at the right', async () => {
    draw();

    const until = DateTime.fromISO('2027-10-14T12:00:00.000Z').toLocaleString(DateTime.DATE_MED);
    expect(await lineUnder('Premium')).toBe(`Terp Cam 1 · included until ${until}active`);
  });

  it('lists the channels that are on and the quiet hours', async () => {
    draw();

    expect(await lineUnder('Notifications')).toBe('Telegram · E-mail · quiet 23:00–07:00');
  });

  it('says what is hidden in shared views and how long climate is kept', async () => {
    draw();

    expect(await lineUnder('Privacy')).toBe('weights hidden in shared views · retention 1 year');
  });

  it('states the theme, the units and the language', async () => {
    draw();

    expect(await lineUnder('Appearance')).toBe('theme: System · units: °C, g, l · language: English');
  });

  it('names the one scheme the running grows are on, marks it edited, and counts the shelf', async () => {
    draw();

    expect(await lineUnder('Feeding schemes')).toBe('Biobizz · Light·Mix (edited) · 1 own');
  });

  it('lists what the account page holds, and states the version of this build', async () => {
    draw();

    expect(await lineUnder('Account')).toBe('e-mail · password · sessions · export · delete');
    expect(await lineUnder('About')).toMatch(/^v\d+\.\d+\.\d+ · /);
  });
});

/**
 * Eight reads fan out from this page and they answer in whatever order the
 * connection gives them, so each is failed in turn here and the page is asked
 * for all ten of its doors. Me is the only way to privacy, to the export and
 * to signing out, and a read that never answers has to cost its own line and
 * nothing else; the mixed state - one read in and another not - is the one
 * that took the whole screen down, so the door built from two of them is
 * checked with each half failing on its own.
 */
describe('one read that fails', () => {
  const DOORS = [
    'Public grows and profile',
    'Following',
    'Share links',
    'Premium',
    'Notifications',
    'Privacy',
    'Feeding schemes',
    'Account',
    'Appearance',
    'About',
  ];

  it.each([
    ['/v1/me', ['Public grows and profile', 'Premium', 'Notifications', 'Privacy', 'Appearance']],
    ['/v1/grows', ['Public grows and profile', 'Feeding schemes']],
    ['/v1/follows', ['Following']],
    ['/v1/share-links', ['Share links']],
    ['/v1/cameras', ['Premium']],
    ['/v1/schemes', ['Feeding schemes']],
  ])('keeps every door when %s fails, and says so under the ones that needed it', async (path, affected) => {
    server.failing = [path];
    draw();

    for (const name of DOORS) expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    for (const name of affected) expect(await lineUnder(name)).toBe('Could not load. Try again.');
  });

  it('draws the Premium line as loading while the account read is still out, whatever the cameras have said', async () => {
    let answerMe = (_: Response) => {};
    const held = new Promise<Response>(resolve => {
      answerMe = resolve;
    });
    server.held = { '/v1/me': held };
    draw();

    expect(await lineUnder('Share links')).toBe('1 active · 1 expired · 1 revoked');
    expect(screen.getByRole('link', { name: /^Premium/ })).toHaveTextContent('loading');

    answerMe(json(server.me));
    const until = DateTime.fromISO('2027-10-14T12:00:00.000Z').toLocaleString(DateTime.DATE_MED);
    expect(await lineUnder('Premium')).toBe(`Terp Cam 1 · included until ${until}active`);
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
      privacy: { hideWeights: false, hideCounts: false },
      retention: { climateDays: null },
      notifications: { ...me().notifications, channels: { email: null, telegram: null, webhook: null }, quietHours: null },
    });
    draw();

    expect(await lineUnder('Public grows and profile')).toBe('no grows yet · localhost:3000/@chrisgrows');
    expect(await lineUnder('Following')).toBe('nobody yet');
    expect(await lineUnder('Share links')).toBe('no links yet');
    expect(await lineUnder('Premium')).toBe('no cameras');
    expect(await lineUnder('Notifications')).toBe('no channel on');
    expect(await lineUnder('Privacy')).toBe('nothing hidden in shared views · retention keep everything');
    expect(await lineUnder('Feeding schemes')).toBe('none in use · no own yet');
  });
});

describe('the lines on their own', () => {
  const t = i18next.t.bind(i18next);
  const now = DateTime.fromISO('2026-09-22T12:00:00.000Z');

  it('counts several cameras and speaks for all of them only when it can', () => {
    const active = camera({});
    const runOut = camera({
      id: 'cam-2',
      name: 'Old cam',
      entitlement: { validUntil: '2025-01-01T00:00:00.000Z', grant: 'migration', tier: 'free', renewalVisible: true },
    });

    expect(premiumLine(t, [active, active], now, true)).toEqual({ text: '2 cameras · 2 premium', aside: 'active' });
    expect(premiumLine(t, [active, runOut], now, true)).toEqual({ text: '2 cameras · 1 premium', aside: 'partly' });
    expect(premiumLine(t, [runOut], now, true)).toEqual({ text: expect.stringMatching(/^Old cam · carried over until /), aside: 'expired' });
    expect(premiumLine(t, [camera({ removedAt: '2026-01-01T00:00:00.000Z' })], now, true)).toEqual({ text: 'no cameras', aside: null });
    // A self-hosted install gates nothing, and every camera reads as entitled
    // there - which is exactly why the row must not call it Premium.
    expect(premiumLine(t, [active, active], now, false)).toEqual({ text: '2 cameras · nothing is gated on this install', aside: null });
  });

  it('does not count a revoked link as expired, whatever its date says', () => {
    expect(shareLinksLine(t, [link('x', { expiresAt: '2020-01-01T00:00:00.000Z', revokedAt: '2019-06-01T00:00:00.000Z' })], now)).toBe('1 revoked');
  });
});

describe('the demo', () => {
  it('finds every door that needs an account closed, with the reason under it, and asks the server for nothing', async () => {
    session.demo = true;
    draw();

    expect(screen.getByText('The demo has no account settings.')).toBeInTheDocument();
    expect(screen.getByText('The demo has no account of its own, so there is nothing here to settle.')).toBeInTheDocument();
    expect(screen.getAllByText('The demo has no account of its own, so there is nothing of it to change.').length).toBeGreaterThan(5);
    for (const name of [
      'Public grows and profile',
      'Following',
      'Share links',
      'Premium',
      'Notifications',
      'Privacy',
      'Feeding schemes',
      'Account',
    ]) {
      expect(screen.queryByRole('link', { name: new RegExp(`^${name}`) })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /^Appearance/ })).toHaveAttribute('href', '/me/appearance');
    expect(screen.getByRole('link', { name: /^About/ })).toHaveAttribute('href', '/me/about');
    expect(await lineUnder('Appearance')).toBe('theme: System · language: English');
    expect(server.asked.filter(path => path.startsWith('/v1/'))).toEqual([]);
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
