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
import { causeOf, filmCauseOf } from '@/screens/camera/capture-failure';
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

const state = vi.hoisted(() => ({
  /** Every film asked for, by the composer's own callback and by the page's one-tap buttons alike. */
  asked: [] as TimelapseCreate[],
  film: null as unknown,
  youMay: 'own' as AccessNeed,
  lastError: null as string | null,
  /** The films the list is served, which carry a span and a verdict of their own where a test needs them drawn. */
  films: [] as { id: string; capturedAt?: string; endsAt?: string; render?: { status: string; error?: string | null } }[],
  moreFilms: false,
  askedForMore: 0,
  frames: { items: [] as { id: string; capturedAt: string }[], partial: false },
  /** The day's read failing, which is not the same as a day the camera took nothing in. */
  framesFailed: false,
  /** The day's read still out, which is not the same as either of those two. */
  framesPending: false,
  readAgain: 0,
  zone: 'UTC' as string | null,
  /** The width this install serves a free camera's stills at; null serves them whole. */
  stillWidth: null as number | null,
  lastStill: null as string | null,
  /** The day the page asked the camera for, which is the account's and not this machine's. */
  askedForDay: null as { startsAt: string; endsAt: string } | null,
  /** What the test button's press answered, which is a picture or a reason and never an error. */
  capture: null as { succeeded: boolean; mediaId: string | null; capturedAt: string | null; error: string | null } | null,
  /** A press that got no answer at all. */
  captureError: null as unknown,
}));

/**
 * The account's own zone, which is what every clock time on these screens is
 * drawn in. The tests read a UTC account from a machine that is not on UTC, so
 * a label that slipped back onto the browser's zone shows up as an hour out.
 */
vi.mock('@/api/account', async importOriginal => ({
  ...(await importOriginal<object>()),
  useMe: () => ({
    data: {
      preferences: { timezone: state.zone },
      premium: { enforced: true, free: { stillWidth: state.stillWidth, stillDays: null, timelapseDays: null } },
    },
  }),
}));

vi.mock('@/api/cameras', async importOriginal => ({
  ...(await importOriginal<object>()),
  useCameras: () => ({ data: { items: [], nextCursor: null } }),
  useLatestStills: () => new Map<string, string | null>(state.lastStill ? [['camera-1', state.lastStill]] : []),
  // One film under the microscope is `film`; a list of them is served from the
  // rows themselves, and only those a test gave a span to - the rest stand for
  // reads that have not answered, which is what the paging tests draw.
  useMedia: (id: string) => ({ data: state.film ?? state.films.find(one => one.id === id && one.capturedAt) ?? null, isError: false }),
  useCameraFrames: (_id: string, day: { startsAt: string; endsAt: string }) => {
    state.askedForDay = day;
    if (state.framesPending) return { data: undefined, isPending: true, isError: false, refetch: () => (state.readAgain += 1) };
    if (state.framesFailed) return { data: undefined, isPending: false, isError: true, refetch: () => (state.readAgain += 1) };

    return { data: state.frames, isPending: false, isError: false, refetch: () => (state.readAgain += 1) };
  },
  useTestCapture: () => ({ mutate: () => {}, data: state.capture ?? undefined, error: state.captureError, isPending: false }),
  useRequestTimelapse: () => ({ mutate: (body: TimelapseCreate) => state.asked.push(body), error: null, isPending: false }),
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
        <Composer
          camera={{ ...camera, state: { ...camera.state, lastStillAt: serverNow().toISO()! }, ...over }}
          grow={one}
          pending={false}
          onRender={body => state.asked.push(body)}
          onClose={() => {}}
        />
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
  state.asked.length = 0;
  state.film = null;
  state.youMay = 'own';
  state.lastError = null;
  state.films = [];
  state.moreFilms = false;
  state.askedForMore = 0;
  state.frames = { items: [], partial: false };
  state.framesFailed = false;
  state.framesPending = false;
  state.readAgain = 0;
  state.zone = 'UTC';
  state.stillWidth = null;
  state.askedForDay = null;
  state.lastStill = null;
  state.capture = null;
  state.captureError = null;
});

describe('the composer', () => {
  it('asks for today with the instant the bucket is worked out around, and nothing else', () => {
    draw(grow);

    fireEvent.click(screen.getByRole('button', { name: 'Render · SD' }));

    expect(state.asked).toHaveLength(1);
    expect(state.asked[0].window).toBe('day');
    expect(state.asked[0].endsAt).toBeUndefined();
    expect(state.asked[0].quality).toBe('sd');
  });

  it('asks for the last complete week as the Week button does, naming no instant', () => {
    draw(grow);

    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Render · SD' }));

    expect(state.asked).toHaveLength(1);
    expect(state.asked[0]).toMatchObject({ window: 'week' });
    expect(state.asked[0].startsAt).toBeUndefined();
  });

  it('refuses a day for a camera that has taken nothing in it, as the Today button does', () => {
    draw(grow, { state: { ...camera.state, lastStillAt: serverNow().minus({ days: 5 }).toISO()! } });

    expect(screen.getByRole('button', { name: 'Render · SD' })).toBeDisabled();
    expect(screen.getByText('No picture today, so there is nothing to film yet.')).toBeInTheDocument();
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

    expect(state.asked[0].window).toBe('phase');
    expect(state.asked[0].startsAt).toBe(grow.phases[1].startedAt);
    expect(state.asked[0].endsAt).toBeTruthy();
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

    expect(state.asked[0].overlays).toEqual({ dayCounter: false, climate: true, entries: true });
    expect(state.asked[0].includeLightsOff).toBe(true);
    expect(state.asked[0].aspect).toBe('9_16');
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
    expect(screen.getByText(/Its settings, its test image and its timelapses are for whoever steers the space/)).toBeInTheDocument();
  });

  /**
   * A dark camera's only explanation was the paragraph ffmpeg wrote, heap
   * addresses and the server's own loopback port and all, in English on a
   * German screen. What the line says now is the kind of failure it was; the
   * words themselves are still on the page, because they are how the one person
   * who can fix the camera finds out what is wrong with it.
   */
  it('names the kind of failure a capture met, and keeps the camera´s own words under it', () => {
    state.lastError =
      '[rtsp @ 0xffffa6850350] Failed reading RTSP data: End of file [in#0 @ 0xffffa67ca520] Error opening input: Invalid data found rtsp://<credentials>@127.0.0.1:40763/stream1';
    drawPage();

    expect(screen.getByText('Last try failed: the stream ended before a picture arrived')).toBeInTheDocument();
    expect(screen.getByText(/40763/)).toBeInTheDocument();
    expect(screen.getByText('What the camera said')).toBeInTheDocument();
  });

  it('names a failure it cannot tell apart as the failure it is, rather than as ffmpeg´s account of it', () => {
    state.lastError = 'ffmpeg exited with status 251';
    drawPage();

    expect(screen.getByText('Last try failed: the camera could not be read')).toBeInTheDocument();
    expect(screen.getByText('ffmpeg exited with status 251')).toBeInTheDocument();
  });

  /**
   * A press that worked used to change nothing at all on this page: the answer
   * carries the id of the still it stored, and the only line the button could
   * draw was a failure.
   */
  it('says what a press that worked left behind, rather than going quiet', () => {
    state.capture = { succeeded: true, mediaId: 'still-new', capturedAt: '2026-09-19T12:00:02.000Z', error: null };
    drawPage();

    expect(screen.getByRole('status')).toHaveTextContent('Taken. It is the newest picture of the day.');
  });

  /**
   * The same failure the banner above the frame already translates. The button
   * printed what the server stored, which is English on every screen: a German
   * page said "device aborted the capture" under a button called "Testbild".
   */
  it('names the kind of failure a press met, and keeps the camera´s own words under it for the owner', () => {
    state.capture = { succeeded: false, mediaId: null, capturedAt: null, error: 'device aborted the capture' };
    drawPage();

    expect(screen.getByRole('alert')).toHaveTextContent('the camera stopped the capture');
    expect(screen.getByText('What the camera said')).toBeInTheDocument();
    expect(screen.getByText('device aborted the capture')).toBeInTheDocument();
  });

  /**
   * The server can take well over half a minute to read a Terp Cam, and this
   * side giving up is not the camera being out of reach: the press said "That
   * did not reach the camera" while the server was still reading it.
   */
  it('says that nothing has answered yet where this side gave up, and that the camera was not reached only where it was not', () => {
    state.captureError = new DOMException('signal timed out', 'TimeoutError');
    const drawn = drawPage();
    expect(screen.getByRole('alert')).toHaveTextContent('No answer after two minutes. If the camera still sends the picture, it appears here.');
    drawn.unmount();

    state.captureError = new TypeError('Failed to fetch');
    drawPage();
    expect(screen.getByRole('alert')).toHaveTextContent('That did not reach the camera.');
  });

  it('gives a co-manager the kind of failure and not the words that name the hardware', () => {
    state.youMay = 'manage';
    state.capture = { succeeded: false, mediaId: null, capturedAt: null, error: 'rtsp://192.168.1.40/stream1 refused' };
    drawPage();

    expect(screen.getByRole('alert')).toHaveTextContent('the camera did not answer');
    expect(screen.queryByText(/192\.168\.1\.40/)).not.toBeInTheDocument();
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
 * The kinds of failure apart, because each of them is a different move: check
 * the power and the network, check the login, check the address, or wait for
 * the tent's controller to come back. What the server stores is whatever the
 * process that reached for the camera said, so these are the wordings the
 * server's own capture paths produce.
 */
describe('what a failed capture is called', () => {
  const causes: [string, string][] = [
    ['device aborted the capture', 'aborted'],
    ['discarding corrupt frame ("no moov atom")', 'damaged'],
    ['[rtsp @ 0x1] Failed reading RTSP data: End of file', 'stoppedEarly'],
    ['Server returned 401 Unauthorized', 'refusedLogin'],
    ['connect ECONNREFUSED 192.168.1.40:554', 'noAnswer'],
    ['timed out waiting for the device to deliver an image', 'noAnswer'],
    ['the device is not connected to the broker', 'noController'],
    ['this camera has no stream address', 'noAddress'],
    ['Error opening input: Invalid data found when processing input', 'noStream'],
    ['ffmpeg exited with status 251', 'unknown'],
  ];

  it.each(causes)('reads %s as %s', (said, cause) => {
    expect(causeOf(said)).toBe(`camera.failure.${cause}`);
  });

  /**
   * A stream cut off mid-frame reports both the end of the file and, a line
   * later, that what arrived was not a video. The first thing that went wrong
   * is the one worth naming; the second is what it looked like afterwards.
   */
  it('names a failure by what it began as where one failure prints the wording of two', () => {
    expect(causeOf('Failed reading RTSP data: End of file … Error opening input: Invalid data found')).toBe('camera.failure.stoppedEarly');
  });

  /**
   * A render is read by its own causes rather than by the ones above it,
   * because a render never goes near the camera: it works from pictures that
   * are already stored, so nothing it fails at is a login being refused or an
   * address answering nothing. These are the sentences the render writes.
   */
  it.each([
    ['every picture in that span was taken with the light off', 'allDark'],
    ['there are not enough pictures in that span to make a film', 'tooFew'],
    ['the camera this was asked of is gone', 'cameraGone'],
    ['the pictures in that span could not be made into a film', 'encodeFailed'],
    ['ffmpeg exited with status 251', 'unknown'],
  ])('reads the render´s %s as %s', (said, cause) => {
    expect(filmCauseOf(said)).toBe(`camera.film.failure.${cause}`);
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

  /**
   * The Phase and Whole grow chips beside it are already drawn refused with
   * their reason, so the pattern for a film that cannot be made exists on this
   * very row. The day chip was the one that did not use it: a tap on a camera
   * that had taken nothing was answered, queued and left a permanent failed row
   * in the list that no screen can remove.
   */
  it('refuses a day film on a camera that has taken no picture in the last day', () => {
    state.frames = { items: [], partial: false };
    const dark = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CameraScreen camera={{ ...camera, ownerId: YOU, state: { ...camera.state, lastStillAt: serverNow().minus({ days: 4 }).toISO()! } }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('button', { name: /Today/ })).toBeDisabled();
    expect(dark.container.textContent).toContain('No picture today, so there is nothing to film yet.');
    dark.unmount();

    // Still delivering: the bucket the server works out cannot start earlier
    // than a day ago, so a picture inside that day is proof it holds frames.
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CameraScreen camera={{ ...camera, ownerId: YOU, state: { ...camera.state, lastStillAt: serverNow().minus({ minutes: 5 }).toISO()! } }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('button', { name: /Today/ })).toBeEnabled();
  });

  /**
   * The span of a "Week" is the server's to work out, and it works one out
   * around whatever instant it is handed. Seven days floor against the epoch,
   * so an instant of now names the week that opened this morning - six days of
   * it in the future - and the button failed every Thursday on a camera holding
   * a full week of pictures. Naming no instant is what the route documents as
   * the most recent complete window, and is what the button now asks for.
   */
  it('asks for a week the server has already finished rather than the one that opened today', () => {
    drawPage();

    fireEvent.click(screen.getByRole('button', { name: /Week/ }));

    expect(state.asked).toHaveLength(1);
    expect(state.asked[0].window).toBe('week');
    expect(state.asked[0].startsAt).toBeUndefined();
    expect(state.asked[0].endsAt).toBeUndefined();
  });

  /**
   * And it is refused where that week can be proved empty, the way the day
   * chip beside it already is. The week the server picks for itself is the one
   * before the week holding now, so it cannot begin earlier than a fortnight
   * ago: a camera with nothing newer than that has nothing in it. A camera
   * dark for five days still has that week full, which is exactly the film it
   * was being denied before.
   */
  it('refuses a week film only where the camera took nothing in any week the server could pick', () => {
    const drawDarkFor = (days: number) =>
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <CameraScreen camera={{ ...camera, ownerId: YOU, state: { ...camera.state, lastStillAt: serverNow().minus({ days }).toISO()! } }} />
          </MemoryRouter>
        </QueryClientProvider>,
      );

    const recent = drawDarkFor(5);
    expect(screen.getByRole('button', { name: /Today/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Week/ })).toBeEnabled();
    recent.unmount();

    const gone = drawDarkFor(20);
    expect(screen.getByRole('button', { name: /Week/ })).toBeDisabled();
    expect(gone.container.textContent).toContain('The camera took no picture in the week this would film.');
  });

  /**
   * Two rows of one span with opposite verdicts, which is what a day rendered
   * twice leaves behind: the quick button stores a `day`, the composer stores
   * the same midnight-to-midnight span as a `custom`, and they are ordered by
   * their span and then by a random uuid. The failure won that draw and stood
   * as the third of the three rows the section rests at, while the film that
   * plays sat behind "More films" - the page denying a film it was holding.
   */
  it('reports a span that has a film that plays as that film, not as the attempt that failed', () => {
    const span = { capturedAt: '2026-09-19T00:00:00.000Z', endsAt: '2026-09-20T00:00:00.000Z' };
    state.films = [
      { id: 'film-failed', ...span, render: { status: 'failed', error: 'there are not enough pictures in that span to make a film' } },
      { id: 'film-ready', ...span, render: { status: 'ready' } },
      { id: 'film-other-day', capturedAt: '2026-09-18T00:00:00.000Z', endsAt: '2026-09-19T00:00:00.000Z', render: { status: 'failed', error: 'x' } },
    ];
    const { container } = drawPage();

    expect(drawn()).toHaveLength(2);
    expect(container.textContent).toContain('19 Sep 00:00 → 19 Sep 23:59');
    expect(container.textContent).not.toContain('there are not enough pictures in that span to make a film');
    // The other day failed and has nothing standing in for it, so it keeps its row.
    expect(container.textContent).toContain('18 Sep 00:00 → 18 Sep 23:59');
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

  /**
   * A free camera's stills are served narrower only where the install names a
   * width. On one that names none they are served whole, and a line calling
   * them reduced was a claim about a picture that is not.
   */
  it('names the width a free camera is served at, and says nothing where the install serves it whole', () => {
    const drawFree = () =>
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <CameraScreen camera={{ ...camera, ownerId: YOU, entitlement: { validUntil: null, grant: null, tier: 'free', renewalVisible: true } }} />
          </MemoryRouter>
        </QueryClientProvider>,
      );

    const count = (container: HTMLElement) => [...container.querySelectorAll('p')].find(line => line.textContent?.includes('pictures today'))!;

    const whole = drawFree();
    expect(count(whole.container)).toHaveTextContent(/^0 pictures today$/);
    whole.unmount();

    state.stillWidth = 640;
    expect(count(drawFree().container)).toHaveTextContent(/^0 pictures today · served 640 px wide$/);
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

  /**
   * A read that did not arrive is not a day with nothing in it. The page said
   * "No picture today yet" and "0 pictures today" as facts, on a camera that
   * had taken thirty-three pictures that morning, with nothing to press.
   */
  it('says the pictures could not be read rather than that the day holds none', () => {
    state.framesFailed = true;
    const { container } = drawPage();

    // Once: the frame has the room for it, so the line that lost its count
    // carries the way out rather than the sentence a second time.
    expect(container.textContent?.match(/could not be read just now/g)).toHaveLength(1);
    expect(container.textContent).not.toContain('No picture today yet');
    expect(container.textContent).not.toContain('0 pictures today');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.readAgain).toBe(1);
  });

  /**
   * A read that has not answered yet is not an answer of zero. The page drew
   * the frame as loading and, two lines under it, stated "0 pictures today" of
   * a camera that had been filling the day since dawn - one screen holding
   * both answers at once, until the read landed and it changed its mind.
   */
  it('says nothing about the day´s count while the read is still out', () => {
    state.framesPending = true;
    const waiting = drawPage();

    expect(waiting.container.textContent).toContain('loading');
    expect(waiting.container.textContent).not.toContain('0 pictures today');
    expect(waiting.container.textContent).not.toContain('No picture today yet');
    // The read is named once, by the frame that has the room for it.
    expect(waiting.container.textContent?.match(/loading/g)).toHaveLength(1);
    waiting.unmount();

    // The same page once the read lands: now the count is an answer and is said.
    state.framesPending = false;
    state.frames = { items: [{ id: 'still-1', capturedAt: NOW.minus({ minutes: 4 }).toISO()! }], partial: false };
    expect(drawPage().container.textContent).toContain('1 picture today');
  });

  /**
   * A control that cannot change anything is worse than no control. On a
   * camera dark for days the scrubber was drawn live across midnight to now
   * over a day holding no picture: the handle moved and announced an hour this
   * morning while the still under it, four days old, never changed.
   */
  it('draws the scrubber only where there are pictures for it to walk between', () => {
    state.frames = { items: [], partial: false };
    state.lastStill = 'still-old';
    const dark = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <CameraScreen camera={{ ...camera, ownerId: YOU, state: { ...camera.state, lastStillAt: '2026-09-15T02:28:17.000Z' } }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(dark.container.querySelector('input[type=range]')).toBeNull();
    // The day's own count and the picture standing in for it are still said.
    expect(dark.container.textContent).toContain('0 pictures today');
    expect(dark.container.querySelector('img[src="/media/still-old"]')).toBeInTheDocument();
    dark.unmount();

    // A read still out has no window to draw either: its ends would be the
    // whole day and would jump to the first picture as soon as it answered.
    state.framesPending = true;
    const waiting = drawPage();
    expect(waiting.container.querySelector('input[type=range]')).toBeNull();
    waiting.unmount();

    // A day the camera filled gets the control, spanning its own pictures.
    state.framesPending = false;
    state.lastStill = null;
    state.frames = { items: [{ id: 'still-1', capturedAt: NOW.minus({ hours: 2 }).toISO()! }], partial: false };
    const walked = drawPage().container.querySelector('input[type=range]')!;

    expect(walked).toBeInTheDocument();
    expect(walked.getAttribute('min')).toBe(String(DateTime.fromISO(NOW.minus({ hours: 2 }).toISO()!).toMillis()));
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

  /**
   * The two things that write `endsAt` mean different ends by it: the rolling
   * builder stores the last frame it encoded, a film composed on request stores
   * the exclusive end of its bucket. A one-tap "Today" arrived as midnight to
   * midnight and was drawn as two dates, over builder films of the same length
   * reading as one.
   */
  it('reads a film´s end as the last moment inside it rather than the first outside', () => {
    state.zone = 'UTC';
    state.film = { ...(film('ready') as object), capturedAt: '2026-09-23T00:00:00.000Z', endsAt: '2026-09-24T00:00:00.000Z' };

    const { container } = render(<Film mediaId="media-1" />);

    expect(container.textContent).toContain('23 Sep 00:00 → 23 Sep 23:59');
    expect(container.textContent).not.toContain('24 Sep');
  });

  it('plays the film once it is done, with the length it came out at', () => {
    state.film = film('ready');
    const { container } = render(<Film mediaId="media-1" />);

    expect(screen.getByText(/ready · 0:14 · SD/)).toBeInTheDocument();
    expect(container.querySelector('video')).toHaveAttribute('src', '/media/media-1');
  });

  /**
   * A render that failed says why, in the language the page is in. The server
   * writes its reason in English - the German camera page's one English line
   * was this row - so the words are read for the cause they name and the cause
   * is what is drawn, with the server's own sentence kept a tap below for
   * whoever owns the camera, exactly as the capture banner keeps it.
   */
  it('names why a render failed in the language of the page, and keeps the server´s own words for the owner', () => {
    state.film = film('failed', { error: 'every picture in that span was taken with the light off' });
    const { container } = render(<Film mediaId="media-1" mayOwn />);

    expect(screen.getByRole('alert')).toHaveTextContent('Every picture in that span was taken with the light off');
    expect(screen.getByRole('group')).toHaveTextContent('What the render said');
    expect(container.textContent).toContain('every picture in that span was taken with the light off');
  });

  it('keeps the render´s own words from a reader who cannot go and fix the camera', () => {
    state.film = film('failed', { error: 'ffmpeg exited with status 251' });
    const { container } = render(<Film mediaId="media-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent('The render failed.');
    expect(container.textContent).not.toContain('ffmpeg');
  });
});
