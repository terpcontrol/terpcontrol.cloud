import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import i18next from 'i18next';
import { DateTime } from 'luxon';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import type { HomeSpaceCard } from '@fg2/shared-types/v1';
import { attentionOf, isClub, livenessOf, sortedByAttention } from '@/screens/home/attention';
import { SpaceCard } from '@/screens/home/SpaceCard';
import { AttentionStrip, DueStrip, FollowingStrip } from '@/screens/home/Strips';

/**
 * One card per space, drawn from what the server answered and nothing else:
 * the values with their targets and ages, dimmed when old and never hidden;
 * the grow with its counter, its "auto" tag and its strains; and the one-line
 * invitation where a half is empty.
 */

const NOW = DateTime.fromISO('2026-06-10T12:00:00.000Z');
const at = (secondsAgo: number) => NOW.minus({ seconds: secondsAgo }).toISO()!;

const card = (over: Partial<HomeSpaceCard>): HomeSpaceCard => ({
  spaceId: 'space-1',
  name: 'Tent 1',
  kind: 'tent',
  roomId: null,
  deviceIds: ['device-1'],
  values: [
    { metric: 'temperature', value: 25.1, measuredAt: at(20), state: 'live' },
    { metric: 'humidity', value: 57, measuredAt: at(20), state: 'live' },
    { metric: 'co2', value: 1010, measuredAt: at(20), state: 'live' },
  ],
  setpoints: [
    { metric: 'temperature', value: 25, band: 1 },
    { metric: 'humidity', value: 50, band: 5 },
  ],
  trend: { metric: 'temperature', stepSeconds: 1800, endsAt: NOW.toISO()!, points: [24.6, 25.0, null, 25.3, 25.1] },
  grow: {
    growId: 'grow-1',
    name: 'Spring run',
    type: 'photoperiod',
    dayNumber: 34,
    phaseDay: 10,
    stage: 'flowering',
    preset: 'flower',
    isAuto: true,
    plantCount: 3,
    strains: ['Amnesia', 'Gelato'],
    coverMediaId: null,
    stageGroups: [],
  },
  entries: [
    {
      id: 'entry-1',
      createdAt: at(86_400),
      kind: 'note',
      occurredAt: at(86_400),
      source: 'human',
      authorId: 'user-mia',
      growId: 'grow-1',
      spaceId: 'space-1',
      deviceId: null,
      plantIds: [],
      cameraId: null,
      taskId: null,
      alertId: null,
      severity: null,
      text: 'Defoliated',
      message: null,
      values: { kind: 'note' },
      mediaIds: [],
      undoUntil: null,
    },
  ],
  latestStill: null,
  dueTasks: [],
  openAlerts: [],
  ...over,
});

const people = [{ id: 'user-mia', handle: 'mia' }];

const draw = (node: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );

beforeAll(async () => {
  const translation = JSON.parse(await readFile(resolve(process.cwd(), 'public/assets/i18n/en.json'), 'utf8'));
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation } }, nsSeparator: false, interpolation: { escapeValue: false } });
});

describe('the climate half', () => {
  it('shows each value large with its target beside it, and says whether it is in band', () => {
    draw(<SpaceCard card={card({})} people={people} now={NOW} compact={false} />);

    const temperature = screen.getByText('25.1').closest('[data-age]')!;
    expect(temperature).toHaveAttribute('data-age', 'live');
    expect(temperature).toHaveTextContent('→ 25');
    expect(temperature).toHaveTextContent('in band');

    // Judged by the band the server put on the setpoint: 5 either side, so 57 is out and 55 would not be.
    const humidity = screen.getByText('57').closest('[data-age]')!;
    expect(humidity).toHaveTextContent('→ 50');
    expect(humidity).toHaveTextContent('+7');
  });

  it('dims an old value by its age and never hides it', () => {
    const stale = card({
      values: [{ metric: 'temperature', value: 24.2, measuredAt: at(3 * 3600), state: 'offline' }],
    });
    draw(<SpaceCard card={stale} people={people} now={NOW} compact={false} />);

    expect(screen.getByText('24.2').closest('[data-age]')).toHaveAttribute('data-age', 'offline');
    expect(screen.getByText(/offline · 3 h/)).toBeInTheDocument();
  });

  it('draws the day of temperature the card came with, and asks for nothing more', () => {
    draw(<SpaceCard card={card({})} people={people} now={NOW} compact={false} />);

    expect(screen.getByRole('img', { name: 'Temperature in Tent 1 over the last 24 hours' })).toBeInTheDocument();
    expect(screen.getByText('24 h')).toBeInTheDocument();
  });

  it('says a metric has no target where the controller holds none', () => {
    draw(<SpaceCard card={card({ setpoints: [] })} people={people} now={NOW} compact={false} />);

    expect(screen.getByText('1010').closest('[data-age]')).toHaveTextContent('no target');
  });

  it('invites a place with nothing measuring to log a reading or add a device', () => {
    draw(<SpaceCard card={card({ deviceIds: [], values: [], setpoints: [], grow: null, entries: [] })} people={people} now={NOW} compact={false} />);

    expect(screen.getByText(/No sensor/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log a reading' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a device' })).toBeInTheDocument();
    expect(screen.queryByText(/live/)).not.toBeInTheDocument();
  });
});

describe('the grow half', () => {
  it('shows the day counter, the phase with its auto tag, the strains and who wrote the newest entry', () => {
    draw(<SpaceCard card={card({})} people={people} now={NOW} compact={false} />);

    expect(screen.getByText('34')).toBeInTheDocument();
    expect(screen.getByText(/Flower · wk 2/)).toBeInTheDocument();
    expect(screen.getByText('auto')).toBeInTheDocument();
    expect(screen.getByText(/Amnesia, Gelato/)).toBeInTheDocument();
    expect(screen.getByText('Defoliated')).toBeInTheDocument();
    expect(screen.getByText(/1 d ago · mia/)).toBeInTheDocument();
    // The place and the grow each open their page; the three actions follow.
    const links = screen.getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/spaces/space-1',
      '/grows/grow-1',
      '/log?kind=water&grow=grow-1',
      '/log?kind=note&grow=grow-1',
      '/log?kind=photo&grow=grow-1',
    ]);
    expect(links.slice(2).map(link => link.textContent)).toEqual(['Water', 'Note', 'Photo']);
  });

  it('draws no auto tag for a phase a person set', () => {
    const grow = { ...card({}).grow!, isAuto: false };
    draw(<SpaceCard card={card({ grow })} people={people} now={NOW} compact={false} />);

    expect(screen.queryByText('auto')).not.toBeInTheDocument();
  });

  it('invites a place without a grow in the record´s words, and takes "not now" for an answer', () => {
    draw(<SpaceCard card={card({ grow: null, entries: [] })} people={people} now={NOW} compact={false} />);

    const invite = screen.getByText(/Nothing growing here yet/);
    expect(invite).toHaveTextContent('Nothing growing here yet · Start a grow · Move a grow here · Not now');

    fireEvent.click(screen.getByRole('button', { name: /Not now/ }));
    expect(screen.queryByText(/Nothing growing here yet/)).not.toBeInTheDocument();
  });

  it('shows a place without a grow its own newest line - what its device or an alarm wrote', () => {
    const line = { ...card({}).entries[0], growId: null, source: 'alarm' as const, authorId: null, text: 'Humidity high 72 % · resolved' };
    draw(<SpaceCard card={card({ spaceId: 'space-device-only', grow: null, entries: [line] })} people={people} now={NOW} compact={false} />);

    expect(screen.getByText('Humidity high 72 % · resolved')).toBeInTheDocument();
    expect(screen.getByText(/· alarm/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing growing here yet/)).toBeInTheDocument();
  });

  it('lets the grow take the header when there is no device', () => {
    const diaryOnly = card({ name: 'Balcony', kind: 'balcony', deviceIds: [], values: [], setpoints: [] });
    draw(<SpaceCard card={diaryOnly} people={people} now={NOW} compact={false} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Spring run');
    expect(screen.getByText('Balcony')).toBeInTheDocument();
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Spring run', 'Balcony', 'Water', 'Photo', 'Reading']);
  });
});

describe('what needs a person', () => {
  const alarming = card({
    spaceId: 'space-2',
    name: 'Flower room B',
    openAlerts: [{ alertId: 'alert-1', kind: 'threshold', severity: 'critical', startedAt: at(600), value: 68, metric: 'humidity' }],
  });
  const due = card({
    spaceId: 'space-3',
    name: 'Veg room',
    dueTasks: [{ id: 'task-1', kind: 'water', label: 'Water', dueAt: NOW.toISO()!, subject: { type: 'grow', id: 'grow-1' }, assigneeId: null }],
  });

  it('orders the cards by what needs a person, and keeps the rest in the order given', () => {
    const quiet = card({ spaceId: 'space-1' });
    expect(sortedByAttention([quiet, due, alarming]).map(item => item.spaceId)).toEqual(['space-2', 'space-3', 'space-1']);
    expect(attentionOf(alarming)).toBeGreaterThan(attentionOf(due));
  });

  it('is a club once places are grouped under rooms', () => {
    expect(isClub([card({}), card({})])).toBe(false);
    expect(isClub([card({ roomId: 'room-1' })])).toBe(true);
  });

  it('draws the attention and due strips only from what is open or due', () => {
    draw(
      <>
        <AttentionStrip cards={[card({}), alarming]} now={NOW} />
        <DueStrip cards={[card({}), due]} now={NOW} />
      </>,
    );

    const attention = screen.getByRole('list', { name: 'Needs attention' });
    expect(within(attention).getAllByRole('listitem')).toHaveLength(1);
    expect(attention).toHaveTextContent('Alarm · 68 % RH · Flower room B');

    const dueList = screen.getByRole('list', { name: 'Due' });
    expect(dueList).toHaveTextContent('Water · Spring run');
    expect(dueList).toHaveTextContent('today');
    expect(within(dueList).getByRole('link', { name: 'Done' })).toBeInTheDocument();
  });

  it('draws nothing at all when nothing is open, due or followed', () => {
    const { container } = draw(
      <>
        <AttentionStrip cards={[card({})]} now={NOW} />
        <DueStrip cards={[card({})]} now={NOW} />
        <FollowingStrip grows={[]} now={NOW} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a followed grow under its owner´s handle', () => {
    draw(
      <FollowingStrip
        grows={[
          {
            growId: 'grow-9',
            slug: 'autoflower-run',
            name: 'Autoflower run',
            handle: 'greenthumb',
            dayNumber: 51,
            stage: 'flowering',
            coverMediaId: null,
            updatedAt: at(3 * 3600),
          },
        ]}
        now={NOW}
      />,
    );

    expect(screen.getByText('@greenthumb · Autoflower run')).toBeInTheDocument();
    expect(screen.getByText(/Day 51 · Flower · 3 h ago/)).toBeInTheDocument();
  });
});

describe('liveness', () => {
  it('is the best of the values, offline for a device that has said nothing, and none without a device', () => {
    expect(livenessOf(card({}))).toBe('live');
    expect(livenessOf(card({ values: [{ metric: 'temperature', value: 1, measuredAt: at(300), state: 'stale' }] }))).toBe('stale');
    expect(livenessOf(card({ values: [] }))).toBe('offline');
    expect(livenessOf(card({ deviceIds: [], values: [] }))).toBe('none');
  });
});
