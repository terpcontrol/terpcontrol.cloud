import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, Me, PremiumFree } from '@fg2/shared-types/v1';
import { CameraSettings } from '@/screens/camera/CameraSettings';
import { countdownDays, renewalDue } from '@/screens/me/premium/entitlement';
import { Premium } from '@/screens/me/premium/Premium';
import { Privacy } from '@/screens/me/privacy/Privacy';
import { spacePage, spaceWhere } from './session';

/**
 * Me › Premium, and the marks a camera carries elsewhere.
 *
 * Everything on the screen is read from three answers and inferred from none
 * of them, so what is checked is that the words follow the fields: a camera
 * is called entitled because the server says so and not because its date is
 * ahead, the sentence under it comes from `grant`, the countdown appears only
 * where the server allows a notice and only inside the last sixty days, and
 * every figure about the free tier is the install's own from `/me` - a width
 * where one is configured and the plain truth where none is. An install that
 * gates nothing draws no chip, no date and no offer however the records read.
 * The offer stands on the card of the camera it is for, and the price on it is
 * the install's or nothing.
 */

const NOW = DateTime.fromISO('2026-09-22T12:00:00.000Z');

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return {
    ...(await importOriginal<object>()),
    // A test session carries no media token; the privacy screen's export row only wants an address.
    mediaUrl: (id: string) => `/media/${id}/content`,
    useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN),
  };
});

vi.mock('@/ui/useNow', () => ({ useNow: () => NOW }));

/** The install's own figures where it has set them all, as the hosted install would answer. */
const CONFIGURED: PremiumFree = { stillWidth: 640, stillDays: 90, timelapseDays: 30 };

const me = (premium: Partial<Me['premium']> = {}): Me => ({
  id: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  email: 'login@example.org',
  isAdmin: false,
  isActive: true,
  handle: 'chrisgrows',
  bio: null,
  avatarMediaId: null,
  publicProfile: false,
  privacy: { hideWeights: false, hideCounts: false },
  preferences: { units: { temperature: 'celsius', weight: 'grams', volume: 'liters' }, locale: 'en', timezone: 'Europe/Berlin' },
  retention: { climateDays: null },
  climateRetention: { installDays: null, appliesDays: null },
  notifications: { channels: { email: null, telegram: null, webhook: null }, routing: {}, quietHours: null, mutedUntil: null },
  deletionStartedAt: null,
  premium: {
    enforced: true,
    extendUrl: 'https://shop.example.org/premium',
    priceLabel: '€ 29 / year',
    free: { stillWidth: null, stillDays: null, timelapseDays: null },
    ...premium,
  },
  pushPublicKey: null,
  telegramAvailable: false,
  pushSubscribed: false,
});

const camera = (over: Partial<Camera> & { entitlement: Camera['entitlement'] }): Camera => ({
  id: `camera-${over.name ?? 'x'}`,
  createdAt: NOW.toISO()!,
  ownerId: 'user-1',
  kind: 'terpcam_controller',
  staleWarning: true,
  deviceId: 'device-1',
  spaceId: 'space-1',
  name: 'Terp Cam 1',
  looksAt: null,
  plantIds: [],
  did: 'SIMCAM',
  uid: null,
  ip: null,
  url: null,
  transport: null,
  tunnel: false,
  model: 'terp_cam',
  stillIntervalSeconds: 30,
  nightOff: false,
  maintenanceOff: false,
  logErrors: false,
  isDemo: false,
  removedAt: null,
  state: { lastStillAt: NOW.toISO()!, lastError: null, firmwareVersion: null },
  ...over,
});

const ahead = (days: number) => NOW.plus({ days }).toISO()!;

const included = camera({
  name: 'Terp Cam 1',
  entitlement: { validUntil: ahead(300), grant: 'included', tier: 'premium', renewalVisible: true },
});

const migrated = camera({
  name: 'Old cam',
  entitlement: { validUntil: ahead(20), grant: 'migration', tier: 'premium', renewalVisible: true },
});

const bought = camera({
  name: 'Tapo C200',
  kind: 'rtsp',
  url: 'rtsp://192.168.1.40/stream1',
  entitlement: { validUntil: ahead(400), grant: 'purchase', tier: 'premium', renewalVisible: true },
});

const rtsp = camera({
  name: 'Side cam',
  kind: 'rtsp',
  url: 'rtsp://192.168.1.41/stream1',
  stillIntervalSeconds: 60,
  entitlement: { validUntil: null, grant: null, tier: 'free', renewalVisible: true },
});

const server = { me: me(), cameras: [] as Camera[] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchStub = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);

  if (url.endsWith('/v1/me')) return json(server.me);
  if (url.endsWith('/v1/cameras')) return json({ items: server.cameras, nextCursor: null });
  if (url.endsWith('/v1/spaces')) return json(spacePage(spaceWhere('own'), spaceWhere('own', { id: 'space-2', name: 'Tent 2' })));
  if (url.endsWith('/v1/devices')) return json({ items: [], nextCursor: null });
  return json({ status: 404, code: 'not_found', title: 'Not found', detail: '', errors: [] }, 404);
}) as unknown as typeof fetch;

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const draw = () =>
  render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={['/me/premium']}>
        <Premium />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const drawLoaded = async () => {
  draw();
  await screen.findByText('What Premium covers');
  await screen.findByText(/Per camera, not per account/);
};

const card = (name: string) => within(screen.getByText(name).closest('li')!);

/** The free and the Premium cell of every row, in the table's order; a drawn check reads as "✓". */
const tableSays = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map(row =>
      within(row)
        .getAllByRole('cell')
        .map(cell => (cell.querySelector('svg') ? '✓' : cell.textContent)),
    );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8')) as Record<string, unknown>;
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  vi.mocked(fetchStub).mockClear();
  session.demo = false;
  server.me = me();
  server.cameras = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('an install that enforces Premium', () => {
  beforeEach(() => {
    server.cameras = [included, migrated, bought, rtsp];
  });

  it('says of every camera what and where it is, whether it is entitled and until when', async () => {
    await drawLoaded();

    expect(card('Terp Cam 1').getByText('until 19 Jul 2027')).toBeInTheDocument();
    expect(card('Terp Cam 1').getByText('Premium')).toBeInTheDocument();
    expect(card('Terp Cam 1').getByText('· Terp Cam · Tent 1')).toBeInTheDocument();
    expect(card('Terp Cam 1').getByRole('link', { name: 'Terp Cam 1' })).toHaveAttribute('href', '/cameras/camera-Terp Cam 1');

    expect(card('Tapo C200').getByText('· RTSP · Tent 1')).toBeInTheDocument();
    expect(card('Tapo C200').getByText('until 27 Oct 2027')).toBeInTheDocument();

    expect(card('Side cam').getByText('needs Premium')).toBeInTheDocument();
    expect(card('Side cam').queryByText(/^until /)).toBeNull();
  });

  it('tells two cameras with one name apart by the tent each stands in', async () => {
    server.cameras = [
      camera({ name: 'Canopy cam', id: 'camera-a', spaceId: 'space-1', entitlement: included.entitlement }),
      camera({ name: 'Canopy cam', id: 'camera-b', spaceId: 'space-2', kind: 'rtsp', entitlement: rtsp.entitlement }),
    ];
    await drawLoaded();

    const cards = screen.getAllByText('Canopy cam').map(name => within(name.closest('li')!));
    expect(cards).toHaveLength(2);
    expect(cards[0].getByText('· Terp Cam · Tent 1')).toBeInTheDocument();
    expect(cards[1].getByText('· RTSP · Tent 2')).toBeInTheDocument();
    expect(cards[0].getByRole('link', { name: 'Canopy cam' })).toHaveAttribute('href', '/cameras/camera-a');
    expect(cards[1].getByRole('link', { name: 'Canopy cam' })).toHaveAttribute('href', '/cameras/camera-b');
  });

  it('reads the sentence under a camera from its grant rather than from its dates', async () => {
    await drawLoaded();

    expect(card('Terp Cam 1').getByText('included with the cam · 12 months · renews only if you say so')).toBeInTheDocument();
    expect(card('Old cam').getByText('carried over at the migration · 12 months from that day · renews only if you say so')).toBeInTheDocument();
    expect(card('Tapo C200').getByText('bought for this camera · renews only if you say so')).toBeInTheDocument();
  });

  it('tells a camera without Premium the truth where the install has set no figure: stills whole, films SD', async () => {
    await drawLoaded();

    expect(
      card('Side cam').getByText(
        'RTSP cameras are a Premium feature: this one shows stills every 60 s; its stills are served whole and kept just as long, but its films stay SD with a watermark until Premium covers it.',
      ),
    ).toBeInTheDocument();
  });

  it("tells a camera without Premium the install's own figures where it has set them", async () => {
    server.me = me({ free: CONFIGURED });
    server.cameras = [
      rtsp,
      camera({ name: 'Odd cam', entitlement: { validUntil: ahead(-200), grant: 'included', tier: 'free', renewalVisible: true } }),
    ];
    await drawLoaded();

    expect(
      card('Side cam').getByText(
        'RTSP cameras are a Premium feature: this one shows stills every 60 s; its stills are served 640 px wide and kept 90 days, and its films stay SD with a watermark until Premium covers it.',
      ),
    ).toBeInTheDocument();
    expect(
      card('Odd cam').getByText(
        'Its Premium ran out on 6 Mar 2026: its stills are served 640 px wide and kept 90 days, and its films stay SD with a watermark until it is extended.',
      ),
    ).toBeInTheDocument();
  });

  it('names only the width where the install has set a width and no window', async () => {
    server.me = me({ free: { stillWidth: 640, stillDays: null, timelapseDays: null } });
    server.cameras = [rtsp];
    await drawLoaded();

    expect(
      card('Side cam').getByText(/its stills are served 640 px wide and its films stay SD with a watermark until Premium covers it\.$/),
    ).toBeInTheDocument();
  });

  it('names only the window where the install has set a window and no width', async () => {
    server.me = me({ free: { stillWidth: null, stillDays: 7, timelapseDays: null } });
    server.cameras = [rtsp];
    await drawLoaded();

    expect(
      card('Side cam').getByText(/its stills are kept 7 days and its films stay SD with a watermark until Premium covers it\.$/),
    ).toBeInTheDocument();
  });

  it('counts down only inside the last sixty days, and only where the server allows a notice', async () => {
    await drawLoaded();

    expect(card('Old cam').getByRole('status')).toHaveTextContent('ends in 20 days');
    expect(card('Terp Cam 1').queryByRole('status')).toBeNull();
    expect(card('Tapo C200').queryByRole('status')).toBeNull();
  });

  it('draws no countdown for a camera whose renewal is not visible, however close its date', async () => {
    server.cameras = [
      camera({ name: 'Quiet cam', entitlement: { validUntil: ahead(20), grant: 'included', tier: 'premium', renewalVisible: false } }),
    ];
    await drawLoaded();

    expect(card('Quiet cam').queryByRole('status')).toBeNull();
    expect(card('Quiet cam').getByText('until 12 Oct 2026')).toBeInTheDocument();
  });

  it('never calls a camera entitled because its date is ahead', async () => {
    server.cameras = [camera({ name: 'Odd cam', entitlement: { validUntil: ahead(200), grant: 'included', tier: 'free', renewalVisible: true } })];
    await drawLoaded();

    expect(card('Odd cam').getByText('needs Premium')).toBeInTheDocument();
    expect(card('Odd cam').queryByText('Premium')).toBeNull();
    expect(card('Odd cam').getByText(/Its Premium ran out on 10 Apr 2027/)).toBeInTheDocument();
  });

  it('puts the offer on the card of the camera it is for, with the price, and leaves the app through it', async () => {
    await drawLoaded();

    // Inside its last sixty days: something to extend.
    const extend = card('Old cam').getByRole('link', { name: /Extend Premium/ });
    expect(extend).toHaveAttribute('href', 'https://shop.example.org/premium');
    expect(extend).toHaveAttribute('target', '_blank');
    expect(extend).toHaveTextContent('Extend Premium · € 29 / year');

    // Never had a year: nothing to extend, so it is offered Premium.
    expect(card('Side cam').getByRole('link', { name: /Get Premium/ })).toHaveTextContent('Get Premium · € 29 / year');

    // Not due: no offer on these, and none anywhere else on the page.
    expect(card('Terp Cam 1').queryByRole('link', { name: /Premium/ })).toBeNull();
    expect(card('Tapo C200').queryByRole('link', { name: /Premium/ })).toBeNull();
    expect(screen.getAllByRole('link', { name: /Extend Premium|Get Premium/ })).toHaveLength(2);
  });

  it('offers nothing while no camera is due, and the closing line says from when it will', async () => {
    server.cameras = [included, bought];
    await drawLoaded();

    expect(screen.queryByRole('link', { name: /Extend Premium|Get Premium/ })).toBeNull();
    expect(screen.queryByText(/€ 29/)).toBeNull();
    expect(screen.getByText(/from 60 days before its year ends/)).toBeInTheDocument();
  });

  it('draws no price the install has not given, even once a camera is due', async () => {
    server.me = me({ priceLabel: null });
    await drawLoaded();

    expect(card('Old cam').getByRole('link', { name: /Extend Premium/ })).toHaveTextContent(/^Extend Premium$/);
  });

  it('has no offer where the install names nowhere to extend, and says once whom to ask', async () => {
    server.me = me({ extendUrl: null });
    server.cameras = [migrated, rtsp];
    await drawLoaded();

    expect(screen.queryByRole('link', { name: /Extend Premium|Get Premium/ })).toBeNull();
    expect(screen.getAllByText('This installation names no place to extend Premium from; ask whoever runs it.')).toHaveLength(1);
  });

  it('says nothing about where to extend while no camera is due', async () => {
    server.me = me({ extendUrl: null });
    server.cameras = [included];
    await drawLoaded();

    expect(screen.queryByText(/names no place to extend/)).toBeNull();
  });
});

describe('an install that gates nothing', () => {
  beforeEach(() => {
    server.me = me({ enforced: false, extendUrl: null, priceLabel: null });
    server.cameras = [included, migrated, rtspOnUngated()];
  });

  it('says so once, and draws no chip, no date, no countdown and no offer however the records read', async () => {
    await drawLoaded();

    expect(screen.getByText(/This installation gates nothing/)).toBeInTheDocument();
    expect(screen.queryByText(/until /)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('link', { name: /Extend Premium|Get Premium/ })).toBeNull();
    expect(screen.queryByText(/needs Premium/)).toBeNull();
    expect(screen.getAllByText('everything included on this install')).toHaveLength(3);

    // The word is the page's title and the table's column, and is on no card:
    // a tier is not a fact about a camera where nothing is gated.
    for (const name of ['Terp Cam 1', 'Old cam', 'Side cam']) expect(card(name).queryByText('Premium')).toBeNull();
    expect(screen.getAllByText('Premium')).toHaveLength(2);
  });

  it('still names the tent beside each camera', async () => {
    await drawLoaded();

    expect(card('Old cam').getByText('· Terp Cam · Tent 1')).toBeInTheDocument();
  });
});

describe('what Premium covers', () => {
  const FIXED = [
    ['✓', '✓'],
    ['–', '✓'],
    ['watermark', '✓'],
    ['–', '✓'],
    ['✓', '✓'],
  ];

  it('draws the table row for row as the board does, about cameras only', async () => {
    await drawLoaded();

    expect(screen.getByText('cameras only')).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getByRole('columnheader', { name: 'Free' })).toBeInTheDocument();
    expect(table.getByRole('columnheader', { name: 'Premium' })).toBeInTheDocument();

    expect(
      table
        .getAllByRole('row')
        .slice(1)
        .map(row => within(row).getByRole('rowheader').textContent),
    ).toEqual([
      "Live still and today's timelapse",
      'Full resolution stills',
      'Stills kept',
      'Timelapse over the whole grow, HD',
      'Reel export with overlays',
      'RTSP cameras without a Terp Cam',
      'Control, charts, diary, alarms, sharing',
    ]);
  });

  it('prints the figures the install has set where it has set them', async () => {
    server.me = me({ free: CONFIGURED });
    await drawLoaded();

    expect(tableSays()).toEqual([FIXED[0], ['640 px', 'whole'], ['90 days', 'whole grow'], ...FIXED.slice(1)]);
  });

  it('says on an enforcing install with no figures set that free stills are whole and kept the whole grow', async () => {
    await drawLoaded();

    expect(tableSays()).toEqual([FIXED[0], ['whole', 'whole'], ['whole grow', 'whole grow'], ...FIXED.slice(1)]);
  });

  it('says the same on an install that gates nothing, which is what its null figures mean', async () => {
    server.me = me({ enforced: false, extendUrl: null, priceLabel: null });
    await drawLoaded();

    expect(tableSays()).toEqual([FIXED[0], ['whole', 'whole'], ['whole grow', 'whole grow'], ...FIXED.slice(1)]);
  });

  it('closes with the rule: per camera, the offer on the card ahead of the end, nothing automatic, nothing self-hosted', async () => {
    await drawLoaded();

    expect(
      screen.getByText(
        "Per camera, not per account. The offer to extend stands on a camera's own card from 60 days before its year ends; nothing renews on its own. Self-hosted installations have no Premium at all.",
      ),
    ).toBeInTheDocument();
  });

  it("is told, as the demo, that there is no account to look at, asks for nothing, and says the figures are the install's", async () => {
    session.demo = true;
    draw();

    expect(await screen.findByText('The demo has no account of its own, so there is no Premium to look at.')).toBeInTheDocument();
    expect(tableSays()).toEqual([FIXED[0], ['per install', 'whole'], ['per install', 'whole grow'], ...FIXED.slice(1)]);
    expect(vi.mocked(fetchStub).mock.calls).toHaveLength(0);
  });
});

describe('the two screens that describe the free tier', () => {
  const drawPrivacy = () =>
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/me/privacy']}>
          <Privacy />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('agree that nothing of a free camera is deleted where the install names no window', async () => {
    server.me = me({ enforced: false, extendUrl: null, priceLabel: null });
    await drawLoaded();
    expect(tableSays()[2]).toEqual(['whole grow', 'whole grow']);

    drawPrivacy();
    expect(await screen.findByText('Premium: the whole grow · free: kept just as long on this install')).toBeInTheDocument();
  });

  it('agree on the days where the install names them', async () => {
    server.me = me({ free: CONFIGURED });
    await drawLoaded();
    expect(tableSays()[2]).toEqual(['90 days', 'whole grow']);

    drawPrivacy();
    expect(await screen.findByText('Premium: the whole grow · free: 90 days')).toBeInTheDocument();
  });
});

describe('when the renewal is due', () => {
  it('is never before the server allows a notice', () => {
    expect(renewalDue({ entitlement: { validUntil: ahead(5), grant: 'included', tier: 'premium', renewalVisible: false } }, NOW)).toBe(false);
    expect(renewalDue({ entitlement: { validUntil: null, grant: null, tier: 'free', renewalVisible: false } }, NOW)).toBe(false);
  });

  it('is inside the last sixty days, or at once for a camera without Premium', () => {
    expect(renewalDue({ entitlement: { validUntil: ahead(61), grant: 'included', tier: 'premium', renewalVisible: true } }, NOW)).toBe(false);
    expect(renewalDue({ entitlement: { validUntil: ahead(60), grant: 'included', tier: 'premium', renewalVisible: true } }, NOW)).toBe(true);
    expect(renewalDue({ entitlement: { validUntil: null, grant: null, tier: 'free', renewalVisible: true } }, NOW)).toBe(true);
  });

  it('counts whole days down to today and stops once the year is over', () => {
    expect(countdownDays({ entitlement: { validUntil: ahead(60), grant: 'included', tier: 'premium', renewalVisible: true } }, NOW)).toBe(60);
    expect(
      countdownDays({ entitlement: { validUntil: NOW.plus({ hours: 5 }).toISO()!, grant: 'included', tier: 'premium', renewalVisible: true } }, NOW),
    ).toBe(0);
    expect(countdownDays({ entitlement: { validUntil: ahead(-1), grant: 'included', tier: 'free', renewalVisible: true } }, NOW)).toBeNull();
    expect(countdownDays({ entitlement: { validUntil: ahead(90), grant: 'included', tier: 'premium', renewalVisible: true } }, NOW)).toBeNull();
  });
});

describe('the camera page', () => {
  // The camera page works out what this reader may do with this camera and
  // hands it down as two answers: its settings are `manage` where it stands,
  // and taking it off the account is `own`.
  const drawSettings = (one: Camera) =>
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <CameraSettings camera={one} mayManage={false} mayOwn={false} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('lets a camera without Premium say its stills are served reduced, with the door to what Premium covers', async () => {
    drawSettings(rtsp);

    expect(await screen.findByText('Without Premium its stills are served reduced and its films stay SD with a watermark.')).toBeInTheDocument();
    expect(screen.getByText('not entitled')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /What Premium covers/ })).toHaveAttribute('href', '/me/premium');
  });

  it('says the year ran out rather than reading a past date as a promise', async () => {
    drawSettings(camera({ name: 'Terp Cam 1', entitlement: { validUntil: ahead(-3), grant: 'included', tier: 'free', renewalVisible: true } }));

    expect(await screen.findByText('ran out 19 Sep 2026')).toBeInTheDocument();
  });

  it('counts the year down where a notice is allowed and it is inside the last sixty days', async () => {
    drawSettings(migrated);

    expect(await screen.findByRole('status')).toHaveTextContent('ends in 20 days');
    expect(screen.getByText('carried over until 12 Oct 2026')).toBeInTheDocument();
  });

  it('says on an install that gates nothing that everything is included, whatever the date on the record', async () => {
    server.me = me({ enforced: false, extendUrl: null, priceLabel: null });
    drawSettings(migrated);

    expect(await screen.findByText('everything included on this install')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

/** An RTSP camera as an install that gates nothing answers it: no year of its own, and yet `premium`. */
function rtspOnUngated(): Camera {
  return camera({
    name: 'Side cam',
    kind: 'rtsp',
    url: 'rtsp://192.168.1.41/stream1',
    entitlement: { validUntil: null, grant: null, tier: 'premium', renewalVisible: false },
  });
}
