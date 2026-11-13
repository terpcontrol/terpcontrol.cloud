import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccessNeed,
  Camera,
  CameraUpdate,
  Device,
  GrowDiaryPage,
  GrowListItem,
  OverviewCamera,
  TestCapture,
  TimelapseCreate,
} from '@fg2/shared-types/v1';
import { NoAnswerInTime } from '@/api/cameras';
import { ApiError } from '@/api/problem';
import { serverNow } from '@/api/clock';
import type { Told } from '@/log/log-context';
import { CameraPage, CameraScreen } from '@/screens/camera/CameraPage';
import { causeOf, filmCauseOf } from '@/screens/camera/capture-failure';
import { Composer } from '@/screens/camera/Composer';
import { CameraSettings } from '@/screens/camera/CameraSettings';
import { firstDayOf, landsOn, nearestTo, picturedDays } from '@/screens/camera/days';
import { Film } from '@/screens/camera/Film';
import { reachesBackTo } from '@/screens/grow/diary/read-back';
import { forgetKept } from '@/ui/kept';
import { drawAt, NOT_FOUND, reading } from './harness';
import { THE_HOST, YOU } from './session';
import { translate } from './translations';

/**
 * The camera page: its picture and the days behind it, the films by name, one
 * picture now, the composer, the job it starts, and what the camera is set to.
 *
 * Every range but the two rolling ones names both of its own ends, because
 * where a phase or a grow began is the grow's record and not something the
 * server can guess - so a range that needs a grow and has none is refused here,
 * with the reason, rather than sent and turned down.
 */

const state = vi.hoisted(() => ({
  /** Every film asked for, by the composer's own callback and by the page's button alike. */
  asked: [] as TimelapseCreate[],
  /** The film row a request is answered with; null is a request still out. */
  accepted: null as unknown,
  /** The cameras standing where this one does, itself among them. */
  beside: [] as Camera[],
  film: null as unknown,
  youMay: 'own' as AccessNeed,
  lastError: null as string | null,
  /** The films the camera has, which carry a span and a verdict of their own where a test needs them drawn. */
  films: [] as { id: string; window?: string; capturedAt?: string; endsAt?: string; render?: { status: string; error?: string | null } }[],
  moreFilms: false,
  askedForMore: 0,
  zone: 'UTC' as string | null,
  lastStill: null as string | null,
  /** What the test button's press answered, which is a picture or a reason and never an error. */
  capture: null as TestCapture | null,
  /** A press that got no answer at all. */
  captureError: null as unknown,
  /** A press still waiting for its answer. */
  capturing: false,
  /** Whether the account keeps a grow diary, whose films are a phase and a whole grow. */
  diary: true,
  /** The account's devices, which a camera read through one goes dark with; null is a read still out. */
  devices: null as Device[] | null,
  /** The grows of the camera's place, and the pages of the running one's diary read so far. */
  grows: [] as GrowListItem[],
  pages: null as GrowDiaryPage[] | null,
  earlierWeeks: false,
  askedForEarlier: 0,
  /** The camera as the place's overview shows it, which is where today's picture and its lit stand-in come from. */
  seen: null as OverviewCamera | null,
  /** Whether a device measures where the camera looks. */
  measured: true,
  told: [] as Told[],
  saved: [] as { cameraId: string; body: CameraUpdate }[],
  removed: [] as string[],
}));

/** A test picture as the server answers it once it is over. */
const captured = (over: Partial<TestCapture>): TestCapture => ({
  id: 'capture-1',
  cameraId: 'camera-1',
  state: 'running',
  startedAt: '2026-09-19T12:00:00.000Z',
  finishedAt: '2026-09-19T12:00:02.000Z',
  still: null,
  reason: null,
  error: null,
  ...over,
});

vi.mock('@/api/devices', async importOriginal => ({
  ...(await importOriginal<object>()),
  useDevices: () => ({
    data: state.devices ? { items: state.devices, nextCursor: null } : undefined,
    isPending: state.devices === null,
    isError: false,
  }),
}));

vi.mock('@/api/layers', async importOriginal => ({ ...(await importOriginal<object>()), useDiaryLayer: () => state.diary }));

vi.mock('@/api/home', async importOriginal => ({
  ...(await importOriginal<object>()),
  useHomeShape: () => ({ data: { spaces: [{ spaceId: 'space-1', deviceIds: state.measured ? ['device-1'] : [] }] } }),
}));

vi.mock('@/api/grows', async importOriginal => ({
  ...(await importOriginal<object>()),
  useSpaceGrows: () => ({ data: { items: state.grows, nextCursor: null } }),
  useGrowDiary: () => ({
    data: state.pages ? { pages: state.pages } : undefined,
    hasNextPage: state.earlierWeeks,
    isFetchingNextPage: false,
    fetchNextPage: () => {
      state.askedForEarlier += 1;
    },
  }),
}));

vi.mock('@/log/log-context', async importOriginal => ({
  ...(await importOriginal<object>()),
  useLog: () => ({ tell: (told: Told) => state.told.push(told) }),
}));

/**
 * The account's own zone, which is what every clock time on these screens is
 * drawn in. The tests read a UTC account from a machine that is not on UTC, so
 * a label that slipped back onto the browser's zone shows up as an hour out.
 */
vi.mock('@/api/account', async importOriginal => {
  const me = () => ({
    data: {
      preferences: { timezone: state.zone },
      premium: { enforced: true, free: { stillWidth: null, stillDays: null, timelapseDays: null } },
    },
  });
  return { ...(await importOriginal<object>()), useMe: me, useAccountMe: me };
});

vi.mock('@/api/media', async importOriginal => ({
  ...(await importOriginal<object>()),
  // One film under the microscope is `film`; a list of them is served from the
  // rows themselves, and only those a test gave a span to - the rest stand for
  // reads that have not answered, which is what the paging tests draw.
  useMedia: (id: string | null) => ({
    data: id === null ? null : (state.film ?? state.films.find(one => one.id === id && one.capturedAt) ?? null),
    isError: false,
  }),
}));

vi.mock('@/api/cameras', async importOriginal => ({
  ...(await importOriginal<object>()),
  // The page's own read of its camera is drawn only as one that found nothing; every other test hands the camera in.
  useCamera: () => ({ isPending: false, data: undefined, error: new ApiError(NOT_FOUND), isError: true }),
  useCameras: () => ({ data: { items: state.beside, nextCursor: null } }),
  useLatestStills: () => new Map<string, string | null>(state.lastStill ? [['camera-1', state.lastStill]] : []),
  useTestCapture: () => ({
    mutate: (_: undefined, options?: { onSuccess?: (answer: TestCapture) => void }) => state.capture && options?.onSuccess?.(state.capture),
    data: state.capture ?? undefined,
    error: state.captureError,
    isPending: state.capturing,
  }),
  useRequestTimelapse: () => ({
    mutate: (body: TimelapseCreate, options?: { onSuccess?: (accepted: { media: unknown }) => void }) => {
      state.asked.push(body);
      if (state.accepted) options?.onSuccess?.({ media: state.accepted });
    },
    error: null,
    isPending: false,
  }),
  useTimelapses: () => ({
    data: { pages: [{ items: state.films, nextCursor: state.moreFilms ? 'cursor' : null }] },
    hasNextPage: state.moreFilms,
    isFetchingNextPage: false,
    fetchNextPage: () => {
      state.askedForMore += 1;
    },
  }),
  useUpdateCamera: () => ({
    mutate: (asked: { cameraId: string; body: CameraUpdate }, options?: { onSuccess?: () => void }) => {
      state.saved.push(asked);
      options?.onSuccess?.();
    },
    mutateAsync: (asked: { cameraId: string; body: CameraUpdate }) => Promise.resolve(state.saved.push(asked)),
    isPending: false,
    error: null,
  }),
  useRemoveCamera: () => ({
    mutate: (cameraId: string, options?: { onSuccess?: () => void }) => {
      state.removed.push(cameraId);
      options?.onSuccess?.();
    },
    isPending: false,
    error: null,
  }),
}));

vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), mediaUrl: (id: string) => `/media/${id}`, useSession: () => SIGNED_IN };
});

/**
 * What this account may do with the camera is worked out from the place it
 * stands in and from who owns it, so both halves are answered here - and the
 * place's overview, where the camera's picture of today is read from.
 */
vi.mock('@/api/spaces', async importOriginal => {
  const { spaceWhere, spacesAnswering } = await import('./session');

  return {
    ...(await importOriginal<object>()),
    useSpaces: () => spacesAnswering(spaceWhere(state.youMay)),
    useSpaceOverview: () => ({ data: state.seen ? { cameras: [state.seen] } : undefined }),
  };
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
  drawAt(
    <Composer
      camera={{ ...camera, state: { ...camera.state, lastStillAt: serverNow().toISO()! }, ...over }}
      grow={one}
      pending={false}
      onRender={body => state.asked.push(body)}
      onClose={() => {}}
    />,
  );

/** The grow running where the camera looks: on its 35th day, counted on a UTC calendar. */
const running = { ...grow, summary: { stage: 'flowering', dayNumber: 35, zone: 'UTC' } } as unknown as GrowListItem;

beforeAll(() => translate());

beforeEach(() => {
  // What a page keeps for its history entry outlives a test, whose pages all stand on the one entry a test router has.
  forgetKept();
  state.asked.length = 0;
  state.accepted = null;
  state.beside = [];
  state.film = null;
  window.history.replaceState(null, '', '/');
  state.youMay = 'own';
  state.lastError = null;
  state.films = [];
  state.moreFilms = false;
  state.askedForMore = 0;
  state.zone = 'UTC';
  state.lastStill = null;
  state.capture = null;
  state.capturing = false;
  state.captureError = null;
  state.diary = true;
  state.devices = null;
  state.grows = [];
  state.pages = null;
  state.earlierWeeks = false;
  state.askedForEarlier = 0;
  state.seen = null;
  state.measured = true;
  state.told.length = 0;
  state.saved.length = 0;
  state.removed.length = 0;
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

  it('leaves the phase and the whole grow out where they are not asked to be offered', () => {
    drawAt(<Composer camera={camera} grow={null} growFilms={false} pending={false} onRender={() => {}} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: 'Week' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Phase/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Whole grow' })).not.toBeInTheDocument();
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

  /** One camera or two side by side is a choice only where a second one stands there; nothing is said about one that does not. */
  it('offers a second camera only where one stands there', () => {
    const alone = draw(grow);
    expect(screen.queryByRole('group', { name: 'Cam' })).not.toBeInTheDocument();
    alone.unmount();

    state.beside = [camera, { ...camera, id: 'camera-2', name: 'Side cam' }];
    draw(grow);
    fireEvent.click(within(screen.getByRole('group', { name: 'Cam' })).getByRole('button', { name: 'Both · Side cam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Render · SD' }));

    expect(state.asked[0].secondCameraId).toBe('camera-2');
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
    drawAt(
      <CameraScreen
        camera={{ ...camera, ownerId: state.youMay === 'own' ? YOU : THE_HOST, state: { ...camera.state, lastError: state.lastError } }}
      />,
    );

  it('gives the owner one picture now, a film of his own, the settings with the way to unpair, and the camera´s own words', () => {
    state.lastError = 'rtsp://192.168.1.40/stream1 refused';
    drawPage();

    expect(screen.getByRole('button', { name: 'Take a picture now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Put together your own timelapse/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Camera settings/ })).toHaveTextContent('Name, interval, Premium, unpair');
    expect(screen.getByText(/192\.168\.1\.40/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Camera settings/ }));
    const sheet = within(screen.getByRole('dialog', { name: 'Camera settings' }));
    expect(sheet.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    expect(sheet.getByRole('button', { name: 'Unpair' })).toBeInTheDocument();
  });

  /**
   * A phase and a whole grow are the diary's films. Somebody who keeps none
   * and has no grow here is not shown two refused chips and a sentence about
   * a grow they never meant to start; a diary with nothing growing here is,
   * because the grow it could start is what is missing.
   */
  it('offers the films of a phase and a grow only to a diary, refused with the reason while nothing grows here', () => {
    state.diary = false;
    const { unmount } = drawPage();

    expect(screen.getByRole('button', { name: 'Daily film' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Week' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Phase' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Whole grow/ })).not.toBeInTheDocument();
    unmount();

    state.diary = true;
    drawPage();
    expect(screen.queryByText(/Nothing grows here/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Phase' }));
    expect(screen.getByText(/Nothing grows here/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make the film' })).not.toBeInTheDocument();
  });

  /** A control the reader may not use is absent: nothing is drawn disabled, and nothing is said about what a member may not do. */
  it('gives a member the picture and the films there are, and nothing to make, set or take', () => {
    state.youMay = 'log';
    state.lastError = 'rtsp://192.168.1.40/stream1 refused';
    state.films = [{ id: 'film-week', window: 'week', capturedAt: '2026-09-07T00:00:00.000Z', endsAt: '2026-09-14T00:00:00.000Z' }];
    drawPage();

    expect(screen.queryByRole('button', { name: 'Take a picture now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Put together your own timelapse/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Camera settings/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/192\.168\.1\.40/)).not.toBeInTheDocument();
    // Of the four films only the one there is, and it plays.
    expect(screen.queryByRole('button', { name: 'Daily film' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play the film' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make the film' })).not.toBeInTheDocument();
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute('aria-disabled');
    }

    fireEvent.click(screen.getByRole('button', { name: /^About this camera/ }));
    const sheet = within(screen.getByRole('dialog', { name: 'About this camera' }));
    expect(sheet.queryByRole('textbox')).not.toBeInTheDocument();
    expect(sheet.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(sheet.queryByRole('button', { name: 'Unpair' })).not.toBeInTheDocument();
  });

  it('says there is no film yet to a reader who could not make one', () => {
    state.youMay = 'view';
    drawPage();

    expect(screen.getByText('No film of this camera yet.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Film' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All films' })).not.toBeInTheDocument();
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
   * A press that worked used to change nothing at all on this page. Its answer
   * carries the still it stored: the toast names it by its hour, and the
   * frame shows it - also while the lamp is off and an older, lit picture
   * would otherwise stand there.
   */
  it('shows the picture a press took and says when, rather than going quiet', () => {
    const lit = serverNow().minus({ hours: 3 }).toISO()!;
    state.seen = { cameraId: 'camera-1', name: 'Terp Cam 1', lastStillAt: lit, stills: [], litStill: { mediaId: 'still-lit', capturedAt: lit } };
    state.capture = captured({ state: 'done', still: { mediaId: 'still-new', capturedAt: serverNow().toISO()! } });
    drawPage();
    fireEvent.click(screen.getByRole('button', { name: 'Take a picture now' }));

    expect(state.told).toHaveLength(1);
    expect(state.told[0].label).toMatch(/^Picture of \d\d:\d\d taken$/);
    expect(state.told[0].undo).toBeNull();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/media/still-new');
  });

  /**
   * The same failure the box above the frame already translates. The button
   * printed what the server stored, which is English on every screen. The kind
   * is half a sentence, so alone it is given the first half the add screen
   * gives it.
   */
  it('names the kind of failure a press met, and keeps the camera´s own words under it for the owner', () => {
    state.capture = captured({ state: 'failed', reason: 'aborted', error: 'device aborted the capture' });
    drawPage();
    fireEvent.click(screen.getByRole('button', { name: 'Take a picture now' }));

    expect(state.told).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent(/^No picture: the camera stopped the capture/);
    expect(screen.getByText('What the camera said')).toBeInTheDocument();
    expect(screen.getByText('device aborted the capture')).toBeInTheDocument();
  });

  /**
   * The server can take minutes to read a Terp Cam, and this side giving up is
   * not the camera being out of reach: the press said "That did not reach the
   * camera" while the server was still reading it. The minutes are the read's
   * own budget, which the server keeps.
   */
  it('says that nothing has answered yet where this side gave up, and that the camera was not reached only where it was not', () => {
    state.captureError = new NoAnswerInTime();
    const drawn = drawPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Still no answer after more than 3 minutes. Please try again.');
    drawn.unmount();

    state.captureError = new TypeError('Failed to fetch');
    drawPage();
    expect(screen.getByRole('alert')).toHaveTextContent('That did not reach the camera.');
  });

  /**
   * A Terp Cam is read over its device's relay and is not even tried while
   * that device is offline. The page said only why the last try before it
   * failed - "the device did not open the way to the camera in time" - and left
   * the test button to spend over two minutes finding the same thing out.
   */
  it('says the device the camera is read through is offline, with what to try and the way to it, and holds the picture until it is back', () => {
    const carrier = (secondsAgo: number) =>
      ({
        id: 'device-1',
        name: null,
        type: 'controller',
        spaceId: 'space-1',
        state: { lastSeenAt: serverNow().minus({ seconds: secondsAgo }).toISO()! },
      }) as unknown as Device;
    state.lastError = 'the device did not open the relay in time';
    state.devices = [carrier(60 * 60)];
    const drawn = drawPage();

    expect(screen.getByRole('heading', { name: /^Controller has been offline since / })).toBeInTheDocument();
    expect(screen.getByText('This camera is read through the device (Controller). No pictures arrive until it is back online.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'What you can do ›' }));
    expect(screen.getByText(/Power: is the adapter plugged in/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /See the device/ })).toHaveAttribute('href', '/devices/device-1');
    expect(screen.queryByText(/did not open the way to the camera/)).not.toBeInTheDocument();
    // The camera's last picture is as old as the fixture: the pill says what it waits for rather than an age.
    expect(screen.getByText('waiting for Controller')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take a picture now' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Possible again once the device is back online.')).toBeInTheDocument();
    drawn.unmount();

    state.devices = [carrier(5)];
    drawPage();
    expect(screen.queryByText(/is read through the device/)).not.toBeInTheDocument();
    expect(screen.getByText(/did not open the way to the camera/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take a picture now' })).not.toHaveAttribute('aria-disabled');
  });

  /**
   * A device that has missed its reports opens no relay: a press then waited out the server's whole read (the critic
   * watched "Taking a picture …" for 45 s beside a camera that had not delivered for minutes). Not offered while the
   * device is not heard, with the reason beside it, and a press it fell silent under is dropped rather than left hanging.
   */
  it('holds the picture button while the device it is read through is late with its reports, and drops a press made before', async () => {
    const carrier = (secondsAgo: number) =>
      ({
        id: 'device-1',
        name: null,
        type: 'controller',
        spaceId: 'space-1',
        state: { lastSeenAt: serverNow().minus({ seconds: secondsAgo }).toISO()! },
      }) as unknown as Device;
    state.devices = [carrier(5 * 60)];
    const drawn = drawPage();

    const button = screen.getByRole('button', { name: 'Take a picture now' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Controller is not reporting just now – possible again once it does.')).toBeInTheDocument();
    // Not the box of a device that is gone: it is late, not offline.
    expect(screen.queryByText(/is read through the device/)).not.toBeInTheDocument();
    drawn.unmount();

    // A press made while it was heard, and still waiting when it fell silent: the button says it can be pressed again later.
    state.capturing = true;
    state.devices = [carrier(5)];
    const live = drawPage();
    expect(screen.getByRole('button', { name: 'Taking a picture …' })).toBeDisabled();
    live.unmount();
    state.devices = [carrier(3 * 60)];
    drawPage();
    expect(screen.queryByRole('button', { name: 'Taking a picture …' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take a picture now' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('names a press the server turned down because the device was offline as that', () => {
    expect(causeOf('the device this camera is read through is offline since 2026-10-03T18:48:00.401Z')).toBe('camera.failure.deviceOffline');
  });

  it('gives a co-manager the kind of failure and not the words that name the hardware', () => {
    state.youMay = 'manage';
    // The server holds the words back from a co-manager; the page would not draw them either way.
    state.capture = captured({ state: 'failed', reason: 'noAnswer', error: 'rtsp://192.168.1.40/stream1 refused' });
    drawPage();

    expect(screen.getByRole('alert')).toHaveTextContent('the camera did not answer');
    expect(screen.queryByText(/192\.168\.1\.40/)).not.toBeInTheDocument();
  });

  /** A co-manager runs the tent and may set the camera up; ending it is still the owner's. */
  it('gives a co-manager the form and withholds the unpair', () => {
    state.youMay = 'manage';
    drawPage();

    expect(screen.getByRole('button', { name: 'Take a picture now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Camera settings/ })).toHaveTextContent('Name, interval, Premium');
    expect(screen.getByRole('button', { name: /^Camera settings/ })).not.toHaveTextContent('unpair');

    fireEvent.click(screen.getByRole('button', { name: /^Camera settings/ }));
    const sheet = within(screen.getByRole('dialog', { name: 'Camera settings' }));
    expect(sheet.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    expect(sheet.queryByRole('button', { name: 'Unpair' })).not.toBeInTheDocument();
  });

  /** The page's ways on, each only where what it leads to is there. */
  it('leads to the curves of the place and the diary of the grow, and to neither where there is none', () => {
    const none = drawPage();
    expect(screen.getByRole('link', { name: 'Curves of this day' })).toHaveAttribute('href', '/timeline?space=space-1');
    expect(screen.queryByRole('link', { name: 'Show in the diary' })).not.toBeInTheDocument();
    none.unmount();

    state.grows = [running];
    state.measured = false;
    drawPage();
    expect(screen.queryByRole('link', { name: 'Curves of this day' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show in the diary' })).toHaveAttribute('href', '/grows/grow-1');
  });

  /** An address that names no camera the account can open is a page all the same: a heading, which titles the window, and a way on. */
  it('says under a heading that a camera cannot be opened, with the way to Start', () => {
    drawAt(<CameraPage />, { at: '/cameras/x' });

    expect(screen.getByRole('heading', { level: 1, name: 'Camera' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This camera cannot be opened.');
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  });
});

/**
 * The picture at the head of the page. Today's is the one Start shows: the
 * newest taken in the light, said to be that while the lamp is off. An old
 * picture is dated and stepped back, never called today's.
 */
describe('the picture', () => {
  const drawPage = (over: Partial<Camera> = {}) => drawAt(<CameraScreen camera={{ ...camera, ownerId: YOU, ...over }} />);
  const delivering = (minutesAgo = 0) => ({ state: { ...camera.state, lastStillAt: serverNow().minus({ minutes: minutesAgo }).toISO()! } });
  const pill = () => document.querySelector('[data-liveness]');

  it('shows the newest picture with its hour, and says online with its age', () => {
    state.lastStill = 'still-newest';
    drawPage(delivering());

    expect(screen.getByRole('img')).toHaveAttribute('src', '/media/still-newest');
    expect(screen.getByText(/^Picture from \d\d:\d\d$/)).toBeInTheDocument();
    expect(pill()).toHaveAttribute('data-liveness', 'live');
    expect(pill()).toHaveTextContent(/^online · \d+ s ago$/);
  });

  it('shows the newest lit picture while the lamp is off, and says so', () => {
    const lit = serverNow().minus({ hours: 2 }).toISO()!;
    state.seen = {
      cameraId: 'camera-1',
      name: 'Terp Cam 1',
      lastStillAt: serverNow().toISO()!,
      stills: [],
      litStill: { mediaId: 'still-lit', capturedAt: lit },
    };
    drawPage(delivering());

    expect(screen.getByRole('img')).toHaveAttribute('src', '/media/still-lit');
    expect(screen.getByText(/^Light off · picture from /)).toBeInTheDocument();
  });

  it('names the grow and its day on the picture', () => {
    state.grows = [running];
    state.lastStill = 'still-newest';
    drawPage(delivering());

    expect(screen.getByText('Spring run')).toBeInTheDocument();
    expect(screen.getByText('· Day 35', { exact: false })).toBeInTheDocument();
  });

  /** A camera that has stopped keeps its last picture, dated by its day and dimmed, and the pill says since when. */
  it('steps the last picture of a camera that has stopped back, with its day, and says since when nothing came', () => {
    state.lastStill = 'still-old';
    drawPage();

    expect(screen.getByRole('img')).toHaveAttribute('src', '/media/still-old');
    expect(screen.getByRole('img').parentElement).toHaveAttribute('data-age', 'offline');
    expect(screen.getByText('last picture from 19 Sep 12:00')).toBeInTheDocument();
    expect(pill()).toHaveTextContent('no picture since 19 Sep 12:00');
    // Its alt text names the instant too: read aloud, an old picture is not "just now".
    expect(screen.getByRole('img')).toHaveAccessibleName('Terp Cam 1 at 19 Sep 12:00');
  });

  it('says a camera has never delivered a picture rather than drawing an empty frame for today', () => {
    drawPage({ state: { ...camera.state, lastStillAt: null } });

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('This camera has not delivered a picture yet.')).toBeInTheDocument();
    expect(pill()).toHaveTextContent('no picture yet');
  });

  it('says a camera running late is late, with the age of its last picture', () => {
    state.lastStill = 'still-newest';
    drawPage(delivering(3));

    expect(pill()).toHaveAttribute('data-liveness', 'stale');
    expect(pill()).toHaveTextContent('last picture 3 min ago');
  });

  it('stamps the picture in the account´s zone rather than the browser´s', () => {
    state.zone = 'Asia/Tokyo';
    state.lastStill = 'still-old';
    drawPage();

    expect(screen.getByText('last picture from 19 Sep 21:00')).toBeInTheDocument();
  });
});

/**
 * The slider under the picture: one picture per day of the grow the camera
 * watches, as the diary heads that day's card. Its handle rests only on days
 * that have a picture, and the weeks before those read so far are read once
 * it is moved there.
 */
describe('the days under the picture', () => {
  const still = (dayNumber: number, cameraId = 'camera-1') => ({
    mediaId: `still-${dayNumber}`,
    cameraId,
    capturedAt: NOW.minus({ days: 35 - dayNumber }).toISO()!,
  });
  const day = (dayNumber: number, pictured: ReturnType<typeof still> | null) =>
    ({
      date: NOW.minus({ days: 35 - dayNumber }).toISODate()!,
      dayNumber,
      still: pictured,
    }) as unknown as GrowDiaryPage['items'][number]['days'][number];
  const week = (dayFrom: number, dayTo: number, days: ReturnType<typeof day>[]) =>
    ({ dayFrom, dayTo, days }) as unknown as GrowDiaryPage['items'][number];
  /** Days 29 to 35 read: 34, 32 and 30 pictured by this camera, 33 by another, 31 by none. */
  const firstPage = {
    items: [week(29, 35, [day(35, null), day(34, still(34)), day(33, still(33, 'camera-2')), day(32, still(32)), day(31, null), day(30, still(30))])],
  };
  const older = { createdAt: NOW.minus({ days: 10 }).toISO()! };
  const drawPage = (over: Partial<Camera> = {}) => {
    state.grows = [running];
    state.pages = [firstPage as unknown as GrowDiaryPage];
    state.lastStill = 'still-newest';
    return drawAt(<CameraScreen camera={{ ...camera, ownerId: YOU, ...older, ...over }} />);
  };
  const slider = () => screen.getByRole('slider', { name: 'Day of the grow' });
  const moveTo = (to: number) => fireEvent.change(slider(), { target: { value: String(to) } });

  it('runs from the day the camera was added to today, and opens on today', () => {
    drawPage();

    expect(slider()).toHaveAttribute('min', '25');
    expect(slider()).toHaveAttribute('max', '35');
    expect(slider()).toHaveValue('35');
    expect(screen.getByText('Day 35 of 35')).toBeInTheDocument();
    expect(screen.getByText('one picture a day, from midday')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/media/still-newest');
  });

  it('shows the picture of the day it is moved to, named by its day and dated', () => {
    drawPage();
    moveTo(34);

    expect(slider()).toHaveValue('34');
    expect(slider()).toHaveAttribute('aria-valuetext', 'Day 34, 18 Sep 12:00');
    expect(screen.getByText('Day 34 of 35')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('src', '/media/still-34');
    expect(screen.getByText('Picture from 18 Sep 12:00')).toBeInTheDocument();
    expect(screen.getByText('· Day 34', { exact: false })).toBeInTheDocument();
  });

  /** A day another camera pictured, or none, is no stop: a step lands on the next day this camera has a picture of. */
  it('steps over a day this camera has no picture of, in the direction it was moved', () => {
    drawPage();
    moveTo(34);
    moveTo(33);
    expect(slider()).toHaveValue('32');

    moveTo(31);
    expect(slider()).toHaveValue('30');

    moveTo(31);
    expect(slider()).toHaveValue('32');
    // Back at the right end it is today again, the camera's newest picture.
    moveTo(35);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/media/still-newest');
  });

  it('lands a drag on the pictured day nearest to where it was let go', () => {
    drawPage();
    moveTo(31);

    expect(slider()).toHaveValue('32');
  });

  it('leads to the curves of the day shown, at the moment of its picture', () => {
    drawPage();
    moveTo(32);

    // That day of the grow's calendar as the window, and the cursor on its picture.
    const curves = new URL(screen.getByRole('link', { name: 'Curves of this day' }).getAttribute('href')!, 'http://app');
    const asked = Object.fromEntries(curves.searchParams);
    expect(curves.pathname).toBe('/timeline');
    expect(asked).toMatchObject({ space: 'space-1', at: still(32).capturedAt, grow: 'grow-1' });
    expect(Date.parse(asked.to) - Date.parse(asked.from)).toBe(24 * 3600 * 1000);
    expect(Date.parse(asked.from)).toBeLessThanOrEqual(Date.parse(still(32).capturedAt));
    expect(Date.parse(asked.to)).toBeGreaterThan(Date.parse(still(32).capturedAt));
  });

  /**
   * The day is part of the address, so a reload and the way back find it. It
   * is written there without a navigation: the history gains no entry, and
   * the entry it stands on stays the one the page keeps its state for.
   */
  it('keeps the day it is moved to in the address, and opens on the day an address names', async () => {
    const entries = window.history.length;
    const first = drawPage();
    moveTo(34);
    expect(window.location.search).toBe('?day=34');
    expect(window.history.length).toBe(entries);
    first.unmount();

    state.grows = [running];
    drawAt(<CameraScreen camera={{ ...camera, ownerId: YOU, ...older }} />, { at: '/cameras/camera-1?day=32' });
    expect(slider()).toHaveValue('32');
    expect(screen.getByRole('img')).toHaveAttribute('src', '/media/still-32');

    // Back on today the address names no day.
    moveTo(35);
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('shows today for a day the grow has not reached, and takes that day out of the address', async () => {
    drawPage().unmount();
    drawAt(<CameraScreen camera={{ ...camera, ownerId: YOU, ...older }} />, { at: '/cameras/camera-1?day=400' });

    await waitFor(() => expect(slider()).toHaveValue('35'));
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  /**
   * A sheet stands on a history entry of its own, so Back out of one lands on
   * the page's first entry, whose address has not heard of the day: it is told
   * then. A step that leaves the page has an address that is not the page's.
   */
  it('tells the day to the entry Back out of a sheet lands on, and to no address that is not its own', () => {
    drawPage();
    moveTo(34);
    window.history.replaceState(null, '', '/');
    fireEvent.popState(window);
    expect(window.location.search).toBe('?day=34');

    window.history.replaceState(null, '', '/grows/grow-1');
    fireEvent.popState(window);
    expect(window.location.pathname + window.location.search).toBe('/grows/grow-1');
  });

  /** A drag across a grow is as many days: the address follows the slider at once and then no more often than a browser takes it. */
  it('writes the address at once, and a move that follows right after once the slider has rested', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    try {
      drawPage();
      moveTo(34);
      moveTo(32);
      expect(slider()).toHaveValue('32');
      expect(window.location.search).toBe('?day=34');

      vi.advanceTimersByTime(150);
      expect(window.location.search).toBe('?day=32');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leads to the diary on the day shown', () => {
    drawPage();
    expect(screen.getByRole('link', { name: 'Show in the diary' })).toHaveAttribute('href', '/grows/grow-1');

    moveTo(32);
    expect(screen.getByRole('link', { name: 'Show in the diary' })).toHaveAttribute('href', '/grows/grow-1?day=32');
  });

  /** The diary is read a few weeks at a time: a move to a day before those asks for the weeks before, and says it is reading. */
  it('reads the weeks before once it is moved to a day they hold', () => {
    state.earlierWeeks = true;
    drawPage();
    moveTo(26);

    expect(state.askedForEarlier).toBeGreaterThan(0);
    expect(screen.getByText('Day 26 of 35')).toBeInTheDocument();
    expect(slider()).toHaveValue('26');
  });

  it('settles on the pictured day nearest to where it was left, once there is nothing further back to read', () => {
    drawPage();
    moveTo(26);

    expect(slider()).toHaveValue('30');
  });

  /** A control that cannot change what it points at is no control: no slider where there is no second day to go to. */
  it('draws no slider for a camera added today, where nothing grows, or where no earlier day has a picture', () => {
    const today = drawPage({ createdAt: NOW.toISO()! });
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    today.unmount();

    const empty = drawPage();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    empty.unmount();

    state.grows = [];
    const nothing = drawAt(<CameraScreen camera={{ ...camera, ownerId: YOU, ...older }} />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    nothing.unmount();

    state.grows = [running];
    state.pages = [{ items: [week(29, 35, [day(35, null), day(34, still(34, 'camera-2'))])] } as unknown as GrowDiaryPage];
    drawAt(<CameraScreen camera={{ ...camera, ownerId: YOU, ...older }} />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  /** The day's film is that of the day the slider stands on: played where there is one, made where there is none. */
  it('plays or makes the film of the day shown', () => {
    state.films = [
      {
        id: 'film-34',
        window: 'day',
        capturedAt: NOW.minus({ days: 1, hours: 12 }).toISO()!,
        endsAt: NOW.minus({ days: 1 }).plus({ hours: 11 }).toISO()!,
      },
    ];
    drawPage({ state: { ...camera.state, lastStillAt: serverNow().toISO()! } });
    moveTo(34);
    expect(screen.getByRole('button', { name: 'Play the film' })).toBeInTheDocument();

    moveTo(32);
    fireEvent.click(screen.getByRole('button', { name: 'Make the film' }));
    expect(state.asked).toEqual([{ window: 'day', startsAt: still(32).capturedAt }]);
  });

  it('finds the days of one camera in the pages of a diary', () => {
    const pages = [firstPage as unknown as GrowDiaryPage];

    expect(picturedDays(pages, 'camera-1').map(one => one.dayNumber)).toEqual([30, 32, 34]);
    expect(picturedDays(pages, 'camera-2').map(one => one.dayNumber)).toEqual([33]);
    expect(picturedDays(undefined, 'camera-1')).toEqual([]);
    expect(reachesBackTo(pages)).toBe(29);
    expect(reachesBackTo(undefined)).toBeNull();
  });

  it('counts the day a camera was added on as a date of the grow´s owner', () => {
    const grow = { startedAt: '2026-08-16T12:00:00.000Z', phases: [], summary: { zone: 'UTC' } } as unknown as GrowListItem;

    expect(firstDayOf({ createdAt: '2026-08-16T23:00:00.000Z' }, grow)).toBe(1);
    expect(firstDayOf({ createdAt: '2026-08-17T00:30:00.000Z' }, grow)).toBe(2);
    // Added before the grow began: its first day is the grow's.
    expect(firstDayOf({ createdAt: '2026-07-01T00:00:00.000Z' }, grow)).toBe(1);
  });

  it('lands a move on a pictured day on the side it went to, and stays where that side has none', () => {
    expect(landsOn([30, 32, 34, 35], 35, 34)).toBe(34);
    expect(landsOn([30, 32, 34, 35], 34, 33)).toBe(32);
    expect(landsOn([30, 32, 34, 35], 34, 27)).toBe(30);
    expect(landsOn([30, 32, 34, 35], 30, 29)).toBe(30);
    expect(landsOn([30, 32, 34, 35], 30, 31)).toBe(32);
    expect(nearestTo([30, 32, 34], 26)).toBe(30);
    expect(nearestTo([], 26)).toBeNull();
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
    ['the device is not connected to the broker', 'noDevice'],
    ['this camera has no stream address', 'noAddress'],
    // What the server says of a Terp Cam it reaches over its device's relay.
    ['the controller did not open the relay in time', 'relayNotOpened'],
    ['could not ask the controller for a relay', 'noDevice'],
    ['this camera answers to no device that could bridge it to this server', 'noDevice'],
    ['no relay configured, so the server cannot reach a Terp Cam', 'noAddress'],
    ['this device has not reported a camera we can reach', 'noAddress'],
    ['camera rejected the password', 'refusedLogin'],
    ['the camera refused this server recently', 'refusedRecently'],
    ['UID belongs to a different camera than AAC4014031SCAQ', 'otherCamera'],
    ['camera did not accept the session (only 41x2 in 10s)', 'stoppedEarly'],
    ['no keyframe arrived', 'stoppedEarly'],
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
  const closed = vi.fn();
  const drawSettings = (over: Partial<Camera> = {}, mayManage = true) =>
    drawAt(
      <CameraSettings
        camera={{ ...camera, ...over }}
        mayManage={mayManage}
        mayOwn={mayManage}
        tell={told => state.told.push(told)}
        onClose={closed}
      />,
    );

  beforeEach(() => closed.mockClear());

  it('draws every switch the camera carries, in the state the server gave', () => {
    drawSettings({ maintenanceOff: true, staleWarning: true, logErrors: false, nightOff: false });

    expect(screen.getByRole('switch', { name: 'off during maintenance' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'warn when it stops delivering' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'log failed captures to the diary' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'off in the dark' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('states the stream it pulls, how, and whether it goes through the tunnel', () => {
    drawSettings({ kind: 'rtsp', did: null, model: null, url: 'rtsp://192.168.144.77:554/stream1', transport: 'http', tunnel: true });

    // TCP is what nearly every stream is read over, so only another way is said.
    expect(screen.getByText(reading('rtsp://192.168.144.77:554/stream1 · HTTP'))).toBeInTheDocument();
    expect(screen.getByText(/^RTSP via the device/)).toBeInTheDocument();
    // Stated until it is asked to change: the field it becomes is the next test file's.
    expect(screen.queryByRole('textbox', { name: 'Address' })).not.toBeInTheDocument();
  });

  it('says a stream the cloud opens itself is opened by the cloud, and leaves TCP unsaid', () => {
    drawSettings({ kind: 'rtsp', did: null, model: null, deviceId: null, url: 'rtsp://cam.example.org/live', transport: 'tcp', tunnel: false });

    expect(screen.getByText('rtsp://cam.example.org/live')).toBeInTheDocument();
    expect(screen.getByText(/^RTSP, opened by the cloud/)).toBeInTheDocument();
  });

  it('states the identity and address a Terp Cam answers on', () => {
    drawSettings({ did: 'AAC2851962SPLP', ip: '192.168.144.145', model: 'terp_cam' });

    expect(screen.getByText(reading('AAC2851962SPLP · 192.168.144.145'))).toBeInTheDocument();
  });

  it('draws no address at all where the server kept it from this reader', () => {
    // A co-manager or a guest is answered every one of these as null, so the
    // row is absent rather than a row of dashes.
    drawSettings({ did: null, uid: null, ip: null, url: null, model: null });

    expect(screen.queryByText('Camera ID')).not.toBeInTheDocument();
  });

  it('offers a reader who may not manage the same facts as words, and no switch, no Save and no way to unpair', () => {
    drawSettings({ maintenanceOff: true, staleWarning: true, logErrors: false }, false);

    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getByText(/off during maintenance/)).toBeInTheDocument();
    expect(screen.getByText(/warn when it stops delivering/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unpair' })).not.toBeInTheDocument();
  });

  /** Nothing is saved until Save, and with nothing changed there is nothing to offer. */
  it('turns the save on once a switch has been moved', () => {
    drawSettings({ maintenanceOff: true });

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.click(screen.getByRole('switch', { name: 'off during maintenance' }));

    expect(screen.getByRole('switch', { name: 'off during maintenance' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  /** Every write answers: the sheet goes and the toast names what was changed, with the way to put it back. */
  it('saves what was changed, says which settings those were, and takes them back on undo', async () => {
    drawSettings({ maintenanceOff: true });
    fireEvent.click(screen.getByRole('switch', { name: 'off during maintenance' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Canopy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(state.saved).toEqual([{ cameraId: 'camera-1', body: { maintenanceOff: false, name: 'Canopy' } }]);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(state.told).toHaveLength(1);
    expect(state.told[0].label).toBe('Camera saved · off during maintenance, Name');

    await state.told[0].undo?.();
    expect(state.saved[1]).toEqual({ cameraId: 'camera-1', body: { maintenanceOff: true, name: 'Terp Cam 1' } });
  });

  /** The login of a stream is never served, so the one before a change is not known here: no undo that would put back half. */
  it('offers no undo for an address it could not put back', () => {
    drawSettings({ kind: 'rtsp', did: null, model: null, url: 'rtsp://192.168.1.40/stream1', transport: 'tcp' });
    fireEvent.click(screen.getByRole('button', { name: /^Change the address/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Address' }), { target: { value: 'rtsp://192.168.1.41/stream1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(state.told[0]).toEqual({ label: 'Camera saved · Address', undo: null });
  });

  it('asks before it closes over something unsaved, and closes at once over nothing', () => {
    const untouched = drawSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(closed).toHaveBeenCalledTimes(1);
    untouched.unmount();
    closed.mockClear();

    drawSettings();
    fireEvent.click(screen.getByRole('switch', { name: 'off in the dark' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(closed).not.toHaveBeenCalled();
    expect(screen.getByText('What you changed is not saved yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(state.saved).toHaveLength(0);
  });

  /** Taking a camera off the account cannot be taken back: asked where it stands, then said, and the page it leaves is the place's Steuerung. */
  it('unpairs only after asking, and says that it did', () => {
    drawSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Unpair' }));

    expect(state.removed).toHaveLength(0);
    expect(screen.getByText(/Unpairing stops the cloud reading this camera/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Unpair it' }));
    expect(state.removed).toEqual(['camera-1']);
    expect(state.told).toEqual([{ label: 'Terp Cam 1 unpaired', undo: null }]);
  });
});

/**
 * The films by name. A chip chooses one of the four; the button under them
 * plays the newest film of that kind, or makes it where there is none - and a
 * film that cannot be made is refused here, with the reason, rather than
 * rendered and failed.
 */
describe('the films', () => {
  const drawPage = (over: Partial<Camera> = {}) => drawAt(<CameraScreen camera={{ ...camera, ownerId: YOU, ...over }} />);
  const delivering = { state: { ...camera.state, lastStillAt: serverNow().toISO()! } };
  const filmsNumbering = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `film-${index}` }));
  const listed = () => within(screen.getByRole('list', { name: 'All films' })).getAllByRole('listitem');

  it('plays the newest film of the kind chosen where it stands', () => {
    state.films = [
      { id: 'film-today', window: 'day', capturedAt: '2026-09-19T00:00:00.000Z', endsAt: '2026-09-19T11:00:00.000Z' },
      { id: 'film-yesterday', window: 'day', capturedAt: '2026-09-18T00:00:00.000Z', endsAt: '2026-09-18T23:59:00.000Z' },
    ];
    const { container } = drawPage(delivering);

    expect(container.querySelector('video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play the film' }));

    expect(container.querySelector('video')).toHaveAttribute('src', '/media/film-today');
    expect(container.textContent).toContain('19 Sep 00:00 → 19 Sep 10:59');
    // Putting the film away is not the screen's main action: the button that does it is a quiet one.
    const close = screen.getByRole('button', { name: 'Close the film', expanded: true });
    expect(close.className).not.toMatch(/primary/);
    fireEvent.click(close);
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play the film' }).className).toMatch(/primary/);
  });

  /**
   * The span of a "Week" is the server's to work out, and it works one out
   * around whatever instant it is handed - an instant of now names the week
   * that opened this morning, six days of it in the future. Naming no instant
   * is what the route documents as the most recent complete window.
   */
  it('makes a week the server has already finished rather than the one that opened today', () => {
    drawPage(delivering);

    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make the film' }));

    expect(state.asked).toEqual([{ window: 'week' }]);
  });

  it('makes the day´s film around the instant of now, and nothing else', () => {
    drawPage(delivering);
    fireEvent.click(screen.getByRole('button', { name: 'Make the film' }));

    expect(state.asked).toHaveLength(1);
    expect(state.asked[0].window).toBe('day');
    expect(Math.abs(DateTime.fromISO(state.asked[0].startsAt!).diff(serverNow()).as('seconds'))).toBeLessThan(60);
    expect(state.asked[0].endsAt).toBeUndefined();
  });

  /** A tap on a camera that had taken nothing was answered, queued and left a failed row no screen can remove. */
  it('refuses a day film on a camera that has taken no picture in the last day, with the reason', () => {
    const dark = drawPage({ state: { ...camera.state, lastStillAt: serverNow().minus({ days: 4 }).toISO()! } });

    expect(screen.queryByRole('button', { name: 'Make the film' })).not.toBeInTheDocument();
    expect(dark.container.textContent).toContain('No picture today, so there is nothing to film yet.');
    dark.unmount();

    drawPage({ state: { ...camera.state, lastStillAt: serverNow().minus({ minutes: 5 }).toISO()! } });
    expect(screen.getByRole('button', { name: 'Make the film' })).toBeEnabled();
  });

  /**
   * The week the server picks for itself is the one before the week holding
   * now, so it cannot begin earlier than a fortnight ago: a camera with
   * nothing newer than that has nothing in it. A camera dark for five days
   * still has that week full.
   */
  it('refuses a week film only where the camera took nothing in any week the server could pick', () => {
    const darkFor = (days: number) => drawPage({ state: { ...camera.state, lastStillAt: serverNow().minus({ days }).toISO()! } });

    const recent = darkFor(5);
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('button', { name: 'Make the film' })).toBeInTheDocument();
    recent.unmount();

    const gone = darkFor(20);
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.queryByRole('button', { name: 'Make the film' })).not.toBeInTheDocument();
    expect(gone.container.textContent).toContain('The camera took no picture in the week this would film.');
  });

  /** The week filmed is the last complete one, and a camera paired this week has no picture in it. */
  it('refuses the week film of a camera paired since the last complete week began, and says when its first one ends', () => {
    drawPage({ ...delivering, createdAt: serverNow().minus({ hours: 1 }).toISO()! });
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));

    expect(screen.queryByRole('button', { name: 'Make the film' })).not.toBeInTheDocument();
    expect(screen.getByText(/This camera’s first complete week ends on/)).toBeInTheDocument();
  });

  it('refuses the film of a whole grow to a camera without Premium, and leads to what Premium covers', () => {
    state.grows = [running];
    drawPage({ ...delivering, entitlement: { ...camera.entitlement, tier: 'free' } });

    const chip = screen.getByRole('button', { name: /^Whole grow/ });
    expect(chip).toHaveTextContent('Premium');
    fireEvent.click(chip);

    expect(screen.queryByRole('button', { name: 'Make the film' })).not.toBeInTheDocument();
    expect(screen.getByText('HD and a film of a whole grow are part of Premium.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /What Premium covers/ })).toHaveAttribute('href', '/me/premium');
  });

  it('names both ends of a phase and of a grow from the grow´s own record', () => {
    state.grows = [running];
    drawPage(delivering);

    fireEvent.click(screen.getByRole('button', { name: 'Phase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make the film' }));
    fireEvent.click(screen.getByRole('button', { name: /^Whole grow/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Make the film' }));

    expect(state.asked[0]).toMatchObject({ window: 'phase', startsAt: running.phases[1].startedAt });
    expect(state.asked[1]).toMatchObject({ window: 'grow', startsAt: running.startedAt, quality: 'hd' });
    // The camera here is as old as the grow's last day: both films begin where its pictures do, and the page says so.
    expect(screen.getByText(/This camera has only taken pictures since/)).toBeInTheDocument();
  });

  it('lists every film behind its own row, and follows the cursor for those before', () => {
    state.films = filmsNumbering(20).map(film => ({
      ...film,
      window: 'day',
      capturedAt: '2026-09-19T00:00:00.000Z',
      endsAt: `2026-09-19T00:${film.id.slice(5).padStart(2, '0')}:00.000Z`,
    }));
    state.moreFilms = true;
    drawPage(delivering);

    expect(screen.queryByRole('list', { name: 'All films' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All films' }));
    expect(listed()).toHaveLength(20);

    fireEvent.click(screen.getByRole('button', { name: 'Earlier films' }));
    expect(state.askedForMore).toBe(1);
  });

  it('offers no row of films where there is none, and nothing earlier where the page is all there is', () => {
    const none = drawPage(delivering);
    expect(screen.queryByRole('button', { name: 'All films' })).not.toBeInTheDocument();
    none.unmount();

    state.films = [{ id: 'film-1', window: 'day', capturedAt: '2026-09-19T00:00:00.000Z', endsAt: '2026-09-19T11:00:00.000Z' }];
    drawPage(delivering);
    fireEvent.click(screen.getByRole('button', { name: 'All films' }));
    expect(listed()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Earlier films' })).not.toBeInTheDocument();
  });

  /**
   * Two rows of one span with opposite verdicts, which is what a day rendered
   * twice leaves behind. A grower reading a span's row wants to know whether
   * they can watch that day, and where the answer is yes, a failed attempt at
   * it is not an answer at all.
   */
  it('reports a span that has a film that plays as that film, not as the attempt that failed', () => {
    const span = { capturedAt: '2026-09-19T00:00:00.000Z', endsAt: '2026-09-20T00:00:00.000Z' };
    state.films = [
      { id: 'film-failed', ...span, render: { status: 'failed', error: 'there are not enough pictures in that span to make a film' } },
      { id: 'film-ready', ...span, render: { status: 'ready' } },
      { id: 'film-other-day', capturedAt: '2026-09-18T00:00:00.000Z', endsAt: '2026-09-19T00:00:00.000Z', render: { status: 'failed', error: 'x' } },
    ];
    drawPage(delivering);
    fireEvent.click(screen.getByRole('button', { name: 'All films' }));
    const sheet = screen.getByRole('dialog', { name: 'All films' });

    expect(listed()).toHaveLength(2);
    expect(sheet.textContent).toContain('19 Sep 00:00 → 19 Sep 23:59');
    expect(sheet.textContent).not.toContain('there are not enough pictures in that span to make a film');
    // The other day failed and has nothing standing in for it, so it keeps its row.
    expect(sheet.textContent).toContain('18 Sep 00:00 → 18 Sep 23:59');
  });

  /**
   * The list of films was read before the render was done: the film just
   * asked for is followed by its own row, and once that plays it is the film
   * of its kind - the button plays it rather than offering to make it again.
   */
  it('says that a film is being made, and plays it from the button once it is done', () => {
    const asked = { id: 'film-new', window: 'day', capturedAt: serverNow().startOf('day').toISO()!, endsAt: serverNow().toISO()!, quality: 'sd' };
    state.accepted = { ...asked, render: { status: 'queued', error: null } };
    state.film = state.accepted;
    const page = () => <CameraScreen camera={{ ...camera, ownerId: YOU, ...delivering }} />;
    const { container, rerender } = drawAt(page());

    fireEvent.click(screen.getByRole('button', { name: 'Make the film' }));
    expect(state.told).toEqual([{ label: 'Daily film is being made', undo: null }]);
    expect(screen.getByText('waiting · SD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make the film' })).toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();

    // The row is asked after until its render is over.
    state.film = { ...asked, lengthSeconds: 12, render: { status: 'ready', error: null } };
    rerender(page());

    expect(screen.queryByRole('button', { name: 'Make the film' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('video')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Play the film' }));
    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(container.querySelector('video')).toHaveAttribute('autoplay');

    fireEvent.click(screen.getByRole('button', { name: 'Close the film', expanded: true }));
    expect(container.querySelector('video')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play the film' })).toBeInTheDocument();
  });

  it('opens the composer from its row and follows the film it asked for', () => {
    drawPage(delivering);
    fireEvent.click(screen.getByRole('button', { name: /^Put together your own timelapse/ }));

    expect(screen.getByRole('dialog', { name: 'Timelapse' })).toBeInTheDocument();
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

    expect(screen.getByText(/being made/)).toBeInTheDocument();
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
    expect(screen.getByRole('group')).toHaveTextContent('Technical message');
    expect(container.textContent).toContain('every picture in that span was taken with the light off');
  });

  it('tells a failure in the list quietly, as the history it is, rather than as an alarm over a day full of pictures', () => {
    state.film = film('failed', { error: 'there are not enough pictures in that span to make a film' });
    render(<Film mediaId="media-1" collapsed />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/^not made/)).toBeInTheDocument();
    expect(screen.getByText(/When it was to be made, there were not yet enough pictures/)).toBeInTheDocument();
  });

  it('keeps the render´s own words from a reader who cannot go and fix the camera', () => {
    state.film = film('failed', { error: 'ffmpeg exited with status 251' });
    const { container } = render(<Film mediaId="media-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent('The film could not be made.');
    expect(container.textContent).not.toContain('ffmpeg');
  });
});
