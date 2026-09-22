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
import type { Camera, Me } from '@fg2/shared-types/v1';
import { CameraSettings } from '@/screens/camera/CameraSettings';
import { countdownDays, renewalDue } from '@/screens/me/premium/entitlement';
import { Premium } from '@/screens/me/premium/Premium';

/**
 * Me › Premium, and the marks a camera carries elsewhere.
 *
 * Everything on the screen is read from two answers and inferred from
 * neither, so what is checked is that the words follow the fields: a camera is
 * called entitled because the server says so and not because its date is
 * ahead, the sentence under it comes from `grant`, the countdown appears only
 * where the server allows a notice and only inside the last sixty days, and
 * an install that gates nothing draws no date and no button however the
 * records read. The price is the install's or nothing.
 */

const NOW = DateTime.fromISO('2026-09-22T12:00:00.000Z');

const session = vi.hoisted(() => ({ demo: false }));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN, ON_THE_DEMO } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => (session.demo ? ON_THE_DEMO : SIGNED_IN) };
});

vi.mock('@/ui/useNow', () => ({ useNow: () => NOW }));

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
  if (url.endsWith('/v1/devices') || url.endsWith('/v1/spaces')) return json({ items: [], nextCursor: null });
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

  it('says of every camera what it is, whether it is entitled and until when', async () => {
    await drawLoaded();

    expect(card('Terp Cam 1').getByText('until 19 Jul 2027')).toBeInTheDocument();
    expect(card('Terp Cam 1').getByText('Premium')).toBeInTheDocument();
    expect(card('Terp Cam 1').getByText('· Terp Cam')).toBeInTheDocument();

    expect(card('Tapo C200').getByText('· RTSP')).toBeInTheDocument();
    expect(card('Tapo C200').getByText('until 27 Oct 2027')).toBeInTheDocument();

    expect(card('Side cam').getByText('needs Premium')).toBeInTheDocument();
    expect(card('Side cam').queryByText(/^until /)).toBeNull();
  });

  it('reads the sentence under a camera from its grant rather than from its dates', async () => {
    await drawLoaded();

    expect(card('Terp Cam 1').getByText('included with the cam · 12 months · renews only if you say so')).toBeInTheDocument();
    expect(card('Old cam').getByText('carried over at the migration · 12 months from that day · renews only if you say so')).toBeInTheDocument();
    expect(card('Tapo C200').getByText('bought for this camera · renews only if you say so')).toBeInTheDocument();
  });

  it('lets a camera without Premium say what it is missing, at its own interval', async () => {
    await drawLoaded();

    expect(
      card('Side cam').getByText(
        'RTSP cameras are a Premium feature: this one shows stills every 60 s, but they are served reduced and its films stay SD with a watermark until Premium covers it.',
      ),
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

  it('leaves the app to extend, and shows the price once a camera is due', async () => {
    await drawLoaded();

    const extend = screen.getByRole('link', { name: /Extend Premium/ });
    expect(extend).toHaveAttribute('href', 'https://shop.example.org/premium');
    expect(extend).toHaveAttribute('target', '_blank');
    expect(extend).toHaveTextContent('Extend Premium · € 29 / year');
  });

  it('says when the price will be shown while no camera is due, and shows none until then', async () => {
    server.cameras = [included, bought];
    await drawLoaded();

    expect(screen.getByRole('link', { name: /Extend Premium/ })).toHaveTextContent('Extend Premium · price shown 60 days before');
    expect(screen.queryByText(/€ 29/)).toBeNull();
  });

  it('draws no price the install has not given, even once a camera is due', async () => {
    server.me = me({ priceLabel: null });
    await drawLoaded();

    expect(screen.getByRole('link', { name: /Extend Premium/ })).toHaveTextContent(/^Extend Premium$/);
  });

  it('has no button where the install names nowhere to extend, and says whom to ask', async () => {
    server.me = me({ extendUrl: null });
    server.cameras = [
      camera({ name: 'Terp Cam 1', entitlement: { validUntil: ahead(20), grant: 'included', tier: 'premium', renewalVisible: false } }),
    ];
    await drawLoaded();

    expect(screen.queryByRole('link', { name: /Extend Premium/ })).toBeNull();
    expect(screen.getByText('This installation names no place to extend Premium from; ask whoever runs it.')).toBeInTheDocument();
  });
});

describe('an install that gates nothing', () => {
  beforeEach(() => {
    server.me = me({ enforced: false, extendUrl: null, priceLabel: null });
    server.cameras = [included, migrated, rtspOnUngated()];
  });

  it('says so, and draws no date, no countdown and no button however the records read', async () => {
    await drawLoaded();

    expect(screen.getByText(/This installation gates nothing/)).toBeInTheDocument();
    expect(screen.queryByText(/until /)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('link', { name: /Extend Premium/ })).toBeNull();
    expect(screen.queryByText(/needs Premium/)).toBeNull();
    expect(screen.getAllByText('everything included on this install')).toHaveLength(3);
  });
});

describe('what Premium covers', () => {
  it('draws the table row for row as the board does, about cameras only', async () => {
    await drawLoaded();

    expect(screen.getByText('cameras only')).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getByRole('columnheader', { name: 'Free' })).toBeInTheDocument();
    expect(table.getByRole('columnheader', { name: 'Premium' })).toBeInTheDocument();

    const rows = table.getAllByRole('row').slice(1);
    const said = rows.map(row =>
      within(row)
        .getAllByRole('cell')
        .map(cell => cell.textContent),
    );
    expect(rows.map(row => within(row).getByRole('rowheader').textContent)).toEqual([
      "Live still and today's timelapse",
      'Full resolution stills',
      'Stills kept',
      'Timelapse over the whole grow, HD',
      'Reel export with overlays',
      'RTSP cameras without a Terp Cam',
      'Control, charts, diary, alarms, sharing',
    ]);
    expect(said).toEqual([
      ['•', '•'],
      ['SD', '3 MP'],
      ['limited', 'whole grow'],
      ['–', '•'],
      ['watermark', '•'],
      ['–', '•'],
      ['•', '•'],
    ]);
  });

  it('closes with the rule: per camera, the price ahead of the end, nothing automatic, nothing self-hosted', async () => {
    await drawLoaded();

    expect(
      screen.getByText(
        'Per camera, not per account. The renewal price is shown here before the included year ends; nothing renews on its own. Self-hosted installations have no Premium at all.',
      ),
    ).toBeInTheDocument();
  });

  it('is told, as the demo, that there is no account to look at, and asks for nothing', async () => {
    session.demo = true;
    draw();

    expect(await screen.findByText('The demo has no account of its own, so there is no Premium to look at.')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(vi.mocked(fetchStub).mock.calls).toHaveLength(0);
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
  const drawSettings = (one: Camera) =>
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter>
          <CameraSettings camera={one} mayManage={false} />
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
