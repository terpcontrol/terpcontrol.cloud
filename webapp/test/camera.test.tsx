import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, Camera, GrowListItem, TimelapseCreate } from '@fg2/shared-types/v1';
import { serverNow } from '@/api/clock';
import { CameraScreen } from '@/screens/camera/CameraPage';
import { Composer } from '@/screens/camera/Composer';
import { CameraSettings } from '@/screens/camera/CameraSettings';
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
const state = vi.hoisted(() => ({
  film: null as unknown,
  youMay: 'own' as AccessNeed,
  lastError: null as string | null,
  films: [] as { id: string }[],
  moreFilms: false,
  askedForMore: 0,
  frames: { items: [] as { id: string; capturedAt: string }[], partial: false },
  zone: 'UTC' as string | null,
  lastStill: null as string | null,
  /** The day the page asked the camera for, which is the account's and not this machine's. */
  askedForDay: null as { startsAt: string; endsAt: string } | null,
}));

/**
 * The account's own zone, which is what every clock time on these screens is
 * drawn in. The tests read a UTC account from a machine that is not on UTC, so
 * a label that slipped back onto the browser's zone shows up as an hour out.
 */
vi.mock('@/api/account', async importOriginal => ({
  ...(await importOriginal<object>()),
  useMe: () => ({ data: { preferences: { timezone: state.zone }, premium: { enforced: true } } }),
}));

vi.mock('@/api/cameras', async importOriginal => ({
  ...(await importOriginal<object>()),
  useCameras: () => ({ data: { items: [], nextCursor: null } }),
  useLatestStills: () => new Map<string, string | null>(state.lastStill ? [['camera-1', state.lastStill]] : []),
  useMedia: () => ({ data: state.film, isError: false }),
  useCameraFrames: (_id: string, day: { startsAt: string; endsAt: string }) => {
    state.askedForDay = day;
    return { data: state.frames, isPending: false };
  },
  useTimelapses: () => ({
    data: { pages: [{ items: state.films, nextCursor: state.moreFilms ? 'cursor' : null }] },
    hasNextPage: state.moreFilms,
    isFetchingNextPage: false,
    fetchNextPage: () => {
      state.askedForMore += 1;
    },
  }),
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
  state.films = [];
  state.moreFilms = false;
  state.askedForMore = 0;
  state.frames = { items: [], partial: false };
  state.zone = 'UTC';
  state.askedForDay = null;
  state.lastStill = null;
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

  it('says which picture the preview is and how old, not which range was chosen', () => {
    // The preview is the camera's newest still, because a range has no picture
    // of its own until it is rendered - so on a camera that stopped delivering
    // days ago the old caption called a four-day-old frame a preview of today.
    // Aged against the clock the app ages everything by, which is the server's.
    state.lastStill = 'still-old';
    draw(grow, { state: { ...camera.state, lastStillAt: serverNow().minus({ days: 4 }).toISO()! } });

    expect(screen.getByText('latest picture · 4 d ago')).toBeInTheDocument();
    expect(screen.queryByText(/preview · Today/)).not.toBeInTheDocument();
  });

  it('says a camera has never delivered a picture rather than that today holds none', () => {
    state.lastStill = null;
    draw(grow);

    expect(screen.getByText('This camera has never delivered a picture')).toBeInTheDocument();
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

/**
 * Every switch the contract lets a camera carry, on the card that is the only
 * screen a grower can undo one from. `maintenanceOff` came through the
 * migration already on for some accounts, and `logErrors` is off until somebody
 * turns it on, so a card that draws neither leaves both where they are for good.
 */
describe('what the camera is set to', () => {
  const drawSettings = (over: Partial<Camera> = {}, mayManage = true) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CameraSettings camera={{ ...camera, ...over }} mayManage={mayManage} mayOwn={mayManage} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('draws every switch the camera carries, in the state the server gave', () => {
    drawSettings({ maintenanceOff: true, staleWarning: true, logErrors: false, nightOff: false });

    expect(screen.getByRole('checkbox', { name: 'off during maintenance' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'warn when it stops delivering' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'log failed captures to the diary' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'night off' })).not.toBeChecked();
  });

  it('states the stream it pulls, how, and whether it goes through the tunnel', () => {
    drawSettings({ kind: 'rtsp', did: null, model: null, url: 'rtsp://192.168.144.77:554/stream1', transport: 'tcp', tunnel: true });

    expect(screen.getByText('rtsp://192.168.144.77:554/stream1 · TCP · through the tunnel')).toBeInTheDocument();
    // Stated and not a field: what was served has had its credentials stripped
    // out, so saving it back would be saving over them.
    expect(screen.queryByRole('textbox', { name: 'Reached at' })).not.toBeInTheDocument();
  });

  it('states the identity and address a Terp Cam answers on', () => {
    drawSettings({ did: 'AAC2851962SPLP', ip: '192.168.144.145', model: 'terp_cam' });

    expect(screen.getByText('AAC2851962SPLP · 192.168.144.145 · terp_cam')).toBeInTheDocument();
  });

  it('draws no address at all where the server kept it from this reader', () => {
    // A co-manager or a guest is answered every one of these as null, so the
    // row is absent rather than a row of dashes.
    drawSettings({ did: null, uid: null, ip: null, url: null, model: null });

    expect(screen.queryByText('Reached at')).not.toBeInTheDocument();
  });

  it('offers a reader who may not manage the same facts as words and no switch at all', () => {
    drawSettings({ maintenanceOff: true, staleWarning: true, logErrors: false }, false);

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText(/off during maintenance/)).toBeInTheDocument();
    expect(screen.getByText(/warn when it stops delivering/)).toBeInTheDocument();
  });

  /** Nothing is saved until Save, and with nothing changed there is nothing to offer. */
  it('turns the save on once a switch has been moved', () => {
    drawSettings({ maintenanceOff: true });

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'off during maintenance' }));

    expect(screen.getByRole('checkbox', { name: 'off during maintenance' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

/**
 * A season of films and a full day of pictures, neither of which fits in the
 * page the route answers with. What the section rests at is a height, not the
 * whole of what there is, and a count the walk stopped short of is said as a
 * floor rather than drawn as the day's total.
 */
describe('the films and the pictures behind the first page', () => {
  const drawPage = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CameraScreen camera={{ ...camera, ownerId: YOU }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  const filmsNumbering = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `film-${index}` }));
  const drawn = () => within(screen.getByRole('list', { name: 'Timelapses' })).getAllByRole('listitem');

  it('rests at three films and opens the rest of the page rather than dropping them', () => {
    state.films = filmsNumbering(20);
    drawPage();

    expect(drawn()).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'More films' }));

    expect(drawn()).toHaveLength(20);
  });

  it('follows the cursor for the films after those, and says nothing more once it is exhausted', () => {
    state.films = filmsNumbering(20);
    state.moreFilms = true;
    drawPage();

    fireEvent.click(screen.getByRole('button', { name: 'More films' }));
    fireEvent.click(screen.getByRole('button', { name: 'More films' }));

    expect(state.askedForMore).toBe(1);
  });

  it('offers nothing more where the films on the page are all there are', () => {
    state.films = filmsNumbering(2);
    drawPage();

    expect(drawn()).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'More films' })).not.toBeInTheDocument();
  });

  it('shows the last picture the camera took on a day it has taken none, dimmed and dated', () => {
    // The tent's card and the camera's own row both draw this picture; the page
    // with the most room for it drew a grey box. A value that is old is dimmed
    // and dated, never hidden.
    state.frames = { items: [], partial: false };
    state.lastStill = 'still-old';
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CameraScreen camera={{ ...camera, ownerId: YOU, state: { ...camera.state, lastStillAt: '2026-09-19T02:28:17.000Z' } }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const still = container.querySelector('img[src="/media/still-old"]')!;
    expect(still).toBeInTheDocument();
    expect(still).toHaveAttribute('data-age', 'offline');
    expect(container.textContent).toContain('19 Sep 02:28');
    expect(container.textContent).not.toContain('No picture today yet');
    // The count is the day's and stays true.
    expect(container.textContent).toContain('0 pictures today');
  });

  it('calls the newest frame live only while the header pill calls the camera live', () => {
    // This camera fails most of its captures, so the gap is routinely minutes:
    // the pill read "4 min · stale" while the label four lines below the same
    // picture read "live". Whichever of the two is true, the page may only say
    // it once. The ages are measured against the clock the page itself reads,
    // so they are taken from there rather than from the fixture's own hour.
    const drawTaken = (minutesAgo: number) => {
      const taken = serverNow().minus({ minutes: minutesAgo }).toISO()!;
      state.frames = { items: [{ id: 'still-1', capturedAt: taken }], partial: false };

      return render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <CameraScreen camera={{ ...camera, ownerId: YOU, state: { ...camera.state, lastStillAt: taken } }} />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    };

    // Inside two of its 30 s intervals, which is what the pill calls live.
    const live = drawTaken(0);
    expect(live.container.querySelector('[data-liveness="live"]')).toBeInTheDocument();
    expect(live.container.textContent).toContain('· live');
    live.unmount();

    // Four intervals missed: the pill says stale, so the label says how old the
    // picture is instead, in the words this page uses for an old picture.
    const stale = drawTaken(2);
    expect(stale.container.querySelector('[data-liveness="stale"]')).toBeInTheDocument();
    expect(stale.container.textContent).not.toContain('· live');
    expect(stale.container.textContent).toContain('2 min ago');
  });

  it('names a picture in its alt text by the instant it was taken, not "just now"', () => {
    // A reader who only gets the alt text was told a four-day-old picture was
    // taken just now, under a label that said 19 Sep and a frame drawn dimmed.
    state.frames = { items: [], partial: false };
    state.lastStill = 'still-old';
    const stale = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CameraScreen camera={{ ...camera, ownerId: YOU, state: { ...camera.state, lastStillAt: '2026-09-19T02:28:17.000Z' } }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(stale.container.querySelector('img[src="/media/still-old"]')).toHaveAttribute('alt', 'Terp Cam 1 at 19 Sep 02:28');
    stale.unmount();

    // Today's frame is named by its own hour, in the same stamp the label
    // beside it carries - which widens with the window, so the hour is what is
    // asserted rather than the width.
    state.lastStill = null;
    state.frames = { items: [{ id: 'still-1', capturedAt: '2026-09-19T08:03:00.000Z' }], partial: false };
    const alt = drawPage().container.querySelector('img[src="/media/still-1"]')!.getAttribute('alt')!;

    expect(alt).toContain('Terp Cam 1 at ');
    expect(alt).toContain('08:03');
  });

  it('stamps a frame in the account´s zone rather than the browser´s', () => {
    // The camera burns the instant into the picture, so a label read in the
    // browser's zone is one the picture beside it contradicts. The account here
    // is on UTC and the frame was taken at 08:03 UTC.
    state.frames = { items: [{ id: 'still-1', capturedAt: '2026-09-19T08:03:00.000Z' }], partial: false };
    const utc = drawPage();
    expect(utc.container.textContent).toContain('08:03');
    utc.unmount();

    // The same instant for an account kept in Berlin, which is two hours on.
    state.zone = 'Europe/Berlin';
    expect(drawPage().container.textContent).toContain('10:03');
  });

  it('walks the account´s day, so "today" is the day the account is having', () => {
    // A browser east or west of the account is in a different day for part of
    // every one of them, and the day asked for has to be the account's or the
    // page walks a day the camera took no picture in.
    state.zone = 'Pacific/Auckland';
    state.frames = { items: [], partial: false };
    drawPage();

    const asked = state.askedForDay!;
    expect(DateTime.fromISO(asked.startsAt).setZone('Pacific/Auckland').toFormat('HH:mm')).toBe('00:00');
    expect(DateTime.fromISO(asked.endsAt).setZone('Pacific/Auckland').toFormat('HH:mm')).toBe('23:59');
  });

  it('counts the day it walked, and calls a count it stopped short of a floor', () => {
    const shot = (index: number) => ({ id: `still-${index}`, capturedAt: NOW.minus({ minutes: index }).toISO()! });

    state.frames = { items: [shot(1), shot(2), shot(3)], partial: false };
    const whole = drawPage();
    expect(whole.container.textContent).toContain('3 pictures today');
    whole.unmount();

    state.frames = { items: [shot(1), shot(2), shot(3)], partial: true };
    expect(drawPage().container.textContent).toContain('at least 3 pictures today');
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

  it('names both ends of a film´s span in the account´s zone', () => {
    // A one-day film ending a minute before midnight reads as running into the
    // next day for anybody east of the account, which is the row claiming a day
    // the film holds no frame of.
    state.film = { ...(film('ready') as object), capturedAt: '2026-09-18T00:00:00.000Z', endsAt: '2026-09-18T23:58:36.000Z' };
    const utc = render(<Film mediaId="media-1" />);
    expect(utc.container.textContent).toContain('18 Sep 00:00 → 18 Sep 23:58');
    utc.unmount();

    state.zone = 'Europe/Berlin';
    expect(render(<Film mediaId="media-1" />).container.textContent).toContain('18 Sep → 19 Sep');
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
