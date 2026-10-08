import { screen, within } from '@testing-library/react';
import { DateTime } from 'luxon';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessNeed, HomeSpaceCard } from '@fg2/shared-types/v1';
import { LooseGrowCard, PlaceCard } from '@/screens/cockpit/PlaceCard';
import { attentionOf, livenessOf, sortedByAttention } from '@/screens/home/attention';
import { DueStrip, FollowingStrip } from '@/screens/home/Strips';
import { LogProvider } from '@/log/LogProvider';
import { drawAt } from './harness';
import { translate } from './translations';

// What a card offers depends on who is looking, so a test says who that is.
vi.mock('@/api/session', async importOriginal => {
  const { SIGNED_IN } = await import('./session');

  return { ...(await importOriginal<object>()), useSession: () => SIGNED_IN };
});

/**
 * The other half of "who is looking": the same account owns one tent and is
 * only let into the next, and what a card may offer is the place's standing
 * rather than the session's. The home's own answer carries no such field, so
 * the space list is where a card reads it - and every place a card here stands
 * in answers the same, which is what makes one line in a test enough.
 */
const may = vi.hoisted(() => ({ youMay: 'own' as AccessNeed }));

vi.mock('@/api/spaces', async importOriginal => {
  const { spaceWhere, spacesAnswering } = await import('./session');
  const places = ['space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-empty', 'space-device-only'];

  return { ...(await importOriginal<object>()), useSpaces: () => spacesAnswering(...places.map(id => spaceWhere(may.youMay, { id }))) };
});

beforeEach(() => {
  may.youMay = 'own';
});

/**
 * One card per space, drawn from what the server answered and nothing else:
 * the values with their targets and ages, dimmed when old and never hidden;
 * the grow with its counter, its "auto" tag and its strains; and the one-line
 * invitation where a half is empty.
 */

const NOW = DateTime.fromISO('2026-06-10T12:00:00.000Z');
const at = (secondsAgo: number) => NOW.minus({ seconds: secondsAgo }).toISO()!;

/** How a silence is dated: the hour if it was today, the day and the hour before that, in the zone of an account that names none. */
const since = (instant: string, now = NOW) => {
  const heard = DateTime.fromISO(instant);
  return heard.hasSame(now, 'day') ? heard.toFormat('HH:mm') : heard.toFormat('d LLL HH:mm');
};

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
    stageWeek: 2,
    stage: 'flowering',
    stagesReached: ['vegetative', 'flowering'],
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

// Every card can log: the sheet and the toast live above the screens, so a
// screen drawn on its own is drawn inside them.
const draw = (node: React.ReactNode) => drawAt(<LogProvider>{node}</LogProvider>);

beforeAll(() => translate());

/**
 * A place on the Start of an account with several: its name opens its cockpit,
 * and the card says what the cockpit's first sentence says, with the readings
 * judged the same way.
 */
describe('a place among several', () => {
  const place = (over: Partial<HomeSpaceCard>) => card({ grow: null, entries: [], ...over }) as HomeSpaceCard & { spaceId: string };

  it('opens the place´s cockpit and says how it is in the cockpit´s words', () => {
    draw(<PlaceCard card={place({})} devices={[]} now={NOW} diary={false} />);

    expect(screen.getByRole('link', { name: 'Tent 1' })).toHaveAttribute('href', '/spaces/space-1');
    // 57 % against a target of 50 ± 5 is off, and the card says so the way the cockpit does - but not
    // "just now", which the cockpit, holding the day's verdict, may contradict with "since 18:02".
    expect(screen.getByText('Humidity 7 % too high')).toBeInTheDocument();
    expect(screen.queryByText(/just now|since/)).not.toBeInTheDocument();
    expect(screen.getByText('57').closest('[data-verdict]')).toHaveAttribute('data-verdict', 'high');
    expect(screen.getByText('25.1').closest('[data-verdict]')).toHaveAttribute('data-verdict', 'in');
  });

  it('says a place gone quiet is offline since its newest reading, and judges none of its figures', () => {
    const quiet = place({ values: card({}).values.map(value => ({ ...value, measuredAt: at(3 * 3600), state: 'offline' as const })) });
    draw(<PlaceCard card={quiet} devices={[]} now={NOW} diary={false} />);

    expect(screen.getByText(`Offline since ${since(at(3 * 3600))}`)).toBeInTheDocument();
    expect(screen.getByText('25.1').closest('[data-verdict]')).toHaveAttribute('data-verdict', 'last');
  });

  it('names the grow standing there only for an account that keeps a diary', () => {
    const growing = place({ grow: card({}).grow });
    const { unmount } = draw(<PlaceCard card={growing} devices={[]} now={NOW} diary />);
    expect(screen.getByText('Spring run · Day 34 · Flower')).toBeInTheDocument();
    unmount();

    draw(<PlaceCard card={growing} devices={[]} now={NOW} diary={false} />);
    expect(screen.queryByText(/Spring run/)).not.toBeInTheDocument();
  });

  it('opens a grow that stands in no place at the grow, because there is no place to open', () => {
    draw(<LooseGrowCard card={card({ spaceId: null, name: 'Spring run', deviceIds: [] })} />);

    expect(screen.getByRole('link', { name: 'Spring run' })).toHaveAttribute('href', '/grows/grow-1');
    expect(screen.getByText(/No fixed place · Day 34 · Flower/)).toBeInTheDocument();
  });
});

describe('what needs a person', () => {
  const alarming = card({
    spaceId: 'space-2',
    name: 'Flower room B',
    openAlerts: [{ alertId: 'alert-1', kind: 'threshold', severity: 'critical', startedAt: at(600), value: 68, metric: 'humidity', name: null }],
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

  it('draws the due strip only from what is due', () => {
    draw(<DueStrip cards={[card({}), due]} now={NOW} />);

    const dueList = screen.getByRole('list', { name: 'Due' });
    expect(dueList).toHaveTextContent('Water · Spring run');
    expect(dueList).toHaveTextContent('today');
    expect(within(dueList).getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  // A task three days out is three days out. Calling everything past today
  // "tomorrow" turns a week's worth of chores into one that all look urgent.
  it('counts a task down in days once it is further off than tomorrow', () => {
    const later = card({
      spaceId: 'space-5',
      name: 'Veg room',
      dueTasks: [
        {
          id: 'task-3',
          kind: 'chore',
          label: 'Check trichomes',
          dueAt: NOW.plus({ days: 3 }).toISO()!,
          subject: { type: 'space', id: 'space-5' },
          assigneeId: null,
        },
        {
          id: 'task-4',
          kind: 'water',
          label: 'Water',
          dueAt: NOW.plus({ days: 1 }).toISO()!,
          subject: { type: 'space', id: 'space-5' },
          assigneeId: null,
        },
      ],
    });
    draw(<DueStrip cards={[later]} now={NOW} />);

    expect(within(screen.getByText('Water').closest('li')!).getByText('tomorrow')).toBeInTheDocument();
    expect(within(screen.getByText('Check trichomes').closest('li')!).getByText('in 3 d')).toBeInTheDocument();
  });

  // The tent's own chores are the tent's, and stay the tent's while a grow
  // stands in it: naming one after the grow sends a person to the wrong place.
  it('names a chore after the place it is about rather than after the grow standing there', () => {
    const chore = card({
      spaceId: 'space-4',
      name: 'Veg room',
      dueTasks: [
        {
          id: 'task-2',
          kind: 'chore',
          label: 'Clean the carbon filter',
          dueAt: NOW.toISO()!,
          subject: { type: 'space', id: 'space-4' },
          assigneeId: null,
        },
      ],
    });
    draw(<DueStrip cards={[chore]} now={NOW} />);

    expect(screen.getByRole('list', { name: 'Due' })).toHaveTextContent('Clean the carbon filter · Veg room');
  });

  it('draws nothing at all when nothing is open, due or followed', () => {
    const { container } = draw(
      <>
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
            endedAt: null,
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

  it('says of a followed grow that has ended that it has, rather than drawing it as one still running', () => {
    draw(
      <FollowingStrip
        grows={[
          {
            growId: 'grow-9',
            slug: 'autoflower-run',
            name: 'Autoflower run',
            handle: 'greenthumb',
            dayNumber: 218,
            stage: 'curing',
            endedAt: '2026-08-24T15:31:56.000Z',
            coverMediaId: null,
            updatedAt: at(3 * 3600),
          },
        ]}
        now={NOW}
      />,
    );

    // The day number is the grow's last day and stays; the age is when its
    // diary last moved, which is neither the end nor a sign of one.
    expect(screen.getByText(/Day 218 · Curing · ended 24 Aug 2026 · 3 h ago/)).toBeInTheDocument();
  });
});

describe('liveness', () => {
  it('is the best of the values, offline for a device that has said nothing, and none without a device', () => {
    expect(livenessOf(card({}), NOW)).toBe('live');
    expect(livenessOf(card({ values: [{ metric: 'temperature', value: 1, measuredAt: at(300), state: 'stale' }] }), NOW)).toBe('stale');
    expect(livenessOf(card({ values: [] }), NOW)).toBe('offline');
    expect(livenessOf(card({ deviceIds: [], values: [] }), NOW)).toBe('none');
  });

  // The dot is a card's one word about whether the place is alive, so it is
  // read at the moment somebody is looking rather than at the moment the home
  // last managed to ask.
  it('falls with the values when the card has gone on being drawn without a new answer', () => {
    const answered = card({ values: [{ metric: 'temperature', value: 1, measuredAt: at(20), state: 'live' }] });

    expect(livenessOf(answered, NOW)).toBe('live');
    expect(livenessOf(answered, NOW.plus({ minutes: 4 }))).toBe('stale');
    expect(livenessOf(answered, NOW.plus({ minutes: 12 }))).toBe('offline');
  });
});
