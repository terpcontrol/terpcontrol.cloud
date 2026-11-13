import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Entry, GrowDiaryDay, GrowDiaryWeek, PublicGrowPage, SpaceOverview } from '@fg2/shared-types/v1';
import { publicPicture } from '@/api/public';
import { session } from '@/api/session';
import { Diary } from '@/screens/public/Diary';
import { FollowButton } from '@/screens/public/FollowButton';
import { PublicGrowRoute } from '@/screens/public/PublicGrowRoute';
import { PublicProfileRoute } from '@/screens/public/PublicProfileRoute';
import { SharedRoute } from '@/screens/public/SharedRoute';
import { SharedSpace } from '@/screens/public/SharedSpace';
import { windowIsCurrent } from '@/screens/public/window';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { drawAt, json } from './harness';
import { translate } from './translations';

/**
 * A diary read by somebody who is not in it.
 *
 * What is checked here is what a stranger is owed: the page stands on its own
 * with no session anywhere near it, every picture on it is addressed by the
 * diary's own public route rather than with a token nobody has, no line carries
 * the name of whoever wrote it, and a page built for a window that has closed
 * says how old it is instead of reading as today.
 */

const state = vi.hoisted(() => ({ session: null as unknown }));

// A chart is a canvas, which jsdom has not got.
vi.mock('@/charts/Chart', () => ({ Chart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} /> }));

vi.mock('@/api/session', async importOriginal => ({
  ...(await importOriginal<object>()),
  useSession: () => state.session,
}));

const NOW = DateTime.fromISO('2026-09-19T12:00:00.000Z');
const at = (daysAgo: number, hour = 10) => NOW.minus({ days: daysAgo }).set({ hour }).toISO()!;

const entry = (over: Partial<Entry>): Entry => ({
  id: 'e1',
  createdAt: at(1),
  kind: 'water',
  occurredAt: at(1),
  source: 'human',
  authorId: 'user-anna',
  growId: 'grow-1',
  spaceId: 'space-1',
  deviceId: null,
  plantIds: [],
  cameraId: null,
  taskId: null,
  alertId: null,
  severity: null,
  text: null,
  message: null,
  values: { kind: 'water', litres: 2, readings: [] },
  mediaIds: [],
  undoUntil: null,
  ...over,
});

/** A day as a reader from outside is answered it: how it was and what was done, nothing the devices did, no share. */
const day = (back: number, over: Partial<GrowDiaryDay> = {}): GrowDiaryDay => ({
  date: NOW.minus({ days: back }).toISODate()!,
  dayNumber: 35 - back,
  startsAt: at(back, 0),
  endsAt: back === 0 ? at(0, 12) : at(back - 1, 0),
  still: null,
  climate: { temperature: 23.6, humidity: 60.2, inBandFraction: null },
  events: [],
  entries: [],
  ...over,
});

const week: GrowDiaryWeek = {
  weekNumber: 5,
  dayFrom: 29,
  dayTo: 35,
  stage: 'flowering',
  preset: 'late_flowering',
  stageWeek: 1,
  film: null,
  days: [
    day(0, { still: { mediaId: 'media-1', cameraId: 'cam-1', capturedAt: at(0) } }),
    day(1, { entries: [entry({ authorId: null })] }),
    day(2, { entries: [entry({ id: 'e2', kind: 'training', authorId: null, text: 'Defoliated', occurredAt: at(2), values: { kind: 'training' } })] }),
  ],
};

const page: PublicGrowPage = {
  slug: 'spring-run',
  growId: 'grow-1',
  name: 'Spring run',
  description: 'Three plants under 400 W.',
  type: 'photoperiod',
  author: { handle: 'mia', bio: 'Two tents in a Berlin flat.', avatarMediaId: 'avatar-1' },
  startedAt: at(34),
  endedAt: null,
  dayNumber: 35,
  stage: 'flowering',
  preset: 'late_flowering',
  // Day 35 is the grow's week 5; the stage it names began two weeks ago.
  stageWeek: 2,
  plantCount: 3,
  strains: ['Amnesia', 'Gelato'],
  coverMediaId: 'cover-1',
  filmMediaId: null,
  // The window of a public diary still running reaches now.
  range: { startsAt: at(34), endsAt: NOW.toISO()! },
  includeCameras: true,
  readingNames: [{ key: 'runoff_ec', name: 'Runoff EC', unit: 'mS/cm' }],
  weeks: [week],
  weeksCursor: null,
  harvest: null,
  totals: { entryCount: 37, waterCount: 9, feedCount: 9, photoCount: 2 },
};

/**
 * The two public addresses as a browser meets them: the diary at its own, where
 * a reader may follow it, and a link onto the same diary, which carries no id
 * and therefore nothing to follow.
 */
/** What a place's Timeline answers a link: the tent, and not the hardware or the grows that stood in it. */
const sharedTimeline = {
  spaceId: 'space-1',
  name: 'Tent 1',
  kind: 'tent',
  range: '24h',
  growId: null,
  dayFrom: null,
  dayTo: null,
  startsAt: NOW.minus({ hours: 24 }).toISO()!,
  endsAt: NOW.toISO()!,
  stepSeconds: 180,
  deviceIds: null,
  panels: [
    {
      metric: 'temperature',
      points: [24, 12, 0].map(hours => ({ measuredAt: NOW.minus({ hours }).toISO()!, value: 24.5 })),
      targets: [],
    },
  ],
  lastReadingAt: null,
  nights: [],
  silences: [],
  alarms: [],
  outputs: [],
  events: [],
  deviceChanges: [],
  machineEvents: { shown: 0, total: 0 },
  grows: [],
  readingNames: [],
  cameras: [],
  people: [],
};

/** Every read made through a link, with the token it carried. */
const reads: { path: string; share: string | null }[] = [];

const fetchStub = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(String(input), 'http://localhost');
  const path = url.pathname.replace(/^\/v1/, '');
  reads.push({ path, share: url.searchParams.get('share') });

  if (path === '/spaces/space-1/timeline') return json({ ...sharedTimeline, range: url.searchParams.get('range') });

  if (path === `/public/grows/${page.slug}`) return json(page);
  if (path === '/shared/a-token') {
    return json({
      kind: 'view',
      range: page.range,
      includeCameras: true,
      expiresAt: null,
      subject: { type: 'grow', grow: page },
    });
  }
  if (path === '/follows') return json({ items: [], nextCursor: null });
  if (path === '/public/users/mia') {
    return json({
      author: page.author,
      grows: [
        {
          growId: 'grow-2',
          slug: 'seriotica',
          name: 'Seriotica',
          handle: 'mia',
          dayNumber: 218,
          stage: 'curing',
          endedAt: '2026-08-24T15:31:56.000Z',
          coverMediaId: null,
          updatedAt: at(83),
        },
      ],
    });
  }

  return json({ code: 'not_found' }, 404);
});

const drawRoute = (at: string, path: string, element: React.ReactNode) => {
  vi.stubGlobal('fetch', fetchStub);

  return drawAt(
    <ThemeProvider>
      <Routes>
        <Route path={path} element={element} />
      </Routes>
    </ThemeProvider>,
    { at },
  );
};

beforeAll(async () => {
  const { SIGNED_OUT } = await import('./session');
  state.session = SIGNED_OUT;

  await translate();
});

describe('a public diary', () => {
  it('stands on its own for a reader with no session: what it is, who it is by, and what has been done to it', () => {
    drawAt(<Diary page={page} picture={publicPicture(page.slug)} now={NOW} />);

    expect(screen.getByRole('heading', { name: 'Spring run' })).toBeInTheDocument();
    expect(screen.getByText('@mia')).toBeInTheDocument();
    expect(screen.getByText('Two tents in a Berlin flat.')).toBeInTheDocument();
    expect(screen.getByText('Three plants under 400 W.')).toBeInTheDocument();
    expect(screen.getByText(/Late flower · week 2 · Amnesia, Gelato · 3 plants · photoperiod · since/)).toBeInTheDocument();

    // The same five figures the owner's own Report counts.
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getAllByText('9')).toHaveLength(2);
    // And the diary by the day, as the grower's own page draws it: how each day was.
    expect(screen.getByRole('article', { name: 'Today · Day 35' })).toHaveTextContent('Ø 23.6 °C · 60 %');
  });

  it('addresses every picture by the diary’s own public route, which carries no token of any kind', () => {
    drawAt(<Diary page={page} picture={publicPicture(page.slug)} now={NOW} />);

    const sources = screen.getAllByRole('img').map(image => image.getAttribute('src') ?? '');
    expect(sources.some(source => source.includes('/v1/public/grows/spring-run/media/cover-1'))).toBe(true);
    expect(sources.some(source => source.includes('/v1/public/grows/spring-run/media/media-1'))).toBe(true);
    expect(sources.every(source => !source.includes('token='))).toBe(true);
  });

  it('names nobody on its lines: the diary has one author, and the people an answer names are not a stranger’s', () => {
    drawAt(<Diary page={page} picture={publicPicture(page.slug)} now={NOW} />);

    expect(screen.getByText('Defoliated')).toBeInTheDocument();
    expect(screen.queryByText('someone')).not.toBeInTheDocument();
    expect(screen.queryByText('you')).not.toBeInTheDocument();
  });

  it('leaves out a harvest weight its owner keeps rather than dashing it out', () => {
    drawAt(
      <Diary page={{ ...page, harvest: { harvestedAt: at(1), wetWeightG: null, dryWeightG: 412 } }} picture={publicPicture(page.slug)} now={NOW} />,
    );

    expect(screen.getByText(/dry 412 g/)).toBeInTheDocument();
    expect(screen.queryByText(/wet/)).not.toBeInTheDocument();
  });

  it('offers the weeks from before the ones it was given, and nothing where the diary fits on its page', () => {
    const asked = vi.fn();
    const older: GrowDiaryWeek = {
      ...week,
      weekNumber: 4,
      dayFrom: 22,
      dayTo: 28,
      days: [day(8, { entries: [entry({ id: 'e8', authorId: null })] })],
    };

    const { rerender } = drawAt(<Diary page={page} picture={publicPicture(page.slug)} now={NOW} />);
    expect(screen.queryByRole('button', { name: 'Earlier weeks' })).not.toBeInTheDocument();

    rerender(<Diary page={page} picture={publicPicture(page.slug)} now={NOW} earlier={{ weeks: [older], more: asked, pending: false }} />);

    // The weeks the page carried and the ones asked for afterwards read as one
    // diary, newest first, and the control is still there because there is more.
    expect(screen.getAllByRole('article', { name: /Day/ }).map(card => card.getAttribute('aria-label'))).toEqual([
      'Today · Day 35',
      'Yesterday · Day 34',
      'Thursday · Day 33',
    ]);
    expect(screen.getByRole('button', { name: /^Day 27/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Earlier weeks' }));
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('calls the last day of a grow that is over its final day, as the owner´s own page does', () => {
    // The figure is frozen at the day the grow ended, and the facts line right
    // under it already says the diary ran to August: "day" there reads as a
    // count still going up.
    const { unmount } = drawAt(<Diary page={{ ...page, endedAt: at(0) }} picture={publicPicture(page.slug)} now={NOW} />);
    expect(screen.getByText('final day')).toBeInTheDocument();
    unmount();

    // A link whose window closed before the grow did is inside a diary that has
    // not ended, which is the same end the week cards on the page are drawn to.
    drawAt(<Diary page={page} picture={publicPicture(page.slug)} now={NOW} />);
    expect(screen.getByText('day')).toBeInTheDocument();
    expect(screen.queryByText('final day')).not.toBeInTheDocument();
  });

  it('counts the week of the stage it has just named, not the week of the whole grow', () => {
    // The line reads "<stage> · week N", and the card two hundred pixels below
    // it repeats the stage week in its own pill: a reader given the grow week
    // there is told a grow has been curing for as long as it has been alive.
    drawAt(<Diary page={{ ...page, stage: 'curing', preset: null, dayNumber: 218, stageWeek: 12 }} picture={publicPicture(page.slug)} now={NOW} />);

    expect(screen.getByText(/Curing · week 12 ·/)).toBeInTheDocument();
    expect(screen.queryByText(/Curing · week 32/)).not.toBeInTheDocument();
  });

  it('says the stage alone where the grow has entered no phase, rather than a week of nothing', () => {
    drawAt(<Diary page={{ ...page, stage: null, preset: null, dayNumber: null, stageWeek: null }} picture={publicPicture(page.slug)} now={NOW} />);

    expect(screen.getByText(/^No phase yet · Amnesia, Gelato/)).toBeInTheDocument();
  });

  it('names a reading by what the grow calls it, not by its key', () => {
    const measured = entry({ authorId: null, values: { kind: 'water', litres: 2, readings: [{ key: 'runoff_ec', value: 1.8, plantId: null }] } });
    drawAt(<Diary page={{ ...page, weeks: [{ ...week, days: [day(0, { entries: [measured] })] }] }} picture={publicPicture(page.slug)} now={NOW} />);

    expect(screen.getByRole('article', { name: 'Today · Day 35' })).toHaveTextContent(/Runoff EC 1\.8 mS\/cm/);
    expect(screen.queryByText(/runoff_ec/)).not.toBeInTheDocument();
  });

  it('leaves its lines inert, because a stranger corrects nothing and has no sheet to be offered one in', () => {
    drawAt(<Diary page={page} picture={publicPicture(page.slug)} now={NOW} />);

    expect(screen.getByText('Defoliated')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Defoliated/ })).not.toBeInTheDocument();
    // Nor does a picture lead into the account: it opens where it stands.
    expect(screen.queryByRole('link', { name: /Camera picture/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Camera picture of day 35/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has no today in a diary that is over, or that a link stopped short of: its days are dates', () => {
    const { unmount } = drawAt(<Diary page={{ ...page, endedAt: at(0) }} picture={publicPicture(page.slug)} now={NOW} />);
    expect(screen.queryByRole('article', { name: /^Today/ })).not.toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Sat 19 Sep · Day 35' })).toBeInTheDocument();
    unmount();

    drawAt(<Diary page={{ ...page, range: { startsAt: at(34), endsAt: at(1, 12) } }} picture={publicPicture(page.slug)} now={NOW} />);
    expect(screen.queryByRole('article', { name: /^Today/ })).not.toBeInTheDocument();
  });

  it('links to the author only where they published a profile, because a handle with none leads nowhere', () => {
    const { rerender } = drawAt(<Diary page={page} picture={publicPicture(page.slug)} now={NOW} />);
    expect(screen.getByRole('link', { name: /@mia/ })).toHaveAttribute('href', '/@mia');

    rerender(<Diary page={{ ...page, author: { handle: 'mia', bio: null, avatarMediaId: null } }} picture={publicPicture(page.slug)} now={NOW} />);
    expect(screen.queryByRole('link', { name: /@mia/ })).not.toBeInTheDocument();
  });
});

describe('a public profile', () => {
  it('says of a diary that is over that it is over, which its own page says one click away', async () => {
    drawRoute('/@mia', '/:handle', <PublicProfileRoute />);

    // The final day and the day it finished on, beside the age of its last
    // line - three different figures, and the card used to draw the first and
    // the third as if the grow were still running.
    expect(await screen.findByText(/Day 218 · Curing · ended 24 Aug 2026 · \d+ d ago/)).toBeInTheDocument();
  });
});

describe('how old a page says it is', () => {
  it('is now while the window still reaches the present, and a dated snapshot once it does not', () => {
    expect(windowIsCurrent(null, NOW)).toBe(true);
    expect(windowIsCurrent(NOW.minus({ minutes: 1 }).toISO()!, NOW)).toBe(true);
    expect(windowIsCurrent(NOW.minus({ days: 7 }).toISO()!, NOW)).toBe(false);
  });
});

describe('a tent behind a link', () => {
  const sharedSpace = (measuredAt: string): SpaceOverview => ({
    spaceId: 'space-1',
    name: 'Tent 1',
    climates: [],
    kind: 'tent',
    roomId: null,
    deviceIds: null,
    // The server called it live when it answered, which is what a page held
    // open for an hour goes on carrying.
    values: [{ metric: 'temperature', value: 25.1, measuredAt, state: 'live' }],
    setpoints: [{ metric: 'temperature', value: 25, band: 1 }],
    targets: null,
    verdict: {
      deviceId: null,
      startsAt: at(1),
      endsAt: at(0),
      forSeconds: 86_400,
      stepSeconds: 120,
      rating: null,
      inBandFraction: null,
      metrics: [],
      actuators: [],
      trend: null,
    },
    grows: [],
    cameras: [],
    entries: [],
    events: [],
    readingNames: [],
    dueTasks: [],
    openAlerts: [],
    people: [],
  });

  it('dims a reading that has stopped moving, however fresh the answer said it was', () => {
    const { unmount } = drawAt(
      <SharedSpace space={sharedSpace(NOW.minus({ minutes: 1 }).toISO()!)} token="a-token" picture={publicPicture('spring-run')} now={NOW} />,
    );

    expect(screen.getByText('25.1').closest('[data-age]')).toHaveAttribute('data-age', 'live');
    unmount();

    drawAt(<SharedSpace space={sharedSpace(at(4))} token="a-token" picture={publicPicture('spring-run')} now={NOW} />);

    // The pill above the tiles already aged it; the tiles under it kept saying live.
    expect(screen.getByText('25.1').closest('[data-age]')).toHaveAttribute('data-age', 'offline');
  });

  /**
   * A window that has closed has no "now", so the answer carries no values -
   * and read as a tent without readings, the page said nothing was ever
   * reported while the answer held the window's last day.
   */
  it('shows the last day of a window that has closed rather than saying nothing was reported', () => {
    const closed = sharedSpace(at(30));
    const space: SpaceOverview = {
      ...closed,
      values: [],
      verdict: {
        ...closed.verdict,
        startsAt: at(31),
        endsAt: at(30),
        metrics: [
          {
            metric: 'temperature',
            rating: null,
            minValue: 20.8,
            maxValue: 29,
            averageValue: 26.9,
            dayBand: null,
            nightBand: null,
            inBandSeconds: 0,
            outOfBandSeconds: 0,
            excursions: [],
          },
        ],
      },
    };

    drawAt(<SharedSpace space={space} token="a-token" picture={publicPicture('spring-run')} now={NOW} />);

    expect(screen.queryByText('Nothing reported yet')).not.toBeInTheDocument();
    expect(screen.getByText(/^Last day of this window/)).toBeInTheDocument();
    expect(screen.getByText('26.9')).toBeInTheDocument();
    expect(screen.getByText('20.8 – 29.0')).toBeInTheDocument();
  });

  it('draws the place’s Timeline for the link, over a day, a week or a month, and offers no way into the app', async () => {
    vi.stubGlobal('fetch', fetchStub);
    reads.length = 0;
    drawAt(<SharedSpace space={sharedSpace(NOW.minus({ minutes: 1 }).toISO()!)} token="a-token" picture={publicPicture('spring-run')} now={NOW} />);

    expect(await screen.findByRole('group', { name: 'Range' })).toBeInTheDocument();
    for (const label of ['24 h', '7 d', '30 d']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    for (const label of ['Phase', 'Grow']) expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Charts/ })).not.toBeInTheDocument();
    await waitFor(() => expect(reads).toContainEqual({ path: '/spaces/space-1/timeline', share: 'a-token' }));
    // The link has no session, so nothing a session would read is asked for.
    expect(reads.some(read => read.path === '/devices' || read.path.startsWith('/grows'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '30 d' }));
    await waitFor(() => expect(fetchStub).toHaveBeenLastCalledWith(expect.stringContaining('range=30d'), expect.anything()));
    vi.unstubAllGlobals();
  });

  it('explains the day’s in-band share where it states it', () => {
    const shown = sharedSpace(NOW.minus({ minutes: 1 }).toISO()!);
    const space: SpaceOverview = { ...shown, verdict: { ...shown.verdict, rating: 'good', inBandFraction: 0.93 } };

    drawAt(<SharedSpace space={space} token="a-token" picture={publicPicture('spring-run')} now={NOW} />);

    expect(screen.getByRole('button', { name: '93 % in band' })).toHaveAccessibleDescription(/^The share of the last 24 hours/);
  });

  /**
   * "Zuletzt" is the diary's own line, as Start draws it: no name on it, the day it was written, and its
   * pictures counted in the line, which is the way to them at the link's own addresses.
   */
  it('says its latest lines as the diary does, and opens a line´s pictures through the link', () => {
    const space: SpaceOverview = {
      ...sharedSpace(at(0)),
      entries: [entry({ id: 'e-photo', kind: 'photo', values: { kind: 'photo' }, text: 'The canopy from above', mediaIds: ['one', 'two'] })],
    };

    drawAt(<SharedSpace space={space} token="a-token" picture={publicPicture('spring-run')} now={NOW} />);

    const latest = within(screen.getByRole('region', { name: 'Latest' }));
    const line = latest.getByRole('listitem');
    expect(line).toHaveTextContent(/^yesterdayPhoto: The canopy from above · 2\s?pictures, open the picture$/);
    expect(line.textContent).not.toMatch(/anna/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(latest.getByRole('button', { name: /The canopy from above/ }));
    const viewer = screen.getByRole('dialog');
    expect(viewer).toHaveAccessibleName('Picture 1 of 2');
    expect(viewer.querySelector('img')).toHaveAttribute('src', publicPicture('spring-run')('one', 1200));
    fireEvent.click(within(viewer).getByRole('button', { name: 'Next picture' }));
    expect(viewer.querySelector('img')).toHaveAttribute('src', publicPicture('spring-run')('two', 1200));
  });

  it('still says nothing has been reported of a tent whose window is open', () => {
    const open = sharedSpace(at(1));
    const space: SpaceOverview = { ...open, values: [], verdict: { ...open.verdict, endsAt: NOW.toISO()! } };

    drawAt(<SharedSpace space={space} token="a-token" picture={publicPicture('spring-run')} now={NOW} />);

    expect(screen.getByText('Nothing reported yet')).toBeInTheDocument();
  });
});

describe('following a diary', () => {
  it('is offered to nobody without an account, and to nobody on the demo, because the server refuses both', async () => {
    const { ON_THE_DEMO, SIGNED_OUT } = await import('./session');

    state.session = SIGNED_OUT;
    const { unmount } = drawAt(<FollowButton growId="grow-1" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();

    state.session = ON_THE_DEMO;
    drawAt(<FollowButton growId="grow-1" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    state.session = SIGNED_OUT;
  });

  it('decides nothing until the stored session has been tried', async () => {
    const { SIGNED_IN, SIGNED_OUT } = await import('./session');

    // A public address restores the session as it loads; a button that decided
    // before that finished would tell a signed-in reader they cannot follow.
    state.session = { ...SIGNED_IN, restored: false };
    const { unmount } = drawAt(<FollowButton growId="grow-1" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();

    state.session = SIGNED_IN;
    drawAt(<FollowButton growId="grow-1" />);
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument();

    state.session = SIGNED_OUT;
  });

  it('is on the diary itself for a reader who is signed in, which is where every screen says it is', async () => {
    const { SIGNED_IN, SIGNED_OUT } = await import('./session');
    state.session = SIGNED_IN;
    // Nothing else on a public address restores the stored session, and without
    // it the page has no reader to offer anything to.
    const restore = vi.spyOn(session, 'restore').mockResolvedValue();

    drawRoute('/g/spring-run', '/g/:slug', <PublicGrowRoute />);

    expect(await screen.findByRole('button', { name: 'Follow' })).toBeInTheDocument();
    expect(restore).toHaveBeenCalled();

    restore.mockRestore();
    state.session = SIGNED_OUT;
  });

  it('is on no diary a link leads to, even a public one: a window onto somebody´s grow is not a subscription', async () => {
    const { SIGNED_IN, SIGNED_OUT } = await import('./session');
    state.session = SIGNED_IN;

    drawRoute('/shared/a-token', '/shared/:token', <SharedRoute />);

    expect(await screen.findByRole('heading', { name: 'Spring run' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Follow/ })).not.toBeInTheDocument();
    state.session = SIGNED_OUT;
  });
});
