import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Camera, GrowListItem, TimelapseCreate } from '@fg2/shared-types/v1';
import { CameraScreen } from '@/screens/camera/CameraPage';
import { Composer } from '@/screens/camera/Composer';
import { Film } from '@/screens/camera/Film';
import { THE_HOST, YOU } from './session';

/**
 * The composer, and the job it starts.
 *
 * Every range but the two rolling ones names both of its own ends, because
 * where a phase or a grow began is the grow's record and not something the
 * server can guess - so a range that needs a grow and has none is refused here,
 * with the reason, rather than sent and turned down.
 */

const asked: TimelapseCreate[] = [];
const state = vi.hoisted(() => ({ film: null as unknown, youMay: 'own' as AccessNeed, lastError: null as string | null }));

vi.mock('@/api/cameras', async importOriginal => ({
  ...(await importOriginal<object>()),
  useCameras: () => ({ data: { items: [], nextCursor: null } }),
  useLatestStills: () => new Map<string, string | null>(),
  useMedia: () => ({ data: state.film, isError: false }),
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

/**
 * What this account may do with the camera is worked out from the place it
 * stands in and from who owns it, so both halves are answered here.
 */
vi.mock('@/api/spaces', async importOriginal => {
  const { spaceWhere, spacesAnswering } = await import('./session');

  return { ...(await importOriginal<object>()), useSpaces: () => spacesAnswering(spaceWhere(state.youMay)) };
});

const NOW = DateTime.fromISO('2026-09-19T12:00:00.000Z');

const camera: Camera = {
  id: 'camera-1',
  createdAt: NOW.toISO()!,
  ownerId: 'user-1',
  kind: 'terpcam_controller',
  // On, the way a camera arrives and the way a migrated one is back-filled.
  staleWarning: true,
  deviceId: 'device-1',
  spaceId: 'space-1',
  name: 'Terp Cam 1',
  looksAt: 'canopy',
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
  logErrors: true,
  entitlement: { validUntil: NOW.plus({ years: 1 }).toISO()!, grant: 'included', tier: 'premium', renewalVisible: false },
  isDemo: false,
  removedAt: null,
  state: { lastStillAt: NOW.toISO()!, lastError: null, firmwareVersion: null },
};

const grow = {
  id: 'grow-1',
  name: 'Spring run',
  startedAt: NOW.minus({ days: 34 }).toISO()!,
  endedAt: null,
  phases: [
    { id: 'phase-1', stage: 'vegetative', startedAt: NOW.minus({ days: 34 }).toISO()! },
    { id: 'phase-2', stage: 'flowering', startedAt: NOW.minus({ days: 12 }).toISO()! },
  ],
  summary: { stage: 'flowering' },
} as unknown as GrowListItem;

const draw = (one: GrowListItem | null, over: Partial<Camera> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Composer camera={{ ...camera, ...over }} grow={one} pending={false} onRender={body => asked.push(body)} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  asked.length = 0;
  state.film = null;
  state.youMay = 'own';
  state.lastError = null;
});

describe('the composer', () => {
  it('asks for today with the instant the bucket is worked out around, and nothing else', () => {
    draw(grow);

    fireEvent.click(screen.getByRole('button', { name: 'Render · SD' }));

    expect(asked).toHaveLength(1);
    expect(asked[0].window).toBe('day');
    expect(asked[0].endsAt).toBeUndefined();
    expect(asked[0].quality).toBe('sd');
  });

  it('names both ends of a phase from the grow´s own record', () => {
    draw(grow);

    fireEvent.click(screen.getByRole('button', { name: /Phase/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Render · SD' }));

    expect(asked[0].window).toBe('phase');
    expect(asked[0].startsAt).toBe(grow.phases[1].startedAt);
    expect(asked[0].endsAt).toBeTruthy();
  });

  it('refuses a phase where nothing grows, with the reason, rather than asking for one', () => {
    draw(null);

    fireEvent.click(screen.getByRole('button', { name: /Phase/ }));

    expect(screen.getByRole('status')).toHaveTextContent('Nothing grows here');
    expect(screen.getByRole('button', { name: 'Render · SD' })).toBeDisabled();
  });

  it('marks HD as Premium and does not offer it to a camera that is not entitled', () => {
    draw(grow, { entitlement: { validUntil: null, grant: null, tier: 'free', renewalVisible: true } });

    expect(screen.getByRole('button', { name: /Render · HD/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Render · SD' })).toBeEnabled();
  });

  it('refuses a whole grow to a camera that is not entitled, at either size', () => {
    draw(grow, { entitlement: { validUntil: null, grant: null, tier: 'free', renewalVisible: true } });

    fireEvent.click(screen.getByRole('button', { name: 'Whole grow' }));

    expect(screen.getByRole('status')).toHaveTextContent('Premium');
    expect(screen.getByRole('button', { name: 'Render · SD' })).toBeDisabled();
  });

  it('sends the overlays and the shape the board offers', () => {
    draw(grow);

    fireEvent.click(screen.getByRole('switch', { name: 'Day counter' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Lights-off frames' }));
    fireEvent.click(screen.getByRole('button', { name: '9 : 16 reel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Render · SD' }));

    expect(asked[0].overlays).toEqual({ dayCounter: false, climate: true, entries: true });
    expect(asked[0].includeLightsOff).toBe(true);
    expect(asked[0].aspect).toBe('9_16');
  });
});

/**
 * The camera's own page, by who is reading it.
 *
 * Its settings and the films it renders are `manage` where it stands, taking it
 * off the account is `own`, and the reason a capture last failed is the
 * camera's address, its tunnel and the paths of the process that reached for
 * it - which the decision record keeps for the owner along with every other way
 * of finding the hardware on somebody's home network.
 */
describe('the camera page, by who is reading', () => {
  const drawPage = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CameraScreen
            camera={{ ...camera, ownerId: state.youMay === 'own' ? YOU : THE_HOST, state: { ...camera.state, lastError: state.lastError } }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('gives the owner the test image, the films, the form and the way to unpair it', () => {
    state.lastError = 'rtsp://192.168.1.40/stream1 refused';
    drawPage();

    expect(screen.getByRole('button', { name: 'Test image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Make a timelapse/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpair' })).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.1\.40/)).toBeInTheDocument();
  });

  it('gives a member the pictures, none of the controls, and not the address the cloud reaches it at', () => {
    state.youMay = 'log';
    state.lastError = 'rtsp://192.168.1.40/stream1 refused';
    drawPage();

    expect(screen.queryByRole('button', { name: 'Test image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Make a timelapse/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unpair' })).not.toBeInTheDocument();
    expect(screen.queryByText(/192\.168\.1\.40/)).not.toBeInTheDocument();
    expect(screen.getByText(/Its settings, its test image and its timelapses are for whoever steers the tent/)).toBeInTheDocument();
  });

  /** A co-manager runs the tent and may set the camera up; ending it is still the owner's. */
  it('gives a co-manager the form and withholds the unpair', () => {
    state.youMay = 'manage';
    drawPage();

    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test image' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unpair' })).not.toBeInTheDocument();
  });
});

describe('the job it starts', () => {
  const film = (status: string, over: Record<string, unknown> = {}) => ({
    id: 'media-1',
    capturedAt: NOW.minus({ days: 1 }).toISO()!,
    endsAt: NOW.toISO()!,
    lengthSeconds: status === 'ready' ? 14 : null,
    quality: 'sd',
    render: { status, error: null, ...over },
  });

  it('says where the render has got to and plays nothing until it is there', () => {
    state.film = film('rendering');
    const { container } = render(<Film mediaId="media-1" />);

    expect(screen.getByText(/rendering/)).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
  });

  it('plays the film once it is done, with the length it came out at', () => {
    state.film = film('ready');
    const { container } = render(<Film mediaId="media-1" />);

    expect(screen.getByText(/ready · 0:14 · SD/)).toBeInTheDocument();
    expect(container.querySelector('video')).toHaveAttribute('src', '/media/media-1');
  });

  it('keeps the reason a render failed instead of staying busy forever', () => {
    state.film = film('failed', { error: 'no frames in that span' });
    render(<Film mediaId="media-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent('no frames in that span');
  });
});
