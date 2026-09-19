import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Entry, GrowWeekCard, PublicGrowPage } from '@fg2/shared-types/v1';
import { publicPicture } from '@/api/public';
import { Diary } from '@/screens/public/Diary';
import { DiaryWeek } from '@/screens/public/DiaryWeek';
import { FollowButton } from '@/screens/public/FollowButton';
import { windowIsCurrent } from '@/screens/public/window';

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

const week: GrowWeekCard = {
  weekNumber: 5,
  dayFrom: 29,
  dayTo: 35,
  startsAt: at(6),
  endsAt: at(0),
  stage: 'flowering',
  preset: 'late_flowering',
  stageWeek: 1,
  // A reader is not told what hardware stands in the tent; the averages are the diary.
  deviceIds: null,
  climate: [
    { metric: 'temperature', minValue: 20, maxValue: 27, averageValue: 23.6, dayAverage: 26.4, nightAverage: 20.8 },
    { metric: 'humidity', minValue: 55, maxValue: 66, averageValue: 60.2, dayAverage: 62, nightAverage: 58 },
  ],
  lightHours: 12.2,
  days: Array.from({ length: 7 }, (_, index) => ({
    dayNumber: 29 + index,
    startsAt: at(6 - index, 0),
    mediaId: index === 6 ? 'media-1' : null,
    cameraId: index === 6 ? 'cam-1' : null,
    capturedAt: index === 6 ? at(0) : null,
  })),
  feeding: { amounts: [{ productKey: 'bloom', name: 'Bio·Bloom', value: 2, unit: 'ml/l' }], plannedCount: 3 },
  readings: [],
  waterCount: 1,
  feedCount: 2,
  entries: [entry({}), entry({ id: 'e2', kind: 'training', text: 'Defoliated', occurredAt: at(2), values: { kind: 'training' } })],
  entryCount: 2,
  timelapseMediaId: null,
};

const page: PublicGrowPage = {
  slug: 'spring-run',
  name: 'Spring run',
  description: 'Three plants under 400 W.',
  type: 'photoperiod',
  author: { handle: 'mia', bio: 'Two tents in a Berlin flat.', avatarMediaId: 'avatar-1' },
  startedAt: at(34),
  endedAt: null,
  dayNumber: 35,
  stage: 'flowering',
  preset: 'late_flowering',
  plantCount: 3,
  strains: ['Amnesia', 'Gelato'],
  coverMediaId: 'cover-1',
  filmMediaId: null,
  range: { startsAt: at(34), endsAt: at(0, 12) },
  includeCameras: true,
  weeks: [week],
  harvest: null,
  totals: { entryCount: 37, waterCount: 9, feedCount: 9, photoCount: 2 },
};

const draw = (node: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(async () => {
  const { SIGNED_OUT } = await import('./session');
  state.session = SIGNED_OUT;

  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

describe('a public diary', () => {
  it('stands on its own for a reader with no session: what it is, who it is by, and what has been done to it', () => {
    draw(<Diary page={page} picture={publicPicture(page.slug)} now={NOW} />);

    expect(screen.getByRole('heading', { name: 'Spring run' })).toBeInTheDocument();
    expect(screen.getByText('@mia')).toBeInTheDocument();
    expect(screen.getByText('Two tents in a Berlin flat.')).toBeInTheDocument();
    expect(screen.getByText('Three plants under 400 W.')).toBeInTheDocument();
    expect(screen.getByText(/Late flower · week 5 · Amnesia, Gelato · 3 plants · photoperiod · since/)).toBeInTheDocument();

    // The same five figures the owner's own Report counts.
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getAllByText('9')).toHaveLength(2);
    expect(screen.getByText('26.4 / 20.8')).toBeInTheDocument();
  });

  it('addresses every picture by the diary’s own public route, which carries no token of any kind', () => {
    draw(<Diary page={page} picture={publicPicture(page.slug)} now={NOW} />);

    const sources = screen.getAllByRole('img').map(image => image.getAttribute('src') ?? '');
    expect(sources.some(source => source.includes('/v1/public/grows/spring-run/media/cover-1'))).toBe(true);
    expect(sources.some(source => source.includes('/v1/public/grows/spring-run/media/media-1'))).toBe(true);
    expect(sources.every(source => !source.includes('token='))).toBe(true);
  });

  it('names nobody on its lines: the diary has one author, and the people an answer names are not a stranger’s', () => {
    draw(<Diary page={page} picture={publicPicture(page.slug)} now={NOW} />);

    expect(screen.getByText('Defoliated')).toBeInTheDocument();
    expect(screen.queryByText('someone')).not.toBeInTheDocument();
    expect(screen.queryByText('you')).not.toBeInTheDocument();
  });

  it('leaves out a harvest weight its owner keeps rather than dashing it out', () => {
    draw(
      <Diary page={{ ...page, harvest: { harvestedAt: at(1), wetWeightG: null, dryWeightG: 412 } }} picture={publicPicture(page.slug)} now={NOW} />,
    );

    expect(screen.getByText(/dry 412 g/)).toBeInTheDocument();
    expect(screen.queryByText(/wet/)).not.toBeInTheDocument();
  });

  it('links to the author only where they published a profile, because a handle with none leads nowhere', () => {
    const { rerender } = draw(<Diary page={page} picture={publicPicture(page.slug)} now={NOW} />);
    expect(screen.getByRole('link', { name: /@mia/ })).toHaveAttribute('href', '/@mia');

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Diary page={{ ...page, author: { handle: 'mia', bio: null, avatarMediaId: null } }} picture={publicPicture(page.slug)} now={NOW} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('link', { name: /@mia/ })).not.toBeInTheDocument();
  });
});

describe('how old a page says it is', () => {
  it('is now while the window still reaches the present, and a dated snapshot once it does not', () => {
    expect(windowIsCurrent(null, NOW)).toBe(true);
    expect(windowIsCurrent(NOW.minus({ minutes: 1 }).toISO()!, NOW)).toBe(true);
    expect(windowIsCurrent(NOW.minus({ days: 7 }).toISO()!, NOW)).toBe(false);
  });

  it('dates and dims the newest card of a diary a link stopped short of', () => {
    draw(<DiaryWeek week={week} picture={publicPicture('spring-run')} now={NOW} current asOf={at(7, 12)} />);

    const range = screen.getByText(/day 29–35/);
    expect(range).toHaveTextContent('as of 7 d ago');
    expect(range).toHaveAttribute('data-age', 'stale');
  });

  it('says nothing about age on an earlier week, because dating those would be dating the past', () => {
    draw(<DiaryWeek week={week} picture={publicPicture('spring-run')} now={NOW} current={false} asOf={null} />);

    expect(screen.getByText(/day 29–35/)).not.toHaveTextContent('as of');
  });
});

describe('following a diary', () => {
  it('is offered to nobody without an account, and to nobody on the demo, because the server refuses both', async () => {
    const { ON_THE_DEMO, SIGNED_OUT } = await import('./session');

    state.session = SIGNED_OUT;
    const { unmount } = draw(<FollowButton growId="grow-1" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();

    state.session = ON_THE_DEMO;
    draw(<FollowButton growId="grow-1" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    state.session = SIGNED_OUT;
  });
});
